# Multiple installations, one active Runtime

Status: approved direction, 2026-11-11; partial implementation under verification. This replaces
concurrent-instance routing and the proposed harness launcher. No live installation
has been migrated.

## User experience

A user can keep a development installation and an everyday installation on the same
computer, each with separate dependencies and data. Under one OS user, only one
managed Runtime/Wallet pair runs at a time. Skills use that pair as the default exit.
The user does not select an instance in every Skill or change the harness launcher.

- On installation, existing configuration offers **Use existing / Create separate /
  Cancel**. Creating a separate installation does not activate it automatically.
- Starting the already active installation is idempotent.
- Starting a different installation shows the current and target names/data folders
  and asks whether to switch. A noninteractive call cannot silently approve this.
- Switching stops the original pair, verifies it has stopped, then starts the target.
  Wallet starts locked. It never copies keys, renews Policies or merges Order history.
- If the original pair cannot be stopped, switching stops there. If the target fails
  to start, show the failure and recovery command; do not silently start another pair.
- Stopping the active pair leaves the default unavailable until the user starts it
  or explicitly switches. There is no fallback to another Wallet.

Keep existing default data in place. Reusing it from another program installation
requires explicit ownership transfer and stopping the previous writer. A new data
folder gets a stable local reference and a readable label. Neither is a Market
Wallet identity, Policy or device identity. Renaming does not change authorization.

## Default Skill connection

Shared User client code resolves the single active installation and its connection.
Skill business code supplies service selection, input/output validation and optional
file handling. It does not search Wallet directories or choose an installation.
Internal connection files remain an implementation detail of the shared client.

Do not introduce mandatory `agentpay exec` or per-harness environment selection.
A new `agentpay skill run` command is not required by this design. Preserve the
existing Skill-facing calling convention where practical and keep a stable shared
client entry. Runtime upgrades must not require publishing every installed Skill.

The current template reads clientModule from connection.json before importing the
shared client. Implementation must address that bootstrap as well as Runtime URL
lookup. Inventory source, folder-local npm and global npm resolution before choosing
the minimal bootstrap change. If template bytes must change, publish a versioned
migration once; do not silently rewrite immutable packages or claim old downloaded
Skills already follow the new default. No background package download is allowed
as a side effect of invoking a Skill.

Resolve the active connection once per invocation. A switch while a call is in flight
must fail or preserve its original request, never retry against the newly active
Wallet. Saved recovery records retain their originating storage/authorization scope.
A missing original record must not become a fresh purchase in the other installation.
Provide a prompt to return to the original installation when that scope is known.
Port, program path and local label do not enter payment or request identity.

This is logical routing under one OS account, not protection against hostile code
running as that same account. An unavailable default must produce a useful error;
merely finding an HTTP listener is not proof it is the selected Runtime.

## Installation and active state

For the first version, one program installation binds one data instance. Development
source and everyday folder-local npm installations have independent dependency trees.
A global npm installation is one installation, not multiple global versions.

Maintain private local records of canonical installation roots and bound data folders,
plus one active selection. Do not store keys in this catalog. Resolve ownership and
path aliases before claiming storage; two aliases cannot claim the same data twice.
Read-only commands must not perform adoption or change the active selection.

CLI lifecycle/update/uninstall commands operate on their installation's bound data,
and display when a different installation is active. Skill invocation alone uses the
default active connection. This distinction prevents a repair in an inactive source
checkout from taking over the everyday installation.

Resolve command context once and pass it to children. Legacy data-directory overrides
must agree with the bound context or enter explicit adoption; they cannot silently
retarget services or delete another instance.

## Lifecycle, switching and startup

Keep one managed systemd user service pair and one login reminder, targeting the
active installation. Reuse existing fixed unit names where their ownership can be
verified; parallel instance-specific units are no longer required. Login startup
starts only the selected pair. Preserve the existing login-start preference when
switching, and show it in the switch summary.

Serialize switch/start/stop/repair and active endpoint publication. Check real process
ownership, not only service-manager state: a manually started old process must also
prevent starting another managed pair. A Runtime lifetime ownership guard must reject
competing starts from supported product entry points. Arbitrary external programs
are outside this guarantee; never kill an unrelated process to reclaim a port.

