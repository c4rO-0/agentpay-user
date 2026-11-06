# Unified local cache foundation

Status, 2026-11-04: foundation and shared-client integration implemented. See
latest payment/file evidence (private historical evidence; not distributed),
neutrality resolution (private historical evidence; not distributed) and
[current usage](../runbooks/local-cache.md). Historical 61-test foundation evidence
is separate from subsequent runs. Paid binary-service participant acceptance is not
claimed. Text view does not change durable request/Order identities or cleanup rules.
Related: [Skill integration](skill-input-output-cache.md),
[current output cache](../reference/result-file-cache.md).

## Existing code and reuse decision

`file-cache.mjs` already supplies private streaming storage, atomic index updates,
digest checks and Order-scoped output records. `file-download.mjs` owns HTTP/HTTPS
streaming, DNS/redirect checks and transfer bounds. `file-cache-owner.mjs` owns a
portable OS lock, loaded only for file operations. `file-cache-settings.mjs` owns
limits. Extend/extract these into one store; do not duplicate them for input files.

Current limitations found by inspection:

- Every record requires an Order ID and URL; an input may precede an Order and come
  from a local file. Current file count is per Order, not per request.
- Only Order-scoped list/download/remove exist; no global summary, export or cleanup
  preview. Configuration currently requires manually editing private JSON.
- A crash after marking a record removed but before unlink can leave physical bytes.
  A failed index commit after publishing a binary can leave unaccounted-to-metadata
  bytes. Physical usage is counted today, but repair/cleanup needs explicit states.
- Directory scanning and full-index parsing occur per operation; new management
  listings must stay bounded and must not hash every binary just to display usage.
- Current total quota covers file-cache bytes, not existing JSON request/result
  history. A unified screen must not misleadingly describe this as total User data.

## File compatibility and identity

Store arbitrary bytes: text in any encoding, images, media, PDFs, archives, model
files and unknown formats. No format whitelist, automatic extraction, rendering,
transcoding or execution. MIME, Unicode display name and extension are descriptive;
control characters must be escaped in terminal output. Physical names are generated
identifiers, never filenames, source URLs or caller paths. Zero-byte files are valid.

Local import accepts an explicitly selected regular file, not a device, FIFO or
recursive directory. Stream from a checked handle and detect ordinary source changes
while copying. This cannot guarantee an atomic view of a concurrently modified source:
callers must provide stable files; the saved bytes and digest define the snapshot.
Do not hard-link source files: future writes must not mutate the snapshot. Directory
packaging and Provider-specific uploads remain Skill responsibilities.

Use a record identity derived from purpose (input/output), original request ID or
Order ID, and file key. Digest describes bytes, not ownership or payment authority.
No cross-request deduplication/refcounts in the first implementation: it complicates
cleanup and reference integrity for little demonstrated benefit. Equal bytes may
have independent copies. Runtime endpoint/port never enters record identity.

## Storage and upgrade

Keep the existing managed root, `runtime/invocations.json.files/`, so existing outputs
do not require copying large files. Preserve existing output storage IDs and bytes.
Add input record namespace and a versioned index with explicit scope/purpose; retain
one writer lock and one quota account for both. No fake Order IDs for input entries.
No new database or background cache service is required.

Existing client JSON checkpoints and verified structured results stay where they
are; the cache manager does not duplicate or reinterpret them. Display their relation
where available, but do not delete financial/checkpoint history through file cleanup.

Before activation, a bounded one-time index upgrade validates old records and writes
new metadata atomically under the store lock. It must not require a running Wallet,
chain calls, byte re-download or new request. Unsupported/corrupt metadata blocks
file mutations with a concrete diagnostic, not an empty replacement index. Do not
keep dual writing or two active schema implementations. Failure leaves recoverable
old metadata; deployment must coordinate stopping old writers. Inspect actual saved
state before any operator migration; no data migration is executed by this document.

## Record and transfer state

A record includes versioned scope, file key, display name, optional MIME/source,
expected and observed digest, byte count, created/updated Unix-millisecond timestamps,
state and safe failure code. Local paths and signed source URLs are private metadata;
routine listings/logs omit source credentials. Output provenance remains distinct
from local digest verification; a digest alone does not prove paid delivery.

Persist `writing` with a unique staging identity before creating partial bytes.
Write to a private temporary file, stream/hash, fsync, publish complete bytes, then
commit `available` metadata. Readers never consume partial bytes. Publishing errors
leave a recoverable record; retries reconcile published bytes before replacement.
Store mutation serializes only metadata/reservations, not entire network transfers.
Concurrent operations on the same record return busy/reuse, not duplicate writers.

