# Runtime result records and file caching

Date: 2026-11-02. All three implementation loops are complete within the
recorded private scope (private historical evidence; not distributed), including
participant restart/unlock. This plan introduces no new Provider output protocol.


## Goal and existing behavior

Preserve a paid service's original result across Runtime/Agent interruption without
buying or executing the service again. Separate payment status, delivery evidence,
local result availability and downloaded file availability.

The initial verified-result store used `runtime/invocations.json.results/` and saved
only after evidence verification. Implemented loop 1 now saves a bounded pending
record first, then verifies and promotes it; local recovery distinguishes missing,
pending, invalid and old-format results. Loop 2 keeps binaries and transfer metadata
separate. See the current file-cache reference for implemented behavior and limits.
A JSON containing a URL is not a local copy of that file.

An initial pending-JSON draft was paused while this layered plan was approved.
Loop 1 now implements structured result persistence under that plan; it does not
implement file downloads. Current pending records use a separate private
`runtime/invocations.json.pending-results/` directory and retain the candidate
alongside the verified copy. Each record is capped at 2 MiB, matching the existing
result read limit. Automatic eviction and binary-file quota belong to loop 2.

## Boundaries

- User Runtime owns private local storage and recovery orchestration. Wallet keeps
  its existing bounded signing/read authority. Settlement stores hashes/usage and
  delivery evidence, not private output or downloaded files. Market is not a result
  hosting service. No contract, SQL or shared Provider wire change is required by
  this plan.
- Keep Provider output format and existing output-hash semantics application-owned.
  Do not scan arbitrary output strings for URLs, invent business-specific adapters,
  require file descriptors in every response, or change what existing receipts mean.
- A Skill explicitly requests caching of selected files through a generic local
  interface. This interface is an opt-in local feature, not a new prerequisite for
  a Provider to accept Orders. The implemented local API is documented in
  [the file-cache reference](../reference/result-file-cache.md); it is not a Provider wire change.
- Private contents, download tokens and signed URLs never appear in status/help,
  routine logs, Market, or Settlement. Local OS ownership is the protection boundary;
  this is not isolation from another process running as the same OS user.
- Cache state never authorizes payment, confirms receipt, changes dispute deadlines,
  proves service quality, or automatically creates a replacement purchase.

## Storage and separate states

Keep the existing verified-record format and location. Add separate pending result
storage and file storage under the selected User data directory, with private owner
permissions. Paths/names supplied by the Provider must not determine filesystem
paths; use generated internal identifiers. Original human filenames are metadata.

| Layer | States and meaning |
| --- | --- |
| Financial Order | Existing authenticated Settlement state; never inferred from cache |
| Result record | Missing; pending evidence; verified; invalid; older format not verifiable |
| File | Not downloaded; downloading; available locally; interrupted/failed; removed locally |
| File integrity | Local digest recorded; expected digest matched, if provided; evidence binding verified only when the existing delivery contract supports it |

Do not label an old-format result as absent if bytes exist. Do not label a local
hash as Provider authenticity: a digest computed after download proves only local
integrity unless independently bound to the agreed original evidence. A verified
structured result may coexist with undownloaded/expired file links. No implicit
"all files complete" claim is possible for unknown application-owned output.

Result records contain the original invocation/Order identity and service binding,
verification state and timestamps. File metadata references the original result,
local generated file identity, display filename, actual size, digest, source and
transfer state. Avoid putting binary content/base64 blobs in result JSON.

## Result receipt and restart

1. Validate Provider response shape, size, identity and output integrity using the
   existing service contract. Save the bounded result as pending before waiting for
   Settlement's evidence. Do not return it as a successful verified delivery yet.
2. Verify original Order/service/request, output hash and usage against authenticated
   Settlement evidence using the original Policy scope. Revocation or unavailable
   authority stays a visible blocker; no Safe-only lookup or rebinding workaround.
3. Atomically promote the result to verified, then return it. Crash between promotion
   and response must return the same saved result on retry. Conflicting candidates
   never silently overwrite the original. Avoid comparing mutable disclosure fields
   as if they were immutable delivery content.
