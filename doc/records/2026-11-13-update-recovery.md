# Newer installed version and unfinished update — 2026-11-13

The participant installed User 0.3.18 and completed repair, but update still rejected
the older 0.3.16 recovery record. The program now verifies the exact installed newer
release and its Wallet/Protocol declarations, then requests confirmation (-f skips
only confirmation). It finishes checks using that installed version, never the old
program or a downgrade. The original journal remains until successful checks and
a final manifest recheck. Cancellation, failure, scope mismatch or program changes
preserve it for retry. Specific recovery error codes replace generic CHECK_FAILED.

Focused tests use real temporary files with controlled npm/service boundaries.
They cover cancellation, repair failure and retry, successful journal completion,
subsequent ordinary latest lookup, dependency/data mismatch and program changes
during recovery. These are not participant systemd or registry acceptance.
The complete local release suite and independent archive installation also passed.

User 0.3.19 is the release candidate; Wallet stays 0.3.4, Protocol 0.14.3.
Publication verification is separate. An older updater cannot load the fix by
retrying its own old repair loop: install the recovery release through npm once,
then run update. Keys, Policy and original Orders are not recreated.
