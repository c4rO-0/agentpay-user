# Wallet identity and Policy history

Market display identity is network + Module + Safe + execution address (delegate).
The nickname belongs to that identity. Several individually verified Policies may
be attached, but each remains the access boundary for its own Orders. Same-key
copies with the same tuple are one Wallet, not separately verified machines.

User keeps one active local spending Policy and preserves original request scopes.
`./run market connect` proves the current Policy; renewal can continue connection
to the same Wallet. Failure to connect does not undo a successful on-chain renewal
or authorize recreating a Policy. Connection receipts are local metadata, not proof
of live website access.

Spending expiry, revocation and Module disablement stop the applicable new payments.
Original Order reads/support use their original verified scope and Order-specific
rules/deadlines; retaining history does not grant a different key access. Never
merge by Safe or nickname alone. Historical read verification does not change the
active binding or authorize a new purchase.

Use [Market connection](../runbooks/market-connection.md), [renewal](../runbooks/policy-renewal.md)
and [backup/restore](../runbooks/wallet-identity.md) for current user procedures.
Account grouping is not a revocation mechanism: consult
[emergency stop](../runbooks/emergency-payment-stop.md) for a compromised key.
