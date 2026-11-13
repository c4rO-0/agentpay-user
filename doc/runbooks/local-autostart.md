# Local automatic startup (Linux)

Wallet and Runtime can start as systemd user services when you log in. Wallet starts
locked. Your Session Key and existing Safe Policy are reused; no password is saved.
This does not enable startup before login or require administrator access/linger.

## Enable during setup

On Linux, Setup starts Wallet and Runtime through systemd user services. This does
not enable login startup by itself. After the official connectivity test succeeds,
the terminal guide asks once
whether Wallet and Runtime should start automatically when you log in. Choosing yes
installs/enables the services and reminder without restarting current processes.
Choosing no keeps manual startup. Your choice is remembered; q leaves it undecided.
A saved yes is retried after partial installation failure without repeating consent
or creating another payment. Manual enable/disable updates the same preference.

The installer verifies that existing listeners belong to its matching guide processes
or existing user services. Missing/stale PID records, mismatched arguments/data paths,
and system-managed processes block automatic adoption. A PID file alone never authorizes stopping a process. On the private shared host, operator services remain operator-managed.

## Manage after setup

The terminal setup start step saves your public Runtime/Settlement addresses in
`runtime/local-services.json` under your remembered User data directory. From User:

```bash
./run service autostart on
```

This enables the services for the next login without restarting them. To apply an
installed update now, use `agentpay repair`. Older Setup versions left independent
background processes running. Repair/start/stop can retire those processes only
after checking their private PID records, exact command, data directory and live
process identity. They request normal termination and wait; they never force-kill
an unknown listener. If identification fails, keep the data and share the diagnostic
report. A restarted Wallet needs `agentpay wallet unlock`.

If you completed setup before this feature, an operator can save the matching public
addresses once with `node scripts/autostart.mjs configure RUNTIME_URL SETTLEMENT_URL`.
Use your existing deployment, not arbitrary endpoints. This saves settings only.
Do not change endpoints to work around an incomplete request or Policy migration.

## Manage

From User, `./run status` shows the services. Use `start` or
`stop` for these managed processes. Unrecognized terminal/operator-managed instances
still require explicit review. A live Wallet socket or Runtime port
is rejected; it is never removed to take over an existing process.

`./run service autostart off` disables login startup without stopping current processes.
`./run service stop` stops them now without changing the login preference.
`./run service start` starts them manually; `./run service restart` restarts them locked.
`./run service logs runtime` shows recent Runtime service errors. Wallet data and history remain.
This is not on-chain revocation, deletion of the installation, or Order cancellation.

Files are installed under `~/.config/systemd/user/`: agentpay-local-wallet.service,
agentpay-local-runtime.service and agentpay-wallet-reminder.service. The installer
does not use or change `~/.config/autostart`, including its permissions or contents.
A conflicting existing file is preserved and reported. Services use absolute Node
and source paths; do not move/delete those paths before disabling/reconfiguring.
The current implementation uses the standard ~/.config location.

## Login reminder

A systemd user oneshot, enabled for graphical-session.target, checks Wallet status
and sends one best-effort notification
if it is locked. It does not unlock, prompt for a password, open a terminal or make
a payment. The notification tells you to open User and run `./run wallet unlock`.
There is no click-to-unlock action in this first version.

Linux needs a desktop environment that starts systemd graphical-session.target and
imports its display/session environment, a notification service, and `notify-send`.
The reminder stays active until graphical logout (PartOf + RemainAfterExit) so normal
Wallet restarts do not repeat it. Manual service start starts only Wallet/Runtime. With SSH/headless
sessions, missing notification support or an already unlocked Wallet, no popup is
sent. Runtime/Skill locked errors still show the unlock command. A missed notification
does not grant authority or block service startup. If Wallet does not become available
during bounded checking, inspect service status; notification is not a health monitor.

## Acceptance scope

Isolated real-process tests verify guide-owned endpoint conflicts, rejection of a
stale PID that points to an unrelated process, verified handoff, repeated handoff,
and managed startup with the same encrypted key and no new Order. Service-manager
command orchestration is tested with controlled fixtures, not a participant login
or real systemd handoff. Participant A/B switching and recovery after this fix remain
pending. macOS launchd support remains deferred. No deployed service was changed.

The `startupChoice` field in local-services.json records the requested preference,
not proof that systemd enable/start succeeded. Use status to inspect actual services.
If setup reports automatic startup pending, current processes remain in place and
local keys/Policy/history remain unchanged; retry enable after correcting the problem.

Desktop environments without that systemd session integration may not show a reminder;
Wallet/Runtime still start through the user default target and locked-call guidance
remains available. No password is collected through the notification. The former
prototype desktop entry is not generated or automatically deleted by this version.

## Uninstall

Run `./run uninstall` in an interactive terminal. It lists the selected local
installation and requires the exact phrase `DELETE LOCAL AGENTPAY DATA`.
Confirmation stops/removes its managed services and permanently deletes its local
Session Key, credentials, installed Skills, recovery history and installer settings.
It preserves the source repositories and tells you to delete User and Wallet folders
once cleanup succeeds. Other installations and unrelated startup files are preserved.
Unknown service definitions, active external listeners or unsafe paths block cleanup.

