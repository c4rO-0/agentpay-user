# User TODO

- [x] Participant 0.3.11 update resumed original installation; unlock/status confirmed original Policy, Market connection and two settled Orders after restoring Anvil forwarding.
- [x] Prepare resumed switch without premature startup; preserve repair checkpoint across current-version interruption.
- [x] Show setup guidance for a fresh unfinished installation, without treating missing established Wallet files as new setup.
- [x] Classify chain RPC transport failure in Wallet and show actionable User recovery guidance; controlled RPC/IPC tests passed.
- [ ] Publish Wallet RPC guidance, pin its verified package in User, then publish and verify combined cleanup.

- [x] Allow update of an exact confirmed stopped switch target, then resume using new code; preserve retry checkpoint and reject other targets/live services (controlled verification).
- [x] Publish User 0.3.11 update recovery and document one-time bootstrap for older blocked updaters; tag/package integrity verified.
- [x] Participant update recovery after bootstrap preserved original Wallet/Policy/Orders (2026-11-12).

- [x] Fix switching back from setup cancelled before Wallet creation; retain stop/listener and established-data checks.
- [x] Publish User 0.3.10 switch-back fix; matching tag and npm integrity verified.
- [ ] Verify participant switch-back to the original installation after installing 0.3.10.
- [x] Improve unconfigured installation status/info: direct to setup, not service start or missing-key recovery (unreleased).

- [x] Verify local official Skill files before downloading and stream update repair progress (2026-11-12; targeted checks).
- [x] Publish local official-Skill verification and streaming update progress in User 0.3.9; tag and npm integrity verified (2026-11-12).

- [x] Publish User 0.3.8 with matching v0.3.8 tag; full CI, standalone package and public registry integrity passed (2026-11-12).

- [x] Recover failed service start/stop without blocking repair; incomplete target unit replacement remains protected (2026-11-12, controlled service-manager verification).

- [x] Fix shared-data switch client relocation and retry without a repair deadlock; isolated selection/connection checks pass (2026-11-11).
- [x] Preserve availability for preference-only operations and require authenticated matching-service readiness before publishing the default; failed readiness permits retry/repair (controlled transport/service verification, 2026-11-11).
- [x] Stage downloaded settings until switch consent under the shared lock; cancellation preserves prior deployment and avoids binding the new installation.
- [x] Persist one state-directory locator for CLI, background processes and candidate Skill loaders; cross-environment and concurrent-first-use process tests passed.

- [x] Coordinate uninstall with service switching; preserve another installation’s managed pair, recheck confirmed scope and retry partial unit removal (19 targeted checks; systemctl simulated).
- [x] Implement inactive update/repair and inherited writer exclusion, plus interrupted-update continuation; isolated process/controlled service checks passed.
- [x] Real A/B/A user-systemd switching, cancellation and same-install start verified (2026-11-12); A restored locked with unchanged key/Policy.
- [ ] Complete remaining login/reboot and full guided-install acceptance; uninstall still refuses occupied ports of unconfirmed ownership.

- [x] Inventory local instance consumers and document the concrete interface/change map (2026-11-11; design only).
- [x] Align design to multiple installations with one active Runtime/Wallet per OS user; remove mandatory harness launcher (2026-11-11).
- [x] Persist canonical per-installation data binding and preserve it across shared checkpoint writes; focused regression checks passed (2026-11-11).
- [x] Implement and check storage-choice module (reuse/new/cancel); public installer selection now connects through a service-switch gate (2026-11-11).
- [x] Connect installer selection and service-start switching with confirmation, stopped-state/listener checks and Runtime lifetime exclusion; focused checks passed (2026-11-11; systemd results simulated).
- [x] Correct shared-directory purge, mixed-unit retry, manual setup regression, first-start preparation and startup-preference inheritance; 37 targeted checks pass (2026-11-11).
- [ ] Complete remaining switch-crash recovery and desktop login acceptance; real A/B/A systemd switching passed; preserve historical request scope across switches. Inactive maintenance isolation is implemented with scoped verification.



- [x] Isolated public npm fresh install, registry failure/retry and disposable-data uninstall (2026-11-11; no real systemd or financial acceptance).
- [x] Replace existence-only locking for new operations: inherited native lock survives caller death while writers live, then permits retry. Old unknown locks require review; they are not automatically removed.
- [x] Publish reviewed folder-local npm uninstall completion guidance in User 0.3.8.


