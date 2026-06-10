# Hardening Documentation Conflicts (post-Markus container hardening)

**Date:** 2026-06-10
**Status:** ✅ All four conflicts resolved 2026-06-10 (documentation-side only; **production was correct throughout and needed no changes**). Per-conflict resolution notes are inline below.
**Scope:** Conflicts between our two operational docs and the container-hardening
work done by the security admin (Markus Wagner) that was merged into this repo as
commit `03bb146f5` ("security: container hardening for prod + monitoring stacks").

## Background

The hardening changes were originally made directly on the prod host, captured in
the self-hosted GitLab repos under `gitlab.dev.memodo.de:memodoai/` (`librechat`,
`platform`, `docs`), and then ported into this fork. The relevant changes:

- `docker-compose.prod.yml` / `monitoring/docker-compose.monitoring.yml`: per-service
  non-root `user:` pinning, `no-new-privileges:true`, `cap_drop: ALL`, and removal
  of the cAdvisor `/var/run` (docker.sock) mount.
- `.env.prod` (host + local master only, gitignored): `UID=1000`/`GID=1000`
  uncommented; `DEBUG_LOGGING` flipped `true`→`false`.
- A host-level OS hardening layer (Ansible, in `platform/`): named admin users,
  key-only SSH, a uid scheme, and an (unbuilt) restic backups role.

The two docs reviewed against that work:

- `docs/production-hardening.md` — the "what's actually implemented" security summary.
- `docs/DEPLOYMENT-CHECKLIST.md` — the step-by-step greenfield deploy procedure.

Markus's authoritative references (for cross-checking): `platform/docs/runbooks/docker-user-hardening.md`
and `docs/reports/hardening-2026-06.md` in his GitLab group.

> **Path convention for this document:** any path prefixed `platform/…`, plus
> `docs/reports/hardening-2026-06.md`, lives in the **separate GitLab repos**
> `gitlab.dev.memodo.de:memodoai/{platform,docs}` — **not** in this project. They
> will not resolve in a clone of this repo. In particular `docs/reports/…` is the
> GitLab `docs` repo, not this project's `docs/` folder. All other `docs/…`,
> `scripts/…`, `docker-compose*.yml`, and `monitoring/…` paths are in this repo.

---

## Conflict 1 — Our docs forbid the `.env.prod` UID/GID change prod now carries

**Severity:** Documentation-vs-reality contradiction. Low operational risk, high confusion risk.

Both of our docs explicitly prohibit `UID=`/`GID=` lines in `.env.prod`:

- `production-hardening.md` A.11 (line ~226): *"The deployment checklist explicitly
  forbids adding `UID=`/`GID=` to `.env.prod` (they're bash readonly built-ins;
  backup scripts would abort on `set -a; source .env.prod`)."*
- `DEPLOYMENT-CHECKLIST.md` Step 1.1 (line ~152): *"**Do NOT add `UID=` or `GID=`
  lines to `.env.prod`.** … the backup scripts (which do `set -a; source .env.prod`)
  will abort with `readonly variable` and never create their backup directories."*

Markus's hardening **uncommented `UID=1000`/`GID=1000`** in prod's `.env.prod` (and
the byte-identical local master copy at `/Users/pablooliva/Dev/AI dev/LibreChat/.env.prod`).
So our own checklist, read literally, declares prod misconfigured.

**Why the prohibition is stale:**

- The stated reason no longer applies. The backup scripts (`scripts/backup-mongodb.sh`
  lines ~25-37, and siblings `backup-minio.sh` / `backup-postgres.sh`) no longer do
  `set -a; source .env.prod`. They use a `get_env()` helper that `grep`s only the
  specific keys needed and treats values as opaque strings. `UID=`/`GID=` lines do
  **not** break them. The checklist half-acknowledges this at line ~492.
