# First spending authorization

Start with `./run install --market YOUR_MARKET_ORIGIN`, or return with `./run setup`.
Follow [installation](user-onboarding.md) for prerequisites. Wallet holds an encrypted
Session Key locally; the Safe enforces the approved spending limits. Market login or
Wallet connection does not create spending permission.

## What you review

1. Initialize Wallet and keep its encrypted Session Key and password securely.
   Neither is your Safe owner's private key. Never give keys to a Skill or platform.
2. Use a Safe on the configured network. Check the Safe address, owners, signature
   threshold, token and balance. An ordinary owner address is not a Safe address.
3. Choose a total budget, per-purchase limit and expiry. Eligible purchases can use
   the full budget without another owner signature. Registry qualification verifies
   identity/control, not service quality. New qualified services satisfying the rule
   do not require a new Policy.
4. Review the exact draft and operation list. `details` shows deployment and identity;
   `back` edits unsubmitted terms. Editing a draft does not grant permission.
5. Approve the operations with the selected owner signer. First setup may require
   enabling the Module before creating the Policy. With the default external signer,
   use the [local browser page](safe-owner-web.md), then return and enter `check`.
6. Wallet independently verifies chain state before binding. Start/unlock local
   services and, if desired, confirm the cost of the official payment test.

If restoring an existing authorization, use [Wallet restoration](wallet-identity.md)
with the original key and Policy. Do not create a replacement purchase to recover
an interrupted Order.

## Signer and evidence boundaries

Signer selection is explicit. The external signer also works on Anvil; a private
chain ID does not automatically select a test account. The guarded Anvil adapter is
only for an explicitly selected, arranged single-owner test Safe. The advanced
`authorize-existing-safe.mjs` test script is not the normal user entry.

An owner approval or submitted transaction is not proof of successful execution.
The guide checks chain effects and retains unfinished plans. Resume the same flow
rather than deleting state. Multi-owner approval requires the Safe's actual threshold.
The recorded private single-owner journey does not establish public-network,
multisig or real-funds readiness. Safe creation is not performed by this guide.

## Daily use and recovery

Wallet starts locked after restart; `./run wallet unlock` unlocks it locally.
Locking it does not revoke on-chain permission. Use [renewal/revocation](policy-renewal.md)
or [emergency payment stop](emergency-payment-stop.md) for owner-authorized changes.

Insufficient funds, exhausted budgets, expiry and unavailable services do not allow
silent increases in authority. Interrupted requests keep their original identity.
For a changed deployment, use [authorization update](deployment-authorization-update.md)
without reinitializing the Session Key.
