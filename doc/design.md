# User Runtime design

## Bounded purchases, separate authority

The human grants bounded Safe spending permission once. Normal eligible Skill
calls use that permission without repeated owner signatures. User coordinates the
interaction; Wallet owns the Session Key and only exposes bounded operations.
Neither Skill code nor Runtime receives generic owner signing authority.

A Skill may use local logic and zero, one or multiple services. Each paid call
carries its own registered service reference and private JSON input. Business
validation belongs to the Skill/Provider. Runtime validates common identities,
amount/usage bounds, delivery evidence and recovery state. The official random
service is only the installation payment test, not a global service requirement.

## Preserve one purchase attempt

Request identity binds the service, input and accepted conditions, not the local
Runtime port. Retry resumes the original attempt or returns its verified saved
result. Ambiguous or incomplete history pauses for review; it must not become a
new paid attempt. A deliberate new purchase requires explicit new-request intent.

User persists private input snapshots, request/payment checkpoints and results.
Received output is not a verified result until its evidence is checked. Binary
attachments are explicitly cached, bounded and integrity checked; arbitrary output
links are not downloaded automatically. See [cache reference](reference/result-file-cache.md).

## Authority is not display grouping

Market groups Wallets by network, Module, Safe and execution address. Each verified
Policy still bounds access to its original Orders. A nickname is display metadata,
not a machine identity. Renewing permission preserves local history and does not
implicitly grant access to another delegate's Orders. See
[Wallet identity](reference/wallet-identity-policy-history.md).

Expiry stops new spending, while original-Order support follows its own verified
rules and deadlines. Revocation, Module disablement, process stop and local lock
are different operations. A saved binding alone does not establish current chain
readiness. Historical reads never silently switch the active spending Policy.

## Network and operator boundaries

Anvil and supported public EVM deployments use the same product flow with explicit
validated configuration and signer selection. Anvil chain ID is not permission to
use unlocked test accounts. External-owner signing must work on Anvil too.
Deployment changes require deliberate authorization review; they do not rewrite
saved requests or grant arbitrary signing.

User accesses Market and Settlement through public participant APIs, not their
databases or private files. Local caller authentication is not OS sandboxing against
code running as the same user. Logs and public services must not receive private
inputs, result bodies, keys or bearer credentials.

## Remaining product work

User consumes a pinned public Wallet package without sibling source assumptions.
Running-process compatibility negotiation and optional combined installers remain
[planned](plans/user-wallet-distribution.md). Real-network, multisig and additional
platform acceptance remain explicit gates in [TODO](TODO.md); private results do
not establish production safety.
