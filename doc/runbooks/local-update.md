# Update User and Wallet

Download the compatible User and Wallet versions listed in the release notes.
Keep the folders side by side, named `user` and `wallet`. Git users can obtain the
same versions through Git; ZIP users do not need Git.

Before replacing program files, stop the background processes with `./run service stop`.
Keep your private User data directory and the parent `.agentpay-install` directory.
Do not use uninstall, replace key backups, or erase local Order history for an update.

Once the downloaded source folders are ready, run from User:

```sh
./run repair
```

AgentPay first checks the local files. If changes need applying, it asks you to type
`confirm` before pausing services. Type `q` to cancel. If nothing changed after the
last successful update, it finishes without rebuilding or restarting.

To skip this confirmation (all version and safety checks still run):

```sh
./run repair -f
```

AgentPay checks the pair, pauses services, installs dependencies, builds Wallet and
starts Wallet/Runtime. This applies local code; it does not fetch Git commits or ZIPs.
Node, npm and Corepack are required as for installation. It does not change your
login startup preference, spending permission or Market connection.

After success:

```sh
./run wallet unlock
./run status
```

If building fails, services remain stopped. The command shows the log location;
resolve the reported problem and repeat `./run repair`. If service state cannot be
confirmed, use `./run status` and `./run service logs runtime`. There is no automatic rollback.
An interrupted run may retain the install lock; inspect it before treating it as stale.

Updating does not buy a test or renew expired authorization. A new paid connectivity
test requires a separate deliberate confirmation. Your original requests are kept.

## Official test Skill check

After a successful software update, the command downloads the published official
test ZIP using the saved Market source, verifies its bytes against User's built-in
SHA-256 and saves the new package alongside existing ones. It does not replace the
selected original test, edit checkpoints, execute package scripts or purchase.
The same check also runs when local software has no changes. Cancelling an update
skips it. Missing settings, network errors or a hash mismatch are reported separately;
they do not turn a successful software update into a failed build. Retry `./run repair`
without rebuilding unchanged software. Local edits in an existing installed copy
are retained and reported rather than overwritten.

## Missing local Skill connection

If a Skill reports a missing Runtime connection while services are running, run
`./run repair`. Preparation restores a missing `runtime/connection.json` from your
saved service settings, including when local code is unchanged. It keeps caller
credentials, keys, Policies and request history. A conflicting, malformed or unsafe
existing connection file is retained and reported for review; do not delete your
User data or repeat setup to work around it.
