# Independent User and Wallet distribution

Updated 2026-11-07. The approved primary distribution direction is npm for Protocol,
Wallet and User. This replaces the 2026-11-06 combined-source-ZIP-first plan.
Repositories, processes and releases remain separate; Node is still required.

## Intended user experience

Ordinary users install `@c4roa0/agentpay-user` and run `agentpay setup`. User installs
its reviewed Wallet dependency; both consume public Protocol. No sibling source
folders, pnpm or local TypeScript build are required for the published User path.
Wallet remains independently installable. Git checkouts are for contributors; the User 0.3.0 candidate now uses the same
public Wallet package. User npm publication remains a separate release step.
Combined ZIPs and platform binaries are optional later work, not a release prerequisite.

npm installation only installs program files. Key creation, background-service
configuration, owner approval and payments require explicit product commands.
No postinstall hook may initialize keys, register services or authorize spending.
Keys, Policies, request history and cache stay outside package installation paths.

## Dependency and authority boundaries

User -> Wallet -> Protocol, and User -> Protocol. Publish only reviewed runtime
files, public declarations, documentation and licenses. Wallet ships compiled JS.
Use exact reviewed dependency versions initially; independent compatibility ranges
are a later step. Versions need not have the same number across repositories.

Replace User imports of Wallet internals with documented IPC-client and local
administration entry points, and resolve the CLI through the installed package.
Normal service calls remain capability-scoped IPC; trusted local administration is
not an Agent API. Do not expose generic signing or let a package dependency move
Session Key ownership into Runtime. Generic private-file helpers belong to User's
own storage boundary, not a new public Wallet API solely to preserve an old import.

Check installed interface requirements and running Wallet identity before enabling
incompatible operations. Installation/version metadata alone is not proof that the
current daemon matches. Preserve diagnostic and recovery access on mismatch; never
replace purchases, Policy identity or keys to resolve an upgrade failure.

## Upgrade and uninstall

Review -> confirm -> stop services -> install update -> repair executable paths ->
start and self-check -> request unlock. Do not let an arbitrary latest-version
lookup replace executable code. `repair` repairs installed files; downloading an
update is a distinct action. Failed/interrupted updates retain private data and
must give a concrete recovery path. Moving npm/Node installations must not leave
systemd pointing silently to a missing or older executable.

Distinguish program removal (stop/remove services, retain private data) from explicit
confirmed deletion of local keys/history/configuration. Document recovery if npm is
uninstalled first. Do not rely on npm lifecycle hooks for sensitive cleanup.

## Closed loops and acceptance

1. Commit the verified Protocol npm migration for User and Wallet as a baseline.
2. Prepare Wallet public package entry points and compiled artifact. Inventory User
   consumers; test installed tarball CLI and real IPC/key lifecycle independently.
   No npm upload or User package migration in this loop.
3. Integrate User with the Wallet package; remove sibling source/build assumptions;
   expose `agentpay`, align service paths, installer, repair and uninstall.
4. Verify version/interface and running-process compatibility, update interruption,
   data preservation and bounded mismatch handling. Keep exact pins until ranges
   and their negative tests are explicitly designed.
5. Configure independent OIDC release workflows. Publish Wallet first, then User;
   verify public registry installs. Update Market and human guides to tested commands.
6. Accept fresh install, restart/unlock, upgrade, uninstall and the official paid
   connectivity test through the same product path on Anvil. Multi-service behavior
   uses maintained controlled fixtures. Real-network acceptance remains separate.

Current scope update — 2026-11-07: owner authorized User package adoption and
installer/service/repair/uninstall integration in sequence. Implemented and tested
with public Wallet 0.3.0. User 0.3.0 remains private/unpublished pending review and
participant acceptance. Exact installed versions are checked; running-daemon version
negotiation is still a separate compatibility task. No participant services, keys,
Policies or Orders were changed in this development loop.

## Approved npm update — 2026-11-07

`agentpay update` queries the configured npm registry for User, displays the exact
release and pinned Wallet version, and asks before changing services. `-f` bypasses
only that confirmation. Target installation is exact, engine-strict and skips
lifecycle hooks; artifacts must already be runnable. Global npm installs are
supported; source/npm-link checkouts use their own source updates and repair.

The installer lock protects requirements/stop/package replacement. Release it before
the new version's repair acquires it; contention refuses safely with a retry rather
than bypassing the lock. Repair runs in a new process, so it uses the new official
Skill digest and package interfaces. Other Skills and original test requests remain.
No paid test, Policy renewal or key initialization is implicit in update. Failed
installation/repair preserves private data and provides a repair/reinstall path.
Unconfigured installs continue through explicit setup after software update.
