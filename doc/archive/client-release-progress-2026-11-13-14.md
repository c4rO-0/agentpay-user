# Historical client release progress — 2026-11-13–14

Stage-specific pending labels below are superseded by current progress and the participant closeout.

## User 0.3.21 published — 2026-11-14

Tag v0.3.21 identifies b2da74585b75a050b3a63e3c78257e1cfe22f87f.
Local full verification passed 477 tests in an isolated HOME; independent package
installation checks passed. GitHub publication run 43539891554 passed behavior,
package and publish steps. Public npm 0.3.21 is visible; the 366705-byte archive
matches its SHA-512 integrity and the verified local artifact. Wallet stays 0.3.5.
Participant update/health/status and the A/B return switch remain pending.


## Participant status diagnostics — 2026-11-14

Installation A's read-only inventory found no Setup projection in the selected
or fallback locations. Market public settings responded HTTP 200 in 1.15–1.28 s;
this does not establish the cause of the earlier intermittent failure. Health now
uses the Wallet binding's registryRpcUrl when Setup RPC is absent. Deployment
checks allow 10 seconds, retain safe error categories and cache failures for
15 seconds (successful settings remain cached for 60 seconds). Same-scope terminal
Order evidence survives transient query failure, with an explicit stale-state
warning; errors still block unresolved operations and retry normally. No Policy,
Order identity or platform addresses are changed. Publication and participant
acceptance remain pending.


## Published 0.3.20 — 2026-11-13

Release tag v0.3.20 identifies a0e0f66bb3c3ad0044241a64bc8b08345b9e0bb5.
GitHub publication run 43443805718 passed publication checks; public npm
archive integrity was independently verified against the local release artifact.
This publishes the nickname fix; Market deployment remains separate.


## Nickname validation release 0.3.20 — 2026-11-13

User 0.3.20 pins published Wallet 0.3.5. Local full behavior verification passed
475 tests in an isolated HOME; standalone package checks passed. The caller-auth
test now isolates its child state and handles an already-exited child during cleanup.
Market requires a separate deployment. Tag publication and npm verification are pending.


## Nickname review fixes — 2026-11-13

Historical nickname uniqueness keys are checked independently of current input
restrictions, so previously accepted formatting characters do not prevent Market
startup. Incorrect stored keys still fail the integrity check. User validates saved
nickname suggestions before displaying them; invalid suggestions fall back to
My Wallet, while existing connected identities are never silently renamed.
User's 16 connection checks and Market's startup/schema and connection HTTP checks
passed. Market checks use controlled SQL fixtures, not a live database. Source only;
release and deployment remain pending.


## Wallet nickname validation — 2026-11-13

Invalid local nicknames and Market ORDER_CONNECTION_LABEL_INVALID / LABEL_TAKEN responses now keep new-Wallet naming in the same signed-in flow. Existing Wallet names are never silently changed; invalid existing names stop with review guidance. Controlled connection tests cover local rejection, server rejection, unchanged identity and login reuse.
Source changes only; deployment/package release remains pending.


## User 0.3.19 published and verified — 2026-11-13

Release tag v0.3.19 points to 93dd7a5154db70a0604203c2ad0a6b783ba4f375.
Local full suite passed 471 tests; standalone archive checks passed. GitHub run
43382567167 completed successfully, including npm integrity verification. Public
npm latest is 0.3.19; the 364179-byte download independently matches its SHA-512
and the tagged update/diagnostic/entry source. Wallet remains 0.3.4.
Participant installs this recovery release through npm once, then runs update to
verify and close the older journal. Cancellation/failure keeps the record. Participant
execution is pending; no new authorization or paid test is required.


## User 0.3.19 release candidate — 2026-11-13

Close older update journals after verifying a manually installed newer release,
with confirmation and fresh repair checks. Cancellation/failure/scope mismatch or
program changes during verification keep the journal for retry. No downgrade or
new payment. Wallet remains 0.3.4 and Protocol 0.14.3. Release checks and publication
are pending; participant 0.3.18 repair already succeeded, update recovery has not.


## Participant repair passed; newer-install update recovery — 2026-11-13

Participant installed User 0.3.18 through npm and completed repair with Wallet
0.3.4; service readiness and the pinned official Skill check passed. The older
0.3.16 update journal still blocked update. The new recovery branch verifies the
exact installed newer release/dependencies, asks before final checks (unless -f),
and removes the old journal only after successful repair/verification. Cancellation,
verification failure or a different data folder preserve recovery state; no downgrade,
reinstall, authorization or payment is initiated by this branch. Specific scope and
package errors replace the generic CHECK_FAILED for these conditions.
Focused tests use real temporary files and controlled npm/service boundaries; they
cover cancel, failed retry, successful completion, subsequent latest-version lookup,
and mismatched dependencies/data scope. This fix is not published yet. Participant
unlock/status and configured A/B switching remain pending.


## Participant old-updater recovery gate — 2026-11-13

