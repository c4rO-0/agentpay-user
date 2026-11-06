# Deployment migration and advanced Policy tools

For normal deployment changes, use `./run setup` or `./run policy renew`.
The guide explains the mismatch, preserves your Safe and Session Key, and prepares
owner-approved replacement permission. Follow
[deployment authorization update](deployment-authorization-update.md) for supported
changes, defaults, signing and recovery. Ordinary software repair or a newly
qualified service does not by itself require a new Policy.

The external signer serves the [browser approval page](safe-owner-web.md), including
on Anvil. Signing support is implemented; public-network, multisig and complete
interruption acceptance remain separate gates. Never use an unlocked test account
as a substitute for a real owner's approval.

## Advanced migration script

`scripts/migrate-safe-policy.mjs` exposes `preview`, `prepare`, `status`, `export`,
`complete`, `refresh` and `cancel` for an explicitly managed migration. It is a
low-level tool, not the normal installation or renewal entry. Inspect its usage
before supplying paths or arguments.

Review the target Safe, network, token, delegate, Registry, budget, expiry and
Module/Factory. `prepare` saves recoverable migration state and blocks new signing.
The owner revokes the old Policy before creating its replacement; `export` provides
the next operation. `complete` switches the local binding only after Wallet checks
actual chain state. `authorize-test` is restricted to private Anvil test use.

If interrupted, inspect `status` and resume the original migration. Do not remove
local files, generate a new key or create a replacement payment. Confirmed on-chain
revocation cannot be reversed by restoring an old local file. Cancel only while
its state and chain checks permit it.

After completion, verify the binding, restart/unlock services and check readiness.
Migration does not purchase a service, and the platform need not wait for every
user to migrate before resuming new Orders. Original Orders retain their original
rules and independently verified authorization scopes.
