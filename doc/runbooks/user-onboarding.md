# Install and use AgentPay User

Use Linux with Node.js 22.22.3 or newer, npm and Corepack. If needed, run
`npm install --global corepack` using your Node installation before starting.
Have your platform's Market address and a
Safe on its supported network, controlled by your owner wallet. AgentPay does not
need your owner private key. macOS startup has not been independently verified.

## 1. Download

Keep `user` and `wallet` inside any parent folder you choose:

```text
agentpay-local/
  user/
  wallet/
```

For Git, see the commands in [README](../../README.md). For ZIPs, download both
repositories and rename the extracted folders accordingly. Keep private data outside
the program folders. The combined download is planned; current installation still
uses two repositories and checks their current version pairing.

## 2. Install and configure

From the User folder:

```sh
./run install --market https://YOUR_MARKET_ORIGIN
```

Use your platform's actual HTTPS origin; private rehearsals may use loopback HTTP.
If the ZIP lost executable permissions, use `sh run install --market ...`.
If Node is not on PATH, set `AGENTPAY_NODE` to its absolute executable path.

Install prepares dependencies, builds Wallet and downloads public deployment
settings, then continues into local setup. Read each prompt: setup prepares an
encrypted Session Key, spending limits, owner approval and local services. Existing
keys, histories and saved drafts are retained on retry. Approve only the intended
network, Safe, amounts and expiry in your owner wallet. See
[browser approval](safe-owner-web.md).

The official connectivity test asks for its maximum price before making a paid
Order. It uses a reviewed package digest pinned in User. Download/install alone
must not be mistaken for spending permission or payment.

## Resume and operate

Run the same Install command if preparation failed, or `./run setup` to return to
a prepared installation. Read its saved log when dependency/build preparation fails;
do not delete Wallet state to bypass an error. Deployment changes are handled by
[authorization update](deployment-authorization-update.md).

```sh
./run status
./run wallet unlock
./run market connect
./run payment test
```

Runtime and Wallet run locally. On Linux, the guide can configure systemd user
services. Wallet starts locked after a restart; [service commands](local-autostart.md)
control startup and background operation. Keep the Node installation used by those
service files available.

The default data location is `$HOME/.local/share/agentpay/user`. Install also stores
private preparation checkpoints/logs under `.agentpay-install/` beside the repositories.
`./run wallet info` shows resolved identity and paths. Follow
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

Download compatible User and Wallet code, then run `./run repair`. It applies local
code and preserves keys and requests. See [updates](local-update.md).
`./run uninstall` requires confirmation before removing local data. It does not
revoke on-chain permission; use the appropriate owner-authorized revocation or
[emergency stop](emergency-payment-stop.md) when needed.
