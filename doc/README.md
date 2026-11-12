# User documentation

- [Real two-installation switching](records/dual-install-systemd-2026-11-12.md): live systemd cancellation, switching, restoration and evidence limits.

- [Historical request routing](records/historical-request-routing-2026-11-11.md): switch-time indexing, missing records and conservative recovery limits.

- [Local instances and installation recovery](plans/local-instances-and-install-recovery.md): agreed design and implementation sequence.

- [Installation maintenance verification](records/installation-maintenance-2026-11-11.md): inactive maintenance and interrupted-writer recovery, with evidence limits.

- [Isolated client acceptance](records/client-isolated-acceptance-2026-11-11.md): installation, failure retry, uninstall and the interruption blocker.

- [Existing-installation update acceptance](records/npm-update-participant-2026-11-11.md): participant update to User 0.3.6 / Wallet 0.3.3 and retained records.

- [Directory npm update verification](records/local-npm-update-2026-11-08.md): real package update and preflight boundary.

## Start by role

| Reader | Start here |
| --- | --- |
| Installing User | [README](../README.md), [installation](runbooks/user-onboarding.md), [usage](usage.md) |
| Managing an existing installation | [Commands](runbooks/commands.md), [updates](runbooks/local-update.md), [background services](runbooks/local-autostart.md) |
| Skill author / Agent integrator | [Shared Runtime client](runbooks/runtime-skill-client.md), [invocation contract](reference/multi-service-runtime.md), [file cache](reference/result-file-cache.md) |
| Contributor | [Developer guide](develope.md), [source map](architecture.md), [design](design.md), [tests](../test/README.md) |
| Security reviewer | [Reporting](../SECURITY.md), [owner page boundary](reference/local-safe-owner-ui.md), [recovery](reference/original-order-recovery.md) |
| Maintainer | [Progress](../progress.md), [TODO](TODO.md), [public-source review](security/public-source-review-2026-11-06.md) |
| AI contributor | [AGENTS](../AGENTS.md), then current progress and affected interfaces |

## User guides

- [Owner browser approval](runbooks/safe-owner-web.md)
- [Renew or revoke permission](runbooks/policy-renewal.md)
- [Deployment authorization update](runbooks/deployment-authorization-update.md)
- [Wallet backup and restoration](runbooks/wallet-identity.md)
- [Market connection](runbooks/market-connection.md)
- [Order support](runbooks/order-support.md) and [cancellation](runbooks/order-cancellation.md)
- [Cache management](runbooks/local-cache.md)
- [Emergency payment stop](runbooks/emergency-payment-stop.md)

## Implementation references

- [Public deployment settings and signer selection](reference/public-deployment-settings.md)
- [Wallet identity and Policy history](reference/wallet-identity-policy-history.md)
- [Startup and Order recovery](reference/runtime-startup-recovery.md)
- [Runtime address recovery](reference/runtime-address-recovery.md)
- [Cache foundation](reference/local-cache-foundation.md), [input/output snapshots](reference/skill-input-output-cache.md), [result persistence](reference/runtime-result-cache.md)
- [Harness integration](reference/harness-skill-runtime.md)
- [Local repair](reference/local-update.md)
- [Onboarding writing rules](reference/onboarding-writing.md)

## Scoped development / advanced procedures

- [Official package maintenance](runbooks/official-test-package.md), [random test example](reference/random-skill-contract.md)
- [Terminal demo preview](runbooks/terminal-authorization-preview.md)
- [Private Anvil setup](runbooks/private-anvil-terminal-setup.md)
- [Initial Safe authorization](runbooks/safe-policy-setup.md), [advanced migration](runbooks/safe-policy-migration.md)
- [Unlock instructions](runbooks/unlock-wallet.md)

The [User/Wallet distribution plan](plans/user-wallet-distribution.md) describes future
compatibility and combined packaging work. `reference/` describes implemented design;
`runbooks/` provides operation steps; `security/` records boundaries and review scope.
Private platform histories and harnesses are retained outside this public tree.

- [User npm integration verification](reference/npm-integration-verification.md): candidate installation, repair and evidence limits.

- [npm publication](runbooks/npm-publication.md): archive checks, initial upload and GitHub Trusted Publisher.