Use `deleting` before removing bytes, then `removed` after durable removal. Restart
finishes interrupted deletion idempotently. A quota slot is not free until bytes are
actually removed. Failed or missing/corrupt copies retain their identity/digest.
An interrupted write is not available; remove only its owned staging files and retry
explicitly. No silent network transfer or service execution during startup repair.

Unrecognized files or corrupt metadata must not trigger recursive deletion. Account
for their physical occupancy and report them for inspection. Recovery scans happen
once under the writer lock; normal lists use bounded metadata pagination. Verify
hashes on reuse/export, not every display refresh. Portable OS locking is reused;
network-filesystem and untested OS support must not be claimed.

## Limits and resource accounting

Start from existing configurable defaults: 100 MiB per file, 512 MiB total managed
file storage, 20 active files per input request or output Order, 2 transfers, 10,000
retained records, 8 MiB index bound and 15-minute transfer deadline. These are resource
limits, not format restrictions or Provider service deadlines. Increasing a limit
must be possible through the management command within documented supported bounds.

Charge input and output binaries, staging bytes and other physical files in the
managed directory; expose metadata overhead and transfer reservations separately.
Never double-count written staging bytes and their reservation. Known sizes reserve
bounded declared space; unknown sizes conservatively reserve the per-file ceiling.
Enforce actual streamed bytes even when a source lies about length. Disk ENOSPC or
permission failure must leave recoverable state and not stop Order reconciliation.
Export copies consume destination disk space outside the managed quota.

Lowering a cap below current use retains data, reports over-limit and blocks new
allocation; it must not make old records unreadable or prohibit cleanup. Metadata
limit stops creating records, not listing/removal. Settings updates are atomic and
validated; avoid restarting/locking Wallet just to change file-cache limits.

## Management and cleanup

Implemented unified entry:

| Command | Behavior |
| --- | --- |
| `./run cache` | Managed bytes, input/output split, reserved space, limits, problems |
| `./run cache list` | Paginated records; filters for purpose, state, request/Order |
| `./run cache details ID` | Scope, file, integrity, timestamps, state and next action |
| `./run cache export ID PATH` | Verify and copy; never execute or overwrite silently |
| `./run cache clean` | Preview candidates and bytes, then deliberate confirmation |
| `./run cache settings` | Show/update validated resource limits |

CLI talks to the existing authenticated Runtime when running. When stopped, a local
management session must acquire the same OS lock; never race a live Runtime or read
a half-written index. Do not introduce another daemon/port. A capability marker or
shared dispatcher must prevent a failed HTTP request from causing unsafe offline
fallback. A held lock means retry through the owning Runtime, not delete the lock.

Preserve existing `/files/*` and installed-client behavior as adapters over the same
store during integration. The current entry is `./run orders files ORDER_ID`; legacy flat aliases are not
retained. New generic storage primitives must not expose arbitrary
path reads through an unauthenticated web route. Local import/export authority stays
within the existing local caller/OS boundary; not a claim of filesystem isolation.

Automatic cleanup is restricted to known abandoned temporary files and incomplete
deletions. Do not add age-based result eviction in the first implementation. Explicit
clean excludes active transfers and recovery-needed input. Unknown/unreconciled
requests remain protected. New input defaults to protected. Recovery integration releases protection only
after verifying a durable delivered result for its original request; no guessed
terminal states. Failed release checks retain protection.

Confirmation reports files and bytes, warns that original links may no longer work,
and says payments/Order history are unchanged. Revalidate eligibility under lock at
delete time; an old preview cannot delete a newly protected or replaced entry. Delete
exact approved identities/generations, not a fresh broad query after confirmation.
Retain removed metadata; metadata-cap exhaustion gives a concrete limit-setting action.
Full-data uninstall retains its existing explicit confirmation and stop-services step.

## Verification gates before invocation integration

- Arbitrary-byte equality for empty, Unicode text, image/PDF/archive-like and binary
  fixtures. No execution, parsing or business-specific branches.
- Bounded memory streaming with large maintained fixtures; deceptive lengths,
  limits, ENOSPC/write failures, raised/lowered limits and shared input/output quota.
- Actual competing processes, transfer interruption, publication/index failure,
  deletion crash and restart repair; existing output upgrade without byte rewriting.
- Corrupt/missing records, unsafe paths, export collisions, unknown files and source
  changes. No destructive blanket cleanup or replacement purchase.
- Clean-preview race, active/protected inputs, pagination, friendly CLI output and
  settings changes. Cache operations make zero Wallet signing/Order-creation calls.

Only after this gate passes attach input readiness and output declarations to Skill
calls. Actual paid acceptance and other-platform checks remain separate evidence.
