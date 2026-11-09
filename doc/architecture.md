# User Runtime architecture

## Processes and authority

```text
Human / Agent
  ├─ ./run → local administration, owner browser approval, service management
  └─ installed Skill → shared client → authenticated loopback Runtime
                                      ├─ narrow Wallet IPC → bounded signatures
                                      └─ Provider HTTP → private input/output
Wallet / User participant clients → public Settlement and Market APIs
```

Wallet runs separately and holds the encrypted Session Key. Safe/Module enforce
on-chain permission. User owns orchestration and recovery, not Provider business
logic or platform storage. No Settlement checkout or database access is required.

## Shared Protocol dependency

User and Wallet pin `@c4roa0/agentpay-protocol@0.14.3` from npm. Their lockfiles
record integrity. The current repair gate still checks the exact package versions
and shared Protocol dependency in `update-pair.json`; `typesDependency` is the
retained v1 field name for that npm version. It is not a compatibility range.
Installation/repair fingerprints cover manifests and lockfiles rather than a vendor
folder. Policy, Order and cached request identities are independent of this package
name change. Independent-version compatibility remains a separate planned feature.

## Source map

| Area | Main files | Responsibility |
| --- | --- | --- |
| CLI | `run`, `scripts/agentpay-cli.mjs`, `src/user-cli.mjs` | Node discovery, grouped commands and help |
| npm update | `npm-update.mjs` | Detect global/direct-project installation, isolate npm preflight, pin the reviewed release and repair services without changing private data |
| Install / repair | `install-user.mjs`, `install-and-setup.mjs`, `install-preflight.mjs`, `local-update.mjs` | Dependency/build preparation, checkpoints, downloaded settings and safe restart |
| Setup | `guided-setup.mjs`, `user-setup-guide.mjs`, `anvil-onboarding.mjs` | Terminal sequence and saved-step continuation; explicit signer mode |
| Permission | `policy-terminal-guide.mjs`, `safe-policy-plan.mjs`, `renew-policy.mjs`, `policy-operations.mjs`, `policy-migration.mjs` | Drafts, approved operations and verified local binding |
| Owner signing | `owner-signer.mjs`, `owner-approval-server.mjs`, `web/owner-approval.js`, `safe-owner-anvil.mjs` | Fixed browser approval plans or guarded explicit test signer |
| Local services | `local-services.mjs`, `autostart-files.mjs`, `setup-autostart.mjs`, `scripts/local-service.mjs` | Linux user services, startup preferences and locked Wallet restart |
| Runtime | `index.mjs`, `caller-auth.mjs`, `transport.mjs`, `service-reference.mjs`, `service-url.mjs` | Caller authentication, per-call routing, payment and evidence orchestration |
| Durable request / result | `invocation-store.mjs`, `invocation-result.mjs`, `runtime-recovery.mjs` | Original identities/checkpoints, provisional versus verified output, read-only startup checks |
| Skill client | `runtime-client.mjs`, `skill-client.mjs`, `client-request-lock.mjs` | Local discovery, input snapshots, original-request selection and replay |
| Files / cache | `file-cache.mjs`, `file-download.mjs`, `file-cache-owner.mjs`, `cache-management.mjs`, `result-cache-view.mjs` | Explicit transfers, integrity/limits, provenance, cleanup and display |
| Orders | `order-support.mjs`, `order-cancellation.mjs`, `order-closure.mjs`, `order-review.mjs` | Original result retrieval, cases, cancellation and local review/archive |
| Market | `connect-market.mjs`, `local-wallet-ipc.mjs` | Deliberate account connection and fixed Wallet proof |
| Presentation | `status-panel.mjs`, `order-list-panel.mjs`, `order-status-panel.mjs`, `local-info.mjs` | Human-readable local/remote observations and next actions |
| Packages | `skill-bundle.mjs`, `skill-zip.mjs`, `active-skill.mjs` | ZIP boundaries, installation and official material selection |
| Official test | `official-paid-test.mjs`, `official-test-package.mjs`, `official-test-update.mjs` | Reviewed package digest, explicit price consent and test recovery |

Unless a path starts with `scripts/` or `web/`, filenames in this table are under
`src/`. Most scripts are thin command entries. `anvil-onboarding.mjs` retains its
historical filename but supports explicit external-owner signing as well; do not
infer permission to choose a test signer from the filename.

## Purchase and recovery path

1. Skill code calls the shared client with a service reference and validated input.
   The client saves request/input identity before contacting Runtime.
2. Runtime authenticates the local caller, resolves or resumes the durable request,
   obtains terms through Wallet and preserves the accepted transaction conditions.
3. Wallet prepares/reads the Order and signs only within its verified boundaries.
   Runtime forwards payment material through the defined Provider protocol; no
   Session Key is exposed.
4. Provider input/output remain on the private service path. Runtime stores received
   output separately from its verified result and checks matching delivery evidence.
5. Repeated calls reuse original checkpoints. Startup reconciliation observes Order
   state; it does not create replacement purchases or automatically acknowledge
   receipt. Only a completed verified result is eligible for normal cached replay.

The startup checker and local result store track different facts: an Order may be
paid out while its result is missing locally. Keep this visible and offer original
result recovery; do not charge again to hide the inconsistency.

## Local state

The selected private User data directory defaults to
`$HOME/.local/share/agentpay/user`. `local-data-directory.mjs` resolves it; do not
hard-code an operator's historical directory. Important state includes Wallet's
keystore/Policy, Runtime caller credential and connection locator, invocation
history, input/result caches, owner-operation journals and Market connection receipt.
The receipt is local convenience metadata, not live website authorization.

Owner approval pages receive only fixed public operation plans. They cannot access
Wallet IPC or keys. Successful browser execution is followed by local chain
verification before binding. A lost response resumes the original plan.

## External dependencies and development boundary

User resolves the installed Wallet package through public client, local-administration
and CLI exports. `wallet-package.mjs` verifies the exact reviewed pair;
`protocol-package.mjs` resolves each consumer's actual Protocol installation, including
nested npm dependencies. `software-versions.mjs` compares process-start reports with
the installed pair during status/repair. User 0.3.1 pins Wallet 0.3.1 for these checks; broader compatibility ranges remain deferred.
User imports ethers from its own
declared dependency. The pinned public Protocol package provides types, hashes and
fixtures. No Agent, Protocol source checkout or private platform repository is
required for the local test suite.

Tests use public interfaces and controlled remote responses. The explicit fault
loader only instruments a spawned test Runtime; production startup contains no
crash-test switch. See [test guide](https://github.com/c4rO-0/agentpay-user/blob/main/test/README.md) for evidence limits.

## Explicit platform address changes

`connect-market.mjs` reauthenticates at the user-selected origin and checks the
original account, Wallet tuple and exact Policy connection ID. Public configuration
is not a Market identity proof. `platform-endpoints.mjs` compares saved deployment
and bound Policy with the new configuration, probes Settlement's existing public
readiness projection, then changes only transport URLs after consent. No new API
or platform identity key is introduced.

The shared installer lock serializes the local apply step. Only the managed Runtime
unit is stopped; its listener must be gone before writes. Private atomic files and
a pending marker allow retry after interruption. Wallet and Order files are never
rewritten. `settlement-address-history.mjs` preserves exact directed, Policy-scoped
address mappings so cancellation retries retain their immutable original IDs.
Runtime recovery observations remain tagged by source and are rechecked instead of
being relabelled. The pending marker is surfaced by status.
