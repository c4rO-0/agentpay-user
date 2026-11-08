# User npm integration verification — 2026-11-07

User 0.3.0 candidate consumes public Wallet 0.3.0 and Protocol 0.14.3 through
public exports. No sibling source or Wallet compiler is required. User remains
private/unpublished. No participant service or private data changed.

## Checks completed

- Independent source copy with npm dependencies and no sibling Wallet: 366 tests
  passed, no failures/skips. Real process and IPC checks are included; remote
  platform/payment behavior uses controlled fixtures, not real financial acceptance.
- Final legacy data-location and repair-lock regressions, including local-update
  tests: 21 passed. A competing installer and conflicting connection stop before
  service changes.
- Packed User installed into a separate consumer directory: `agentpay help` worked;
  installed preparation and exact Wallet version checks passed without invoking a
  compiler or package manager. No source lockfile was needed.
- Real Wallet/Runtime started from the installed artifact: health answered, duplicate
  Wallet startup was rejected, restart remained locked and preserved its encrypted
  key. These two installed-package tests passed.
- Package allowlist includes runtime, public docs and licenses; no tests, private
  state, credentials, sibling source or source lockfile. Git whitespace checks passed.

## Implementation boundaries

Installation state uses XDG state storage. Setup configuration is stored with
private User data; old source checkpoints preserve custom data-directory selection.
A new npm installation cannot discover arbitrary old source directories: provide
AGENTPAY_USER_DATA_DIR when moving an old custom installation.

Repair checks exact installed versions, holds the installer lock across service
changes and updates only recognized managed units. Client-module relocation requires
matching Runtime URL and caller credential. Uninstall keeps data by default;
explicit --delete-data requires destructive confirmation. Neither renews permissions
nor creates purchases.

## Still required

Participant setup/upgrade/restart/uninstall acceptance, running-daemon version
negotiation, User npm/OIDC publication and Market guidance. Package metadata alone
does not identify a previously running daemon; current repair performs a managed
restart and readiness checks. No systemd login, browser, real-network or production
acceptance is claimed. Exact pins remain until compatibility ranges are designed.

## Review corrections and npm update

Relocation previously failed inside service preparation despite a permissive outer
preflight. Repair preparation now checks a relocation without writing it; only the
post-stop phase updates the client-module path. The real autostart script was tested
with old unit/client paths and a controlled systemctl command. Explicit purge now
removes matching legacy checkpoints/setup files so subsequent setup cannot reimport
them; unrelated source installation scope is not deleted.

After these corrections, the independent suite passed 374 tests. Final focused
checks passed 35, including cancellation, -f, installed-file changes during consent,
source-link rejection, install/repair failure, lock contention and retained data.

A real npm global installation under a temporary prefix was replaced from local
0.3.0 and 0.3.1 candidate tarballs. A new Node process loaded the new repair/version
and retained the private fixture. Neither candidate was published. Registry metadata,
systemd/readiness and official download were controlled in this check: it proves
artifact replacement and process handoff, not live platform/paid or login acceptance.
The existing official-package tests cover pinned digest rejection and preservation.

The updater follows npm's [install](https://docs.npmjs.com/cli/v11/commands/npm-install/)
and [view](https://docs.npmjs.com/cli/v11/commands/npm-view/) command interfaces.
A released-version registry upgrade and participant recovery still need acceptance.

## Running-process reporting follow-up — 2026-11-07

User 0.3.0 first publication was verified against the public registry. User and Wallet
Trusted Publishers are configured; first OIDC validation is still pending.

The next candidate checks process-start package/interface/Protocol metadata during
status and repair. User regressions: 378 passed; Wallet behavioral suite: 30 passed.
Wallet tarball consumption passed real CLI/IPC checks. A disposable User install with
a local Wallet 0.3.1 archive and temporary test-only dependency pin passed real process
startup/restart and key preservation. Missing/mismatched reports prevent repair from
recording success. No Policy, Order or participant service was changed.

These results do not establish a published-version upgrade: publish Wallet 0.3.1,
then update User's exact pin, lockfile and pairing metadata and verify its final archive.
The repository still pins public Wallet 0.3.0 until that release exists.

## Actual installed Protocol verification — 2026-11-08

Preflight checks resolved package versions from both User and Wallet, including a
nested Wallet dependency. A mismatched copy is rejected even if both consumer
manifests declare the expected version. Process reporting records the resolved
version at startup. Wallet's 30 tests and standalone archive CLI/IPC checks passed;
User's final 378-test suite passed after updating a dependency-less test fixture.
This is local compatibility verification, not a guarantee against altered package files.
Wallet candidate `7e4d4fa` is pushed; OIDC publication and User exact pin/lockfile
update remain the release gate.

## User 0.3.1 final pairing — 2026-11-08

User 0.3.1 pins public Wallet 0.3.1 and Protocol 0.14.3. Lockfile integrity came from
the public registry; no local file dependency or sibling checkout is required.
The complete suite passed (378 tests). The npm archive installed independently,
exposed `agentpay`, and started/restarted real disposable Wallet/Runtime processes
with matching software reports while preserving the key and starting Wallet locked.
Publication via GitHub OIDC and participant upgrade remain separate pending steps.
