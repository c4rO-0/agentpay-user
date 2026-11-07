# AgentPay User progress

## User 0.3.0 first publication prepared — 2026-11-07

Owner authorized the first npm publication. The package's private gate is removed;
README now describes the npm entry and exact Wallet dependency. GitHub `publish.yml`
uses the `npm-publish` environment and OIDC for subsequent releases. Initial Token
upload, public-registry verification and Trusted Publisher validation are pending.
No published-success claim is made by the prepared package or workflow.


## npm update and migration review fixes — 2026-11-07

Approved `agentpay update [-f]`: query npm, confirm the exact User release and its
pinned Wallet, check requirements, stop managed services, install and invoke the new
repair/official-test digest. Other Skills, original test requests, Policies and keys
are preserved. No paid test is triggered. Source/npm-link checkouts are not replaced.

Review fixes: relocation-aware preparation validates without rewriting the client
path before services stop; explicit data purge also retires matching legacy source
checkpoints/configuration; packaged documentation includes its referenced public
entry files. Independent regression suite: 374 passed; final targeted checks: 35
passed. Real npm replacement between two local unpublished tarballs and new-process
repair passed with controlled registry metadata/service readiness. User npm release
and real published-version upgrade acceptance remain pending; no participant services changed.


## User npm integration candidate complete — 2026-11-07

User 0.3.0 now pins public Wallet 0.3.0 and Protocol 0.14.3, resolves public Wallet
exports and exposes `agentpay`. Installer/setup, managed service paths, repair and
explicit uninstall modes no longer require sibling Wallet source or a compiler.
Private data remains outside program files. Old custom data selections are retained;
repair can refresh a moved client-module path only with matching URL/credential.
Service changes are covered by the installer lock.

Independent User tests passed (366 in the complete suite, followed by targeted
migration/concurrency regressions). A packed User installed from its tarball with
public dependencies and passed real isolated Wallet/Runtime restart checks without
sibling source. No participant service, Policy, key or Order was changed. User is
still `private: true`; no User npm upload or Market guide deployment occurred.
See the [User package integration record](doc/reference/npm-integration-verification.md) for evidence and remaining limits.

Next: review the candidate, then participant install/upgrade/restart/uninstall
acceptance. Running-daemon version negotiation, User OIDC publication and Market
install instructions remain open. Wallet Trusted Publisher is configured by the
owner and pending its first OIDC publication. Earlier sections below are historical
milestones; their sibling-build and unpublished-Wallet statements are superseded.


## Wallet first npm publication complete — 2026-11-07

`@c4roa0/agentpay-wallet@0.3.0` is public; npm `latest` is 0.3.0. The owner
published the verified artifact using a hidden-input Token. Registry SHA-512
integrity matches the local artifact. A fresh public-registry installation with
scripts disabled passed installed CLI and real IPC permission/unlock/restart checks;
disposable test data was removed. Source revision: Wallet `082a8db`.

The publication workflow is on GitHub, but Wallet's npm Trusted Publisher setup
and first OIDC publication remain unverified. User 0.2.0 still rejects this Wallet
pair; next development loop is User package adoption. No live Wallet services,
keys, Policies or Orders were changed. Earlier candidate sections record pre-release
evidence and are superseded for publication status by this section.


## Wallet package review follow-up — 2026-11-07

Review found a missing prepack build guard and stale internal-path examples in
packaged documentation. Wallet now rebuilds compiled files before normal npm pack;
installed tarballs need no build hook. Public client examples and package reading
paths are corrected. Clean independent pack/install, a TypeScript consumer and real
CLI/IPC unlock/restart checks passed. User integration remains the next loop;
Wallet 0.3.0 is still unpublished and intentionally rejected by User 0.2.0 pairing.


## Wallet npm candidate verified — 2026-11-07

Steps 1–2 complete: Protocol migration baseline committed; Wallet 0.3.0 candidate
provides public client/local-administration/CLI entries and compiled declarations.
Independent frozen install/build and 29 behavioral tests passed. The packed artifact
installed without sibling sources; real CLI/IPC checks passed for capability denial,
no generic signing, unlock and restart preserving the key while locking the service.
No npm publication, service restart or participant data change was performed.

Next: User consumes this reviewed Wallet package and resolves public entries instead
of sibling `dist/src` files. Current User 0.2.0 pair checks deliberately reject Wallet
0.3.0; do not update a participant Wallet alone. Publication remains blocked by
`private: true`; package and User integration must be completed before synchronization.


