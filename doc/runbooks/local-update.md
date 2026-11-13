# Update User and Wallet

Keep your private data when updating program files. Do not uninstall to upgrade.

For a global npm installation:

```sh
agentpay update
```

For an npm installation inside a project folder, run its own command:

```sh
./node_modules/.bin/agentpay update
```

If an older updater is stuck retrying a failed repair, install the recovery release
in that same project folder, then run its updater:

```sh
npm install --save-exact @c4roa0/agentpay-user@0.3.19
./node_modules/.bin/agentpay update
```

The new updater recognizes that the installed version is newer than the unfinished
update. It verifies the published version and its dependencies, then asks to finish
the checks. Confirm to continue or enter `q` to leave everything as it is. It keeps
the newer version and closes the old update record only after checks succeed. Do
not delete recovery records or uninstall your Wallet to bypass this condition.

Both forms update the installation that owns the command, regardless of the
terminal's working directory. Directory installs update their direct User dependency
and package lockfile in that folder, with an exact version; global installs keep
their global prefix. The confirmation shows the target folder. User must be a direct
registry dependency, not a transitive dependency or a linked/custom-source package.

It checks the published User version and shows its exact Wallet dependency. Confirm
to continue, or cancel without changing services. `agentpay update -f` skips only
this confirmation. The updater checks requirements in a temporary installation directory, stops this installation’s selected services,
installs the confirmed version and invokes the new version's repair to refresh
services and verify its pinned official test Skill. No paid test runs automatically.
An inactive installation stays inactive: updating or repairing it does not stop the
selected Wallet/Runtime. Use `agentpay service start` from that installation when you
want to switch. Another command changing services or program files will ask you to
wait and retry. Other installed Skills and original requests are kept. Wallet needs unlocking after
restart. A current User version still checks the official test Skill.

Only genuine npm installations are updated. A source checkout or `npm link`
is refused rather than overwritten: update User's files, run `npm ci`, then
`agentpay repair`. Directory update has controlled real-npm verification; participant upgrade acceptance
remains separate. The updater uses npm's configured registry, checks
Node engine requirements and disables package installation hooks; releases must
ship usable runtime artifacts. It never independently selects the newest Wallet.

If npm fails after services stop, keep your private data. Review the shown log;
reinstall the intended User version with npm if program files are incomplete, then
run `agentpay repair`. If the updater was interrupted, rerun `agentpay update`: it retains the confirmed
version and finishes repair even if npm already installed it. Repair
failure is not reported as update success. A newer update cannot silently downgrade
a version changed while you were reviewing the confirmation.

For an old custom data location, first note `wallet info` in the old installation.
Set `AGENTPAY_USER_DATA_DIR` to that same directory when moving to npm; do not
initialize another Wallet. Source repair can read the old adjacent checkpoint, but
an unrelated npm installation cannot discover arbitrary old source folders.

User supplies its exact reviewed Wallet dependency; do not independently replace it.
For a source/ZIP
installation, stop services, update the User files, run `npm ci`, then `agentpay repair`.
If using the source wrapper instead of `npm link`, replace `agentpay` with `./run`.

Repair checks installed versions and asks before restarting changed services.
`agentpay repair -f` skips that confirmation only. It refreshes the managed systemd
user units and local client-module path; it preserves the Runtime address, caller
credential, login startup preference, keys, Policies and original requests.
Wallet starts locked after restart. No Wallet compilation is required.

If preparation fails after stopping services, they remain stopped. Resolve the
reported cause and repeat repair; the log path is shown. An interrupted run may
leave a lock marker. New-format operations allow retry after all writer processes
exit; while a writer is alive, wait for it to finish. Do not delete a lock to bypass
that check. An older lock whose writer cannot be identified is preserved for review.
There is no automatic code rollback. Running-package negotiation is not implemented; complete the managed
restart before relying on a newly installed version.

## Uninstall

`agentpay uninstall` asks before removing background services and keeps private data.
`agentpay uninstall --delete-data` asks for explicit confirmation before permanently
removing the selected local keys, configuration, history and cache. A matching old source checkpoint and its saved setup files are also retired during
explicit data deletion, so later setup cannot import them again. Unrelated source
installations are preserved. Neither command revokes on-chain permission. Afterwards, remove the program with
`npm uninstall --global @c4roa0/agentpay-user`, or delete your source folder.
If you removed npm's program first, reinstall the same reviewed version to run
cleanup against your existing data. Never erase keys to repair an installation.

## Official test Skill check

After a successful software update, the command downloads the published official
test ZIP using the saved Market source, verifies its bytes against User's built-in
SHA-256 and saves the new package alongside existing ones. It does not replace the
selected original test, edit checkpoints, execute package scripts or purchase.
The same check also runs when local software has no changes. Cancelling an update
skips it. Missing settings, network errors or a hash mismatch are reported separately;
they do not turn a successful software update into a failed preparation. Retry `agentpay repair`
without restarting unchanged software. Local edits in an existing installed copy
are retained and reported rather than overwritten.

## Missing local Skill connection

If a Skill reports a missing Runtime connection while services are running, run
`agentpay repair`. Preparation restores a missing `runtime/connection.json` from your
saved service settings, including when local code is unchanged. It keeps caller
credentials, keys, Policies and request history. A conflicting, malformed or unsafe
existing connection file is retained and reported for review; do not delete your
User data or repeat setup to work around it.
