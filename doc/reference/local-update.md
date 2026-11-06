# Apply downloaded User / Wallet updates

Implemented design reference. Current release/participant gates are tracked in
[TODO](../TODO.md); this document is not new deployment or payment authorization.

## One entry for Git and ZIP installations

The user obtains the documented compatible User and Wallet source versions first.
Both remain separate sibling folders. ZIP users do not need Git. From User:

```sh
./run repair
```

`./run repair` asks for confirmation when local changes need applying; `-f` skips
only that prompt. It never forces an incompatible pair or repeats an unchanged
successful update. In non-interactive use, confirmation requires `-f`.

The command does not download, merge, reset or replace source. It checks local pair
metadata, pauses local user services, installs dependencies/builds Wallet using the
existing installer, starts Wallet and Runtime, checks both, and prompts the user to
run `./run wallet unlock` followed by `./run status`. Dependency tools may access their
package registries; “no download” refers to application source, not dependencies.

## Compatibility and release responsibility

`update-pair.json` in the reviewed User source declares its User version, compatible
Wallet version and Protocol types dependency. The updater checks those declarations
against the two package.json files before stopping services. The versions need not
have the same number. This is a compatibility check, not a source signature or proof
of a clean Git checkout. It cannot distinguish arbitrary edits retaining metadata.
Publishers must bump versions when releasing changes, test the pair and update this
file. Current development metadata is not a claim that a new tag was published.
Never guess a pair from two independent latest releases.

## Implementation and preserved boundaries

`local-update.mjs` owns the orchestration. `runInstall({prepareOnly:true})` provides
normal dependency verification and build checkpoints. Its before/after callbacks
run under the existing install lock: prepare user service files, stop, build, start
and readiness verification cannot interleave with a second installer. The update
rechecks pair metadata after acquiring this lock. Tool availability and private data
paths are checked before the service pause.

The updater does not modify Session Keys, Policy, Market connections, deployment
addresses, official-test selection, Order IDs, histories or cached input/output.
Normal Runtime reconciliation may update status after startup. Login startup choice
is unchanged. Explicitly running update starts the two local services on success,
even if previously stopped; it does not enable login startup. Existing unmanaged
listeners or conflicting units must be resolved rather than killed or overwritten.

No automatic unlock, Policy renewal, Skill switch or paid test occurs. After software
readiness, and also on unchanged-code retries, official test package preparation
downloads and checks the fixed ZIP hash and installs alongside old packages. Network
or pin errors remain a separate reported outcome; original selection/checkpoints
are never changed. Linux systemd user services are supported; macOS remains deferred.

## Local change detection

The existing private installer state records `localUpdate` only after a successful
service readiness check. It fingerprints User source/scripts/locks/vendor and the
pair file, Wallet source/build inputs and generated dist/src, plus the Node path/version.
No Git metadata is needed. The confirmation runs under the installer lock, before
service changes. Source is rechecked after confirmation and after building; a pending
marker prevents an interrupted run from being mistaken for a completed update.
Missing dependencies also prevent the no-change fast path. This is change detection,
not a cryptographic trust proof for arbitrary locally edited source.

## Failures and retry

- Wrong pair, unsupported platform or occupied install lock: stop before pausing.
- Dependency/build failure: keep local data and report that services remain stopped;
  show the actual installer log and `./run repair` as the retry command.
- Stop/start/readiness failure: report uncertainty, direct to status/logs, never
  claim that both services are stopped or healthy without evidence.
- Successful update: both service interfaces respond; locked Wallet and incomplete
  historical reconciliation are not proof of payment readiness. Direct to unlock/status.

There is no automatic software rollback. Do not claim the previous executable
version remains usable after an in-place build fails. A terminated updater can leave
an install.lock; retain the existing explicit stale-lock inspection requirement rather
than deleting an unknown process's lock. Data restoration is never part of retry.

## Evidence and remaining acceptance

Controlled tests cover ZIP/Git directory shapes, different paired version numbers,
mismatch/tool/lock gates, pause/build/start ordering, build failure, failed stop,
readiness failure, unchanged startup preference and installer lock lifetime through
restart. These mocks do not prove an actual systemd handoff or successful build on a
participant computer. That is the next human-executed rehearsal. No live purchase is
needed to validate this update command.
