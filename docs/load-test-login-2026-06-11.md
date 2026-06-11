# Login Load Test — Production (MemodoAI)

**Date:** 2026-06-11
**Author:** Pablo Oliva
**Target:** Production LibreChat at `https://chat.memodo.de` (Hetzner Cloud, image `librechat:v0.8.5`)
**Tool:** [k6](https://k6.io) v2.0.0, run from a local macOS machine
**Endpoint under test:** `POST /api/auth/login`

---

## 1. Objective

Measure how the production login path behaves under concurrent load — specifically the
maximum sustainable login throughput and the latency users experience when many people
log in at once. Login is the natural stress target because it performs **bcrypt password
hashing**, which is intentionally CPU-expensive.

---

## 2. Methodology

### 2.1 Test subject: one account, not many mock users

The original plan was to create 100–150 mock users and log in as each. This was dropped
for two reasons:

1. **The login rate limiter is keyed by client IP, not by user** (`keyGenerator: removePorts`
   in `api/server/middleware/limiters/loginLimiter.js`). Distinct users share one rate-limit
   bucket when they originate from the same machine, so 150 different users buys nothing.
2. **Login creates a new session document per request** (`createSession` in
   `api/server/services/AuthService.js`), and there is no per-login write back to the user
   document. So 150 logins as the *same* account produce 150 independent session inserts —
   no single-document write contention — and bcrypt still runs on every request. The test is
   therefore just as valid with one account, while avoiding 150 throwaway accounts with a
   known password sitting on prod.

A single existing credential was used, passed to k6 via environment variables so no secret
was written to disk.

### 2.2 Rate limiter had to be relaxed for the test window

Production defaults (`.env.prod`):

- `LOGIN_MAX=7`, `LOGIN_WINDOW=5` → only 7 login attempts per IP per 5 minutes.
- `BAN_VIOLATIONS=true`, `BAN_DURATION=7200000` (2h) → exceeding the limit bans the IP for 2 hours.

A 150-request burst from one IP would otherwise get ~7 `200`s and ~143 `429`s, then ban the
source IP. For the test window only, the limiter was disabled:

- `LOGIN_MAX=1000`
- `BAN_VIOLATIONS=false`

These were reverted to the protective defaults immediately after each run. **While disabled,
production login has no brute-force protection for any source**, so the window was kept to
the test duration plus two container restarts (~2–3 minutes), attended.

> ⚠️ **Host gotcha (see incident, §6):** applying an `.env.prod` change requires
> `./prod.sh up -d --force-recreate --no-deps api` (a plain `restart` does **not** re-read env
> vars), and any in-place edit of `.env.prod` as the root SSH user must be followed by
> `chown 1000:1000 .env.prod && chmod 600 .env.prod` or the UID-1000 container cannot read it
> and crash-loops.

### 2.3 Canonical host

The live site is served at `chat.memodo.de`. The alias `chat.memodo-eng.de` issues a Caddy
**301 redirect**, and on a POST a 301 is downgraded to GET — so scripted login calls to the
`-eng` host silently fail. All requests targeted `https://chat.memodo.de` directly.
`/api/health` does not exist on v0.8.5 (returns 404); `/` and `/api/config` (both 200) were
used for liveness checks.

### 2.4 Running locally

The test ran from a local machine rather than a co-located box. This is acceptable here
because the measured latencies are in **seconds** while the network round-trip floor is
~100 ms (established by the 1-VU baseline) — the network noise is negligible relative to the
signal. k6 reported **zero client-side connection errors** (no `dial`/timeout/reset), confirming
the local machine was not the bottleneck. For sub-second latency work a co-located generator
would be preferable.

### 2.5 The k6 script

Saved at `scripts/loadtest.js`. Credential and target are passed via `-e` so nothing sensitive
is committed:

```js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'https://chat.memodo.de';
const EMAIL = __ENV.EMAIL;
const PASSWORD = __ENV.PASSWORD;

export const options = {
  scenarios: {
    // Sustained: 150 concurrent virtual users logging in continuously for 30s.
    // Burst variant used: shared-iterations, vus 150, iterations 150.
    login_sustained: { executor: 'constant-vus', vus: 150, duration: '30s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_waiting: ['p(95)<1000'],
  },
};

export default function () {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'status is 200': (r) => r.status === 200,
    'not rate-limited': (r) => r.status !== 429,
  });
}
```

Run:

```bash
k6 run -e BASE=https://chat.memodo.de -e EMAIL=<account> -e PASSWORD='<password>' scripts/loadtest.js
```

### 2.6 Procedure per run

1. **Flip** (disable limiter): backup `.env.prod`, `sed` the two values, `chown 1000:1000`, `force-recreate api`.
2. **Verify health** (`/` and `/api/config` → 200).
3. **Run k6** (1-VU baseline for the network floor, then the load scenario).
4. **Revert**: restore the backup, `chown 1000:1000`, `force-recreate api`.
5. **Verify health** again.

---

## 3. Results

Three scenarios were run. A 1-VU baseline establishes the unloaded floor; the burst fires 150
logins once; the sustained run holds 150 concurrent users for 30 s.

| Metric | Baseline (1 VU) | Burst (150 once) | Sustained (150 × 30s) |
|---|---|---|---|
| Logins completed | 3 | 150 | 472 |
| Success (`200`) | 100% | 100% | 100% |
| Failures | 0% | 0% | 0% |
| Rate-limited (`429`) | none | none | none |
| Throughput | 5.4/s | 11.9/s | **12.3/s** |
| Median latency | 99 ms | 6.58 s | 5.04 s |
| p95 latency | 156 ms | 11.5 s | **36.0 s** |
| Max latency | 163 ms | 11.7 s | 37.5 s |

All runs: **zero errors, zero dropped connections, zero rate-limiting, every response `200`.**

---

## 4. Analysis

### 4.1 The auth path saturates at ~12 logins/sec (bcrypt CPU-bound)

Throughput was ~12/s in **both** the burst and sustained runs, independent of how load was
shaped. That consistency identifies ~12 logins/sec as the genuine service rate. The cause is
bcrypt password hashing running on Node's libuv thread pool — by default `UV_THREADPOOL_SIZE=4`,
so only ~4 hashes compute in parallel; the rest queue. ~4 threads ÷ ~325 ms per hash ≈ 12/s,
matching the measurement.

### 4.2 Burst drains; sustained overload queues unbounded

- **Burst:** 150 requests arrived once and drained through the ~12/s pipe in ~12 s, so the
  worst-case wait was bounded (~11.7 s) and then over.
- **Sustained:** 150 users logged in *continuously*, so arrivals far exceeded 12/s and the
  backlog grew the entire time. Latency climbed from ~5 s median to a **p95 of 36 s** by the
  30 s mark. The only reason it stopped there is that the test ended — at 60 s, p95 would be
  ~70 s. Under persistent overload, latency is bounded only by the overload's duration, not by
  any steady state.

### 4.3 Degrades gracefully, never fails

Even at full saturation the server returned correct `200` responses with no errors, no dropped
connections, and no rate-limiting. The failure mode is *waiting*, not *erroring*.

---

## 5. Real-world interpretation

The sustained scenario (users re-logging-in in a tight loop) is deliberately extreme; real
users log in once. Calibrate to actual peak:

- **Arrivals below ~12/s** → latency stays near baseline (~120 ms). Fine.
- **A one-time spike of N simultaneous logins** → worst-case wait ≈ **N ÷ 12 seconds** for the
  unluckiest user (150 → ~12 s; 360 → ~30 s). No failures, just waiting.
- **A genuinely sustained flood above 12/s** (e.g., credential stuffing) → unbounded queueing.
  This is precisely what the production rate limiter (`LOGIN_MAX=7` + bans) exists to prevent —
  a reminder that the protections relaxed for this test are load-bearing in normal operation.

---

## 6. Operational incident during setup (resolved)

The first flip/revert attempt **took production down for several minutes**. Root cause: editing
`.env.prod` in place as the root SSH user (`sed -i`, `cp`, `mv`) replaced it with a `root:root`
mode-`600` file. The container runs as **UID 1000** and could not read it, so on
`force-recreate` the app's dotenv load yielded nothing and it crash-looped with a misleading
`Azure configuration environment variable "${AZURE_OPENAI_API_KEY_SWEDEN}" was not found` — the
first `${VAR}` reference in `librechat.yaml`, not a genuinely missing variable. The file content
was correct throughout.

**Why it hid:** `restart` reuses the existing container, so env-file ownership only matters at
container *create* time. The latent root-owned file sat harmless until the first `force-recreate`
detonated it.

**Fix / recovery (no secrets needed):**

```bash
ssh Hetzner-personal "cd /opt/docker/librechat && \
  chown 1000:1000 .env.prod && chmod 600 .env.prod && \
  ./prod.sh up -d --force-recreate --no-deps api"
# verify: curl -s -o /dev/null -w '%{http_code}' https://chat.memodo.de/   → 200
```

Diagnostic tells: `502` from Caddy = app down; `ls -ln .env.prod` showing owner `0 0` instead of
`1000 1000` is the smoking gun. All subsequent runs included the `chown` step and ran cleanly.

---

## 7. Recommendation

To raise the ~12/s ceiling, the cheapest lever is **`UV_THREADPOOL_SIZE`** — raising it toward
the host's vCPU count lets more bcrypt hashes run in parallel. It only helps if the box has spare
cores, so the prerequisite is checking the instance's vCPU count against the current thread-pool
setting. Lowering the bcrypt cost factor would also raise throughput but is **not recommended** —
it directly weakens brute-force resistance.

---

## Appendix: exact commands

```bash
# FLIP (disable limiter for the test window)
ssh Hetzner-personal "cd /opt/docker/librechat && cp .env.prod .env.prod.loadtest.bak && \
  sed -i -E 's/^#?\s*LOGIN_MAX=.*/LOGIN_MAX=1000/; s/^#?\s*BAN_VIOLATIONS=.*/BAN_VIOLATIONS=false/' .env.prod && \
  chown 1000:1000 .env.prod && chmod 600 .env.prod && \
  ./prod.sh up -d --force-recreate --no-deps api"

# TEST
k6 run -e BASE=https://chat.memodo.de -e EMAIL=<account> -e PASSWORD='<password>' --vus 1 --iterations 3 scripts/loadtest.js  # baseline
k6 run -e BASE=https://chat.memodo.de -e EMAIL=<account> -e PASSWORD='<password>' scripts/loadtest.js                          # load

# REVERT (restore protections)
ssh Hetzner-personal "cd /opt/docker/librechat && mv .env.prod.loadtest.bak .env.prod && \
  chown 1000:1000 .env.prod && chmod 600 .env.prod && \
  ./prod.sh up -d --force-recreate --no-deps api"
```
