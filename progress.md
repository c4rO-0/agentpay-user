# AgentPay User progress

## User 0.3.7 published — 2026-11-11

Patch release includes installed/target Wallet version preview and clearer Cache ID
help with unique short-ID lookup for read-only details. Wallet remains pinned to
0.3.3 and Protocol to 0.14.3. Manifest, lockfile and update-pair versions are aligned.
393 behavior tests passed from an isolated lockfile installation; standalone npm
archive installation and process lifecycle passed. Tag v0.3.7 points to source
3d31297dd3baedbd798f51e86c5fa8a1e474bb4a. GitHub run 42976422954 succeeded;
public registry SHA-512 matches the tested archive and latest is 0.3.7. No local
participant service or private data was changed by publication.


## Existing client update accepted — 2026-11-11

Participant directory-local npm update to User 0.3.6 / Wallet 0.3.3 completed.
Running versions, unlocked Wallet, two settled Orders, unchanged saved validity,
startup/Market connection and retained available result cache were observed.
Participant confirmed both original Orders remain visible on Market. The older
missing result predates this update. No new payment or Policy was created.
[Evidence and limits](doc/records/npm-update-participant-2026-11-11.md). Update-preview and Cache ID guidance fixes are
published in 0.3.7. Fresh installation and interrupted-update
acceptance remain next for discussion; neither has started in this loop.


## Cache details guidance — 2026-11-11

Missing details IDs now show a short example before accessing local storage.
List guidance explains that the namespace is part of the ID. Read-only details
accept a unique prefix with at least eight hexadecimal characters; ambiguous,
missing or incomplete bounded lookups require a full ID. Export and cleanup keep
their existing exact-identity rules. All 19 targeted cache/CLI regressions passed
with isolated process tests outside the restricted sandbox; no live cache changed.
Included in published 0.3.7. There is no input: ID namespace: inputs use the
attachment ID shown by list, while results can use result: or runtime-result:0x.


## Update preview clarity — 2026-11-11

The confirmation screen now lists installed User and Wallet versions separately
from update targets. Wallet is read from the installed dependency, not inferred
from User's requested dependency. Unchanged versions are explicit; unreadable or
missing Wallet metadata shows “not confirmed” without blocking the normal repair
through npm. Controlled update tests cover all three cases and cancellation without
service/install mutation. Published in 0.3.7; running-process
versions remain the responsibility of status after update/restart.


## User 0.3.6 published — 2026-11-10

Pins published Wallet 0.3.3, retaining Protocol 0.14.3. Maintenance errors provide
same-request guidance without automatic write retries. Package manifest, lockfile
and update-pair metadata agree. Published through matching tag v0.3.6 after 391 behavior tests and independent
installation/lifecycle checks. Public npm metadata and SHA-512 match the verified
archive. No local data, Policy or service changes occur on publication.


## Maintenance guidance — 2026-11-10

Added explicit maintenance guidance without automatic write retries or replacement
purchases. Controlled HTTP/IPC tests verify that retry retains original request
identifiers. This is source verification, not live financial acceptance. These changes were subsequently published in 0.3.6; see the release record above.


## Acceptance bookkeeping — 2026-11-10

Existing-installation npm update/restart and HTTPS original-Order read recovery
are closed by the 2026-11-09 participant evidence below. Older pending publication
and migration paragraphs are historical checkpoints, not instructions to repeat
the accepted update. Deliberate upgrade interruption, clean installation/uninstall
and historical pinned-download availability remain separate acceptance items.
No runtime code or package version changed in this documentation closeout.


## Participant HTTPS address update accepted — 2026-11-09

Participant directory-npm installation reports User 0.3.5 / Wallet 0.3.2.
Market reconnect completed with the existing Wallet and Policy. With Anvil 8547
forwarded, explicit Settlement Order read succeeded over HTTPS; subsequent Runtime
status recovered to 2 saved / 2 settled / 0 waiting. The one older missing result
predates this update and is retained. Initial unavailable checks cleared on retry.
No new paid Order, Policy replacement or result recovery was performed. This closes
the observed existing-installation update/address/read-recovery loop, not fresh
installation, a new HTTPS paid journey or real-network acceptance.

## Missing onboarding draft during npm address update — 2026-11-09

