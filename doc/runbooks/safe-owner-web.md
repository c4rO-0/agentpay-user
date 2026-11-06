# Approve Safe operations in your browser

The external owner signer now opens a temporary local authorization website during
setup, Policy renewal and Policy revocation. It requires an injected browser owner
wallet (window.ethereum) and a validated Safe version: currently 1.3.0 or 1.4.1.
Other Safe versions stop explicitly. WalletConnect/QR is not implemented.

## Local computer

The terminal prints a loopback address and attempts to open the system browser
when a desktop environment is detected. Open that address manually if needed.
Review the network, Safe, operation and limits. Connect a Safe owner wallet on the
matching network. The page cannot access your local Wallet IPC or Session Key.

For a single-owner Safe, choose the named operation button and confirm in the owner wallet.
For a multisig Safe, other owners can open the same plan and use Approve operation.
Approvals use Safe approveHash transactions and require network fees; approvals
remain valid for that transaction hash. Once enough owners are available, execute.
The connected executing owner can count toward the threshold without a separate
approveHash transaction. Other owners' approvals are read from the chain, so no
hosted transaction service or shared signature clipboard is required.

Operations are sequential. For example, enable the Module, check approvals again,
then create the Policy. The page checks completed effects before offering execution.
A changed Safe nonce pauses the saved operation for reconciliation. Approval alone
does not mean execution; a successful Safe ExecutionSuccess and chain state are
required. Expired or conflicting Policy drafts stop.

Return to the terminal and enter check. The local process independently verifies
chain effects, then continues binding. Enter q to pause; the original draft remains.

## Server without a desktop

The local service still listens only on 127.0.0.1. The terminal prints its actual
port and an SSH command such as:

```sh
ssh -N -L PORT:127.0.0.1:PORT USER@SERVER
```

Run that on your own computer, replacing the placeholders with the printed port and
your server login. Open the terminal's printed URL in your local browser with the
owner wallet extension. Forward the same port; Host validation deliberately rejects
other origins. Do not expose this temporary service publicly.

## Portable fallback

Enter export in the terminal. Copy the entire printed directory to a trusted computer.
It contains only the public fixed plan, HTML, bundled ethers/browser code and a
minimal Node server. It does not include RPC credentials, local session tokens or
Wallet keys. From that directory run:

```sh
node serve.mjs
```

Open the address it prints. Alternatively:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765. Direct file:// opening is not a supported wallet
connection method. Keep the files while approval is pending, then remove that
exported directory. Each export is separate and preserved until you remove it.
The static page uses the browser wallet's network provider, not the original
computer's local API. That wallet must have access to the correct network RPC.
For Anvil, configure your browser wallet with the arranged RPC forwarding.

Return to the original terminal and enter check (or resume the original command).
A copied page cannot bind the original computer's Wallet by itself.

## Evidence limits

Controlled HTTP, export and mocked browser/contract tests pass. Actual browser
extension signatures, desktop launch, SSH forwarding, multi-owner chain execution
and transaction fees remain participant acceptance. No real-network authorization
has been performed by implementing this page.

## Recovery after interruption

The local guide saves pending public transaction references and checks their receipts
before another submission. Reopen the original guide and connect the owner wallet.
If another Safe transaction used the nonce, check approvals again and review the new
nonce. Prior approvals do not carry over. Keep exported pages in the same trusted
browser; portable mode uses browser storage rather than the original machine's journal.
Do not clear storage or switch browsers while a transaction is pending. Verify its
original transaction and effects first. Expiry checks use chain time.

## Renewal interaction

Renewal reuses the bound Safe. Deployment updates label the default budget as remaining
allowance and preserve the original expiry when its default is retained. One webpage
runs the fixed revoke/optional Module enable/create plan. Connect once, then confirm
each named operation in the owner wallet. The page verifies each effect before showing
the next action. Return to the terminal and enter `check` once after all operations.
The independent terminal/Wallet checks still gate binding. Type `help` in the terminal
for SSH forwarding instructions; `export` provides the portable fallback.

The complete renewal plan stays fixed when you pause and reopen it; completed
operations are skipped after chain checks. Revoking the old permission alone does
not prevent returning to edit the new draft. Once creation approval/execution has
been prepared for the wallet, the draft is protected against changes; verify the
original operation instead. Exporting the portable page also protects its draft.
