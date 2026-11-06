# Use AgentPay User

The normal entry is `./run` from the User folder. Start with
[installation](runbooks/user-onboarding.md); there is no need to run individual
internal scripts for ordinary setup.

| Task | Command / guide |
| --- | --- |
| Install or continue setup | `./run install --market URL`, then `./run setup` when returning |
| Check local state | `./run status` |
| Unlock / lock | `./run wallet unlock`, `./run wallet lock` |
| Start / stop / restart | `./run service start`, `stop`, `restart` |
| Login startup | `./run service autostart on` / `off` |
| Inspect identity / restore | `./run wallet info`, `./run wallet restore` |
| Change / revoke permission | `./run policy renew`, `./run policy revoke` |
| Connect website support | `./run market connect` |
| Review an Order | `./run orders list`, `details ID`, `status ID` |
| Recover original result | `./run orders retrieve ID` |
| Local files | `./run cache help`, `./run orders files ID` |
| Apply downloaded code | `./run repair` |
| Remove local installation state | `./run uninstall` (explicit destructive confirmation) |

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
`./run wallet info`. Preserve the full private User data directory for local request
and result recovery. A Policy ID alone cannot recover a lost key.

## Local services and Skills

The default data directory is `$HOME/.local/share/agentpay/user`, outside the source
checkout. Runtime listens on loopback and requires a separate caller credential.
A Skill uses local connection discovery; it must not bundle credentials or bypass
Wallet. [Skill integration](runbooks/runtime-skill-client.md) explains per-call
service references and recovery. No global Provider selection is required.

`./run payment test` is a separate, explicitly paid connectivity check using the
maintained, digest-pinned official package. Normal Runtime operation is not tied
to that business example. An interrupted test retains its original request.

[Background service guide](runbooks/local-autostart.md) explains Linux user services,
login reminders and manual startup. A local lock or process stop does not revoke
permission; follow [emergency stop](runbooks/emergency-payment-stop.md) when needed.
