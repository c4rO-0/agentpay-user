# AgentPay User progress

## Wallet first npm publication — 2026-11-07

Owner authorized publishing Wallet independently before User integration. Preparing
0.3.0, a tested artifact and token-free GitHub OIDC workflow. Public registry lookup
returned no Wallet package; this host has no npm login. First publication requires
maintainer authentication, then public registry integrity verification. README, usage, developer guide and public-interface examples were reviewed for
standalone readers before packaging. Status: pending publication, not released. User 0.2.0 still rejects this new Wallet pair.


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
