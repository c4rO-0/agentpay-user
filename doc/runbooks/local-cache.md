# Manage local cache

Current source includes the 2026-11-04 text/file view and generic Provider source.
Existing file-management APIs are unchanged; this display update alone needs no
Runtime restart. Machines on older Runtime code still need the coordinated update.
Wallet unlock is not required. These operations never buy a service or cancel an Order.

```bash
./run cache
./run cache list
./run cache list 1 input
./run cache list 1 output --state available
./run cache list 1 --order ORDER_ID
./run cache list 1 --request REQUEST_ID
./run cache details FILE_ID
./run cache export FILE_ID /your/folder/report.pdf
./run cache clean
./run cache settings
./run cache settings totalBytes 1073741824
```

Use the full file ID shown by `list`. Listings have 20 entries per page; `list 2`
shows the second page. Export verifies the saved bytes and creates a private copy;
it never opens/executes the file or overwrites an existing destination. Choose a
path outside the managed cache. Rename the exported copy as needed for your application.

`clean` previews up to 100 eligible file copies and their sizes before asking for `confirm`.
Original links might have expired: deleted files are not guaranteed downloadable
again. Request/Order history, structured results and protected inputs remain. If
records changed after preview, review cleanup again. No age-based auto eviction
exists. Known interrupted temporary writes/deletions are repaired on first use.

Inputs stay protected until the shared client and Runtime verify a durable delivered
result for the original request. Then confirmed cleanup may remove them. Failed release
checks retain protection and retry with the original call. Do not manually delete
input records to work around protection.

## Runtime stopped

```bash
./run cache --offline
./run cache list --offline
./run cache clean --offline
```

Offline mode is explicit; a failed online request does not silently switch to local
writes. It uses the same OS file lock as Runtime. If Runtime owns the cache, use the
online command or stop Runtime first. Never delete `owner.lock` to bypass contention.
Offline settings changes are read at the next Runtime cache initialization; use the
online settings command for a Runtime that is already managing files.

## Space and limits

The view shows text results and files. Text results include both shared-client
copies and direct Runtime results. Matching Order/service/request/output identities
are displayed once; storage usage includes all physical result records. Display
source comes from the saved Provider reference, not installed package guessing.
A missing historical source is shown as unrecorded. Source labels never authorize
payments or alter request identity. JSON result cleanup remains disabled.

The summary separates text-record storage from attachment storage and reservations.
Unknown files occupy capacity but are not automatically deleted. Request records,
pending delivery evidence and other local state are separate; this is not total
User disk usage.

Defaults: 100 MiB per file, 512 MiB managed file bytes, 20 active files per request or
Order, 2 transfers, 10,000 metadata records and a 15-minute transfer timeout. Supported
configuration names remain `singleBytes`, `totalBytes`, `filesPerResult`, `concurrent`,
`records`, `timeoutMs`. Byte/time values use bytes/milliseconds; all are positive
integers. `filesPerResult` applies separately to each input request or output Order.
The total counts binary/staging/unknown files; index overhead is separately bounded
at 8 MiB. These are local resource limits, not business or file-format restrictions.

Settings commands validate and apply limits without restarting or locking Wallet.
Lowering limits never deletes existing files; over-limit storage blocks new allocation
while keeping inspection, export and cleanup available. Retained removed records
still count toward metadata limits. Raising `records` cannot bypass the 8 MiB index
bound. Cache errors do not stop Runtime's independent Order recovery.

## Storage and upgrade

Managed files remain under `runtime/invocations.json.files/` in the selected User
data directory. `./run wallet info` shows that data directory. No file format is executed,
extracted or converted; extensions and names are descriptive. Original private paths
and signed URLs are excluded from routine lists but can exist in private metadata.
Back up the complete User data directory privately to preserve recovery and files.

First access upgrades the old version-1 output index atomically to version 2 under
the store lock. Existing output IDs and binary paths are preserved, with no redownload.
Old Runtime versions cannot read the new index; stop old writers and coordinate User
updates before rollout. Do not downgrade/delete the index to fix startup. This is a
local file metadata upgrade, not an Order, Policy or chain migration.

Existing `./run orders files ORDER_ID` and `/files/*` operations remain supported through
the same store. The new manager adds authenticated `/cache/manage` on the existing
loopback Runtime; it has no arbitrary file-import/download or financial action.
The shared Skill client uses the separate authenticated `/files/input` operation
for explicit input declarations. `/files/input-release` independently verifies durable
delivery before allowing input cleanup; it does not create, pay or acknowledge Orders.

### Displayed types and sizes

Text (JSON) entries show `content` (UTF-8 bytes of the business output serialized as
JSON) and `cached` (complete saved result records, including internal copies and
Order/verification metadata). Summary text storage counts those complete records. Attachment entries show
input/output, the filename extension and cached bytes. Extensions are descriptive,
not content validation. Zero attachments is expected for JSON-only services. These
sizes are file lengths, not filesystem allocated blocks or total User disk usage.

The standard Runtime result location is `runtime/invocations.json.results/`;
shared-client results remain in `runtime/client-requests/`. If using a custom
Runtime state file, set the same `AGENTPAY_USER_STATE_FILE` for cache commands.
No installed ZIP is scanned for display. Attachment pagination reads only the
prefix needed for the merged page; text inventory still scans retained result
metadata and is not a persistent index.
