# Local result file cache

Current source, 2026-11-04: [unified cache management](../runbooks/local-cache.md)
includes text/file display, both durable result stores and saved Provider source.
The output APIs below remain supported through the shared store. Controlled binary
verification passed; actual paid binary-service acceptance is a separate gate.

Implemented and verified within the private scope on 2026-11-02. See the
closeout (private historical evidence; not distributed) for controlled tests,
participant restart/unlock and unverified environments.
This is an optional local Runtime interface, not a Provider wire requirement.

## Operations

All routes are authenticated POSTs on the existing loopback Runtime with its
existing caller credential. Download requires exactly one saved Order with a verified
local result matching its original service/request. Listing and removing cached files
remain possible even when the original result file is missing or damaged. No Wallet signature, new payment, Provider service execution
or receipt confirmation is part of these operations.

| Route | JSON fields | Result |
| --- | --- | --- |
| `/files/cache` | `orderId`, `fileKey`, `url`; optional `filename`, `sha256` | Download/reuse metadata, including generated local path when available |
| `/files/list` | `orderId`; optional `offset`, `limit` (1–100) | Saved file metadata for this Order |
| `/files/remove` | `orderId`, `fileKey`, `confirmed: true` | Delete local copy and retain metadata with removed state |

The installed Runtime client exports `cacheResultFile`, `listResultFiles`, and
`removeResultFile`. Skill authors select a file URL explicitly; Runtime does not
inspect arbitrary business output for links or force a new output schema.

```js
import {loadRuntimeConnection, cacheResultFile, listResultFiles}
  from './runtime-client.mjs'; // Installed User client module, not a copied implementation.
const connection = await loadRuntimeConnection();
const file = await cacheResultFile(connection, {
  orderId, fileKey: 'report', url: reportUrl, filename: 'report.pdf',
  // sha256: expectedDigest, // Optional expected digest from your delivery contract.
});
const files = await listResultFiles(connection, orderId);
```

Skill bootstrap code must resolve the installed User client through the saved local
connection as it already does. The illustrative import above denotes that installed
module; it is not a requirement to bundle transport or copy credentials into Skills.
Use `./run orders files ORDER_ID` to list copies and
`./run orders files ORDER_ID remove FILE_KEY` to remove one after terminal confirmation.
Listings show up to 100 entries, newest first; use `./run orders files ORDER_ID list 2`
for the second page. Runtime must be running; Wallet unlock is not needed. `confirmed: true` is an explicit operation acknowledgement, not an
OS isolation or cryptographic owner approval. Agents have the local caller boundary.

`fileKey` is 1–80 ASCII letters/digits/dots/underscores/hyphens and identifies one
file within the Order. Reuse the same key for retry. An expired URL may be replaced only when the
record already has a known local or expected digest; downloaded bytes must still
match that digest. Preserve the original optional `sha256` argument. Without any
known digest, use the original URL or explicitly select a different file key;
Runtime cannot establish that a newly supplied link contains the original bytes. Display filenames never form filesystem paths.
URLs, query credentials and file contents are not returned in routine metadata or
logged. Available metadata contains size, SHA-256, generated path, timestamp,
transport (http/https), and integrity description. Inspect the state before using a
path. The file is never executed, extracted, or rendered by Runtime.

## Transfer and integrity

HTTP and HTTPS are supported, including explicit ports. HTTP is unencrypted;
metadata reports its transport. Neither transport alone proves delivery correctness.
Source URLs may differ from the Provider service endpoint.

DNS answers are validated; allowed addresses are tried in order and pinned to each
connection. Up to five redirects are revalidated hop by hop; HTTPS-to-HTTP
downgrade is refused. Direct HTTP remains supported.
Private, loopback, link-local/metadata and reserved destinations are denied by
default. Embedded URL credentials are refused. Identity transfer is requested;
gzip, deflate and Brotli responses are decoded with both transfer and decoded-byte
limits. Unknown HTTP encodings are rejected; this does not restrict archive file formats. Caller/Wallet credentials are never forwarded. Optional signed query URLs
remain only in private metadata; protect cache backups accordingly.

An operator may set `AGENTPAY_USER_FILE_CACHE_PRIVATE_ORIGINS` to a JSON array of at
most 16 exact origins, e.g. `["http://127.0.0.1:8123"]`, in the Runtime environment
for controlled private fixtures. Only that scheme/host/port is excepted; DNS is still
pinned. Only loopback/RFC1918/ULA destinations qualify for this exception; metadata
link-local and reserved addresses remain blocked. No wildcard/all-private-network
option exists. Default is `[]`; the installer does not enable an exception.