During switching the default is unavailable. Publish the new active connection only
after startup and authentication/readiness verification. Journal switch phases so an
interruption can report or resume an incomplete transition without running both pairs.
Do not automatically unlock the new Wallet. Endpoint port conflicts fail explicitly;
a prior free-port probe is not a reservation. Bind and caller authentication remain
mandatory. The default is a logical selection, not a promise of a fixed TCP port.

Uninstalling or updating an inactive installation must not stop, restart or rewrite
the active service pair. Updating the active installation may briefly stop it and
then repair/restart that same pair. Uninstalling it leaves no active default; it does
not activate a replacement. Confirm local data deletion separately as today, and
never revoke on-chain authorization as an uninstall side effect.

## Interrupted installation recovery

The reproduced failure is recorded in
[isolated acceptance](../records/client-isolated-acceptance-2026-11-11.md): killing
all updater writers leaves an empty install.lock and permanently blocks retry.

The first implementation serializes maintenance under one shared OS-user operation
lock. This is deliberately conservative: inactive installations keep running services
unchanged, but two administration commands do not write concurrently. Finer-grained
parallel updates are deferred; there is no installation/lifecycle lock ordering cycle.
Runtime lifetime and request/cache locks remain separate from maintenance.

The existing native lock primitive uses open-file-description locks on Linux. npm
and short-lived administration children inherit the descriptor; a killed caller does
not free it while the writer lives. Real child-process checks verify this behavior.
Daemon processes do not inherit it. No PID/age/procfs stale-lock rule is used.
Recognizable v2 markers can be recovered only after acquiring the OS lock. Unknown
legacy markers remain blocked for review. npm installation hooks are disabled so
package scripts cannot leave untracked descendant writers. macOS service acceptance
remains deferred; raw external npm commands are outside AgentPay's coordination.

Persist non-secret checkpoints: selected installation/data, target versions, phase,
and prior active/service state. Re-entry validates installed dependencies before
resuming repair. It must not activate a previously inactive installation, resume a
payment, change Policy, or invent a replacement request. Failure messages distinguish
active writers, safely recoverable interruption and uncertain ownership.

## Change map

| Component | Required change |
| --- | --- |
| User installation-paths / local-data-directory | Per-install binding and state, single active selection, explicit adoption |
| User CLI and command scripts | Resolve context once; show bound/active distinction; confirm switching through service start |
| User install / npm-update / local-update / uninstall | Scoped exclusion/checkpoints; inactive operations preserve the active services |
| User autostart / local-service / status / endpoint migration | One managed pair, lifetime ownership, serialized switching, correct status/log targets |
| User runtime-client / runtime-connection-settings / skill-client | Stable shared bootstrap and default resolution; invocation never reroutes mid-request |
| Wallet | Verify separate data/socket state and clean stop/start; keep signing and Policy rules unchanged |
| Agent template / official Skill | Assess minimal shared-bootstrap migration; retain business-only glue and version immutable changes |
| Market / Settlement / Protocol | No new API or domain model required; existing template and fixed-package distribution remain |

Update User README, usage, command guide and installation/recovery docs with the
actual supported selection behavior. Agent examples must match the shared client.
Review any official Skill package change before updating User's built-in digest.

## Delivery order and acceptance

1. **Binding and storage:** install two program trees through public entry points;
   reuse/adoption preserves existing identity; separate installation does not copy
   keys or take over the active pair.
2. **Single active lifecycle and recovery:** switch both ways; cancellation, failed
   stop/start, concurrent starts and interrupted switch never leave two active pairs.
   Login preference is preserved. Inactive update/uninstall leaves the active pair
   usable. Real SIGKILL tests cover both all writers ended and surviving npm children.
3. **Default Skill entry:** same maintained Skill entry reaches the active pair after
   deliberate switching without editing harness configuration. Exercise two controlled
   business payloads. An interrupted old request cannot become a payment by the new
   Wallet. Verify missing default and port collision errors with no fallback.
