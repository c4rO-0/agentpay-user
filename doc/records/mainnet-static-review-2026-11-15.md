# User static review — 2026-11-15 to 2026-11-16

Baseline: User 0.3.23, Wallet dependency 0.3.5, Protocol dependency 0.14.3.
Existing uncommitted progress/TODO release-evidence corrections were preserved.
The U3 minimum correction was approved on 2026-11-16. The bounded review and
focused correction pass are complete. No live service, Policy,
Order, credential, npm artifact or chain was changed.

## Findings

### U1 — malformed HTTP target can terminate Runtime (fixed in source)

The async HTTP callback in `src/index.mjs` parsed the URL outside its error boundary.
An unauthenticated request with target `http://[` caused a connection reset instead
of an error response. Reject invalid targets with HTTP 400 / INVALID_INPUT before
routing; do not allow this parse error to escape the server callback.
A real Runtime child-process regression now verifies response, continued health
and no Order creation. Controlled Wallet/Provider fixtures are not live payments.

### U2 — credential initialization changes a link target's permissions (fixed in source)

`initializeCallerCredential` in `src/caller-auth.mjs` chmodded the path before
validating the credential. A symlink reproduction changed its target from 0644 to
0600 even though the later no-follow read rejected it. Existing files now use a
no-follow descriptor with regular-file, link-count, owner and size checks before
chmod. Tests reject both symbolic and hard links without touching target contents
or permissions. This is not an isolation guarantee against malicious same-user code.

### U3 — concurrent renewals can reach different owner approval plans (fixed in source)

Entry: `scripts/renew.mjs` → `renewPolicy` in `src/renew-policy.mjs`.
The workflow reads the current binding and renewal journal without a shared
operation lock. Two callers can both observe no renewal, collect separate drafts
and write different generated Policy IDs to the same guide journal. Both then
reach `approveOwnerOperations`. Its plan-specific journals do not serialize the
higher-level renewal.

A bounded reproduction calls the real renewal coordinator concurrently with real
temporary state files and controlled guide/RPC/approval functions. Both flows reach
approval with two distinct createPolicy calls. The approval stub returns false;
there are zero network calls, owner signatures or transactions. This demonstrates
the orchestration race, not a completed on-chain overspend.

Potential impact, from source tracing: both plans revoke the same old Policy and
create different new ones. The owner page skips an already-revoked old Policy.
If the owner executes both plans, Module permits distinct Policy IDs with separate
budgets. Wallet's later expectedPolicyId/source-conflict check may reject the second
local binding, but cannot undo an already created chain Policy. This is not an
owner-signature bypass and does not by itself spend funds. It can leave an extra
live authorization and overwrite the guide's recovery selection.

Approved correction, 2026-11-16: setup, renew, revoke and the Wallet restore
command and advanced authorization/migration mutation entries acquire one
per-data-directory descriptor lock before reading authorization
state. `src/policy-operation-lock.mjs` is only the application integration; existing
`fs-native-extensions` 1.5.3 supplies the locking implementation. Inspected dependency
sources use Linux OFD locks, macOS flock and Windows LockFileEx. No additional
package, PID-based recovery, lease expiry or lock-file deletion is introduced.
Normal completion closes the descriptor; process exit releases it. The next command
reloads saved state and resumes the same draft. A busy command reports
POLICY_OPERATION_BUSY and never waits to start a second renewal automatically.
The lower-level restore helper is called inside setup/restore's owned operation;
it does not independently reacquire the lock. Browser and service children do not
inherit the authorization descriptor.

This protects cooperating commands using the same local data directory. It is not
cross-machine coordination, protection against malicious same-user code, or a global
one-Policy rule. Existing contracts, owner approvals, budgets and revocation semantics
are unchanged. Linux real-process checks are evidence for Linux only; other-platform
product acceptance and network/shared-filesystem locking are not claimed.

### U4 — stale documentation and fragmented history (fixed)

Current guides described implemented version checks as future work, pinned old
recovery versions and implied that an unmapped official test blocks generic setup.
Corrected those instructions, added the folder-local install step, documented lock
ownership and recovery, and consolidated progress/TODO with linked full snapshots.
Pending participant and deployment work remains explicitly tracked.

## Coverage (R1–R10)

