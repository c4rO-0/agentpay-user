# Use AgentPay User

The normal entry is `agentpay`; source checkouts also provide `./run`. Start with
[installation](runbooks/user-onboarding.md); there is no need to run individual
internal scripts for ordinary setup.

| Task | Command / guide |
| --- | --- |
| Install or continue setup | `agentpay install --market URL`, then `agentpay setup` when returning |
| Check local state | `agentpay status` |
| Diagnose connectivity or setup | `agentpay health` |
| Unlock / lock | `agentpay wallet unlock`, `agentpay wallet lock` |
| Start / stop / restart | `agentpay service start`, `stop`, `restart` |
| Login startup | `agentpay service autostart on` / `off` |
| Inspect identity / restore | `agentpay wallet info`, `agentpay wallet restore` |
| Change / revoke permission | `agentpay policy renew`, `agentpay policy revoke` |
| Connect website support | `agentpay market connect` |
| Review an Order | `agentpay orders list`, `details ID`, `status ID` |
| Recover original result | `agentpay orders retrieve ID` |
| Local files | `agentpay cache help`, `agentpay orders files ID` |
| Update npm installation | `agentpay update` (confirm, or `-f`) |
| Repair installed services | `agentpay repair` |
| Remove services / erase data | `agentpay uninstall` / `agentpay uninstall --delete-data` (confirmation required) |

See [full command reference](runbooks/commands.md) for arguments and examples.
Status distinguishes saved local facts from refreshed observations. It is not a
promise that a new purchase will be accepted. Online Order status queries go through
Wallet; a failed query or missing local result does not prove non-payment.

## Authorization and recovery

[Browser owner approval](runbooks/safe-owner-web.md) is available for setup,
renewal and revocation. [Deployment updates](runbooks/deployment-authorization-update.md)
require deliberate owner approval; neither repair nor Runtime startup may silently
replace Policy, key or Order identity.

Back up the encrypted key and password securely, with the identity displayed by
`agentpay wallet info`. Preserve the full private User data directory for local request
and result recovery. A Policy ID alone cannot recover a lost key.

## Local services and Skills

The default data directory is `$HOME/.local/share/agentpay/user`, outside the source
checkout. Runtime listens on loopback and requires a separate caller credential.
A Skill uses local connection discovery; it must not bundle credentials or bypass
Wallet. [Skill integration](runbooks/runtime-skill-client.md) explains per-call
service references and recovery. No global Provider selection is required.

`agentpay payment test` is a separate, explicitly paid connectivity check using the
maintained, digest-pinned official package. Normal Runtime operation is not tied
to that business example. An interrupted test retains its original request.

[Background service guide](runbooks/local-autostart.md) explains Linux user services,
login reminders and manual startup. A local lock or process stop does not revoke
permission; follow [emergency stop](runbooks/emergency-payment-stop.md) when needed.

### Official test Skill checks during updates

Update and repair verify the official test ZIP against the version pinned by User,
then compare its installed files. Matching local files need no download. Missing
archives trigger a download; changed or incomplete extracted files are kept and
reported for review. These checks do not start a payment or select a newer Skill
from Market. Software updates display repair progress while it runs.

### Updating after an interrupted installation switch

From the installation you previously selected, run `agentpay update`. If its
background services have stopped, the updater can install the new version and
continue that same switch. It preserves Wallet data and the confirmed target. If
recovery fails, run the same command again; do not delete the switch records.

User 0.3.9 and 0.3.10 stop before downloading when unit replacement is unfinished.
For those versions only, install the intended fixed User version with npm in the
same program folder, then run `agentpay service start` there. Do not uninstall or
create a replacement Wallet to recover an interrupted switch.

### Setup and connection warnings

An installation whose setup was cancelled before Wallet creation displays
“Setup not finished”; continue with `agentpay setup`. Existing Wallet records with
missing files instead require review; do not create a replacement Wallet.

“Cannot connect to the chain RPC” refers to the blockchain connection, not the
Market website. Restore the RPC connection and any SSH forwarding used by your
deployment. Keep Wallet unlocked; Runtime retries the original Order checks.
Manual `agentpay orders status ORDER_ID` also retries without making a payment.

Update recovery prepares the selected installation first; repair performs the
final service start. If interrupted between these steps, rerun `agentpay update`.

## Diagnose a problem

From the installation that is having trouble, run:

```sh
agentpay health
```

For a folder-local npm installation, use `./node_modules/.bin/agentpay health`.
The command prints each check as it runs, including its duration, failure category
and suggested next action. It can diagnose an incomplete setup; Wallet does not
need to be unlocked. Missing configuration or stopped services will be reported,
not created or started. An inactive installation may therefore show local service
failures even when the other installation is running normally.

Checks cover installed versions, saved settings, RPC/network, deployed contracts,
Safe ownership and Module setting, Policy reads, local Wallet/Runtime and configured
platform HTTP endpoints. HTTP reachability is not a login or payment test. A
readable expired or revoked Policy does not permit new payments; use `agentpay
status` for readiness. Each chain read has a 30-second limit; HTTP probes have a
10-second limit. After an RPC timeout, remaining chain checks are skipped. Platform
probes verify the expected JSON response, so an HTTP 200 proxy error page does not
count as a healthy endpoint. The command makes no automatic retry loop.

The report includes public contract addresses and timing information. It omits
private keys, tokens, request/result contents, URLs and personal paths. Review it
before sharing; do not attach your data directory or raw service logs by default.
No request is signed, no purchase is made and no local files are changed by health.

Setup retains entered limits after a failed network check. A failure before
submission is labelled as such; after a submitted transaction, resume the same
step to verify it instead of creating a new authorization or purchase. When saving
local settings, Enter or an unrecognized answer keeps the confirmation prompt open;
only `confirm` saves, while `q` or Ctrl+C exits. Owner approval defaults to your own
wallet (for example MetaMask); the test signer remains restricted to a prepared
local Anvil deployment.

## When a command fails

Read the failed operation and error code printed in the terminal. The following
instruction explains what to check or which saved operation to resume. A service
startup failure also checks the systemd user units on Linux and reports recognized
causes from recent service logs, such as a port already in use. Recent log evidence
may describe an earlier attempt; it does not by itself identify the process owner.

Unexpected failures save a private `diagnostic-….json` report and print its path.
This report contains reviewed error categories, exit status, code locations and
available service evidence. It excludes raw exception text, credentials and private
request contents. Share this report and the command you ran with support; inspect
an installation log separately before sharing it. If the report cannot be saved,
copy the terminal error codes instead.

Keep the original Wallet and Order files. A failed command may have applied some
changes already; do not repeat a purchase to repair a setup or connectivity problem.

If npm has already installed a newer User version while an older update was
unfinished, `agentpay update` verifies the installed release and offers to finish
its checks. It keeps the newer version. Confirm to continue, or enter `q` to keep
the recovery record without changing services. The old record is closed only after
the checks succeed; keys, permissions and Orders stay in their data folder.
