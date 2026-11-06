# AgentPay User

User connects your AI Agent's Skills to paid services. A separate local Wallet
holds the Session Key; your Safe's bounded permission controls spending. After
setup, eligible purchases do not require an owner-wallet signature every time.

User is the Agent/Skill runtime, not a Provider server or a general-purpose wallet.
It retains request identity and local results so interruptions can be recovered
without silently creating a replacement purchase.

## Install

Use Linux with Node.js 22.22.3 or newer, npm and Corepack. If Corepack is missing,
install it with `npm install --global corepack` using your Node installation.
The installer uses Corepack to run Wallet’s pinned pnpm version.
Keep the two source repositories in
one parent folder, named `user` and `wallet`:

```sh
mkdir agentpay-local
cd agentpay-local
git clone https://github.com/c4rO-0/agentpay-user.git user
git clone https://github.com/c4rO-0/agentpay-wallet.git wallet
cd user
./run install --market https://YOUR_MARKET_ORIGIN
```

Replace the Market address with your platform's address. For ZIP downloads, extract
both projects into the same sibling layout. Use release instructions for compatible
versions; the combined ZIP and independent compatibility checks are
[planned](doc/plans/user-wallet-distribution.md), not available yet.

Install prepares dependencies and Wallet, downloads public settings and continues
setup. You choose the Safe and spending limits, then approve with its owner wallet.
The optional official payment test requires explicit cost confirmation. Never enter
an owner private key into AgentPay. See [installation and first use](doc/runbooks/user-onboarding.md).

For ZIPs without executable permissions, use `sh run`. If Node is outside PATH:

```sh
export AGENTPAY_NODE="/absolute/path/to/node"
./run help
```

## After setup

```sh
./run status
./run wallet unlock
./run orders list
./run market connect
```

Linux background services use your systemd user session. Wallet starts locked after
a restart. `./run service help` explains startup, stop and logs; `./run help` lists
all groups. [Commands](doc/runbooks/commands.md) · [Updates](doc/runbooks/local-update.md)
· [Backup and restore](doc/runbooks/wallet-identity.md).

## Develop or integrate

- [Developer guide](doc/develope.md): independent checkout, focused tests and evidence limits.
- [Architecture](doc/architecture.md): source map and recovery/authorization boundaries.
- [Skill author guide](doc/runbooks/runtime-skill-client.md): call the shared Runtime client.
- [Contribution guide](CONTRIBUTING.md), [documentation catalog](doc/README.md),
  [progress](progress.md) and [TODO](doc/TODO.md).

## Safety and scope

Source includes external-owner browser approval and a guarded Anvil test signer.
Network identity never automatically selects the test signer. The recorded private
single-owner journey is not real-network, multisig or production acceptance.
Current release gates are in TODO. macOS startup remains unverified.

Keep keys, passwords, caller tokens and private Order data out of repositories and
support messages. For a suspected compromise, follow
[emergency payment stop](doc/runbooks/emergency-payment-stop.md) from a trusted device.
Locking Wallet or disconnecting Market does not revoke on-chain spending permission.

Original User code is **MPL 2.0**. See [LICENSE](LICENSE), [third-party notices](NOTICE.md)
and [security reporting](SECURITY.md). Wallet and Protocol retain their own licenses.