4. Startup/background recovery may verify saved pending results using bounded reads;
   it must not invoke Provider service execution, submit payment or confirm receipt.
   Explicit same-request resume can use this pending copy before considering service
   execution. Existing financial closure still governs all service/mutation actions.
5. Corruption, disk-full, partial writes, concurrent recovery and unknown legacy
   formats must fail visibly and preserve original history. Persisted pending state
   must be included in orphan/history checks and limits. Unverified files never
   become ordinary verified results merely because an Order was paid out.

When no result was durably received (for example the process dies before receiving
the response), local caching cannot solve that loss. Original Provider retrieval,
its permissions and applicable support deadlines remain the recovery route.

## File transfer

- Skill calls a bounded, authenticated local cache operation for an explicitly
  selected result/file. Do not reuse the payment or generic signing interface.
- Support HTTP and HTTPS; record whether the source transport is encrypted. Validate destination resolution and redirects, including private,
  loopback, link-local and metadata endpoints; prevent DNS rebinding/redirect bypass.
  Controlled private rehearsal fixtures require explicit narrow configuration,
  never a global private-network bypass.
- No arbitrary filesystem writes, automatic unpacking, execution, previewing active
  content, or forwarding Wallet/Runtime tokens to remote sources. Arbitrary remote
  authentication headers are not an initial feature. Keep any permitted signed URL
  private; redirect changes must not leak credentials.
- Stream to a temporary file, cap actual bytes even without Content-Length, enforce
  deadlines/concurrency and reserve quota before writing. Match a supplied expected
  hash where applicable, then fsync and atomically publish. Partial bytes are not an
  available result. Leave original identity intact after timeout/network failure.
- Initial restart recovery may retry only the file transfer. Byte-range continuation
  is optional: use it only with reliable validators preventing mixed file versions;
  otherwise restart the download rather than append blindly. Never invoke the paid
  service again to refresh an expired link.
- If the URL expired or content changed, retain the failure and original metadata.
  Requesting an original file again is distinct from rerunning the service. No claim
  that every Provider can reissue URLs or retain outputs indefinitely.

## Capacity and cleanup

Implement bounded total file bytes, single-file bytes, per-result file count and
concurrent transfers. Implemented defaults and configuration names are documented in the
[file-cache reference](../reference/result-file-cache.md); the cache is bounded. Account for
concurrent reservations, interrupted temporary files and disk-full failures.

Do not automatically evict Order history, evidence metadata or pending result records
to make room. At the limit, stop new file downloads with a clear action. Initial
cleanup is deliberate: show scope/size, confirm, delete only selected local file
copies, and retain metadata marked removed locally. Protect in-flight writes and
use locks/atomic transitions so cleanup cannot publish a deleted transfer as ready.
Later automatic retention requires its own explicit policy. Uninstall's existing
confirmed all-local-data removal includes this storage. Backup guidance must explain
that restoring keys/Policy alone does not restore private result/file copies.

## UX and implementation loops

1. **Result preservation:** pending → evidence verification → verified; read-only
   restart recovery; accurate missing/invalid/legacy/pending messages in status,
   orders and details. Keep structured results general. Verify crash boundaries,
   wrong evidence, revoked Policy, disk errors and concurrent same-request resume
   with at least two maintained business payloads through one Runtime.
2. **File cache:** finalize the local Skill client interface and limits; implement
   metadata + streaming file storage, safe downloads, interruption/retry, quota and
   deliberate cleanup. Test maintained text/binary fixtures, malicious destinations,
   redirects, changed downloads, large/unknown-length streams and cleanup races.
3. **Integration and acceptance:** document Skill-author usage and local CLI access;
   distinguish original Order status, record verification and file availability.
   Integrate uninstall/backup/info. Participant tests use official controlled fixtures,
   preserve original Policy/history and avoid third-party Skills. No new purchase is
   needed merely to inspect existing cache. Report source tests separately from
   real-process and human acceptance.

The loops above were completed in sequence; see the closeout for their evidence. Neither a JSON placeholder
nor mocked downloads constitute acceptance of durable binary file recovery.