| Area | Inspected modules / conclusion |
| --- | --- |
| R1 Design | Generic service references, shared Skill client, transport and input/result cache remain business-neutral. Official random test is scoped; platform URLs and signer are explicit. |
| R2 Flows | CLI install/setup, owner browser, renew/revoke/restore, advanced migration, Market connection, invocation/payment/delivery, Orders/cases, cache and uninstall traced through persistence and public consumers. U3 closes local competing authorization entries. |
| R3 Recovery | Installer/selection and Runtime/cache ownership, original request journals, pending/verified results, background recovery, update interruption and cancellation IDs reviewed. U1/U3 corrected; old unidentified client-directory locks remain fail-closed for review. |
| R4 Security/funds | Caller credentials, bounded owner plan, Wallet scopes, evidence hashes, ZIP/download limits and URL checks inspected. U2 fixed. User does not independently authorize money; Wallet/chain and platform authority remain distinct. No transaction semantics changed. |
| R5 Interfaces/dependencies | Public Wallet exports, both Protocol resolutions, exact installed/running pair, package/Skill trust pins, selected data directories and saved deployment compatibility checked. Reviewed Wallet/Protocol source changes need later published dependency adoption. |
| R6 Maintainability | Source map and control flow reviewed; comments explain request-before-send, verify-before-promote, operation ownership and lower-level restore nesting. No unrelated framework rewrite. |
| R7 Interaction | Grouped command routing, health/status, guided retries, sanitized cause reporting and service evidence reviewed. Lock errors give stable code and recovery action. Advanced scripts remain developer procedures rather than the normal human guide. |
| R8 Tests/CI | Behavioral suite, real process recovery, controlled financial boundaries, installed artifact and tag-triggered verification inspected. New regressions protect observable failures, not source structure; evidence limits below. |
| R9 Documentation | README, role catalog, architecture/design/developer/usage, renewal/update guides, AGENTS, progress/TODO reconciled. Chronology archived, unfinished scope preserved. U4 corrected. |
| R10 Release/operations | npm allowlist/license, exact pair/tag workflow, installed CLI/IPC/browser assets, service ownership, private-state separation and update/uninstall reviewed. Artifact installation verified; no tag, upload, deploy or participant-state change. |

The public entries and core orchestration/storage paths above were statically
reviewed; test success is additional evidence, not proof that no defect remains.
This is not an independent security audit or real-network acceptance.

## Validation

Before fixes, the two new regression cases failed on the described boundaries.
After fixes, caller credential and multi-service Runtime suites passed all 30
checks, including the real uninstrumented Runtime malformed-target case. Tests used
an isolated HOME/state directory, disposable files and local controlled services.
No public network or real funds were used. U3 reproduction has the limits above.

The authorization regression run passes 46 checks across renewal, restoration,
setup orchestration/local IPC and descriptor ownership. A real child holds the lock;
competitors are refused, SIGKILL releases it, a surviving helper does not retain it,
and original journal contents remain unchanged. A separate coordinator regression
rejects conflicting renew/revoke/setup/restore before authorization reads, then
resumes the same saved Policy ID. Chain/approval dependencies in coordinator tests
are controlled fixtures, not real chain acceptance. Existing interrupted-binding
and external approval plan regressions also pass. Fixtures now use disposable data
directories for real locking, without a test-only lock bypass.

Full sequential suite: 484 checks passed before the advanced-entry additions.
The final Linux process suite then passed all three scenarios, including seven
advanced mutation commands refusing ownership before reading Wallet/config or
contacting a chain. The child retains its FileHandle for its entire lifetime;
process termination rather than garbage collection is the tested release path.

An independent `npm pack` → temporary npm install consumed the pinned public
Wallet/Protocol packages with no sibling repositories. Installed command help,
real local Wallet/Runtime process handoff, owner web assets and maintained official
connectivity/helper tests passed. No publication, deployment or live authorization
occurred. Archive output and disposable test state stayed outside the repository.

## Closeout and retained limits

No unresolved blocker was found in this bounded User review after the approved
U3 correction. Linux native ownership is verified; macOS/Windows and shared/network
filesystems are not. Cross-machine/malicious same-user concurrency is not prevented
by this local lock. An independently exported owner transaction cannot be recalled
by a local process lock; chain authority checks still apply.

Keep the legacy pending-request lock's conservative manual recovery; do not silently
remove unknown locks or manufacture replacement purchases. Reviewed dependency
source corrections require a separate authorized release/adoption. Remaining
participant, owner signing and deployment evidence is in [TODO](../TODO.md), not a
reason to reopen this entire review. Commit the scoped source/docs; push, npm and
deployment require separate authorization.