- [x] Participant directory-local update to User 0.3.6 / Wallet 0.3.3: running versions, original Orders in CLI/Market and available result cache verified (2026-11-11).
- [ ] Complete configured multi-instance installation and interrupted-update recovery acceptance after the scoped implementation; isolated fresh npm installation already passed, systemd and recovery gaps remain.


- [x] Clarify full Cache IDs and missing details argument; support bounded, unique read-only short-ID lookup (2026-11-11).
- [x] Publish cache-details guidance in User 0.3.7; tag/registry integrity verified (2026-11-11).


- [x] Clarify npm update preview with actual installed Wallet versus target, unchanged and unknown states (2026-11-11).
- [x] Publish update-preview wording in User 0.3.7 (2026-11-11).


- [x] Preserve maintenance error guidance and original request identity; controlled HTTP/IPC verification (2026-11-10).
- [x] Publish User 0.3.6 with exact Wallet 0.3.3 dependency; registry identity/integrity verified (2026-11-10).

## Existing Market address update

- [x] Allow source-to-npm reconnect without an onboarding draft; verify Policy contracts and preserve missing files.
- [x] Publish 0.3.5 and independently verify registry integrity.
- [x] Retry the participant address update without old onboarding files. Observed User 0.3.5 / Wallet 0.3.2 on 2026-11-09.

- [x] Reauthenticate and verify original account, Wallet tuple and Policy connection before replacing an address.
- [x] Verify unchanged deployment; preserve RPC, key, Policy, history/cache and original cancellation IDs.
- [x] Apply under installer lock, restart managed Runtime, retain retry marker and show incomplete update in status.
- [x] Full regression (387 checks), followed by targeted reconnect-boundary/transaction checks.
- [x] Publish User 0.3.4 through v0.3.4; workflow and independent registry integrity verification passed.
- [x] Verify the existing participant installation and explicit address update against HTTPS. Observed User 0.3.5 / Wallet 0.3.2 on 2026-11-09.

## Directory npm update, then HTTPS

- [x] Support directory-local npm update without replacing source/link installs.
- [x] Verify real npm directory upgrade and isolated preflight; nine regression checks passed.
- [x] Publish 0.3.3 via v0.3.3 and independently verify registry archive/dependency pins.
- [x] Verify participant directory install/update. Observed User 0.3.5 / Wallet 0.3.2 on 2026-11-09.

## Tag-triggered publication

- [x] Use matching `vX.Y.Z` tags for npm publication; retain verification gates.
- [x] Owner confirmed release tags allowed in the GitHub `npm-publish` environment.
- [x] Verify first tag-triggered OIDC run 42491753287 and registry archive integrity.

## Official package 1.2.1 — 2026-11-08

- [x] Review actual published bytes, update the built-in official pin and verify fixed-download checks. Real Market fixed-version download/install repeated successfully in an isolated directory.
- [x] Inspect this participant installation’s prior-version official tests: saved 1.2.0 record is acknowledged; retained unchanged. This does not assert every user has completed old tests.
- [x] Load the reviewed User source update and run the normal 1.2.1 payment test with explicit user consent; terminal delivery/result/ack completed.
- [x] Verify website visibility and independently reconcile Settlement/chain outcome; prepare User 0.3.2 candidate.
- [x] Pin the verified public Wallet 0.3.2; align package/lockfile/update-pair.
- [x] Publish User 0.3.2 through tag-triggered OIDC; verify public registry archive.
- [x] Accept a real participant npm update/restart. Observed User 0.3.5 / Wallet 0.3.2 on 2026-11-09.


## Fixed Skill download loop — 2026-11-08

- [x] Request the official ZIP by the built-in SHA-256; reject unavailable/substituted versions without fallback.
- [x] Complete fixed-download regression/type checks and publication/deletion review; the separate Market schema-fixture issue was resolved in its later regression.
- [x] Publish later User versions and accept participant update through 0.3.5.
- [ ] Independently verify retained old pinned ZIP download; current package acceptance alone does not close historical-version availability.


## Running-version release loop — 2026-11-07