Transfers stream to private temporary files, enforce the actual byte limit even
without Content-Length. Default total transfer timeout is 15 minutes, configurable
up to 24 hours. Connection/header attempts are capped at 10 seconds each within
that total budget. These are local resource limits, not Provider delivery deadlines. No partial file is marked
available. After restart, the first cache operation validates completed bytes with a durable
digest and finishes publication where possible; other interrupted transfers are
marked failed and their owned partial bytes removed. Retrying restarts only the download; no
byte-range append or automatic background network retry is implemented.

An optional expected SHA-256 must match. Otherwise the digest records local bytes
only. A Skill-supplied digest is not itself evidence from Settlement. Metadata uses
`expected_digest_matched` or `local_digest_only`; neither is an evidence-binding
claim. Reuse rechecks the saved file hash, size and permissions. Listing shows saved
metadata and does not reread/hash every binary. If a previously downloaded URL later
serves different bytes, retry cannot silently replace the known digest. Original
links may expire; refreshing one is separate from buying/executing the service.

## Storage, limits and cleanup

Storage is under `runtime/invocations.json.files/` in selected User data. Index and
binary files are owner-private (0600); directory is 0700. Generated SHA-256 storage
names derive from Order ID/file key. Files and index updates are fsynced and published
atomically. Metadata stores state/timestamps, source and integrity; it retains
removed/failed records. Local backup contains private result data and URLs.

Default limits: 100 MiB/file, 512 MiB shared input/output file bytes, 20 non-removed records per request or Order,
2 concurrent transfers, 10,000 retained history records and 8 MiB metadata.
Removed copies free byte capacity and per-Order slots. Removed history remains
bounded separately: at its cap, new keys stop with FILE_HISTORY_LIMIT; existing
keys remain reusable. History is not silently deleted. Operators can raise the
record cap (up to 100,000), subject to the metadata byte cap.

Prefer `./run cache settings` to inspect/change limits live. `./run cache settings`
also shows saved limits and the optional settings path:
`runtime/invocations.json.file-cache-settings.json` under selected User data.
Create an owner-private (0600) JSON file containing only the overrides needed:

```json
{"singleBytes":209715200,"totalBytes":1073741824,"timeoutMs":3600000}
```

Other keys are `filesPerResult`, `concurrent`, and `records`. Values must be positive
integers; singleBytes cannot exceed totalBytes; totalBytes is capped at 1 TiB,
concurrent at 16, records at 100,000 and timeoutMs at 86,400,000. Manual file edits require Runtime restart (`./run service restart` also locks Wallet);
`./run cache settings KEY VALUE` applies changes live without that restart. Invalid optional cache settings
fail file operations without stopping Runtime's Order recovery. Limits cannot be
supplied by a Skill in route requests.

URL transfers reserve the maximum file size; local inputs reserve their checked
file size. Reservations subtract already-written partial or published bytes;
actual stored bytes also count. A small file may still require one full-size slot.
Cache ownership uses `fs-native-extensions` 1.5.3 through a small file-lock adapter.
Each Runtime retains a descriptor for the empty `owner.lock` file in the cache
folder. OS locks release on process exit/crash; the file itself remains and must
not be deleted/replaced while Runtime is running. There are no heartbeat timers,
PID-reuse assumptions or extra ports. Multiple handles in one process share a queue.

The pinned package ships Node prebuilds for Linux, macOS and Windows x64/ARM64;
this host verified Linux x64 with Node 22.22.3 using installation scripts disabled,
without compilation. The lock adapter no longer rejects other OSes. This is not a
claim that all User filesystem permissions, startup or CLI operations have been
ported/tested on Windows/macOS/mobile. Actual supported environments remain subject
to platform acceptance. Network/shared-filesystem locking is not validated.

If the native binding is unavailable, file operations fail with
`FILE_CACHE_LOCK_UNAVAILABLE`; they never silently skip locking. Reinstall the
locked User dependencies with `npm ci` and restart Runtime; if the error persists,
report the Node/OS/architecture to support. Runtime startup and Order recovery do
not load this optional native binding. A lock file left after a crash is normal:
do not manually delete it to recover. Full uninstall still stops services first.

Removal first persists deletion intent, then deletes bytes and records completion;
restart finishes interrupted deletion. Removal retains history and does not cancel/refund an Order or remove structured
results. Cache-full never evicts original data. The existing confirmed all-local-data
uninstall removes this subdirectory with User data. Back up the complete User data
folder privately to retain pending/verified results, files, history and signed URLs;
key/Policy backup alone cannot restore file contents.

Tests use controlled streams, default HTTP/HTTPS clients with normal certificate
validation, actual SIGKILL transfer recovery, and two
maintained business payloads through Runtime. They are not production network or
live paid acceptance, and do not establish that an arbitrary Provider can retain or
reissue files indefinitely.
