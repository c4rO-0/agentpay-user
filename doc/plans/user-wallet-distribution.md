# User and Wallet distribution

Updated 2026-11-16. npm is the implemented primary distribution path. The
repositories, releases, processes and roles remain separate. See
[installation](../runbooks/user-onboarding.md) and [updates](../runbooks/local-update.md)
for commands; this document explains the maintained boundary.

## One install, separate authority

Installing User downloads its exact reviewed Wallet dependency and public Protocol.
No sibling checkout or Wallet compilation is needed. Wallet remains independently
installable and owns the Session Key. User uses documented client/administration
exports and capability-scoped IPC, never generic signing or private Wallet internals.

npm installs program files only. Product commands perform setup, service changes,
owner approval and paid tests with the corresponding consent. No postinstall hook
creates keys or spending permission. Private data stays outside package directories.

## Version and update contract

The manifest, lockfile and update-pair metadata select exact compatible packages.
Installed dependency checks include each consumer's actual Protocol resolution.
Process-start version/interface reports detect stale running software; diagnostics
and repair remain accessible on mismatch. Version equality does not prove transaction
readiness. Wider compatibility ranges require a separately verified matrix.

`agentpay update` displays the exact User release and paired Wallet before replacing
files; `-f` skips update consent only. Both global and direct project npm installs
are supported. Source/link installations update their files and use `repair`.
Preflight checks engines and installation without lifecycle hooks. A new process
repairs the confirmed version using its own official Skill digest and interfaces.
Installer ownership covers writes; child writers retain ownership as required until
they finish. Recovery keeps checkpoints and refuses unsafe overlap or downgrade.

Multiple installations may retain separate data. One selected Wallet/Runtime pair
runs per OS user. Inactive repair/update stays inactive; deliberate service start
asks before switching. No upgrade changes a Policy, creates a replacement Order or
runs the paid test. See [installation design](local-instances-and-install-recovery.md).

## Release and evidence

Protocol/Wallet corrections must be published before User pins those artifacts.
Tags vX.Y.Z trigger each package's authorized OIDC publication; manifests and tags
must agree. Verify the installed archive and public npm integrity separately.

Public package installation, update/restart and configured two-installation switching
have scoped evidence in [progress](../../progress.md). Exact remaining participant
and deployment gates live in [TODO](../TODO.md). Combined source ZIPs, embedded Node,
broader compatibility ranges and additional platforms are optional later work.
Historical sequencing is retained in the [baseline](../archive/review-baseline-progress-2026-11-16.md).