- [x] Verify User 0.3.0 public-registry publication; Trusted Publisher configured.
- [x] Verify actual installed Protocol versions from both consumer resolution paths.
- [x] Add process-start software reporting and status/repair mismatch handling; isolated checks passed.
- [x] Wallet 0.3.1 published through the configured workflow; public npm version/dependencies verified.
- [x] Pin User 0.3.1 to published Wallet 0.3.1; pairing metadata/lockfile and standalone archive verification complete.
- [x] Publish User 0.3.1; verify public npm/latest and successful Wallet/User OIDC runs.
- [x] Verify real published-version update/restart on the participant installation. Observed User 0.3.5 / Wallet 0.3.2 on 2026-11-09.


## npm update follow-up — 2026-11-07

- [x] Implement confirmed `agentpay update [-f]`, exact User target and matching Wallet; invoke new repair and pinned official Skill check.
- [x] Fix relocation preparation ordering, matching legacy purge and packaged document links.
- [x] Complete update/migration regressions (374 full-suite and 35 final targeted checks) and real npm replacement of local candidate artifacts; controlled service/registry dependencies.
- [x] Verify published-version directory npm update and participant service recovery: User 0.3.5 / Wallet 0.3.2, 2026-11-09. Deliberate interruption remains separate.

## npm client distribution — 2026-11-07

- [x] Record npm-first plan; combined source ZIP is optional, not the primary installer.
- [x] Step 1: commit verified User/Wallet Protocol dependency migration baseline.
- [x] Step 2: prepare Wallet public entry points, compiled npm artifact and standalone acceptance (29 behavioral tests plus installed-package CLI/IPC lifecycle).
- [x] Review step 2: guard normal packing against missing/stale builds, correct public-interface docs and verify a standalone TypeScript consumer.
- [x] Step 3: migrate User to Wallet npm dependency and `agentpay` entry; remove sibling/build assumptions; isolated tarball/process acceptance passed.
- [x] Step 4a: exact installed-package checks, service-path/client relocation, installer lock, recovery-safe preparation and explicit uninstall modes.
- [x] Step 4b implementation: installed/running version and interface checks.
- [x] Step 4b participant existing-installation update/restart and HTTPS original-Order read recovery (2026-11-09).
- [ ] Step 4b deliberate interrupted-upgrade acceptance; normal restart recovery does not close this case.
- [ ] Step 5: publish Wallet then User via OIDC; verify registry installs and update Market guides.
  - [x] Wallet 0.3.0 first Token publication; registry integrity/latest and fresh public install/CLI/IPC verified.
  - [x] Owner configured Wallet npm Trusted Publisher; validated by 0.3.1 publication.
  - [x] Wallet and User OIDC validated by 0.3.1 releases; Market guide updates remain pending.
- [ ] Step 6: participant setup/upgrade/restart/uninstall and official Anvil paid acceptance.


## Public npm Protocol dependency

- [x] Pin npm core 0.14.3; migrate imports, fixtures, lockfile and notices.
- [x] Update exact User/Wallet pair checks; reject mixed archive/npm or mismatched dependencies.
- [x] Remove vendor-directory assumptions from install/repair fingerprints.
- [x] Verify isolated sibling install/build, all 364 tests and real prepare-only retry; remove old archives.
- [ ] Commit/push the matching User and Wallet revisions together before participant synchronization.


## Public-source preparation

- [x] Inventory current source, archives, private harnesses and contributor prerequisites.
- [x] Select MPL 2.0 for original User code; preserve separate third-party licenses.
- [x] Privately archive old Protocol packages, platform-only scripts and operational history.
- [x] Use the reviewed public Protocol artifact; remove unused MySQL dependency.
- [x] Replace sibling Agent/Protocol test dependencies with attributed local/public-package fixtures.
- [x] Rewrite current entry guides and source map; separate implemented references from future plans.
- [x] Finish behavioral test review, code readability checks and isolated User + Wallet verification: 364 tests passed, no failures or skips.
- [x] Correct follow-up review findings: identity/support instructions, explicit signer flow, installation prerequisites and legacy-preview comments.
- [x] Owner approved history reset/public visibility; anonymous main ref verified, with no published tags.
- [ ] Verify full anonymous clone and ZIP installation independently of source-ref access.