Participant 0.3.4 reconnect stopped before address writes because an old onboarding
file was absent. Address updates now validate the saved Policy and service settings
without requiring that draft; existing draft/public files are updated only if
present. No RPC, Policy, test configuration or private history is synthesized.
389 full regressions passed, followed by targeted error-guidance checks. Missing
drafts still reject contract drift; preflight errors explain the stage, preserved
state and retry action, while interrupted writes warn about partial updates.
User 0.3.5 published from tag v0.3.5 (6c57c12). GitHub run 42575980847
and independent registry archive verification passed;
participant migration remains unverified.

## User 0.3.4 published — 2026-11-09

Release the explicit Market address update with unchanged Wallet 0.3.2 and
Protocol 0.14.3 pins. No participant data or running services are changed by
publication. Independent npm archive installation and real isolated local-service
startup passed; all 388 release regressions passed. Tag v0.3.4 identifies c63ff80.
GitHub run 42574859894 completed OIDC publication and registry verification.
Independent registry integrity comparison matched the reviewed local archive.
Participant address migration remains pending.


## Explicit Market address update — 2026-11-09

Approved reduced scope: reuse login, Wallet list and public deployment interfaces;
no Market identity key or new backend endpoint. User-selected address changes must
match the original account/Wallet/Policy connection and deployment. Consent updates
transport URLs, restarts only managed Runtime and preserves key/Policy/Orders/cache.
Policy-scoped aliases retain cancellation IDs; interrupted apply has a retry marker
and status guidance. Controlled address/connection/cancellation/status checks pass;
387 full regression checks passed; subsequent reconnect-boundary/transaction
changes passed targeted checks. npm publication and participant acceptance remain
pending. Only explicit origin changes or interrupted updates enter this path;
ordinary reconnect/renewal does not acquire new configuration dependencies.
No participant settings have been modified.

## User 0.3.3 published — 2026-11-09

Tag v0.3.3 identifies c5f3be1. GitHub run 42567636609 passed behavior, standalone
archive and OIDC publication steps. Independent public-registry verification
confirmed exact Wallet 0.3.2 / Protocol 0.14.3 dependencies, provenance metadata
and byte-identical archive (SHA-256
aa231297a4690117850f5d50414d89ad0da86b29c29d03947383c23bfa62a833).
Participant directory-update acceptance remains pending. Existing directory installs
older than 0.3.3 need one npm install of 0.3.3 and repair before using local update.
HTTPS endpoint migration is not included.

## User 0.3.3 release candidate — 2026-11-09

Release directory-local npm updates, keeping exact Wallet 0.3.2 and Protocol
0.14.3 dependencies and the reviewed official test package unchanged. No endpoint
migration, Policy or saved request rewrite is included. All 383 local behavior tests and independent archive installation/process checks
passed. Tag-triggered publication and registry verification remain pending.

## HTTPS endpoint migration — 2026-11-09

HTTPS migration inventory: existing setup rejects URL differences; local service settings, Market receipt origin/session, recovery observations and cancellation intents need coordinated handling. Public configuration publication does not migrate existing users. Keep original requests/Policies and current tunnels until an explicit local migration is implemented and verified.

## Directory npm update — 2026-11-08

Update now supports a direct registry dependency under a project node_modules as
well as a global installation. It derives the owning project from the running
package, pins the confirmed version, preserves the dependency section, updates the
local lockfile and uses the existing stop/repair/private-data flow. Source/link,
custom-source and transitive installs are refused before changing services.
Nine updater regression checks passed. A real public-npm 0.3.1 → 0.3.2 upgrade
in a disposable project verified program/manifest/lockfile agreement and preserved
private-record fixtures; service hooks were controlled, not participant processes.
This exposed npm dry-run rewriting the hidden installed-tree lockfile. Preflight
now runs in a disposable prefix with private project npm settings, removed afterward.
See [verification](doc/records/local-npm-update-2026-11-08.md).
User 0.3.3 is the release candidate for this fix; publication verification is pending.

## User 0.3.2 tag publication verified — 2026-11-08