Participant update still ran User 0.3.16 because its pending update record selects
the already-installed old version and retries repair before checking latest. The
0.3.18 fix was never loaded. Prepared a normal npm install of 0.3.18 followed by
its repair; no state record deletion, authorization or purchase. Participant execution
is pending. A separate updater gap remains: after installing a newer version by npm,
the older pending target currently blocks future update rather than reconciling the
installed version. Resolve with verified same-installation/data recovery, no downgrade
and no premature journal removal; do not claim the full update loop is closed.


## User 0.3.18 publication verified — 2026-11-13

GitHub run 43378486830 completed successfully. Public npm version and latest both
resolve to 0.3.18. The 361261-byte archive passed independent SHA-512 verification;
manifest, update pair, handoff/diagnostic modules and CLI/service entries match
release tag v0.3.18 (c6559d18dbcec953559f9e1730e2bab65f6fab72).
Wallet remains 0.3.4. Earlier publication-visibility entries below are historical;
the registry gate is now closed. Participant repair/unlock/status and configured
A/B switching still require verification; no participant services were changed.


## User 0.3.18 publication visibility pending — 2026-11-13

Tag v0.3.18 is c6559d18dbcec953559f9e1730e2bab65f6fab72. GitHub run
43378486830 passed Verify User behavior and standalone package verification;
Publish with npm trusted identity returned success. Public npm latest still reads
0.3.16 and the 0.3.18 metadata endpoint returns 404. The registry integrity step is
waiting. Do not republish or claim availability; maintainer publication output is
requested to distinguish propagation from a staged/reviewed release. No production
handoff guard was relaxed. Participant repair remains pending package availability.


## User 0.3.18 release candidate — 2026-11-13

The maintainer supplied the v0.3.17 failure: real-process handoff was refused at
ownership validation. The test now observes the real cgroup: user-session fixtures
must hand off successfully; system-managed fixtures must reject handoff without
stopping either child. Only the test owner then cleans up its own children to
verify managed restart. No production guard, cgroup injection or CI-only bypass
was added. CI diagnostic output distinguishes these evidence scopes. The v0.3.17
tag remains unchanged. Wallet stays 0.3.4; npm publication is pending for 0.3.18.


## User 0.3.17 CI gate — 2026-11-13

Source/tag v0.3.17 points to 86757e1c0b620e25c978e782a04eecf36e0c6d31.
Local full suite passed 468 tests and standalone archive checks passed. GitHub run
43377098217 failed at Verify User behavior before publishing; npm release is not
confirmed. Public annotations contain only exit code 1; log download returns 403.
The maintainer subsequently supplied the failure; see the 0.3.18 follow-up above.
Do not overwrite this tag or treat it as a published npm release.


## User 0.3.17 release candidate — 2026-11-13

Release includes managed Linux Setup startup, verified legacy-process handoff and
command failure diagnostics. Wallet remains 0.3.4; Protocol remains 0.14.3. Source,
manifest and tag must match. Publication/registry verification and participant repair
remain pending; no participant services or transaction records were changed here.


## Managed Setup and legacy process handoff — 2026-11-13

Implemented Linux Setup startup through the existing systemd user-service path;
login startup remains a separate preference. Repair/start/stop and confirmed
installation switching retire only verified legacy guide processes, with bounded
SIGTERM waiting, no forced kill, and PID record retirement after exit. Missing,
foreign or mismatched live identities do not authorize signalling. Setup now checks
running package/interface versions, rather than accepting any healthy old Runtime.
Isolated real-process and controlled service-manager verification is recorded in
User's diagnostics/repair review. No participant services, Policies or Orders were
changed. Release and participant repair/A-B acceptance remain pending.


## Command failure diagnostics — 2026-11-13

User commands now share a failure boundary and private diagnostic reports. Setup,
repair/update, service management, Wallet/Policy, Market connection, Orders and cache
operations retain reviewed causes and recovery guidance. Service subprocess errors
preserve exit status and running/installed versions; failed service operations
collect bounded read-only systemd state and recognized journal failure categories.
Raw journals and arbitrary exceptions are not copied into the shareable report.
Controlled subprocess tests cover cause propagation, report permissions, secret
omission and service evidence. This does not repair the detached-process/systemd
ownership gap below; participant recovery and publication are still pending.


Review follow-up: automatic-startup errors and install-log read failures now retain
the original cause. Isolated real-process reproduction confirms guide endpoints
block managed startup; explicit shutdown of test-owned processes permits restart.
Automatic handoff is now implemented above; participant process ownership and recovery remain unverified.

## Participant setup/service ownership gap — 2026-11-13

B completed the official paid test and reported one settled Order. Status then
showed installed User 0.3.16 with running Runtime 0.3.15. Repair stopped/started
systemd units but readiness still reported the old Runtime; both units subsequently
showed failed with exit code 1. Code inspection confirms Setup starts detached
processes and finishLocalSetup only enables future login startup; systemd stop does
not cover those guide processes. Participant read-only process ownership verification
is pending before any signals or handoff. Do not repeat the paid test or reset data.
The implementation above addresses this ownership gap. Participant repair and
configured A/B switching must still verify the real systemd handoff before closeout.