## Independent distribution (next development loop)

- [ ] Define the supported Wallet client/IPC boundary and source/build/running compatibility requirements.
- [ ] Optional later: widen exact reviewed dependency pairs only with a verified compatibility matrix; preserve keys, Policies and recovery.
- [ ] Optional later: combined ZIP/platform assets after primary npm installation acceptance.
- [ ] Verify fresh Git/ZIP installation and missing/incompatible/stale version recovery; update Market guidance.

See [distribution plan](plans/user-wallet-distribution.md). These changes are not
implemented by the current source cleanup. Repair still applies downloaded local code.

## Network and owner approval gates

- [ ] Design official test package/network mapping (N4), keeping release-pinned executable SHA checks.
- [ ] Finish general deployment/artifact output and coherent confirmation settings (N5/N7).
- [ ] Finish public URL/settings handoff (N8); ordinary public-network users must not need private rehearsal tunnels.
- [ ] After the official domain is chosen, define the default HTTPS Market address.
- [ ] Accept multisig, interrupted owner signing, headless tunnel and portable-page recovery with participants.
- [ ] Verify browser RPC reachability/CORS and approved Safe versions on the selected network.
- [ ] Run explicitly scoped same-code public-testnet acceptance; no real funds/reset is implied by these tasks.
- [ ] Evaluate WalletConnect/QR only if required; current browser flow uses an injected wallet.

## Retained participant and recovery acceptance

- [ ] Complete original-key/Policy restore on an isolated installation, including invalid/absent/expired/revoked scope and unavailable RPC; never fall back to a new purchase.
- [ ] Complete post-renewal Market reconnection cancellation/failure checks and grouped old/new Policy Order/case access; viewing Orders alone does not prove support mutation.
- [ ] Verify case evidence, original-result retrieval, withdrawal/reopening and deadlines through participant entry points.
- [ ] Complete remaining real Runtime interruption and late-funding recovery acceptance with authoritative financial reconciliation.
- [ ] Verify full desktop login/reboot, reminder failure/dismissal, wrong-password recovery and deferred service handoff.
- [ ] Verify confirmed uninstall on disposable local data and no change to on-chain permission.
- [ ] Verify detailed status/cache/owner-page presentation and narrow-terminal readability with participants.
- [ ] Verify maintained Skill discovery, tool permission and execution in supported Agent harnesses.
- [ ] Define maintenance-response handling (503/Retry-After) while retaining original request identity.
- [ ] Complete official package release/configuration handoff, installation and endpoint/settings refresh for release.
- [ ] Inspect implicit address, service, platform and repository assumptions during each change.

Prior Market schema/cutover, nickname and display tasks are platform-owned; they must
not turn into User database access. Existing source now implements key restore/info,
Policy renewal/revoke, user service startup and deployment-mismatch guidance. Their
older unchecked implementation labels are superseded by current code; remaining
participant/recovery acceptance is retained above. Historical one-off request
investigations remain private operator work, not a public contributor prerequisite.

## Deferred / release gates

- [ ] Independent security review, supported-version policy and release provenance before real funds.
- [ ] macOS startup, graphical unlock and embedded-Node/multi-platform packaging remain separately scoped.
- [ ] Broader business/harness acceptance uses maintained fixtures; do not require third-party Skills for installation verification.

Original chronological TODO snapshots are preserved in the private workspace.
Consolidation does not turn historical partial evidence into completed acceptance.

- [x] Update candidate Agent template/default loader; selected storage is pinned for each invocation, unavailable selection has no fallback.
- [ ] Review/build/deploy candidate Agent template 0.1.2 and official bundle 1.2.2, then update the reviewed User official digest; no publication authorized by source changes.

- [x] Protect new default request ownership across data folders; restore selected connection on Runtime bind; persist startup changes and allow Node-path-independent recovery (2026-11-11, scoped tests).
- [x] Index historical client request identities during confirmed switching; reject missing selection/checkpoints and conflicting owners, preserve startup with an unclassified-history barrier (controlled verification).
- [ ] Accept historical request routing in the complete two-install public-entry/systemd rehearsal before rollout.
- [ ] Finish actual login/switch and full public-entry interruption acceptance; isolated inactive maintenance/concurrency verification is complete.