Tag `v0.3.2` points to `890171b`; GitHub push-triggered OIDC run
[42491753287](https://github.com/c4rO-0/agentpay-user/actions/runs/42491753287)
completed successfully, including registry integrity verification. Public npm latest
is 0.3.2, pins Wallet 0.3.2 / Protocol 0.14.3 and includes provenance. Independently
downloaded registry bytes exactly match the locally tested archive (SHA-256
`e6bb2f1199e510850313c004055afeb3ba45afc07035697c1d37af14ebcf1489`).
All 380 existing tests and the independent package's real Wallet/Runtime restart
check passed. Participant npm update/restart acceptance remains the next step;
publication did not modify any participant services or create a paid Order.

## User 0.3.2 release pairing — 2026-11-08

Candidate now pins the verified public Wallet 0.3.2 with Protocol 0.14.3; package,
lockfile and update-pair metadata agree. This release includes fixed-version
Market downloads and the reviewed official Skill 1.2.1 pin. Historical notes
below describe earlier candidate pairings. Publish through tag `v0.3.2` after
final suite and standalone archive checks; no automatic new purchase is authorized.

## Tag-triggered publication — 2026-11-08

Wallet, Protocol and User release workflows now run on pushed `vX.Y.Z` tags.
Each validates its package version, runs existing verification, publishes with
OIDC and checks registry integrity. Branch pushes do not publish. No tag was
pushed or npm version published for this workflow change. Owner confirmed `v*` tags allowed in the GitHub
`npm-publish` environment; npm trust fields remain unchanged. YAML/shell checks and six executable tag/version guard cases passed
per repository (matching version, mismatch, branch, prerelease, leading zero and
newline rejection). Actual GitHub/OIDC execution remains pending.

## Official 1.2.1 payment reconciled / User 0.3.2 candidate — 2026-11-08

Participant confirmed Market Order visibility. Independent fixed-block chain reads,
receipts and token transfers match Settlement's finalized release record: paid
0.7 rUSDC, seller 0.665, platform fee 0.035, no refund, empty Vault. Funding,
delivery and release events occur once for the verified Order. No further payment.
This is private Anvil acceptance, not real-network or production approval.
User 0.3.2 candidate includes fixed-version downloads and the reviewed official
1.2.1 ZIP pin. Its preliminary package check used Wallet 0.3.1 and Protocol 0.14.3.
The maintainer requested Wallet 0.3.2 review/publication first; after registry
verification, update User’s exact dependency and reverify the final package.
Candidate publication and real npm update acceptance remain pending.

## Official Skill 1.2.1 participant payment passed — 2026-11-08

Operator ran normal wallet unlock and payment-test commands after source repair.
The guide quoted a maximum 0.7 rUSDC and 10-minute service limit; the operator
explicitly confirmed. It reported delivery verification, saved-result verification
and receipt acknowledgement, then completed successfully. This is private Anvil
end-to-end participant evidence. The quoted maximum is not independently reconciled
actual charge; payout/refund terminal chain evidence has not been checked here.
User remains the 0.3.1-labelled source candidate, not a new published npm release.
Next: website Order visibility and read-only Settlement/chain reconciliation before
release closeout. Do not rerun a completed payment test just to inspect the result.

## Participant repair completed — 2026-11-08

Operator ran the normal source repair entry. Official Skill 1.2.1 passed the
built-in hash check and was installed. Wallet and Runtime restarted; Wallet is
locked as expected. Saved Policy and Market connection remain present, and local
history reports two settled Orders plus one archived record. No purchase occurred.
This is source-candidate repair acceptance, not publication of a new npm version.
Next operator step unlocks Wallet and invokes the normal payment test; explicit
current-price confirmation remains required before creating a paid Order.

## Official fixed-download acceptance — 2026-11-08

The normal prepareOfficialTestUpdate entry downloaded 1.2.1 twice from the running
Market fixed-version API into an isolated directory, verified the built-in hash,
installed successfully and preserved an existing prior-record fixture byte-for-byte.
The first diagnostic read assumed a flat archive; it was corrected to read the saved
publisher ZIP through User's parser. No product installation defect was found.
17 targeted pin/download/update/payment-orchestration/prefix checks passed.
This proves download/install behavior, not paid invocation. No participant services
or Wallet data changed. Source repair and explicit payment acceptance are next;
the candidate is not yet a new npm release.

## Official test pin 1.2.1 prepared — 2026-11-08

Reviewed the actual Provider ZIP and confirmed it matches the published fixed Market
download: 4373 bytes, SHA-256
`20633b314c66166f94dc6e7d7eb5bce54ab5901fb1ed314a04ea3fd49ca8a9a4`.
The official-test pin now selects 1.2.1; generic Runtime routing is unchanged.
The package checker and 14 controlled pin/download/update/payment-orchestration
checks passed. The payment fixture now follows the selected version instead of
hardcoding 1.2.0. No real payment, service restart or npm release was performed.
Before participant testing, check for unfinished tests from the previous version:
records are retained, but the payment-test entry selects a version-specific record.
Do not treat a new-version test as recovery of an old purchase.


## Development dependency verification — 2026-11-08

Reinstalled dependencies from the unchanged lockfile after a stale local installation
could not resolve the already-declared Protocol package. Fixed-download/update/prefix
checks pass 8/8; the cross-repository publication/download/User preview regression
passes 27/27. No dependency pins, services or user data changed. This is controlled
verification, not a new npm release or live payment acceptance.


## Fixed historical Skill downloads — 2026-11-08

Development adds SHA-256-fixed Market metadata/ZIP routes over retained releases,
a derived per-listing lookup, website forwarding and User official-test pin selection.
Current publication replacement no longer changes the requested ZIP. Hidden/deleted
listings, takedown, stale approval and damaged files remain unavailable. Historical
internal-version ZIP routes now also respect listing visibility. No DB migration,
Provider download dependency, service restart or payment was performed.
Deploy Market API/Web and the nginx route allowlist first, then release the updated User; current published User
0.3.1 does not use the new fixed-version endpoint. Verification: User 33 targeted checks, Web 7 proxy checks, Deploy 8 route/build checks
and both Market/Web typechecks passed. Market publication regression: 69/70 passed;
the remaining pre-existing schema fixture fails with WALLET_MAPPING_SCHEMA_INVALID.
Controlled scanner/DB fixtures and local HTTP were used; no live database, nginx
rollout or participant acceptance is claimed.

## User 0.3.1 paired release published — 2026-11-08

Public npm now contains Wallet 0.3.1 with Protocol 0.14.3. User 0.3.1 pins that
published Wallet exactly; pairing metadata and lockfile are updated together.
This release adds actual installed Protocol verification and running-version checks
for status/repair. Prior release-gate notes below describe earlier checkpoints.
User 0.3.1 passed 378 behavioral tests and standalone npm archive installation,
including real Wallet/Runtime restart and matching running-version reports.
User 0.3.1 is public and npm `latest`, with Wallet 0.3.1 and Protocol 0.14.3.
[User OIDC publication](https://github.com/c4rO-0/agentpay-user/actions/runs/42440841342)
passed from `46796ea`; [Wallet OIDC publication](https://github.com/c4rO-0/agentpay-wallet/actions/runs/42440112081)
passed from `7e4d4fa`. Registry metadata was independently checked.
Real published-version upgrade/restart acceptance remains pending.
No participant services, keys, Policies or Orders are changed by package verification.

## Historical checkpoints — superseded by the current release status above

The dated entries below preserve evidence and earlier decisions. Their pending
release labels are historical; use current TODO for remaining work.

### Installed dependency verification / paired release — 2026-11-08

User now checks the actual Protocol package resolved from User and Wallet separately,
including nested npm copies. Process reports use resolved installed versions, not
just dependency declarations. Wallet 0.3.1 candidate passed behavioral and independent
package checks and is pushed as `7e4d4fa`; its OIDC publication is the next operator step.
User remains pinned to public Wallet 0.3.0 until the new registry release exists;
then update its exact dependency, lockfile and pairing metadata together. User changes
remain unreleased. No participant service, key, Policy or Order was changed.

## User 0.3.0 published; running-version checks in development — 2026-11-07

`@c4roa0/agentpay-user@0.3.0` was published from User `86ee8e7`.
Public registry version/latest and archive integrity matched the verified artifact.
User and Wallet Trusted Publishers are configured; first OIDC releases remain pending.
Earlier candidate sections below are historical, not current publication status.

Wallet 0.3.1 candidate reports process-start software metadata. User status and repair
compare running package/interface/Protocol versions against the installed pair.
Missing reporting is unknown, never proof of compatibility. Policy format/version,
identity and transaction authority are unchanged. Wallet behavioral tests (30) and installed-package IPC checks passed. User full
regressions (378) passed, followed by final status checks and an isolated candidate
Wallet/User process restart test. The candidate pair used a temporary test-only pin.

Release gate: publish verified Wallet 0.3.1 first, then update User's exact Wallet pin,
lockfile and pairing metadata and verify the combined package before publishing User.
Current User still pins published Wallet 0.3.0; these development changes are not yet
an installable verified release pair. No participant services/data were changed.


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

Public npm distribution and the existing-participant update/HTTPS loop are verified
within the recorded scope. User pins Wallet and Protocol packages; npm update is
available. Combined release archives remain optional, not the next installation
prerequisite. Remaining compatibility and fresh-install checks follow the
[distribution plan](doc/plans/user-wallet-distribution.md).

Official test network mapping, deployment/artifact handoff, complete interrupted owner
signing and real-network acceptance remain open. macOS and graphical unlock remain
deferred. [TODO](doc/TODO.md) tracks these gates and the retained acceptance backlog.
