# GDPR Article 17 Erasure Procedure

**Spec:** SPEC-010-production-readiness (REQ-048)
**Script:** `scripts/gdpr-erase-user.sh`
**Last Updated:** 2026-04-30

This runbook is for fulfilling a verified data subject's right-to-erasure request. The companion script automates everything that can be automated; this document covers the parts that require human judgement and the verification steps you should perform afterward.

## When to use this

A data subject (or their authorised representative) has submitted an Article 17 request and you have:

1. Verified their identity (matching the email on file is sufficient when combined with possession of the inbox — confirm via a reply-to-confirm exchange).
2. Confirmed there is no overriding obligation to retain the data (legal hold, ongoing dispute, tax/accounting records). If any apply, document the basis and refuse the request in writing per Article 17(3).
3. Recorded the request in your compliance tracker with date received and target response date (one calendar month under Article 12(3)).

Do not run the script against accounts that haven't cleared those checks.

## What the script handles

| System | How | Verification |
|---|---|---|
| MongoDB (21 collections) | Delegates to `config/delete-user.js` | Counts logged at the end of the run |
| MeiliSearch (`convos`, `messages`) | Auto-cascades from Mongo `deleteMany` via the mongoMeili plugin (`packages/data-schemas/src/models/plugins/mongoMeili.ts:663`) | None needed — happens transactionally with the Mongo delete |
| MinIO (all per-user prefixes) | Enumerates top-level basePaths (`images/`, `files/`, …) and removes `<basePath>/<USER_ID>/` from each | Lists remaining objects under `/<USER_ID>/` |
| pgvector (RAG embeddings) | Calls RAG API `DELETE /documents` with file_ids captured before the Mongo delete | Embeddings count against the user_id falls to zero (per-file response codes logged) |

## What the script does NOT handle (operator responsibility)

These are out of scope for the script — either because they're upstream of the deletion or because they require judgement. Address each one separately.

1. **Identity verification of the requester.** See "When to use this" above.
2. **Legal-hold check.** No automation can know whether this user is subject to litigation hold, regulatory retention, or active fraud investigation. Verify before invoking the script.
3. **Off-host backups.** The nightly off-host backup (`scripts/backup-offhost.sh`) and local backups (`backups/{mongodb,minio,postgres}/`) retain data until their retention windows expire (default 30 days). Article 17 plus Recital 26 explicitly allow this when:
   - The retention is documented and time-bounded.
   - The data is not actively used during the retention window.
   - The data is purged on schedule when the window expires.

   Disclose this to the data subject in your reply: *"Your data has been removed from production systems on YYYY-MM-DD. Encrypted backups containing earlier snapshots will be purged automatically by DD MM YYYY (30 days)."*
4. **MinIO console-managed users / bucket policies.** If you've manually created MinIO IAM users or bucket policies referencing this person, those persist. Check `mc admin user list local` and `mc admin policy list local`.
5. **External systems holding derivatives.** Azure OpenAI's prompt/completion logging (REQ-033 diagnostic settings), if enabled, retains request bodies in your Log Analytics workspace per Azure's retention. Submit an Azure data subject request separately if the data subject's content is in scope.
6. **MeiliSearch when it was offline during deletion.** If the API container could not reach MeiliSearch when `deleteMany` ran (network blip, Meili restarting), the plugin logs a warning and proceeds — the Mongo data is gone but the Meili index entries remain. After running the script, check `./prod.sh logs api | grep MeiliMongooseModel.deleteMany` for warnings on the same timestamp; if any, run `docker exec LibreChat node config/reset-meili-sync.js` and `./prod.sh restart api` to trigger a full reindex.
7. **Compliance tracker entry.** The script writes a local audit log to `backups/gdpr/<timestamp>_<email>.log`, but you must record completion in whatever system tracks data subject requests for your DPA.

## Procedure

### 1. Pre-flight

```bash
cd /opt/docker/librechat

# Confirm the user exists and capture their _id for your records.
docker exec chat-mongodb mongosh --quiet \
  -u librechat \
  -p "$(grep ^LIBRECHAT_MONGO_PASSWORD .env.prod | cut -d= -f2-)" \
  --authenticationDatabase LibreChat \
  --eval "db.getSiblingDB('LibreChat').users.findOne({email:'<email>'}, {_id:1, email:1, createdAt:1})"
```

If no user is returned, the email never had an account — reply to the data subject confirming that fact and close the request.

### 2. Dry run

Always do this first. It shows what would be deleted without touching anything.

```bash
./scripts/gdpr-erase-user.sh <email> --dry-run
```

Review the output:
- Is the captured `user._id` the right one?
- Are the file_ids what you expect?
- Are the MinIO basePaths sensible (`images/`, `files/`, …)?

If the bucket has unexpected top-level prefixes, investigate before proceeding — the script will try to remove `<unexpected-prefix>/<USER_ID>/` from every prefix it finds.

### 3. Execute

```bash
./scripts/gdpr-erase-user.sh <email>
```

The script will:
- Print the user's `_id` and require you to type the email back to confirm.
- Capture file metadata into the audit log (file_ids needed for RAG cleanup are gone after the Mongo delete).
- Run `npm run delete-user`, answering both prompts with `y` (transactions are deleted by default for GDPR — keeping them attached to a deleted user is itself a problem).
- Call the RAG API for each embedded file_id.
- Remove all per-user prefixes from MinIO.
- Print verification counts.

