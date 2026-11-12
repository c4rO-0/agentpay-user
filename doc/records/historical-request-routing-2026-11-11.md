# Historical request routing — 2026-11-11

Working-tree verification only; no participant history, authorization or payment
was changed.

## Implemented behavior

A confirmed installation switch inventories the previous and selected data folders'
client request/selection stores and Runtime invocation history. It reads bounded,
private local files, retaining originals unchanged. The shared routing index stores
service/input hashes, original request IDs and data-folder ownership, not inputs,
results, keys or signed payment payloads. No Market or Settlement request is involved.

Default Skill calls claim ownership and select a local request under the same short
maintenance lock used by switching. Network/payment work occurs afterwards against
the already pinned connection. A matching old request reuses its original ID.
A request belonging to another installation prompts the caller to return there.
Conflicting owners require explicit `--resume` in the intended installation.

Missing selection or checkpoint files no longer silently create a replacement.
Known historical IDs constrain selection, and an ID retained in a pending record
must be resumed from its checkpoint rather than recreated. `--force` remains an
explicit new-purchase choice; migration does not override that later choice.

Runtime-only history cannot establish a Skill's original pre-upload/preparation
input. Unreadable or unlinked records therefore retain an unclassified-owner barrier.
They do not prevent Runtime startup or a confirmed switch. Automatic invocation in
another installation is blocked with review guidance; only deliberate `--force`
can authorize treating a call as new. Explicit original-request resume remains local.
This can conservatively block unrelated new inputs after switching from very old
history; it does not imply every such input previously incurred a payment.

## Evidence and limits

Targeted runtime-client, default-runtime-lifecycle, service-selection and
invocation-store checks passed. The final run, including candidate Skill bootstrap
and reference-client regressions, passed all 37 checks. Tests exercise the shared Skill entry against
controlled local HTTP services, preserve IDs for two different JSON business
payloads, reject replacement before any invocation HTTP call, and cover missing
selection/checkpoint, conflicting installations, explicit force/retry and malformed
old history during a switch. Historical-only fixtures prepare missing/old metadata;
they are not claims of real payment recovery. Service management remains simulated.

Only known selected data folders are inventoried; unrelated disks or directories
are not searched. Older immutable Skill bootstraps do not automatically gain default
selection. Candidate template publication, complete two-install entry-point/systemd
acceptance and participant review remain release gates.
