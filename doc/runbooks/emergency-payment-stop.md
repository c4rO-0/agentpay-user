# Emergency stop: disable AgentPay payments from your Safe

Use this procedure if your computer or Wallet Session Key may be compromised.
Use another trusted device and your Safe owner wallet. Do not enter owner keys,
Session Keys or unlock passwords into Market or send them to support.

This procedure assumes the Safe owner signers remain under your control.
A compromised owner signer requires a separate Safe account recovery response;
disabling a Module alone is not sufficient if an attacker can enable it again.

## What disabling the Module means

Your Safe permits the AgentPay Spending Module to execute bounded payments.
Removing that Module from this Safe stops all new payments through that Module,
across all its Policies and Wallet execution addresses. It does not disable the
Module for other users' Safes or shut down AgentPay.

A copied Session Key cannot bypass this stop: AgentPay funding calls the Safe's
module execution function, which requires the Module to remain enabled.
The stop takes effect only when the disabling transaction executes successfully
on-chain. A pending proposal or owner signature is not a completed stop; payments
may still execute before it.

## Stop payments from a trusted device

1. Open [Safe Wallet](https://app.safe.global/), select the correct network and Safe.
2. Open Settings and find Modules (under advanced settings in some versions).
   Identify the AgentPay Spending Module by its exact address, not only its label.
   Your saved setup and `./run wallet info` expose that address, but information
   displayed on the compromised computer must be independently checked.
3. Select removal for that Module. Review the Safe, network and target Module.
   Obtain the Safe's required owner approvals and execute the transaction.
4. Confirm a successful chain receipt and verify
   `isModuleEnabled(moduleAddress) == false` on the correct Safe.
5. Check for other enabled AgentPay Module versions on this Safe, and repeat if
   necessary. Each network and Safe must be handled separately.

Safe exposes this through `disableModule(prevModule, module)`, called by a Safe
transaction targeting the Safe itself. `prevModule` is the predecessor in its
enabled-module linked list, not a previous AgentPay release. Do not guess this
address or submit a direct owner-account call as a substitute for a Safe transaction.

Official references:
[Managing Modules](https://help.safe.global/articles/7039805766-add-a-module),
[disableModule](https://docs.safe.global/reference-smart-account/modules/disableModule).

## What remains unchanged

- Safe owner operations remain available. Other unrelated enabled modules are not removed.
- Already-funded Order Vaults retain their delivery, cancellation, dispute, payout
  and refund rules. This operation does not refund them.
- Policy records remain on-chain. Disabling does not revoke or delete them.
- Market Disconnect, sign-out, stopping Runtime or locking Wallet do not replace
  this chain operation. An attacker may hold a copied key elsewhere.
- This is a payment stop, not revocation of every history/support credential.
  Do not assume copied credentials lose all non-payment access.

## Before restoring payments

Keep the Module disabled while investigating. Replace the compromised execution
key and revoke its still-valid Policies through the Safe owner before re-enabling
the Module. Review all relevant Policies, including ones absent from Market's
connected list. Re-enabling without this cleanup can restore an attacker's
remaining spending permission.

Use a trusted installation for the replacement Wallet. Do not restore a suspected
leaked key as a security remedy. Keep Order history and incident evidence; do not
repeat paid requests to recover missing results.

## Current product and rehearsal limits

Market currently provides connection management and revocation documentation;
it does not execute this emergency Safe transaction. `./run policy revoke`
addresses the locally selected Policy, not every Policy or the entire Module.
See [Policy renewal and revocation](policy-renewal.md).

The private Anvil rehearsal is not available through the hosted Safe Wallet.
It needs a separately prepared owner-authorized Safe transaction and independent
chain checks. No emergency Module-disable rehearsal has been completed by writing
this guide. Do not send private rehearsal transactions to a real network.
