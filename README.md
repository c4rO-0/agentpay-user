# AgentPay User

User connects your AI Agent's Skills to paid services. A separate local Wallet
holds the Session Key; your Safe's bounded permission controls spending. After
setup, eligible purchases do not require an owner-wallet signature every time.

User is the Agent/Skill runtime, not a Provider server or a general-purpose wallet.
It retains request identity and local results so interruptions can be recovered
without silently creating a replacement purchase.

## Install with npm

On Linux, prepare Node.js 22.22.3 or newer, npm and your AgentPay Market address.
Install User with the command below. It automatically installs the matching Wallet
and Protocol packages; you do not need to download two repositories:

```sh
npm install --global @c4roa0/agentpay-user@0.3.1
agentpay install --market https://YOUR_MARKET_ORIGIN
```

Replace the Market URL with your platform's address. Use a user-owned Node/npm
installation with Node and npm's executable directory on PATH. No Wallet checkout,
Corepack, pnpm or TypeScript build is needed.

Install verifies dependencies, downloads public settings and continues setup.
You choose the Safe and spending limits, then approve with its owner wallet.
The optional official payment test asks before spending. Never enter an owner
private key into AgentPay. See [installation and first use](doc/runbooks/user-onboarding.md).

Program files and private state are separate. Keys, Policies, Orders and cache
normally live in `~/.local/share/agentpay/user`; an existing custom data directory
is retained. Installation checkpoints use `~/.local/state/agentpay/user` (or
`$XDG_STATE_HOME/agentpay/user`). Upgrading program files does not erase either.

## After setup

```sh
agentpay status
agentpay wallet unlock
agentpay orders list
agentpay market connect
```

Linux background services use your systemd user session. Wallet starts locked after
a restart. `agentpay service help` explains startup, stop and logs; `agentpay help` lists
all groups. Global npm installations use `agentpay update` to review and install a
new User version with its matching Wallet and official test Skill. Source checkouts
update their files, run `npm ci`, then `agentpay repair`. [Commands](doc/runbooks/commands.md) · [Updates](doc/runbooks/local-update.md)
· [Backup and restore](doc/runbooks/wallet-identity.md).

## Develop or integrate

For contributors or source ZIP users:

```sh
git clone https://github.com/c4rO-0/agentpay-user.git user
cd user
npm ci
npm link
agentpay help
```

`npm link` exposes the command from your checkout. Without linking, `./run` (or
`sh run`) provides the same commands; `AGENTPAY_NODE` can select your Node executable.

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
