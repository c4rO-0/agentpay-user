# User documentation

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
