# Electron diagnostic instrumentation — execution not performed

Scope: only `electron-probe.cjs`, `electron.mjs`, and `harness.mjs` under
`scripts/b02`, plus this evidence and the B02 change manifest. A35 unchanged;
D01 pending; B03 locked. Historical B01 and prior B02 test outcomes are preserved.

## Diagnostic changes

- Electron emits `B02_EVENT` records for load invocation/resolution, request
  admission, did-start-loading, did-fail-load, did-finish-load, dom-ready,
  render-process-gone, permission requests, and probe rejection.
- Records carry Unix-millisecond timestamps, source, and per-source sequence.
  Error codes, main-frame status and renderer reason/exit code are selected
  explicitly. URLs are represented by `owned-loopback-probe` or `REDACTED`.
  Permission names are bounded tokens; requests remain denied with `callback(false)`.
- HTTP emits `B02_HTTP` records for probe receipt, response-write request,
  return from `res.end`, response finish/close, request abort and socket close/errors.
  Per-request IDs distinguish separate requests. Error monitoring uses
  `errorMonitor`, retaining existing error propagation rather than consuming errors.
- The response body, headers, routing, allowlists, sandbox, environment and timeout
  settings are unchanged. Diagnostic logging failures are caught. HTTP finish
  means server-side completion, not proof the client received or rendered the body.
- The launcher filters child events to selected primitive fields and includes them
  in failure messages and `error.diagnostics`. It parses after child stdio closes
  to retain final output. Failures remain failures. Server records are emitted
  directly to the test output and are also available as `harness.diagnostics`.

## Verification and execution gate

Changed files pass `node --check` and the existing ESLint configuration. Static
review confirms no production imports, grant decisions, network exceptions,
response changes, schema operations or dependencies were introduced.

Current code establishes owned disposable targets, no normal ERP startup, no
business/schema/seed/sync operation, no cloud fallback in the probe, and confined
cleanup for trusted harness code. It does not prove confinement of every native
Electron/Chromium network path to loopback. The Node monkey patches and selected
session interception are not complete native-process egress enforcement.

**STOP — unsafe verification target.** Electron was not executed. No new lifecycle
sequence was collected. **UNVERIFIED — evidence required before proceeding.**

Database structural identity is checked by read-only DB/WAL byte hashes against
the recorded baseline; SQLite is not opened and no business rows are queried.
Package manifests and the explicitly protected source files are hash-compared.
Results and updated file hashes are recorded in the change-manifest amendment.

No root-cause repair is proposed without new evidence. Further execution requires
a demonstrated native network-confinement boundary; any changes to establish it
require separate authorization. Do not infer permission to repair A35 or begin B03.
