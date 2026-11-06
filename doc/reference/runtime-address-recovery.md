# Runtime address and original-request recovery

Implemented recovery boundary; participant and real-network scope remain in TODO.
A local Runtime URL is transport location, not purchase identity. Historical records
that included an address are retained for guarded lookup rather than silently reset.

## Existing-only recovery

Treat loopback Runtime URL as a connection location. Preserve service/profile/input,
caller request ID, original orderRequestId, authorization scope and any known Order
ID as recovery evidence. Do not add a machine ID or bind nickname to an installation.

Before allowing a changed destination, inspect the original request through the
authenticated local interface. Do not create state during this check. Continuing a
recovered request must atomically require that original invocation still exists and
matches: a separate successful preflight alone cannot protect against state removal
before execution. Missing, mismatched or ambiguous history stops paid continuation.
The new Runtime may not silently call begin's create branch for a recovery request.

Default selection must find old records independently of the changed port. Preserve
historical records and block ambiguity; do not overwrite legacy keys or silently
choose one of multiple candidate requests. Valid local verified results can be read
without restarting a purchase. Explicit new-purchase intent remains separate.

A truly never-submitted request needs a separately justified creation path; absence
of a local Order ID is not proof that it never reached Runtime. A lost-history
reinstall requires original-order reconciliation, not blind URL replacement.

## Required regression coverage

Same history/new port; same Wallet/missing history; changed service/input/scope;
legacy address-keyed selection; multiple candidates; concurrent selection; crash
between lookup and execution; saved result reuse. In every recovery failure assert
zero new prepare/sign/fund calls. Use two maintained business payloads. No old
Policy, Order, commitment or service profile is rewritten.

## Related input snapshots

The approved [Skill input/output persistence plan](skill-input-output-cache.md) adds
request-scoped file snapshots without changing the existing-only recovery requirement.
Implement and verify these together at the invocation boundary; cached files alone
do not prove that another Runtime retains the original financial history.
