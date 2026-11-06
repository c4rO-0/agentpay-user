# Terminal authorization preview

Use Linux with compatible Node installed. Prompts are English. This page covers
the demo/preview entries only; ordinary setup supports external owner signing.
macOS startup and public-network acceptance remain separate release gates.

## Choose an entry

For the complete four-stage UI simulation, run from User:

```bash
node scripts/user-setup.mjs --demo
```

Choose `continue` once. The demo advances through Wallet initialization, spending permission, official Skill preparation and paid test. It asks for two confirmations: spending permission and test payment. Official Skill preparation and acknowledgement of verified test receipt are simulated automatically. Hidden practice-secret entry and spending-limit fields remain. It never creates keys, connects to a chain, installs files or pays. Simulation progress survives a pause in the same process, not process exit. It ends after the test and points to Market.

To preview only the spending parameters:

```bash
node scripts/guide-policy.mjs --demo
```

Enter the Safe (or press Enter for the fictional example), total budget, per-payment limit and duration in whole days. `details` shows deployment information; `create` at the Safe prompt explains where to obtain the correct Safe. One final confirmation completes this read-only preview, without granting permission. Expiry is displayed in the local timezone. No inputs are persisted by this standalone preview.

For actual read-only deployment checks:

```bash
node scripts/guide-policy.mjs PUBLIC_DEPLOYMENT_JSON WALLET_DELEGATE
```

The public config supplies `chainId`, `rpcUrl`, `module`, `token`, `factory`, `registry`, `tokenDecimals` and `source`; optional `tokenSymbol` labels amounts. Use trusted deployment data and the public Wallet execution address. The command checks chain identity, contract presence, Safe owners/threshold, Module and Policy state. It cannot sign or bind. Contract presence alone is not proof of trusted semantics. Never enter an owner private key, Session Key or unlock secret into these fields.

## Actual setup and owner signing

This guide describes the explicit demo/preview path only. Ordinary setup supports external-owner approval; see [browser signing](safe-owner-web.md). Private Anvil can use an explicitly selected guarded test signer.

On a supported real network the owner must execute the reviewed Safe operations: enable the trusted AgentPay Module if absent, then create the bounded Policy. The application must verify actual chain results and the Safe's signature threshold; a user clicking confirm is not chain evidence. Reducing guide confirmations does not merge contract operations or imply a real-wallet batch-signing implementation. [Safe authorization](safe-policy-setup.md) explains the authority and release boundaries. The demo does not open an owner-signing browser page. Actual setup attempts to
open its local approval page on a desktop and always prints the address.
