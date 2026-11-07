# Independent User and Wallet distribution

Updated 2026-11-07. The approved primary distribution direction is npm for Protocol,
Wallet and User. This replaces the 2026-11-06 combined-source-ZIP-first plan.
Repositories, processes and releases remain separate; Node is still required.

## Intended user experience

Ordinary users install `@c4roa0/agentpay-user` and run `agentpay setup`. User installs
its reviewed Wallet dependency; both consume public Protocol. No sibling source
folders, pnpm or local TypeScript build are required for the published User path.
Wallet remains independently installable. Git checkouts are for contributors; keep
current instructions until the package integration is implemented and verified.
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

Current scope: steps 1–2 authorized on 2026-11-07. No new npm upload, chain operation,
service restart or participant data migration is authorized by this plan.
