# Use AgentPay User

The normal entry is `agentpay`; source checkouts also provide `./run`. Start with
[installation](runbooks/user-onboarding.md); there is no need to run individual
internal scripts for ordinary setup.

| Task | Command / guide |
| --- | --- |
| Install or continue setup | `agentpay install --market URL`, then `agentpay setup` when returning |
| Check local state | `agentpay status` |
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