4. **Package and participant checks:** source, folder-local and global npm paths;
   template migration if needed; keys, Policies, original requests and cache preserved.
   Prepare the user rehearsal only after these checks, with explicit release approval.

Use maintained fixtures, not third-party Skills or unapproved paid tests. Isolated
checks do not prove financial acceptance. macOS service integration remains deferred
until a test machine is available. This design update does not authorize package
publication, live migration, chain writes or new payments.

### Uninstall implementation checkpoint

Removal and service switching use the same lifecycle lock. The confirmation preview
is revalidated inside the lock; changed targets require another confirmation. Valid
foreign managed units are left intact, and shared active data cannot be purged.
A partial unit deletion can be retried. The default selection remains stopped after
removal, so Skills cannot silently select another Wallet. Unknown occupied ports
remain a conservative refusal. Installer/update and child-writer exclusion are now integrated. Actual systemd and
full participant interruption acceptance remain open.

### Historical request implementation checkpoint

Confirmed switching imports known client selection/checkpoint scopes and request IDs
from both involved folders without rewriting history. Runtime-only or unreadable
history cannot establish the original Skill input; retain a conservative unclassified
owner barrier. Do not fail Runtime startup solely because old requests need review.
A different default installation must not automatically invoke a replacement when
this barrier applies. Explicit `--force` still means a deliberate new purchase.

Missing selection/checkpoint files stop automatic recovery; conflicts require the
original installation and saved `--resume` identifier. New ownership selection and
local checkpoint creation share the short maintenance lock; payment/network calls
remain outside it. [Verification and limits](../records/historical-request-routing-2026-11-11.md).

## Readiness and startup preferences — 2026-11-11

A successful service-manager start request is not readiness. Before publishing the
default connection, check the selected data directory's authenticated Wallet status
and Runtime status, including the installed pair's reported versions. Wallet may be
locked and historical Order checks may still be running. Neither condition alone
prevents a running connection from being selected.

Preference changes and same-installation preparation preserve availability; they
do not revive stopped services. Removal closes the default. If unit installation
succeeds but readiness fails, keep the default closed and allow repair or another
start. Login startup performs the same checks while holding the selection lock,
and cannot publish another program/data selection or an unfinished switch.

These checks have isolated transport and service-control fixture coverage. Actual
systemd switch/login acceptance remains a separate gate.

## Confirm before applying settings; keep one state location — 2026-11-11

The installer validates downloaded public settings in memory. While holding the
installation operation lock, it requests the normal setup activation/switch. Only
successful activation permits writing deployment settings and importing missing
legacy setup files. Cancellation does not bind the new installation or change the
old deployment. The activation child inherits the operation lock, so another
installation cannot switch services between consent and configuration application.
Dependency preparation may already have completed; cancelling does not roll back
installed program packages. A failed download never requests a service switch.

On first mutation/start, the chosen state directory is recorded in the private
`~/.local/state/agentpay/state-location.json`. This small file contains only the
state directory path; Wallet data and its identity stay in their own data folder.
Existing XDG state directories are retained in place. Subsequent CLI commands,
background processes and candidate Skill loaders follow this locator even if their
XDG environment differs. Read-only lookup does not create it. Initial concurrent
writers publish without overwriting another location; conflicting commands retry.
Changing XDG is not a state migration or a way to start a second Runtime.

The locator is retained when uninstalling an installation because other bindings
and original-request ownership may still use the shared catalog. Invalid/private-
permission failures stop lookup instead of silently choosing another directory.
This is local routing under one OS account, not isolation against hostile code
running as that user. Existing immutable Skill packages are not rewritten.

## Service command failures — 2026-11-12

After verifying all generated target unit files, persist an unavailable default
before daemon reload or start/stop. A failed command must not be confused with
unfinished file replacement: stop can be retried, and startup failure permits
repair. An older preparing/stopping journal can use the same recovery only when
all exact target units exist and agree. Partial or conflicting files still require
completing the recorded switch. The unavailable journal phase does not assert
that the processes have stopped; status and stopped-listener checks remain required.
