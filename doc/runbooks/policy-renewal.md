# Change or revoke spending permission

To stop all payments through an AgentPay Module after a suspected key leak, see [Emergency payment stop](emergency-payment-stop.md). Revoking the current Policy alone may leave other Policies usable.

From User, inspect the current permission:

```sh
./run policy info
```

## Renew or change limits

```sh
./run policy renew
```

New renewal drafts read budget, per-payment limit and validity duration from the
previous on-chain Policy. Press Enter to keep each displayed value; existing draft
answers take precedence. Duration starts again from now, not the old expiry date.
If the previous duration is not a whole number of days, enter days explicitly.
A previous per-payment limit above a newly reduced budget is not reused.
Navigation hints appear on a separate line.

This works both before and after expiry. Keep the same Safe and Session Key, choose
new budget/per-purchase limits/validity, then confirm. `back` revisits the draft;
`q` pauses with answers saved. There is no `-f` bypass for owner approval.

Replacement revokes the old Policy before creating the new one. It then asks Wallet
to independently verify the chain and switch. If creation fails after revocation,
new payments remain stopped; rerun the same command to continue the saved new Policy.
Submitted authorization terms cannot be edited as a draft. The new budget is a new
permission, not an automatic carry-over of old unused allowance.

Owner signing follows your explicit local signer selection, independently of the
network. The default external signer provides a temporary local browser page for
your Safe owner wallet, including on Anvil. Return to the terminal and enter `check`
after execution. The guarded Anvil test adapter is available only when explicitly
selected for the arranged test Safe; chain ID alone never selects it. See
[browser approval](safe-owner-web.md). No owner private key is requested by AgentPay.
Implemented signing support does not establish real-network or multisig acceptance.

Wallet verifies its existing trusted network/RPC, Safe, Module, key, token, Factory,
Registry and the new authorization's activation/expiry and unused state. Replacing
an unexpired Policy requires independent proof that the old one is revoked. The old
scope is archived before the durable pending/completed binding switch. Retry resumes
that exact switch and keeps signing blocked while incomplete; unlocking for recovery
remains possible. No service purchase occurs in this guide.

## Revoke

```sh
./run policy revoke
```

Review the Safe/Policy and type `confirm`. This revokes the current Policy on-chain;
it keeps the local key and binding for Order history/support. It is different from
`wallet lock` or `service stop`, which only affect local processes. The command verifies
revocation after owner approval; repeats detect an already-revoked Policy.

`status` and `policy info` show a revocation last verified by these commands. External
owner revocation is still independently enforced by payment checks; these local
summaries are not continuous chain monitoring.

## Existing Orders and next step

Expiry/revocation stop new spending without cancelling funded Orders. Queries and
support keep signature, original scope, ownership, replay and business-deadline checks.
Session Key, local Orders, files and Market connection are retained. After successful
renewal/binding, a saved Market connection automatically continues into the existing
connection guide using its saved address. Sign in and confirm to add the new Policy;
the stable Wallet group and nickname are reused. Without a saved connection, this
step is skipped. Cancelling or a Market failure does not undo renewal. Retry only
`./run market connect` to finish website access; do not renew again for this purpose.
Renewal does not silently broaden Market's authorization scopes.

Finish with `./run status`. Its Market section checks the local connection receipt
against the current Wallet/Policy without contacting Market. A mismatch prompts
`./run market connect`; a matching receipt does not prove current server availability
or detect a later website disconnect. Neither renewal nor revocation reruns a completed official
test or initiates another payment.