Uninstall does **not** revoke Safe authorization or cancel Orders. Resolve pending
Orders and revoke permission separately before retiring an installation. Reinstalling
cannot recover deleted keys or request history. Neither `stop` nor `autostart-off`
deletes data. Graphical password input is deferred; unlock remains a terminal command.

## Private rehearsal networking

Current Anvil settings contain loopback RPC, Settlement and package URLs, and the
published reference package still uses a loopback Provider URL. A desktop using those
settings needs the arranged SSH tunnels. Existing nginx routes do not rewrite saved
configuration or package identities. Keep Anvil and local Wallet/Runtime private.
A production installation must use public HTTPS Market/Settlement/Provider URLs and
an appropriate chain RPC; SSH forwarding is not a normal user installation step.
Public settings/package handoff and production owner signing remain release work.

## Startup self-check and historical Orders

Runtime starts its authenticated local listener before checking business history.
`./run status` shows process state, local inventory, Wallet availability and Order
check counts separately. A running process is not proof that a purchase is eligible.
The local `/status` endpoint requires the existing caller credential; `/health`
remains a minimal liveness endpoint.

The background task only reads Wallet status and original Settlement Orders. Locked
Wallets wait for unlock; unavailable services are retried with bounded backoff.
It does not create Orders, send payments, execute Provider work, confirm receipt or
cancel Orders. Existing Settlement workers retain their automatic refund duties.

Old invocation records stay unchanged. Known legacy requests cannot be replayed as
new purchases. Valid inventory permits unrelated requests through ordinary checks;
unreadable/missing/conflicting history or failed recovery-state writes pause new
paid calls without stopping the status listener. Missing caller authentication or
an occupied port still prevents unsafe startup.

Financial state and verified result availability are separate. A settled Order with
no verified local output is reported explicitly; Runtime will not re-execute that
settled service request to replace missing output. Unknown IDs, mismatched identities,
legacy output formats and unavailable original deployment access require review.
Do not delete history or add routing-version fields to bypass those protections.

Observations are saved privately beside `runtime/invocations.json` in
`runtime/invocations.json.recovery.json`; the original history, signed payloads and
result files are not migrated or erased. The observation file contains identifiers,
check times and conclusions, not private inputs, outputs or signatures. It is part
of the selected local data removed only by confirmed uninstall. Cached observations
are not a substitute for the Wallet/Settlement checks on each actual invocation.

The queue handles at most 4 records per pass, one read at a time. The IPC timeout allows Wallet's
30-second HTTP deadline to finish before the next read. Passes wait about
10–11 seconds after the previous pass; pending Orders are rechecked after 30 seconds, failed reads use
backoff up to five minutes, and terminal observations at most hourly. `./run status`
wakes a pass without bypassing per-Order backoff. Large inventories can take several
passes. All observed times are Unix milliseconds internally.

### Reading status

`./run status` groups services, Orders and one suggested next command. A live Wallet
read takes precedence over an older background observation when describing lock state.
Green `[OK]`, yellow `[WAIT]` and red `[!]` distinguish normal, waiting and blocked
conditions in interactive terminals. Redirected output is plain text; `NO_COLOR` or
`TERM=dumb` also disables color. Labels remain readable without color.

Status layout wraps explanations for terminals of at least 40 columns, keeps service
columns aligned with or without color, and does not show zero Orders when inventory
is unavailable. A successful summary says local checks passed, not payment approved.

Login startup reports Enabled/Disabled only when systemd confirms that setting.
Not configured for this user means the corresponding user unit is absent; it does
not describe administrator-managed services. Could not check means the query did
not establish the setting. Temporary enablement and masking are shown separately.
Start/restart output confirms that systemd accepted a request, not that Runtime
finished self-check; use status next. Stop/off remain separate operations.

### What to do next

| Status | Action |
| --- | --- |
| Runtime/Wallet stopped | Use the displayed start command, then check status. |
| Status unavailable | Inspect the indicated service log; do not reset history. |
| Locked | Run `./run wallet unlock`; background Order checks resume. |
| Permission missing | Run `./run setup`. An existing migration must follow its original update instructions instead. |
| Initial checks in progress | Leave services running; check after about 15 seconds. Large histories take longer. |
| Order check temporarily unavailable | Automatic backoff continues. If persistent, check network and Runtime logs. |
| Orders in progress | Keep services running and use the original Agent conversation. Only resume supported original requests with their original identifiers. |
| Identity/state/result conflict, unknown Order or missing Order ID | Preserve history; ask AgentPay support to review the Order/status. Do not share secrets or signed payloads. |
| Payment complete; local result unavailable | Check the original conversation, then ask the Provider using the Order ID. Repeated status checks cannot reconstruct the result; do not pay again to recover it. |
| Local checks passed | This check is finished. Normal checks still apply to each purchase. |

Mixed histories retain per-Order explanations; pending Orders continue automatic
checks even when another Order needs review. Background terminal-state rechecks
remain enabled; the guidance does not change recovery scheduling.

## Missing startup settings

`./run service start` prepares missing user-service configuration for an initialized Wallet.
It reuses private User settings and asks for any missing endpoint in the terminal.
It never reads platform secret configuration or changes your Policy.
`./run market connect` uses the same preparation before rebuilding/restarting when
needed. Preparing services does not turn on login startup. Conflicting saved
addresses stop the flow for review; no new identity is generated.

An old system-level installation requires an operator handoff first; User does not
stop root services. Do not initialize another Wallet to fix process management.
