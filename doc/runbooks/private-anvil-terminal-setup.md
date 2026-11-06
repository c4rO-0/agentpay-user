# Private Anvil terminal onboarding

Use this guide with the existing private chain (31337), an operator-reviewed public deployment config, an existing single-owner test Safe and the published official random Skill. User and Wallet are separate sibling repositories. User/Wallet access their own files and public or role-authorized APIs.

## Start

Build Wallet and install dependencies as described in [User installation](user-onboarding.md). The operator supplies current deployment and package facts using [the config example](../reference/private-anvil-onboarding-config.example.json). Optional `safe` displays the rehearsal Safe as a default. URLs must be loopback addresses; no second Anvil or database is created.

Run in an interactive terminal from the User repository:

```bash
node scripts/user-setup.mjs --anvil /ABSOLUTE/PRIVATE/agentpay-data /ABSOLUTE/PATH/anvil-onboarding.json
```

The private data directory must be owner-held and outside the User/Wallet repositories. Missing directories are created during initialization. An operator's debug launcher may record terminal output, but must invoke this original command and preserve the terminal needed for hidden password input. It must not automate the participant's answers or replace the User/Wallet operations.

## Four stages

| Stage | What you enter | What the guide does |
| --- | --- | --- |
| 1. Create local Wallet | Set an unlock secret twice using hidden input | Creates or reuses the encrypted Session Key and local caller credential |
| 2. Set spending permission | Choose Safe, total budget, per-payment limit and whole days; confirm the final authorization summary once | Saves the exact draft, executes through the selected owner signer, reads back the chain and binds Wallet |
| 3. Prepare the official test Skill | Unlock Wallet if requested; official package preparation is automatic | Verifies/downloads the package, installs and selects it, starts local processes and checks readiness |
| 4. Run the paid test | Confirm the displayed maximum cost; verified official-test receipt is acknowledged automatically | Invokes the official service with a durable request identity, verifies delivery and completes the guide |

The guide asks for spending authorization and paid-test consent; external owner
approval also requires the corresponding wallet transactions. Official package preparation and verified test receipt acknowledgement run automatically. Data entry and password prompts remain. At entry or after a pause, choose `continue`, `details` or `q`; successful internal operations advance automatically. Technical substeps remain independently checked and recoverable.

Press Enter to use the displayed rehearsal Safe, or enter another Safe account address. Without a Safe, enter `create` for the appropriate guidance. Private Anvil is not available in the official Safe app. Amounts use displayed token units, not atomic integers. Expiry is computed from the selected number of days and displayed in the local timezone.

Review the budget carefully: eligible purchases may use the full budget without another owner signature. Qualification verifies identity/control, not service quality. Signer selection is explicit: the default external signer opens the local owner
approval page, also on Anvil. Only an explicitly selected Anvil adapter uses the
arranged test owner’s RPC signing operation, with chain and Safe guards. No owner
private key is entered into AgentPay. See [browser approval](safe-owner-web.md).

Deployment and selected-package details are available through `details`. The official-test preparation mode refuses to automatically select local edits; inspect them using the standalone selection command before continuing. `--preview` still provides JSON for technical inspection. New selection cannot abandon existing invocation history.

## Recovery and saved state

Reopen the same command with the same directory. The guide reads actual local and chain state, skips completed operations and continues the incomplete stage. A binding failure after successful chain authorization resumes binding; it does not ask you to authorize again. A stopped Wallet must be unlocked after restarting.

- `runtime/authorization-fields.json`: validated Safe/budget/per-payment/days, saved by semantic field names with deployment/delegate context. Wording changes do not invalidate saved inputs. No password is stored here.
- `runtime/authorization-draft.json`: the exact Policy ID and reviewed terms, saved before chain submission. Its presence does not mean authorization succeeded; final consent precedes submission.
- `runtime/active-skill.json`: selected bundle and file hashes.
- `runtime/model-ack-smoke.json` and `runtime/invocations.json`: retain both to resume the same test. Conflicting or missing history stops recovery instead of creating a replacement purchase.

An older unfinished `authorization-inputs.json` is retained. If no complete draft exists, the guide explains that its old prompt-based answers must be re-entered once; there is no silent migration. Existing complete drafts, Wallet bindings and Order checkpoints continue to be used.

Newly started Wallet/Runtime processes remain running after exit. PID/log files are `runtime/wallet-guide.pid`, `runtime/wallet-guide.log`, `runtime/user-runtime-guide.pid` and `runtime/user-runtime-guide.log`. Existing processes are reused only when their checks pass. Stop them through your process manager or verified PID ownership. Binding can start a locked Wallet and does not itself unlock it.

A saved confirmed test is revalidated before reporting completion. Automatic receipt acknowledgement for this official test can bring payout forward; connectivity success does not establish terminal financial reconciliation. On completion the guide explicitly ends and directs you to Market to choose other Skills.

## Evidence boundary

Focused tests cover orchestration, temporary local IPC/CLI operations and recovery.
The recorded participant single-owner browser-signing and payment journey passed on
private Anvil. Neither establishes public-network, multisig or real-funds readiness.
Current acceptance gaps are tracked in [TODO](../TODO.md).
