# B02 safe harness preparation — A35 unchanged

Status: **BLOCKED on native Electron probe completion**. The Local harness safety
tests pass; the Electron page load fails closed. No runtime remediation, D01
precedence decision, B03 work, package rebuild, or dependency change is included.

## Inspection and confirmed limits

Inspected all `scripts/b01/*` and `docs/b01/*`, package configuration, both tsconfig
files, the relevant startup/configuration portions of `electron-main.js` and
`server.js`, database and sync runtime paths, `src/lib/api.ts`, `api/index.js`, and
`api/health.js`. Prior B01 and B02 reports are the accepted context.

B01 already provides explicit disposable SQLite validation, offline test-cloud
configuration checks, source/package hashes, read-only metadata fingerprints, and
unconditional legacy guards. It does not provide a server lease, Electron profile
isolation, or an execution boundary for normal ERP startup.

Evidence correction: Node 24 `--permission` does **not** itself deny network
access. B01's corresponding prose overstates that flag. B01 files are preserved;
this harness installs explicit socket/DNS/HTTP controls for its trusted code.
This is not an OS sandbox for arbitrary or hostile code. Never import ERP startup,
third-party test scripts, or unrestricted native addons into this harness.

B01 cloud host discovery can read project/AppData `.env` files without connecting
to a database. The B02 B01-test wrapper redirects AppData and hides `.env` files
from discovery; no real environment file is needed for this regression run.

Normal `electron-main.js` explicitly selects the standard application userData
directory, seeds environment configuration, and launches `server.js`. Normal
server initialization performs schema/seed work. Neither entry is executed here.
The new standalone Electron probe imports only test tooling and Electron APIs.

## Design and commands

```powershell
# Local harness safety suite only; includes an owned loopback server
node --test --test-name-pattern=T-H scripts/b02/harness.test.mjs

# B01 tests under additional network/configuration restrictions
node --test scripts/b02/b01-safe.test.mjs

# Full harness suite: currently FAILS at the Electron probe; do not bypass it
node --test scripts/b02/harness.test.mjs

node scripts/b01/check.mjs types
node scripts/b01/check.mjs syntax
node node_modules/eslint/bin/eslint.js scripts/b02 --ext .mjs,.cjs --env node --no-ignore
```

`createHarness()` creates an owned root under OS temp using the B01-compatible
`erp-b01-b02-` prefix. It creates an empty SQLite fixture from an in-memory database
without creating any application tables or business records. This fixture's
schema intentionally differs from Golden Master. A read-only probe fingerprints
it and verifies byte/structure preservation. No production data is copied.

Every operation requires an explicit `mode: local-test`, root, SQLite target,
userData, appData, API base and exact origin allowlist. This is a **harness mode**,
not a new production configuration variable. Roots are owned by the creating
process. Pre-existing arbitrary roots cannot be enrolled. Missing configuration,
cloud configuration, project/standard-AppData databases, relative/parent paths,
junctions, symlinks, hard links and invalid SQLite headers fail closed.

The server binds numeric loopback on an OS-assigned ephemeral port. Its active
server object leases that exact origin. Allowlisting an arbitrary localhost port
does not grant a lease. External hosts, LAN targets, DNS, TLS, UDP, raw sockets,
global fetch/WebSocket, redirects, proxy CONNECT and upgrades are denied by the
available trusted-harness paths. The probe is read-only and is not an ERP API.

Cleanup requires in-process root ownership, validates the entire tree before any
deletion, rejects links/escapes, and removes individual files/directories without
recursive shell commands. The threat model excludes another privileged process
maliciously replacing validated paths during the run.

## Electron isolation and observed blocker

The launcher preflights the configuration, invokes the installed Electron binary
directly with `windowsHide`, and passes only minimal system environment keys and
explicit disposable paths. No inherited cloud credentials, mode flags, proxies,
NODE_OPTIONS or Electron startup overrides are forwarded. The renderer is hidden,
sandboxed, context-isolated, and has no Node integration.

The independent probe selects disposable appData/userData/sessionData/crash paths,
uses an in-memory browser session, explicitly disables proxies for that session,
denies permission/new-window/navigation requests, and permits exactly the leased
`/api/probe` URL. DNS/background-networking launch restrictions provide additional
defense. Node networking in the Electron main process has no allowed leases.

Observed result: configuration and Electron readiness stages complete; the
loopback server receives the request; Chromium reports `ERR_FAILED` during page
load. Observed URL policy: one allowed request, zero denied. The native cause is
not established. No sandbox/host restrictions were removed to make this pass.
T-E01–T-E04 remain collectively **BLOCKED**, not certified. Do not equate this
standalone shell with testing the production Electron startup or packaged ERP.

The harness audit covers its own socket attempts and Chromium session requests;
it is not an OS-wide packet capture or filesystem-access monitor. No production
request or real AppData access is performed by the test code. Full native-process
confinement is not claimed. Do not run unrestricted ERP code based on these checks.

## Proposed test matrix — requires D01, not implemented

| Scenario | Expected mode | Expected DB | Expected API host |
|---|---|---|---|
| Electron offline | Local | Disposable SQLite | Owned Local backend |
| Electron online | Local-first hybrid; D01 precedence pending | Disposable SQLite plus separately approved test-sync target | Controlled test server |
| Localhost browser | Approved contract, D01 pending | Controlled target | Owned Local backend |
| LAN browser | Explicit contract, D01 pending | Controlled target | Explicit host; simulated until separate LAN authorization |
| Saved LAN host after reload | D01 persistence/priority decision | Controlled target | Approved saved host |
| Saved custom remote host after reload | D01 persistence/priority decision | Controlled target | Approved custom host |
| Custom domain | Online/serverless contract | Test cloud only | Same-origin test API |
| Vercel/serverless | Online | Test cloud only | Same-origin API |
| Missing harness configuration | Fail closed | None | None |
| Invalid harness configuration | Fail closed | None | None |

Missing/invalid *production* configuration expectations still require D01: the
harness's stricter rule does not silently redefine the approved ERP fallback.

Future cases must combine unset/valid/invalid `DATABASE_ENGINE`, `APP_ROLE`,
`VERCEL`, and `IS_WEB_CLIENT`, including conflicting values and credentials present
before SQLite initialization. Record mode, API URL, business DB, sync activation,
fallback and reason for each. Test Electron inheritance, localhost/LAN/custom
domains, saved-host reload/restart, cloud-unavailable operation, reconnect, and
serverless initialization. Do not guess precedence for conflicting flags.

## Evidence and approval

Baseline records hash source, package/lockfile, all B01 records, project DB/WAL,
and schema metadata. Only the explicitly requested read-only metadata inspection
opens the project database; no business-table contents are queried. AppData SQLite
is not opened. Source/package comparison reads the existing ASAR only.

Required approvals before actual A35 remediation: approve this harness after the
Electron blocker is resolved; approve D01 expected precedence/fallback behavior;
then explicitly authorize B02 runtime edits. A dedicated test-cloud target is
separately required for live Online tests. No cloud target is contacted here.

Every new file and its production/schema/business impact is listed in
`change-manifest.json`. All existing B01 and production runtime files remain
unchanged. STOP: A35 and B03 have not begun.