## npm client distribution plan — 2026-11-07

Approved npm-first distribution for Protocol, Wallet and User; separate repositories
and processes remain. Ordinary users will install User, which supplies a reviewed
compiled Wallet dependency. Combined source ZIP is optional later work. See the
local distribution plan for public entries, upgrades, service paths, private data
and uninstall boundaries. Steps 1–2 are authorized: commit the verified Protocol
dependency baseline, then prepare/test Wallet's public package. User package
integration and npm uploads are later loops; present sibling installation remains
until replaced and verified.


## Public Protocol npm migration verified — 2026-11-06

User now pins `@c4roa0/agentpay-protocol@0.14.3`; production imports, test fixtures
and the public notice use that package. No unrelated locked dependencies changed.
The v1 update-pair metadata retains its `typesDependency` field and pins 0.14.3;
checks require both User and Wallet to use the new package at that exact version.
Old archive-based Wallet and different Protocol versions are rejected. Version-range
compatibility remains planned; no legacy alias or bypass was added.

Installer/repair fingerprints no longer require a vendor directory. Manifests and
lockfiles still bind dependency changes. Removed the old archive/license/manifest
after independent verification; historical review records describe the earlier state.
With only sibling User/Wallet source in a temporary directory, frozen Wallet install,
Wallet build, User npm ci and all 364 tests passed (zero failures/skips). Real installer
prepare-only execution also passed twice: first preparation ran the package managers
and build, unchanged retry skipped them. Actual pair checks/snapshot reads passed
without vendor directories. This proves preparation and controlled local behavior,
not participant setup, owner approval or real-network payment acceptance.
No running services, key files, Policies or Orders were modified.


## Public-source preparation — 2026-11-06

User's original code is MPL 2.0, as selected by the owner; public Protocol and
attributed reference fixtures retain MIT. Wallet and Protocol are public. User
history was replaced by the approved single-commit baseline `2a80f4a`; the owner
confirmed public visibility. Anonymous refs were verified on 2026-11-06. Release
assets and full anonymous clone/ZIP installation remain separate work.

Current preparation removes private platform harnesses and historical dependency
archives from the public tree, uses the reviewed public Protocol 0.14.1 archive,
and makes tests independent of sibling Agent/Protocol/private platform checkouts.
User still requires a built sibling Wallet. The exact version pair and internal
Wallet imports remain current constraints, not the planned compatibility contract.
See [source review](doc/security/public-source-review-2026-11-06.md).

Current documentation is organized by role and feature. Private chronological records
and previous TODO snapshots are preserved outside the repository; removing them from
publication does not cancel outstanding acceptance. Independent User + built public Wallet verification passed all 364 tests with no
failures or skips. Offline installation, 112-file syntax-tree comparison, local
Markdown links and whitespace checks passed. This does not establish live-network
or fresh participant installation acceptance.

Follow-up public-document review corrected stale Market per-Policy grouping claims,
expired-Policy connection guidance and owner-signing descriptions across setup,
renewal, migration and deployment references. Installation prerequisites now include
npm/Corepack. The old preview module is labelled as such; executable behavior is
unchanged. Local links, stale-wording scan, syntax and whitespace checks passed.

## Implemented product scope

- One grouped `./run` entry for installation, repair, Wallet/Policy operations,
  Linux user services, Market connection, Orders and local cache management.
- External-owner browser approval with resumable operation plans; separate guarded
  Anvil signer. Policy renewal/deployment replacement preserves key and Order history.
- Per-call service-neutral Runtime, private caller authentication, original request
  recovery, durable input/result snapshots and explicitly managed attachment cache.
- Stable Wallet display identity with individually verified Policy scopes. Local
  status distinguishes saved metadata, live observations and unresolved results.
- Official digest-pinned paid connectivity test, with explicit price consent and
  original-request continuation after interruption.

The recorded private single-owner MetaMask/Anvil authorization and payment journey
passed, including participant Market Order viewing and independent payout reconciliation.
This is scoped private evidence, not public-network, multisig, real-funds or production
approval. Detailed operational records are not distributed in this repository.

## Next work

Public source preparation is complete within the recorded review scope. Next is the approved
[distribution plan](doc/plans/user-wallet-distribution.md): a supported public Wallet
client/version boundary and combined release archive. No automatic source updater.

Official test network mapping, deployment/artifact handoff, complete interrupted owner
signing and real-network acceptance remain open. macOS and graphical unlock remain
deferred. [TODO](doc/TODO.md) tracks these gates and the retained acceptance backlog.
