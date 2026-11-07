# Install and use AgentPay User

Use Linux with Node.js 22.22.3 or newer and npm. Have your platform's Market
address and a Safe on its supported network, controlled by your owner wallet.
AgentPay does not need your owner private key. macOS startup remains unverified.

## 1. Install program files

Install User with `npm install --global @c4roa0/agentpay-user@0.3.0`.
Its reviewed Wallet dependency is included. Source/ZIP alternatives are in
[README](../../README.md). No separate Wallet checkout or build is needed.
Keep private data outside the program folder.

## 2. Configure

```sh
agentpay install --market https://YOUR_MARKET_ORIGIN
```

Use your platform's actual HTTPS origin; private rehearsals may use loopback HTTP.
Without `npm link`, run `./run install --market ...` from User instead. For a ZIP
without executable permissions use `sh run`; `AGENTPAY_NODE` can select Node.

Install verifies installed dependencies and downloads public deployment
settings, then continues into local setup. Read each prompt: setup prepares an
encrypted Session Key, spending limits, owner approval and local services. Existing
keys, histories and saved drafts are retained on retry. Approve only the intended
network, Safe, amounts and expiry in your owner wallet. See
[browser approval](safe-owner-web.md).

The official connectivity test asks for its maximum price before making a paid
Order. It uses a reviewed package digest pinned in User. Download/install alone
must not be mistaken for spending permission or payment.

## Resume and operate

Run the same Install command if preparation failed, or `agentpay setup` to return to
a prepared installation. Read its saved log when dependency preparation fails;
do not delete Wallet state to bypass an error. Deployment changes are handled by
[authorization update](deployment-authorization-update.md).

```sh
agentpay status
agentpay wallet unlock
agentpay market connect
agentpay payment test
```

Runtime and Wallet run locally. On Linux, the guide can configure systemd user
services. Wallet starts locked after a restart; [service commands](local-autostart.md)
control startup and background operation. Keep the Node installation used by those
service files available.

The default data location is `$HOME/.local/share/agentpay/user`. Install also stores
private preparation checkpoints/logs under `.agentpay-install/` beside the repositories.
`agentpay wallet info` shows resolved identity and paths. Follow
[backup and restore](wallet-identity.md) before replacing a computer or deleting data.

## Private Anvil and other deployment settings

Anvil uses the same authorization/payment code with explicit configuration. Select
external-owner signing for browser-wallet testing; the guarded test signer is only
for the arranged private rehearsal. Network ID alone does not authorize a test signer.

If a rehearsal configuration publishes server loopback URLs, they refer to that
server and need arranged SSH forwarding from another computer. Ask the operator
for the endpoints in that configuration; there is no universal public port list.
Supported public deployment configuration should expose reachable public APIs and
RPC, while your Runtime remains local. See [deployment settings](../reference/public-deployment-settings.md).

The [advanced private test guide](private-anvil-terminal-setup.md) is not a requirement
for an ordinary public-network user. Source support is not real-network acceptance.

## Edit an authorization draft

Type `back` to revisit the previous editable question. Earlier answers are retained;
dependent later choices may need review. `q` pauses with saved progress. An operation
already submitted on-chain cannot be changed by editing a local draft: resume its
original verification first.

## Update or uninstall

Download compatible User and Wallet code, then run `agentpay repair`. It applies local
code and preserves keys and requests. See [updates](local-update.md).
`agentpay uninstall` requires confirmation before removing local data. It does not
revoke on-chain permission; use the appropriate owner-authorized revocation or
[emergency stop](emergency-payment-stop.md) when needed.
