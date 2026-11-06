# Skill glue and shared input/output persistence

Implemented design reference. Current release/participant gates are tracked in
[TODO](../TODO.md); this document is not new deployment or payment authorization.

## Responsibilities

The editable Skill is glue: it validates application input, explicitly identifies
input/output files and adapts application data to its Provider interface. The
installed User client owns common persistence and recovery. Runtime continues to
own the existing bounded payment, service authorization and delivery verification
path. This work does not move those operations into arbitrary Skill callbacks.

Shared caching does not impose a common Provider business payload or result
format. Input remains supported bounded JSON, including arrays and nested data;
it is not necessarily text. Binary data belongs in separate files, not an enlarged
JSON/base64 payload. Only hashes and existing required metadata reach Settlement;
private content remains local or travels to the selected Provider.

## Invocation lifecycle

1. Validate input and select/preserve the original request ID. Persist explicit
   file declarations and preparation state before copying files or submitting a
   paid invocation. An incomplete snapshot cannot be mistaken for a file-free call.
2. Save JSON using the existing checkpoint mechanism. Snapshot only files the
   Skill explicitly declares; ordinary strings, paths and URLs are not instructions
   to read or fetch. Record a stable file key, size and content digest. Write files
   durably before marking the complete input snapshot ready.
3. Application adaptation consumes the saved copies, not mutable original paths.
   Preserve the exact final business request used for its existing request hash.
   Provider-specific upload/reference construction must not be silently invented
   by the common client. A changed or expired upload reference is not permission
   to change an already submitted business request or create another Order.
4. Continue through the existing Runtime payment/invocation path. Before the first
   network submission, durably record that submission may occur; a crash or missing
   local Order ID is not proof of non-payment.
5. Retain the existing verified structured-result persistence. A Skill explicitly
   selects output files for the existing Order-scoped cache. Cache/download failure
   is distinct from paid service failure: retain the verified result and retry
   caching only, without invoking the paid service again or confirming receipt.
6. Resume by original request identity and saved inputs. A valid saved result can
   be read without requiring its original input files to remain available. A resume
   that still needs input bytes must stop if their snapshot is missing or corrupt.

Inputs are request-scoped because an Order may not exist yet. Outputs keep their
existing Order/evidence scope. Do not invent Order IDs for input caching or change
delivery hash rules to match cache digests. Runtime URLs are connection locations;
port changes do not create new request or file identities. The separate
[address recovery plan](runtime-address-recovery.md) still requires atomic
existing-only continuation when recovering potentially submitted requests.

## Retry and storage boundaries

- Repeating a matching invocation selects its existing snapshot before reading
  mutable sources. An edited/deleted original file does not replace saved bytes.
  Deliberately using new input remains an explicit new request; `--force` retains
  its existing additional-purchase meaning and never bypasses Policy limits.
- A missing snapshot after possible submission is a recovery problem, not a reason
  to reconstruct from changed files. Legacy JSON-only requests remain JSON-only;
  never infer missing file declarations from historical strings.
- Use bounded streaming, private local storage, atomic manifests and the existing
  portable locking approach where appropriate. Do not introduce Linux-only process
  identity checks or another lock protocol just for this feature.
- Reuse download validation for explicitly declared URL sources; do not assume
  HTTPS-only Providers. Do not forward Wallet, Runtime or platform credentials to
  file hosts. Do not follow symlinks or automatically inspect unrelated local files.
- Input and output usage must both be visible and bounded. Reusing numeric defaults
  does not establish a shared quota unless accounting actually includes both stores.
  Final limits and CLI presentation must be documented with implementation.
- Never automatically evict inputs needed by unresolved requests. Explicit deletion
  must explain loss of local recovery, retain request/digest history, and prevent
  future retries from silently substituting fresh input. Cache cleanup is not Order
  cancellation. Existing uninstall confirmation covers deletion of local data.

## Implementation sequence and acceptance

The user changed the sequence to **cache foundation first**. The detailed
[local cache design](local-cache-foundation.md) owns storage and management.

1. Review existing storage; specify shared layout, formats, quotas, crash states,
   cleanup and management. No payment/Skill integration in this loop.
2. Implement the shared file store and management commands; reuse existing output
   capabilities instead of running separate input/output storage engines.
3. Verify the foundation with maintained arbitrary-byte fixtures, large streams,
   concurrent operations, disk failures, process interruption and cleanup races.
4. Attach input snapshots and existing verified results to request recovery;
   implement address-independent original-record selection and atomic existing-only
   continuation. Missing history must never create replacement purchases.
5. Update editable templates and common Skill-client hooks, then verify two business
   payloads through the same Runtime. Output-download retries must not repeat paid
   execution. Participant deployment follows review and controlled verification.

No services, policies, stored purchases or public APIs are changed by this plan.
