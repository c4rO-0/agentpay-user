# Original results and delivery cases

## Reading result warnings

A settled Order can have no verified result saved on this device. Check the
original Agent conversation or retrieve the original result through the Order
commands below. This warning describes the result record; service health appears
separately in `agentpay status`. Do not pay again to recover an existing result.
The post-0.3.21 copy identifies “some results” and shows the affected count; that
wording is not yet in the published 0.3.21 package.

If the latest query fails temporarily, 0.3.21 retains a previously confirmed
terminal state for the same request and Settlement source, and marks the check
as unavailable. This saved state is not a fresh online verification. Keep Wallet
unlocked and restore connectivity; Runtime retries automatically.

From the User repository, unlock Wallet and use the saved installation:

```bash
./run orders list
./run orders status ORDER_ID
./run orders retrieve ORDER_ID
./run orders case ORDER_ID
```

Use a complete original Order ID from `orders`. Status never initiates a purchase.
Retrieval uses a short-lived, Order-bound permission, directly contacts the original
Provider and checks original delivery metadata. It never sends another payment,
executes service work or confirms receipt. Current-format valid results are saved
through the existing private result store and reused by the original Skill request.
Unsupported historical formats need review; they are not silently reinterpreted.

Run `./run market connect` once for this Wallet, sign in and choose a nickname.
Then open Market → Account → Order support and choose the Order. `case` shows this
guidance; it no longer prints a code for a Buyer page that does not accept one.
The independent Wallet Case API remains available for API clients.
See [Market connection](market-connection.md) for scope, privacy and disconnect.

Open the case before the displayed filing deadline even if result retrieval is
still pending. Opening a case does not automatically request or retrieve the
result; successful retrieval does not withdraw your case or approve early payout.
Explain the missing delivery and submit relevant evidence. Evidence
is deliberately shared with the case participants and review service; do not include
keys, passwords, private payment signatures or unrelated personal information.

Receipt confirmation ends the right to open a non-receipt case. Withdrawal does not
confirm receipt; reopening is allowed before the original cutoff with unchanged
deadlines. No repeated query, evidence or model retry extends a deadline.

New-policy time windows: accepted delivery +7d filing, +10d evidence, +11d latest
human handoff, +14d decision and +15d ordinary unconfirmed payout. Chain public
refund opens no earlier than the latest permitted delivery +16d, fixed at creation.
All days are 24 hours. Existing Orders keep their original policy. Provider-winning
rulings retain the planned payout; Buyer-winning rulings schedule prompt refunds.
A completed decision is not proof that a financial transaction has confirmed.
