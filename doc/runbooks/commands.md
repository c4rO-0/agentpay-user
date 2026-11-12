# User command reference

Use `agentpay` after installing the package or linking a source checkout with
`npm link`. From a source folder, `./run` is the same entry; it uses Node on PATH
or `AGENTPAY_NODE`. For a folder-local npm install, use
`./node_modules/.bin/agentpay`; its `update` stays in that installation folder.

```sh
agentpay help
agentpay status
```

Top-level operations are `install --market URL`, `setup`, `repair [-f]`,
`update [-f]`, `uninstall [--delete-data]` and `status`.
Update checks npm and installs User with its pinned Wallet, then checks the official
test Skill. It asks before changes unless `-f` is given. Source/npm-link installations
use manual source updates followed by repair. Repair checks installed packages and
confirms service interruption; `-f` skips that prompt only. Uninstall removes
services and keeps data unless `--delete-data` is explicitly confirmed. Neither
operation revokes on-chain permission.

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
agentpay service start
agentpay wallet unlock
agentpay status
agentpay payment test

agentpay policy renew
agentpay policy revoke

agentpay orders list
agentpay orders details ORDER_ID
agentpay orders retrieve ORDER_ID

agentpay service autostart off
agentpay service stop
agentpay service logs runtime
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

`agentpay orders status ID` reads the current Settlement record through Wallet.
It displays retrieval time and the record update time when available; it does not
independently query the chain. If querying fails, the command labels the last
local record and its saved check time. A successful query does not rewrite local
history; Runtime maintains its own recovery observations. Use
`agentpay orders details ID` for the saved local record.

## Running-version checks (User 0.3.1)

`agentpay status` compares the installed User/Wallet pair with the versions reported
by the running processes. A mismatch leads to `agentpay repair`; missing reporting
requires a paired package update first. Repair only records success after both
processes report the expected package, local reporting interface and Protocol versions.
These checks do not change Policy validity, Order identity or payment permissions.
User 0.3.1 installs the required Wallet 0.3.1 dependency automatically.

Protocol reporting reads the installed package resolved by that process, rather than
copying its dependency declaration. User preflight checks both User's and Wallet's
resolved copies against the reviewed exact version, including nested dependencies.
Package version checks establish compatibility metadata, not file-integrity attestation.

## Multiple installations (unreleased working tree)

Run `agentpay service start` from the installation you want to use. When another
installation owns the background services, the command shows both data folders and
asks for `confirm` before stopping the old pair. Cancellation keeps the old services.
Noninteractive commands cannot approve a switch. Wallet and Order data stay in their
own folders; unlock the selected Wallet after starting it.

Install now offers reuse, separate data or cancellation when it finds existing data.
The setup guide checks service ownership before continuing. A separate data folder
starts empty; it does not copy a Session Key or spending permission.

These changes are under development. Actual systemd switching and login behavior have
not yet been accepted; default Skill discovery and interrupted-switch recovery remain
open. Do not use these working-tree changes as a released multi-installation guide.

### Original requests after switching installations

If a Skill says a request belongs to another installation, return to that installation
and inspect `agentpay orders list`. Use the Skill's `--resume REQUEST_ID` option with
its original request identifier. An Order ID and a Skill request ID are different.

Missing or conflicting history is kept for review; switching does not recreate a
purchase. Very old records may prevent automatic invocation in another installation
because the original input cannot be identified. `--force` is only for an intentional
new purchase, never a way to recover an old result. Read-only status, order inspection
and service startup remain available.
