# User work queue

- [x] Completed R11 consumer/state compatibility review. [Dispositions and evidence](records/compatibility-review-2026-11-19.md). Retained historical recovery and published interfaces have explicit exit conditions; no release or deployment.

Updated 2026-11-16. Read [progress](../progress.md) for current source and published
versions. Historical items remain in the [baseline](archive/review-baseline-todo-2026-11-16.md);
consolidation does not turn partial evidence into acceptance.

## Review and coordinated release

- [x] Complete R1–R10 source/comment/documentation review and fix U1/U2/U3 within
  the approved local authorization boundary; [record](records/mainnet-static-review-2026-11-15.md).
- [x] Prepare the reviewed User source/documentation closeout; enclosing workspace
  records the resulting commit and pointer.
- [x] Publish User 0.3.24 with Wallet 0.3.6 and Protocol 0.14.4. Verified matching tag, registry archive and independent CLI installation.
- [x] Confirm the Market guide uses the package name for both global and directory-local installation; both resolve the published release.

Public npm dependencies, OIDC publication, installed/running exact-pair checks,
directory-local updates, maintenance error handling and interrupted-update recovery
are implemented. Older implementation tasks for these features are superseded;
compatibility ranges remain deferred. Participant evidence is scoped below.

## Deployment and owner approval

- [ ] Select release network/asset and populate its deployment artifacts, explicit
  signer, RPC/finality and public URLs. Private Anvil URLs are not public defaults.
- [ ] Supply a reviewed official test mapping for the target network if offering
  that optional test. Mapping/optional-test code is implemented; without a matching
  package, normal setup and generic Runtime do not depend on the random test.
- [ ] Decide whether to supply a default Market URL; explicit input already works.
- [ ] Verify chosen Safe version, browser RPC/CORS and required owner signing modes.
  Multisig, interrupted signing, headless tunnel and portable-page participant
  acceptance remain distinct from single-owner Anvil evidence.
- [ ] Evaluate WalletConnect/QR only if required; current flow uses an injected wallet.

## Retained participant boundaries

These are a scoped evidence backlog, not a requirement to repeat every historical
experiment before launch. Select release blockers with the launch plan.

- [ ] Complete remaining full login/reboot, reminder failure/dismissal,
  wrong-password and service handoff checks on supported Linux desktops.
- [ ] Cover remaining deliberate switch/update interruption and original-request
  routing boundaries. Configured A/B switching and interrupted-update recovery
  already have scoped participant and controlled-process evidence.
- [ ] Restore original key/Policy on disposable state; cover absent, invalid,
  expired/revoked scope and unavailable RPC without creating replacement purchases.
- [ ] Cover post-renewal Market cancellation/failure and original/new Policy support
  mutations. Grouped Order visibility alone does not prove case authority.
- [ ] Verify original-result retrieval, case evidence, withdrawal/reopening and
  deadlines through participant entries; retain authoritative financial reconciliation
  for remaining interruption/late-funding cases.
- [ ] Confirm uninstall on disposable participant data, preserving on-chain permission.
  Isolated installation/uninstall tests do not establish desktop acceptance.
- [ ] Check nickname rejection, narrow-terminal status/cache and owner-page wording
  when those participant paths are exercised.
- [ ] Verify fresh anonymous Git/ZIP installation separately from npm artifact
  installation and anonymous source-ref access.

## Skill delivery and integration

- [x] Retained official Skill 1.1.0 download after current 1.2.1 was verified;
  current fixed-hash downloads and original test records are preserved.
- [ ] Review/build/deploy candidate Agent template 0.1.2 and bundle 1.2.2 only in an
  authorized release; then update User's reviewed executable digest. Source changes
  alone do not authorize publication or replacement of the current 1.2.1 pin.
- [ ] Complete official package/public settings handoff for the selected deployment.
- [ ] Verify supported Agent harness discovery/tool permissions with maintained
  fixtures. No third-party Skill is required for installation acceptance.
- [ ] Continue checking implicit service/address/platform assumptions during changes.

## Separately scoped

- [ ] Independent security review and supported-version/release-provenance decisions
  before real funds; Anvil and static review are not production approval.
- [ ] Compatibility ranges, combined ZIP/platform assets, embedded Node, macOS and
  graphical unlock are deferred. This review validates Linux only.

Older public-npm migration and publication tasks are closed by the recorded 0.3.23
baseline. Same-directory authorization exclusion is implemented; cross-machine
Policy serialization and a global one-Policy rule are not part of this design.
