# Directory npm update verification — 2026-11-08

The updater accepts a direct registry dependency in a project installation as well
as a global installation. The owning folder comes from the running package, not
the terminal working directory. Source/link, custom-source and transitive installs
remain outside automatic updates. Confirmation, exact release pinning, private-data
retention and the existing service repair flow remain in effect.

Nine controlled regression checks passed, covering global/local update, cancellation,
forced confirmation, failures, concurrent changes and unsupported install layouts.
A real-npm check installed public User 0.3.1 into a temporary project, ran the changed
updater against public 0.3.2 and verified program, manifest and lockfile versions.
Private-record fixture bytes were preserved. Service stop/repair hooks were controlled;
this is not participant process recovery or paid acceptance.

npm 10.9.8 dry-run changed node_modules/.package-lock.json without replacing program
files. The subsequent install could report up to date while leaving old code.
Lock-related flags did not reliably prevent this. Preflight now uses a disposable
prefix with privately copied project npm settings for consistent registry selection,
removed afterward. The real check confirms the existing hidden lockfile stays on
the old version after preflight. No participant keys, services or payments were used.

Follow-up publication and participant directory-update acceptance remain pending.

User 0.3.3 release preparation (2026-11-09): all 383 behavior checks and standalone
archive installation with isolated Wallet/Runtime process checks passed. Wallet
0.3.2, Protocol 0.14.3 and official package pin are unchanged. Publication and
participant acceptance remain separate gates.
