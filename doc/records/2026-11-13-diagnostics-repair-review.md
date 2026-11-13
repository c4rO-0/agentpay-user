# Command diagnostics and repair review — 2026-11-13

## Findings

The diagnostic changes do not resolve service ownership. Two remaining diagnostic
omissions were corrected during review: finishLocalSetup now preserves/reports
an automatic-startup failure; a failed attempt to read an install log tail cannot
replace the original installation error.

Setup starts detached Wallet/Runtime children and retains their PID files.
finishLocalSetup enables login startup without transferring the running children
to systemd. Repair stops systemd units, which cannot stop these independent guide
processes. local-service refuses occupied sockets/ports, while readiness can still
read the old Runtime and correctly reject its version. Setup also accepts an
already-running Runtime based on role/capabilities without checking the installed
version before declaring readiness. Updating files does not update a running process.

The participant's installed 0.3.16/running 0.3.15 and failed units are consistent
with this mechanism. The participant process identity has not yet been independently
confirmed; do not infer ownership from a PID file or port alone.

## Verification

The focused diagnostics/install/repair/autostart/process group passed 31 tests.
After extending the process case, setup-autostart and local-services-process passed
7 tests. The process case uses isolated real Wallet and Runtime processes: direct
guide-style startup occupies endpoints, managed startup rejects both duplicates,
and explicit termination of only test-owned processes permits managed startup.
The Wallet remains locked after restart, its encrypted key bytes are unchanged,
and no Order history or payment is created. This is not an automatic handoff test
and does not prove participant recovery. No deployed services were changed.

## Next repair loop

Unify future Setup and service management under one lifecycle on supported Linux
hosts. Existing guide processes require verified installation/data ownership and
safe bounded handoff; never signal an arbitrary listener or trust a stale PID.
Preserve keys, Policy, Orders and login preference. A restarted Wallet may require
unlocking. Require matching running software before declaring setup/repair complete.
Verify stale PID, unrelated process, interrupted handoff and configured A/B switching
before publication and participant recovery. Do not repeat the paid test as a repair.

## Implementation follow-up

Linux Setup now calls the existing managed service start path, preserving the
separate login-startup choice. Its live probes require installed software versions.
Legacy handoff validates private PID files, same-user process ownership, exact
Node/program/data arguments, Runtime state-directory environment and process start
identity immediately before requesting SIGTERM. It excludes system-managed and
AgentPay unit processes. There is no port-based PID discovery or SIGKILL fallback.
Consumed PID files are retired; key, Policy and Order files are untouched. The
existing installation lock serializes product service transitions.

The process regression now calls the product handoff: a stale PID naming the test
runner rejects the whole preflight without stopping either guide child; corrected
records allow normal shutdown and managed startup; repeating after exit is safe.
The unchanged encrypted key and absent new Order file are checked. This uses real
local child processes, but systemctl orchestration uses fixtures. Participant repair
is still pending. The earlier manual-shutdown observation above describes the
pre-fix reproduction, not the final verification.

After the implementation, the focused lifecycle/Setup/repair suite passed 67 tests.
No release tag or npm publication was performed in this loop.

## Release review

The complete release suite exposed a shutdown race: after SIGTERM, /proc/environ
can become unreadable before the process disappears. Exit waiting now reads only
the process lifetime/state; complete ownership checks remain required before any
signal. All 468 tests in the final full suite passed. Standalone archive installation
and real-process/package tests also passed. Manifest, lockfile and update pair use User 0.3.17;
Wallet remains 0.3.4. Publication and participant acceptance are recorded separately.
