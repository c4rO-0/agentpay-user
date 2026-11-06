# Local Safe owner approval boundary

`owner-approval-server.mjs` serves a temporary loopback page for a fixed public
operation plan. `web/owner-approval.js` connects an injected browser owner wallet,
checks the selected network/Safe and obtains the required Safe approvals/execution.
It does not hold the local Session Key or obtain Wallet administrator capability.

The terminal and page share the same saved operation identity. The page verifies
execution receipts/effects; the terminal independently checks chain state before
binding or advancing. Changed nonce, conflicting draft, incomplete signature count
or unknown effect must preserve the original plan for reconciliation.

Source supports sequential single-owner and multisig approval mechanics. The recorded
private MetaMask journey used one owner. Multi-owner, interrupted-signature and
portable-page participant acceptance remain separate gates. Supported Safe versions
are checked explicitly, not inferred from chain ID.

Headless users can forward the printed loopback port. Portable export contains a
fixed public plan and local server, not RPC credentials, keys or local tokens.
Browser RPC reachability/CORS must still be verified. Do not expose the temporary
approval service publicly or allow arbitrary transaction input.

See [user instructions](../runbooks/safe-owner-web.md),
[signer/deployment settings](public-deployment-settings.md) and
[emergency stop](../runbooks/emergency-payment-stop.md).