- Removing the lines wouldn't even un-harden prod. Base `docker-compose.yml` uses
  `user: "${UID}:${GID}"` for exactly three services — `api` (line 14), `mongodb`
  (line 34), `meilisearch` (line 44) — and `docker-compose.prod.yml` overrides **all
  three** with literal users (`api` → `1000:1000` line ~28, `mongodb` → `999:999`
  line ~115, `meilisearch` → `1000:1000` line ~171; plus `vectordb` → `999:999`
  line ~200 and `minio` → `1000:1000` line ~276). In the prod merge the literal
  override wins, so the `.env.prod` values are effectively shadowed. Markus's own
  runbook says setting them in `.env.prod` is *"NOT enough"* on its own.

**Failure mode:** not a crash — a person. An auditor comparing prod to our checklist
flags the UID/GID lines as a defect and "fixes" them; or a greenfield redeploy
follows the checklist and omits them.

**Recommended fix:** in both docs, drop the absolute prohibition and replace it with
an explanation of the literal-pin model (pin `user:` literally in `prod.yml`;
UID/GID in `.env.prod` are harmless and silence `docker compose` "variable not set"
warnings on the non-`prod.sh` path).

**✅ Resolved 2026-06-10:** rewrote `production-hardening.md` A.11 (both the
"forbids" bullet and the now-false "scripts use `set -a; source`" bullet) and
`DEPLOYMENT-CHECKLIST.md` Step 1.1 callout to explain the literal-pin model and the
keep-scripts-grep-based caveat. Also fixed the contradicting "remove them" warning
at the Step 2.3 backup-test step (it now says fix-forward the older script, don't
remove the env-file lines).

---

## Conflict 2 — The checklist is missing the host `chown` prerequisites the merged compose now requires

**Severity:** Latent deploy breakage. **This is the one that could actually break a fresh deploy.**

Markus's `cap_drop: ALL` has a hard coupling, documented in his
`docker-user-hardening.md` runbook: dropping all capabilities removes
`CAP_DAC_OVERRIDE`, so a container can no longer write files it doesn't own. The
scheme only works because the host directories were chown'd to match the container
UIDs:

- `uploads`, `logs`, `images`, `.env.prod`, `meili_data_v1.35.1`, `minio-data` → `1000:1000`
- the mongodb `data-node` dir and the postgres volume were already `999:999`.

That hardened `docker-compose.prod.yml` is **now merged into this repo**, but
`DEPLOYMENT-CHECKLIST.md` (the greenfield deploy procedure) contains **no chown
steps**. A fresh deploy that follows the checklist and brings up the merged compose
would start containers with `cap_drop: ALL` against root-owned bind-mounts and
**EACCES crash-loop** (exactly the symptom Markus hit and recorded).

**Recommended fix:** add the chown prerequisites to `DEPLOYMENT-CHECKLIST.md` as a
step that runs before first `up`. The compose gained a prerequisite the checklist
doesn't yet teach.

**✅ Resolved 2026-06-10:** added a "Set host ownership for the hardened
containers — REQUIRED before the first `up`" checklist item to Step 1.8 (before
`./prod.sh up -d`), with the exact `chown` commands for the bind-mounts
(`uploads`/`logs`/`images`/`.env.prod`/`meili_data_v1.35.1`/`minio-data` → 1000,
`data-node` → 999), a note on the `pgdata2` named-volume case, and a pointer to the
`platform` runbook.

---

## Conflict 3 — `production-hardening.md` no longer describes what's actually deployed

**Severity:** Completeness gap. Confusion risk (people treat this doc as source of truth).

`production-hardening.md` bills itself (line ~13) as *"a human-readable summary of
what was actually implemented."* After Markus's work it is materially incomplete:

- No mention of **non-root container users**, **`no-new-privileges`**, **`cap_drop:
  ALL`**, or the **cAdvisor docker.sock removal** — collectively the single biggest
  hardening change since the doc was written.
- A.10 "Operating system hardening" doesn't mention the **uid scheme** Markus
  introduced: uid `1000` reserved as a locked, no-login `librechat` service identity;
  human admins `markus`/`pablo` pinned to `1100`/`1101`.

