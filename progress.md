# AgentPay User progress

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
