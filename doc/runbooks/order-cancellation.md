# Cancel an unaccepted Order

The cancellation client is implemented. Remaining participant and financial
acceptance is tracked in current TODO. Keep User and Wallet side by side and use
their declared dependency lockfiles.

## Before you start

Wallet must be running, unlocked and bound to the original Buyer Safe/Policy.
Use the same User data directory and Settlement base URL as the original request.
Use HTTPS in public deployments; loopback HTTP is permitted for private testing.
A public reverse-proxy prefix belongs in the base URL, for example
`https://market.example/settlement`, not the final `/agentpay/wallet` route.
No access to platform files, databases or Provider credentials is needed.

From the User repository, cancel by the original Runtime request ID:

```sh
node scripts/cancel-order.mjs "$HOME/.local/share/agentpay/user" 'https://market.example/settlement' --request 'YOUR_ORIGINAL_REQUEST_ID'
```

Replace the example URL and request ID. This reads the existing default
`runtime/invocations.json` ledger. If Runtime uses a custom state-file path,
use the original Order ID instead; the command does not search other ledgers:

```sh
node scripts/cancel-order.mjs "$HOME/.local/share/agentpay/user" 'https://market.example/settlement' '0xYOUR_ORIGINAL_64_HEX_ORDER_ID'
```

No saved Order means nothing is cancelled. Do not start a replacement payment
to work around a missing or interrupted request.

## Check or retry

Add `--status` to either command to read the original Order without requesting
cancellation. A request timeout is not a confirmed cancellation: check status,
then rerun the same cancellation command if needed. The client saves one private
cancellation identity before sending it and reuses it after response loss or
process restart. Keep `runtime/order-cancellations/` and invocation history.

| Result | Meaning / next action |
| --- | --- |
| `requested`, `cancelling`, `refunding` | Still pending. Query the same Order later. |
| `cancelled` | Unpaid Order closed; no payment was refunded. |
| `refunded` | Funded principal returned to the original Buyer Safe. Policy cumulative spend is not restored. |
| `ORDER_ALREADY_ACCEPTED` | Provider acceptance won; existing delivery and timeout rules apply. |
| `ORDER_CANCEL_FORBIDDEN` | Current Safe/Policy does not own that Order. Restore the original configuration. |
| `CANCELLATION_STATE_CONFLICT` | Local intent belongs to another Policy/endpoint. Preserve it for recovery review. |
| `ORDER_CANCELLATION_UNAVAILABLE` | Deployment or original Order does not support this closure flow. Contact the operator. |

Settlement decides acceptance/cancellation atomically. A local intent alone does
not cancel an Order. Runtime reads authoritative closure before further payment
or service calls and stops on closing/cancelled/refunded Orders; saved, verified
output can still be recovered. In-flight operations remain subject to Settlement
and contract race checks. There is no new owner signature, generic signing,
replacement Order or automatic reuse of refunded budget in this command.