**Latent hazard:** a greenfield provision per our docs could create a human or admin
account at uid `1000` and collide with the container service identity whose data
dirs are chown'd to `1000`.

**Recommended fix:** add a container-runtime-hardening subsection to Part A and the
uid scheme to A.10.

**✅ Resolved 2026-06-10:** added subsection **A.13 Container runtime hardening
(2026-06)** to `production-hardening.md` (non-root literal user pinning,
`no-new-privileges`, `cap_drop: ALL`, cAdvisor docker.sock removal, node-exporter
healthcheck, and the host-ownership coupling), and a **uid scheme + named admins**
bullet to A.10 (including the "don't create a human at uid 1000" warning).

---

## Conflict 4 — Two backup philosophies (latent; both sides already flag it)

**Severity:** Latent collision. Low risk while contained.

`production-hardening.md` B.4 documents the **live** backup system: cron-driven
`mongodump` / `mc mirror` / `pg_dump` via `crontab.prod`. Markus's Ansible `backups`
role (`platform/ansible/roles/backups/`) installs a **restic** stack instead.

Both sides already know this is a collision: Markus's `hardening-2026-06.md` §8 and
his `docker-user-hardening.md` runbook **explicitly warn not to run `deploy.sh
harden`** because the backups role *"would install a competing restic stack next to
the working `crontab.prod` backups."* Contained while nobody runs his playbook; a
real conflict the moment someone does.

**Recommended fix:** add a one-line cross-reference in B.4 pointing at the
`deploy.sh harden` warning, so the collision is visible from our side too.

**✅ Resolved 2026-06-10:** added a blockquote at the top of `production-hardening.md`
B.4 stating the cron scripts are the live/authoritative system and warning not to
run `deploy.sh harden`/`all` (which would install the competing restic stack),
with pointers to the `platform` runbook and `hardening-2026-06.md` §8.

---

## Not conflicts (recorded to prevent re-investigation)

- **`DEBUG_LOGGING` true→false** — an **alignment**, not a conflict. Our doc B.3
  (line ~294) already specifies `DEBUG_LOGGING=false` as the production target, so
  prod was previously *non-compliant with our own doc* and Markus's flip fixed it.

- **`ALLOW_EMAIL_LOGIN=false` "Disabled at the endpoint"** — a **pre-existing
  inaccuracy**, not introduced by Markus. Our doc's "At a glance" (line ~25) and A.4
  (line ~102) describe email/registration login as *"Disabled at the endpoint,"* but
  the endpoint (`POST /api/auth/login`) is **not** disabled — only the UI form is
  hidden (the flag is read solely in `api/server/routes/config.js` → consumed by
  `client/src/components/Auth/Login.tsx`; `requireLocalAuth` still runs
  unconditionally in `api/server/routes/auth.js`). Markus's flip is the same UI-only
  mechanism. If true SSO-only enforcement is wanted, it needs a Caddy rule blocking
  `POST /api/auth/login` or a server-side gate. See the separate email-login finding.

---

## Remediation priority

| # | Conflict | Type | Priority | Status |
|---|---|---|---|---|
| 1 | `.env.prod` UID/GID prohibition contradicts prod; reason is stale | Doc vs reality | High (confusion) | ✅ Resolved 2026-06-10 |
| 2 | Checklist missing `chown` prerequisites for `cap_drop: ALL` | Latent breakage | **Highest** (deploy-breaking) | ✅ Resolved 2026-06-10 |
| 3 | `production-hardening.md` omits container hardening + uid scheme | Completeness | Medium | ✅ Resolved 2026-06-10 |
| 4 | crontab vs restic backups | Latent collision | Low (contained) | ✅ Resolved 2026-06-10 |

All four were edits to our markdown docs only; nothing on the production host was
changed. Files touched: `docs/production-hardening.md` (A.10, A.11, new A.13, B.4)
and `docs/DEPLOYMENT-CHECKLIST.md` (Step 1.1 callout, Step 1.8 chown step, Step 2.3
backup-test warning).
