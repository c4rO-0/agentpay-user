# User command reference

Run from the User folder. `./run` uses your Node on PATH, or the absolute executable
selected with `AGENTPAY_NODE`. Git and ZIP installations share the same commands.

```sh
./run help
./run status
```

Top-level operations are `install --market URL`, `setup`, `repair [-f]` and `uninstall`.
Repair applies already downloaded User/Wallet code and confirms local changes before
service interruption. Its `-f` skips that prompt only. Uninstall confirms full local
data removal and does not revoke on-chain spending permission.

| Group | Operations |
| --- | --- |
| `wallet` | `info`, `unlock`, `lock`, `restore` |
| `policy` | `info`, `renew`, `revoke` |
| `service` | `start`, `stop`, `restart`, `autostart on/off`, `logs wallet/runtime` |
| `market` | `connect [--market URL]` |
| `orders` | `list`, `details ID`, `status ID`, `retrieve ID`, `case ID`, `archive ID`, `unarchive ID`, `files ID [remove KEY]` |
| `cache` | `info`, `list`, `details ID`, `export ID PATH`, `clean`, `settings [KEY VALUE]` |
| `payment` | `test` |

A group without an action shows help; it never unlocks, revokes or changes files.
Use `<group> help`, or `service autostart help`, to see focused instructions. Old
flat commands such as `unlock`, `renew`, `connect-market`, `order ID details` are
no longer accepted; use the grouped forms shown here.

## Common tasks

```sh
./run service start
./run wallet unlock
./run status
./run payment test

./run policy renew
./run policy revoke

./run orders list
./run orders details ORDER_ID
./run orders retrieve ORDER_ID

./run service autostart off
./run service stop
./run service logs runtime
```

`policy renew` covers expired renewal and active replacement. Revoking permission
requires owner confirmation, and existing Orders retain their support rules.
Service stop/Wallet lock do not revoke permission. Archive hides a local warning;
it does not cancel or settle an Order. Retrieve requests the original result and
never buys a replacement. Cache removal only removes local copies.

Online Order operations require an unlocked Wallet. Start/unlock instructions and
`status` guide you to the next action; setup renews expired authorization first.

`status` includes a Policy section and expiry. “Within saved validity period” describes
local saved validity, not a new chain/payment-readiness check. Revocation records
are the last verification by this command suite. Unknown or conflicting scope is
shown as unconfirmed; use `policy info` for saved details.

`payment test` is the maintained end-to-end purchase check. In this release it uses
the reviewed private-Anvil official Skill. It shows the current price and service
time and asks before every new paid Order. If a test is unfinished, the same command
resumes its saved request instead of starting another purchase. Completed test records
are archived before a new one; the original onboarding test and Skill selection stay
untouched. After verified delivery, Wallet acknowledges receipt, which can bring
forward Provider payout.

The command checks payment, delivery and receipt acknowledgement. Provider payout
follows the Order’s settlement schedule; success does not claim final payout.


### Order status sources

`./run orders status ID` reads the current Settlement record through Wallet.
It displays retrieval time and the record update time when available; it does not
independently query the chain. If querying fails, the command labels the last
local record and its saved check time. A successful query does not rewrite local
history; Runtime maintains its own recovery observations. Use
`./run orders details ID` for the saved local record.
