# Call paid services from a Skill

Audience: Skill authors and local Agent integrators. Use the common per-call
Runtime contract; no process-wide Skill selection or business adapter is needed.
See [service contract](../reference/multi-service-runtime.md). Actual DeepSeek
Harness/Claude Code discovery and execution remain separate acceptance.

## Local setup

Complete User/Wallet setup. The guide saves runtime/connection.json in the private
User data directory: loopback Runtime URL, caller token file path and installed
User module location. The token itself never enters a package or model message.
The default is $HOME/.local/share/agentpay/user; set AGENTPAY_USER_DATA_DIR for a
custom directory. Keep User installed at its recorded location.

Existing developer installations can save discovery from the User repository:

```bash
node scripts/configure-runtime-client.mjs "$HOME/.local/share/agentpay/user" http://127.0.0.1:6490
```

This writes local connection metadata only; it does not authorize spending.

## Author package

Download Market's Skill template. Fill package identity, copy registered service
references into services.main and additional aliases, and implement business input
validation and result interpretation in the wrapper. Keep payment/credentials in
the installed shared User client. The template text parameter is only an example.

```bash
node scripts/call-runtime.mjs --check
node scripts/call-runtime.mjs --invoke '{"text":"hello"}' --units 1
node scripts/call-runtime.mjs --service second --invoke '{"text":"hello"}'
```

--check verifies local interface/reference matching; it does not reserve a Quote or
establish purchase readiness. --units is a maximum, not a price or actual usage.
Provider business output is application-owned. Verify delivery using the agreed
evidence contract; do not invent a new output shape or hashing requirement.

## Recovery and explicit new purchase

Retry the same input normally. Matching calls recover the same request or reuse
saved verified output. Use --force only for an explicitly intended additional
purchase. It never bypasses Policy. Diagnostic --resume <request-id> selects an
existing request when several unfinished forced calls make automatic selection
ambiguous. Preserve private checkpoints and invocation history. A lock left during
local request selection fails closed for inspection; do not delete purchase state
or automatically force a new request to work around it.

## Release and acceptance

The installed User and Wallet dependencies must match their shipped lockfiles.
Preserve older request identities during upgrades; never reinterpret their routing
or create replacement purchases. The official paid connectivity suite remains the
installation acceptance test. Other business payloads are tested with maintained
controlled fixtures, not third-party Skills.

Runtime starts with retained older requests and performs read-only self-checks.
Unsupported or unknown original scopes remain visible for review; they do not
become eligible for replacement purchases. Use `./run orders list` and the suggested
`details`, `status` or `archive` actions. Archiving preserves the request and does
not establish its financial state. See [original Order recovery](../reference/original-order-recovery.md).

## Optional result files

Runtime preserves received structured results; a URL in a result is not a saved
file. Skills can explicitly cache selected files through the installed client.
Use the [file-cache interface](../reference/result-file-cache.md) for API examples,
limits and digest semantics. Users inspect copies with `./run orders files ORDER_ID`.
File operations never start a new purchase or confirm receipt.

## Transport failures

`RUNTIME_TIMEOUT` means the response deadline elapsed; an Order may still be running.
`RUNTIME_RESPONSE_TOO_LARGE` means the bounded JSON response was exceeded.
`RUNTIME_RESPONSE_INVALID` means unreadable JSON or failed delivery verification.
`RUNTIME_UNAVAILABLE` means communication could not finish. Check local status/logs
as directed and resume the original request. None of these proves non-payment or
allows replacing a purchase. Binary files use the separate explicit file interface.

Provider profiles may use HTTP or HTTPS. Existing requests retain their exact
registered endpoint/profile. HTTP provides no transport confidentiality; use HTTPS
when the service requires it. This does not change local Runtime loopback or
Market/Settlement credential requirements, or package-download validation.

## File inputs and outputs

The current installed client provides `skillClientCapabilities` including
`input-snapshots-v1`. The official Agent template distributed by Market checks it before running. Upgrade User
and restart Runtime together; older Runtime versions lack original-request recovery.

The optional hooks are:

```js
await runSkill({
  service,
  validateRequest: validateYourBusinessInput,
  inputFiles(input) {
    return [{fileKey: 'document', sourcePath: input.absoluteFilePath,
             filename: 'document.pdf'}];
  },
  async prepareRequest({request, files, requestId}) {
    // Implement YOUR Provider's upload/reference contract using files[].localPath.
    // Use requestId/fileKey to make preparatory uploads idempotent where supported.
    // Return bounded business JSON, not an embedded large binary or a local path
    // that the remote Provider cannot access. Never create/pay Orders here.
    return prepareYourProviderInput(request, files, requestId);
  },
  outputFiles(output) {
    return [{fileKey: 'report', url: output.reportUrl, filename: 'report.pdf'}];
  }
});
```

These illustrative business functions are author code, not built-in APIs. JSON-only
Skills omit the hooks. Input declarations accept either an absolute `sourcePath` or
an HTTP/HTTPS `url`, plus unique `fileKey`, optional `filename` and SHA-256 `sha256`.
At most 20 declarations are allowed; local resource limits also apply. No automatic
path/URL discovery, archive extraction or format restriction is added.

The common client saves declarations, snapshots and the final adapted request before
paid invocation. Retrying after source changes uses original copies. `--resume` never
reinterprets a submitted request through newly edited business preparation code.
Use `--force` only for an intentional additional purchase/new input snapshot.

Output download failure preserves the verified result and request ID. The command
returns nonzero with `ok: true` delivery and `fileCache.state: incomplete`; retry the
same call to finish downloading, not `--force`. Saved files are optional local copies,
not a new delivery-proof format. View/manage copies with `./run cache`.

Once Runtime verifies durable delivery, original inputs become eligible for confirmed
cleanup. If release cannot be checked, they remain protected; retry the original call.
A saved Runtime result can restore missing client results even after input cleanup.

Runtime port changes do not change the request. A possibly submitted request requires
matching Runtime history and atomic existing-only continuation. Missing history stops
with `ORIGINAL_REQUEST_NOT_FOUND`: preserve local files and review with support; do
not delete checkpoints, change IDs or force another purchase to recover it.

## Service and package addresses

Service references must conform to the existing Protocol v1 profile: the challenged
MCP endpoint and payment endpoint have the canonical service-specific suffixes.
An allowed deployment prefix is supported. Do not derive or change these identities
inside a Skill to bypass validation. These rules apply to all service businesses.

The ZIP download URL is independent: use the publisher's explicit full URL plus a
trusted expected SHA-256, or Market's metadata/download link. The direct installer
does not derive the ZIP path from `/invoke` and does not require a `main` service
alias. Multiple service aliases may point to independently registered services.
Generic `--preview`/`--execute` install without global selection; official test
selection remains scoped to the maintained connectivity suite. Transport safety,
archive structure, digest and service-profile validation still apply.
