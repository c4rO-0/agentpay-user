# AgentPay User Runtime Instructions

## Behavior-first verification — 2026-11-06

- Prefer end-to-end tests through real product entry points and public interfaces.
  Test observable behavior and user outcomes, not internal implementation shape.
  Use real processes, storage and Anvil where the claim depends on them; do not
  substitute direct database writes or internal-state injection for the workflow
  being accepted. Controlled fixtures may prepare prerequisites.
- Select meaningful complete journeys and failure boundaries: independent install/
  package consumption, authorization, payment, delivery, settlement/refund, denied
  access, duplicate requests and interrupted-operation recovery as applicable.
  A test should demonstrate a functional requirement or a concrete regression.
- Avoid tests that merely mirror implementation, assert source text/private helper
  structure, or repeat the same coverage without a distinct failure boundary.
  Syntax, type and build checks are useful checks, not functional acceptance.
- Keep focused tests for signatures, canonical hashes, amount/time boundaries,
  authorization and concurrency invariants when they give precise protection that
  end-to-end tests alone cannot efficiently provide. End-to-end preference does
  not remove negative security or financial-boundary coverage.
- Review existing tests by the same standard. Consolidate redundant tests only
  after equivalent meaningful coverage passes; do not delete a regression merely
  because it is a unit test. Do not inflate test counts as a measure of readiness.
- Label mocked external dependencies and evidence limits explicitly. Simulated
  success does not prove real process recovery, real payment or participant usability.
  Keep tests bounded to the change and use maintained fixtures; this principle does
  not authorize live funds, public-network operations, destructive resets or broad
  resource-heavy test runs.



## Network portability invariant — 2026-11-04

Develop and verify the same product flows on Anvil. Moving to a supported EVM
network must use configuration, deployment artifacts and explicit signer selection,
not a separate implementation of authorization, payment or recovery. External-owner
signing must be testable against Anvil as well. Keep test signer guards and private
reset/funding tools restricted; never remove them to make a product entry portable.
Chain ID is identity, not permission to select an unlocked test signer. Network
capabilities/finality and deployment addresses are explicit validated settings.
Changing networks never silently rewrites saved Policies, Orders or request identity.
Anvil results do not establish real-network compatibility or release approval.

## Cache and download boundaries — 2026-11-04

Cache text/files are business-neutral. Show saved Provider provenance when package
provenance is unavailable; never infer caller identity from installed ZIPs. Merge
matching logical outputs for display but count physical result copies. Display
metadata must not change request identity, payment authorization or cleanup safety.
ZIP source URLs are explicit and independent of service endpoint paths. Protocol
v1 canonical endpoint/profile requirements remain authoritative; do not relax them
as part of a generic installer or UI fix. Official random-test selection is scoped.


## Canonical User commands

Use grouped public commands: `wallet info/unlock/lock/restore`, `policy info/renew/revoke`,
`service start/stop/restart`, `service autostart on/off`, `service logs wallet/runtime`,
`market connect`, `orders ACTION ID`, `cache ACTION`, and `payment test`.
Top-level install/setup/repair/uninstall/status/help remain. The official test is a
paid private-Anvil check after explicit quote consent. Completed tests lead to a
fresh quote and confirmation; unfinished tests retain their original request. Retain older test identities and records. Keep
generated Next steps, web copy, tests and current
runbooks aligned. Do not add legacy flat aliases. Policy owner confirmation cannot
be bypassed by repair's `-f`. See doc/runbooks/commands.md.


## Wallet identity priority — 2026-10-31

Read `doc/reference/wallet-identity-policy-history.md` before connection/recovery work.
Market identity is network/Module/Safe/delegate; nickname belongs to this tuple,
while each Policy remains an independently verified Order-access scope. Do not
merge by Safe/name alone or create device IDs. Use current progress/TODO to identify
remaining acceptance; historical implementation pauses are not current blockers. Do not
silently reinterpret existing connection IDs, reset data or broaden authority.


Read `README.md`, `progress.md`, `doc/architecture.md`, `doc/design.md`, and
`doc/TODO.md` before changing this repository. Check this repository's Git
status first; when working inside a larger workspace, also check its enclosing
repository status.

## Product Boundary

- This is the user-side Agent/Skill runtime, not the Provider server.
- Wallet is a separate process and the only owner of the Session Key.
- Use only Wallet's narrow AgentPay IPC operations; never add generic signing.
- A local Skill may receive an opaque Service Authorization but must not log or
  persist it beyond the active invocation.
- Private request and output data travel only through User Runtime, Skill, and
  Provider server. Settlement and Market receive only hashes and metadata.
- Never accept caller-supplied price, usage limit, Provider identity, or payout
  facts as authority. Settlement owns commercial truth.
- Do not introduce legacy Execution Ticket behavior into native purchases.

## Development Rules

- Keep participant interactions simple: one `./run` command should orchestrate
  required preparation and continue the original task. Ask only for meaningful
  decisions or secrets; do not make users assemble build/restart/unlock commands.
- Use concise, human-readable progress, clear completion and a concrete retry
  action. Keep detailed diagnostics in logs, not the main guide.

- Complete one approved closed loop at a time and report before starting the
  next.
- Native acceptance evidence must start real processes and use formal APIs. Test harnesses
  may orchestrate and assert, but must not fabricate states through direct
  database writes, internal stores, or static authorization bypasses.
- Keep ports loopback-only until a later ingress decision.
- Never commit secrets, private requests/results, runtime config, logs, or
  generated credentials.
- Prefer targeted syntax, unit, and process checks over full builds.

## Documentation

Keep `README.md`, `AGENTS.md`, `progress.md`, and the required `doc/` files
current. Put durable evidence in `doc/records/`, runbooks in `doc/runbooks/`,
specialized contracts in `doc/reference/`, and obsolete material in
`doc/archive/`.

## Documentation navigation

Use `doc/README.md` to select documents by role and function. Keep current work in
`progress.md` and `doc/TODO.md`; put dated verification in `doc/records/` and superseded
chronology in `doc/archive/`. Archived pending tasks do not authorize repeating old
operations. Keep this repository independently readable; do not link parent workspace
documentation. Update local links and the catalog when reorganizing documents.

## Public source and independent development

User's original code is MPL 2.0; preserve MIT notices on Protocol and attributed
reference fixtures. Keep private platform scripts and operational records outside
this repository. Normal local tests need only User and a built sibling Wallet;
load Protocol fixtures from the pinned public package, not a source checkout.
Do not remove scripts merely because their name contains smoke or Anvil: some are
current onboarding entries. Review callers first. Never weaken signer or payment
boundaries to simplify tests. Keep source maps and behavioral evidence limits current.
