# B01 verification contract

Scope: verification infrastructure and one confirmed type-only correction. No
application startup, business remediation, production cloud access, or packaging.

## Authoritative runtime

`server.js` imports `src/db/connection.js` and `src/services/syncService.js`.
Those JavaScript files are authoritative for backend execution. Their TypeScript
counterparts are not generated into runtime JavaScript by this verification
tooling. Neither counterpart was changed. Electron starts the same backend;
Online `api/index.js` imports it. Importing the backend is **not** a safe test setup.

The purchase-order GET route selects existing `purchase_orders` records and
returns `updated_at: po.updated_at || null`. Purchasing spreads that response into
its order state. `PurchaseOrder.updated_at?: string | null` describes this existing
contract; it changes no runtime behavior or schema.

## Safe commands

Run from the project root using the already installed Node 24 runtime:

```powershell
node scripts/b01/check.mjs types
node scripts/b01/check.mjs syntax
node --test scripts/b01/targets.test.mjs
node scripts/b01/check.mjs targets C:\absolute\path\test-targets.json
node scripts/b01/check.mjs targets C:\absolute\path\test-targets.json --cloud
node scripts/b01/check.mjs schema C:\absolute\path\test-targets.json
node scripts/b01/check.mjs project-schema --read-only-metadata
node scripts/b01/check.mjs baseline
```

These commands do not import application modules, load dotenv, initialize the ERP,
flush queues, seed/clean data, or connect to any network endpoint. `types` and
`syntax` parse/check code without executing application code. The test suite
creates an empty disposable SQLite fixture and removes only its own known files.
It executes the four blocked legacy entries under Node permissions denying
network, filesystem writes, native addons, and child processes.

`schema` accepts only a validated disposable target. The separately named
`project-schema --read-only-metadata` command is the explicit exception for
read-only source-database metadata: SQLite readOnly + query_only, schema queries
only, no business rows or journal-mode changes. It hashes database/WAL bytes
before and after. Do not use the project database for business tests.

`baseline` reads hashes, installed/locked core versions and the existing ASAR;
it does not extract files to disk or rebuild anything. An absent archive is
reported as unavailable. A mismatch is evidence, not an instruction to package.

## Explicit disposable targets

Supply a JSON configuration (never production credentials). Example shape:

```json
{
  "disposable": true,
  "root": "C:\\Users\\YOUR_USER\\AppData\\Local\\Temp\\erp-b01-YOUR_RUN",
  "local": "C:\\Users\\YOUR_USER\\AppData\\Local\\Temp\\erp-b01-YOUR_RUN\\disposable.sqlite"
}
```

The root and SQLite file must already exist. The root must be beneath the OS
temporary directory with an `erp-b01-` prefix. Validation requires an SQLite file
header; it does not initialize a missing file. Production names `hardware.db`
and `hardware_erp.db`, paths outside the disposable root, normal AppData paths,
relative paths, hard links, and symlink/junction components are rejected.
Do not configure a directory that another process can replace while checking it.
This guards accidental target resolution; it is not a sandbox against a malicious
process that controls the configuration or filesystem.

For **offline cloud-configuration validation only**, additionally supply:

```json
{
  "cloud": {
    "dedicatedTestDatabase": true,
    "url": "libsql://YOUR-test-DATABASE.turso.io",
    "allowedHosts": ["your-test-database.turso.io"]
  }
}
```

Use the real lower-case dedicated test hostname in both fields, and provide the
test-only token through `ERP_TEST_TURSO_AUTH_TOKEN`. The validator never falls back
to `TURSO_AUTH_TOKEN`, embedded defaults, or dotenv. Credentials are not printed.
The host must explicitly identify a test database, be exactly allowlisted, and
not match known production hosts/database identifiers discovered read-only from
existing runtime/configuration files. HTTP API targets, including localhost, are
unsupported and rejected. No test Turso was provisioned or contacted in B01.
Successful configuration validation does not prove remote ownership, isolation,
credentials, connectivity, or schema compatibility.

## Legacy verification quarantine

`legacy-entrypoints.json` records every affected entry, original and resulting
hashes, and whether Git ignores it. The four tracked verification scripts and
25 relevant scratch entries have a first dependency on `legacy-block.cjs` (or a
first `require` for CJS). It always throws before application module evaluation.
There is no flag, environment variable, or configured-target bypass.

The old script bodies are preserved for review. They are **not safely runnable
business tests yet**, even with a valid target configuration. Reasons include:

- Default `initDb()` and embedded cloud defaults.
- Direct project/AppData SQLite paths and localhost requests.
- Import-time server initialization, seed and schema setup.
- Sync connectivity fallback, whole-queue flushing, pull/prune and cleanup.

Allowing these bodies to execute would exceed B01's no-initialization/no-sync
boundary. A later authorized test adaptation must explicitly consume the validated
target and demonstrate isolation of every side effect before removing a guard.
Do not delete guards just because a test URL has been supplied.

The scratch source-only date/session/math audits, source inspector, and static
report generator are not database integration entry points and were left alone.
Production maintenance/reset/migration scripts are not verification entry points;
they are neither modified nor executed. Do not treat them as B01 commands.

Git ignores `scratch/`. Its 25 local guard changes are recorded in the manifest
but will not travel in a normal tracked-source patch. On another checkout, absent
scratch files are harmless; copied legacy scratch files must have their guards
verified before use. The tests reject an existing unguarded manifest entry.

## Baselines and limits

`baseline-before.json` records the accepted Git revision, source hashes, installed
and locked versions, and existing packaged-server mismatch. `schema-before.json`
records the accepted structural fingerprint. After files record the corresponding
post-verification state. No dependencies or package manifests are changed.

The existing packaged server differs from source and remains untouched. Electron
AppData schema remains unverified because the previous safe read-only open failed;
access was not forced. Cloud schema remains unverified. No B02 work is authorized
by this contract. Business workflows and Local/Online parity are not certified by
the B01 static/configuration tests.