## Setup payment-test HTTPS regression — 2026-11-13

Participant B reached the paid-test step and received only STEP_FAILED. Inspection
found that its legacy helper incorrectly required loopback HTTP for Settlement as
well as Runtime. HTTPS Settlement therefore failed before request creation in this
helper. It now uses the shared platform URL validator while retaining local Runtime
loopback restrictions. Controlled process acceptance uses an HTTPS Settlement base,
one simulated Order and original-request receipt confirmation; no live payment was
performed. Participant B subsequently reported successful delivery/receipt and one settled Order; the remaining service ownership failure is recorded above. User 0.3.16 is published with Wallet 0.3.4 unchanged. Wider review also replaced raw captured-helper errors with reviewed
categories, bounded captured output without killing uncertain financial work,
and moved purchase-readiness RPC reads to the cancellable transport. Readiness
now compares Policy fields using the same normalization as setup and stops further
chain checks after a failed initial inspection. Readiness blockers also carry
reviewed diagnostic categories so the guide can explain a timeout or network
failure rather than printing only CHAIN_POLICY_UNAVAILABLE. Health uses the existing public
purchase-readiness endpoint for connectivity (not payment readiness); unfinished
setup is distinguished from local service failure. No nginx route was opened.

Controlled verification: setup/recovery and multi-service process tests passed;
health's former expectation that unfinished setup must fail was updated, and all
five health/readiness checks passed, including a command exiting while the RPC
server remained stalled. Installed candidate archive acceptance passed nine checks
covering actual service restart, owner-page assets, the official-test helper with
an HTTPS platform base and sanitized child failure. These are simulated services,
not participant payment or full A/B acceptance. The earlier locally packed 0.3.15 candidate was not the published 0.3.15 artifact;
the release version is 0.3.16.
Published tag `v0.3.16` points to `076377f`. [Release workflow](https://github.com/c4rO-0/agentpay-user/actions/runs/43361067283)
passed the full behavior suite, installed-package acceptance and registry integrity.
Independent download verified npm latest 0.3.16, Wallet 0.3.4 and archive SHA-512.
Participant B should update and resume its original setup, retaining the saved request.


## npm owner approval assets — 2026-11-13

Participant B passed chain inspection but confirmation failed before opening the
Safe approval page. The npm file allowlist omitted web assets and the browser
ethers bundle used a source-only node_modules path. User 0.3.15 includes
the static web assets, resolves ethers from the installed dependency, and reports
missing program assets separately from missing Wallet data. The package acceptance
entry now runs the owner-page HTTP/export tests from the installed archive, including
loading both browser scripts. No saved key, draft or Policy needs replacement.
Published as `v0.3.15` at `6a5a142`. [Release workflow](https://github.com/c4rO-0/agentpay-user/actions/runs/43355135810)
passed full tests, installed-package acceptance and registry integrity. Independent
npm download verified SHA-512 and all four web assets. Participant browser approval
remains pending; no live authorization was performed by these tests.


## Setup diagnostics published — 2026-11-13

User 0.3.14 keeps Wallet 0.3.4 / Protocol 0.14.3. Review fixes stop
further chain probes after RPC timeout and reject HTTP 200 proxy/error pages rather
than treating them as valid platform responses. An additional process-level check
found that ethers provider destruction alone leaves HTTP work pending. The final
patch uses abortable, bounded HTTP for read-only RPC checks and verifies process
exit while the test RPC server is still running. User 0.3.13 was published during
this review; v0.3.14 supersedes it without moving the existing tag.

Participant read-only diagnostics found valid contracts and owner but an 8.744-second
combined preflight, exceeding the former five-second limit. Setup and policy preview
now allow 30 seconds. Saving settings reprompts on blank/invalid confirmation;
owner-wallet approval is explicitly the default, with test-signer guards unchanged.

New `agentpay health` performs read-only local settings, chain/contract, local
service and configured platform HTTP checks. It prints safe categories, durations
and next steps without credentials, URLs, personal paths or Order contents. It does
not switch installations, unlock, sign, repair or create requests. Setup failures
use reviewed categories and retained-progress guidance; installation and Market
failures point to diagnostics while retaining existing specific guidance/log paths.

65 targeted checks passed, including actual local HTTP with controlled chain
responses, a combined setup check slower than five seconds, invalid confirmation,
privacy and unchanged diagnostic storage. These are controlled regressions, not
completion of participant B setup or full configured A/B switching.

Published as `v0.3.14` at `65f178d`. [Release workflow](https://github.com/c4rO-0/agentpay-user/actions/runs/43352403711)
passed the full behavior suite, independent package checks and registry integrity.
npm latest, pinned Wallet 0.3.4 and downloaded archive SHA-512 were independently
verified. The final transport patch also passed 42 targeted regressions, including
child-process exit against a still-running stalled RPC. Participant continuation
from the saved B setup remains pending.


