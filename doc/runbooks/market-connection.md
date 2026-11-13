# Connect a local Wallet to Market

Run from User after Wallet setup:

```sh
./run market connect
```

Enter your Market HTTPS address, sign in with your Market account, and choose a
Wallet nickname. Private rehearsals may use an arranged loopback HTTP address.
If preparation is needed, the command asks once, verifies the installed Wallet package,
restarts local services and continues. Unlock when prompted; input is hidden.
Keys, spending permission and Order records are preserved.

Choose a nickname of 1–64 characters. Chinese, spaces, punctuation and emoji are
allowed; control characters and hidden direction/formatting marks are rejected.
Some emoji count as two characters. Market also checks the normalized name length
and rejects names already used by another Wallet on your account. If a new name
is rejected, enter another without signing in again. Existing Wallets reuse their
name; an invalid saved name requires support review rather than an automatic rename.

Review the account and nickname, then type `confirm`. Use `details` to inspect the
Safe, network and Policy. Open Market → Account to view your Wallets and Orders.
A separate browser login may be needed; terminal sign-in does not create browser cookies.

## Change the address of the same Market

In a version containing the address-update feature, run:

```sh
agentpay market connect --market https://YOUR_NEW_MARKET_ADDRESS
```

For a folder installation, use `./node_modules/.bin/agentpay` instead of `agentpay`.
Sign in again at the address you trust. User checks that the account ID and the
original Wallet/Policy connection are still present. The existing nickname is
reused. It also checks the network, contracts and Settlement deployment before
showing the new platform addresses for confirmation.

Confirm to update the saved Market address and, if changed, the Settlement and
package download addresses. Runtime pauses briefly and restarts; Wallet remains
unlocked. Keys, Policy, Orders, input/output caches, startup preference and the
participant's RPC address stay unchanged. No paid test runs automatically.

A different account, missing original connection or changed contracts stops the
address update. This is a deliberate address change, not automatic discovery or
cryptographic proof of server identity. Check the website address yourself; the
terminal never forwards a previously saved login token to the new address.

If interrupted, repeat the same command with the same address. `status` reports
an incomplete update until it finishes. If a killed process leaves an installation
lock, confirm no installer is running before following the lock-review guidance;
User does not break an unknown live lock automatically. Existing cancellation requests keep their
original IDs; recovery checks refresh observations from the new Settlement.
Keep any old SSH tunnels until the update succeeds and `status` confirms operation.
This feature requires User 0.3.5 or newer. Updating software does not change
your saved addresses; run the command above to review the change.

Older source installations may leave onboarding files outside the npm package.
Address updates use the saved Wallet Policy and Runtime settings; they do not
require or recreate an old onboarding draft.

## Wallet identity and Policy access

A Wallet is identified by network + Module + Safe + execution address. Its nickname
belongs to that identity. Each attached Policy is verified separately and grants
access only to its own Orders. Connecting another Policy with the same identity
adds it to the existing Wallet group; it does not create a new machine identity or
inherit unverified Policies. Activity reflects the connected, authorized scopes,
not every transaction made by the Safe.

Two machines using the same key and identity share a Wallet group. Different keys
are different Wallets even on the same Safe. Choose a nickname distinct from other
Wallets in your Market account. Names are compared with Unicode normalization and
without case distinctions. The guide checks availability before confirmation; a
pending challenge can reserve the name for up to ten minutes. Reconnecting the same
Wallet can retain its name. Names are labels, not permission to access Orders.

Connection adds website Order access/support, not payment permission, receipt
confirmation, Policy management or platform adjudication. See the
[identity reference](../reference/wallet-identity-policy-history.md).

## Recovery and disconnect

- **Locked:** enter the Wallet password when prompted.
- **Old or stopped Wallet:** confirm preparation. If it fails, check the displayed
  log and retry. Obtain current source if requested; preparation builds local code.
- **Interrupted connection:** repeat `./run market connect`. Challenge verification
  is idempotent; an expired challenge needs a fresh proof. No purchase is created.
- **Expired Policy or disabled Module:** these stop new payments, but do not alone
  prevent connecting the original Policy for its Order history/support. Ownership,
  signatures, Policy existence and Order deadlines are still checked.
- **Revoked Policy:** new support requests through that Policy are denied. Another
  Policy does not inherit its Orders. Local original-Order reads/recovery have their
  own authorization checks; a denied connection is not a reason to buy again.
- **Renewal:** successful renewal can continue this connection flow to verify the
  new Policy under the same Wallet. A cancelled connection does not undo renewal;
  retry only `./run market connect`.
- **Disconnect:** removes the Market association and its pending challenges, not
  on-chain spending permission or a submitted dispute. Separately authorized access
  may still exist. For a compromised key, use the [emergency stop](emergency-payment-stop.md).

## Local administrative boundary

Wallet's admin capability signs only a fixed `market.connect` proof. The Agent/Skill
capability cannot call it. The proof binds Market origin, account, challenge,
nickname and expiry; it cannot make a payment. Same-user filesystem/code access is
not isolated by these capabilities. Market does not receive keys, unlock passwords
or private service results.

Normal completion and handled cancellation attempt to revoke the temporary terminal
login session. A forcibly killed process cannot guarantee logout; unused sessions
follow platform expiry. Passwords, login tokens and signatures are not saved locally.
`market-connection.json` in the selected User data directory contains public receipt
metadata and the saved Market address, protected with private file permissions.
It is not authority for website access. Local status does not detect a later website
disconnect or establish current server availability.