The full run is logged to `backups/gdpr/<timestamp>_<email>.log`. Keep this file — it is the proof of action for the data subject's reply and your DPA tracker.

### 4. Verify

The script prints verification at the end. Spot-check:

- Mongo collection counts: all `0`.
- "MinIO objects under user prefix": `(clean)`.
- No `WARN:` lines from the RAG step.

If any verification fails, see "Edge cases" below.

### 5. Reply to the data subject

Suggested template:

> Dear <name>,
>
> Per your request dated <DATE_RECEIVED>, we have erased your account and associated data from our production systems on <DATE_OF_RUN>.
>
> The following data has been removed: account profile, conversation history, messages, uploaded files, search index entries, and AI memory entries. Encrypted backups containing earlier snapshots will be purged automatically by <DATE_OF_RUN + 30 days>, in line with our documented backup retention policy.
>
> If you have a copy of this email and a follow-up question, please reply within 14 days; after that, we will have no remaining link between this address and any record of the request.
>
> Regards, …

### 6. Record completion

Update your compliance tracker with:
- Date erasure was run.
- Path to the audit log on the production server.
- Confirmation email message-id (so future audits can correlate).

## Edge cases

### RAG API was unreachable

The script logs `WARN: RAG API call returned non-zero` and continues. The Mongo files document is gone, so the file_ids are no longer recoverable from the app — but the audit log captured them in step 1. To complete the cleanup:

```bash
# Reach into vectordb directly. Schema is langchain default.
PGPW=$(grep ^POSTGRES_PASSWORD .env.prod | cut -d= -f2-)
docker exec -e PGPASSWORD="$PGPW" vectordb \
  psql -U librechat_rag -d librechat_rag \
  -c "DELETE FROM langchain_pg_embedding WHERE cmetadata->>'user_id' = '<USER_ID>';"
```

Confirm column names with `\d langchain_pg_embedding` first — the layout may differ across RAG API versions.

### MinIO was unreachable

The `mc rm` step will fail loudly. Re-run only the MinIO portion manually:

```bash
USER_ID=<from-audit-log>
NETWORK="$(docker inspect chat-mongodb --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)"
MINIO_ROOT_USER="$(grep ^MINIO_ROOT_USER .env.prod | cut -d= -f2-)"
MINIO_ROOT_PASSWORD="$(grep ^MINIO_ROOT_PASSWORD .env.prod | cut -d= -f2-)"

docker run --rm --network "$NETWORK" \
  -e "MC_HOST_local=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio:9000" \
  minio/mc:RELEASE.2025-03-12T17-29-24Z \
  ls --recursive "local/librechat/" | grep "/${USER_ID}/"
# Then mc rm --recursive --force on each prefix found.
```

### User had MeiliSearch entries that didn't cascade

Symptoms: searches in the UI still surface the deleted user's messages.

```bash
# Force a full Meili rebuild on next API start.
docker exec LibreChat node config/reset-meili-sync.js
./prod.sh restart api
# Wait a few minutes for the background sync to finish; messages from the
# deleted user will no longer be in the Mongo source of truth, so they won't
# be re-indexed.
```

### Re-running after partial failure

The script is safe to re-run: each step is idempotent (already-deleted Mongo docs return zero deletions, missing MinIO objects return "not found", RAG API returns 404 for already-deleted file_ids — treated as success). Re-run with the same email; you'll get a fresh audit log timestamp.

### User had transactions you wanted to keep

The script always answers "y" to the transaction-deletion prompt. If you have a legitimate reason to retain transactions (legal hold, billing dispute), do not use the script — invoke the CLI manually:

```bash
docker exec -it LibreChat npm run delete-user -- <email>
# Answer "y", then "n" for transactions.
```

…then perform the MinIO + RAG cleanup steps from the script by hand. Document the basis for retention in the audit record.

## Test drill (no real user data)

Recommended cadence: once per quarter, on a non-production environment, to validate the procedure still works after dependency updates.

```bash
# 1. Create a throwaway user.
docker exec -it LibreChat npm run create-user -- \
  gdpr-drill@memodo.de "GDPR Drill" gdprdrill --email-verified=true

# 2. Log in as them, generate a few conversations and upload at least one file
#    that gets embedded (PDF/text). This exercises the RAG path.

# 3. Dry-run, then execute.
./scripts/gdpr-erase-user.sh gdpr-drill@memodo.de --dry-run
./scripts/gdpr-erase-user.sh gdpr-drill@memodo.de --yes

# 4. Confirm verification block at the end of the audit log shows zero counts
#    and a clean MinIO listing.
```

If the drill fails, the script or the underlying APIs have drifted — fix before the next real request lands.

## References

- Code: `config/delete-user.js`, `scripts/gdpr-erase-user.sh`, `packages/api/src/files/rag.ts`, `packages/data-schemas/src/models/plugins/mongoMeili.ts`
- Spec: `SDD/specs/SPEC-010-production-readiness.md` (REQ-048)
- Backup retention: `docs/runbooks/backup-restore.md`
