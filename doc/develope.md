# Develop AgentPay User

## Independent checkout

Read [README](../README.md) and keep User and Wallet as siblings. A developer needs
Node.js 22.22.3 or newer, npm and Corepack. If Corepack is absent, install it with
`npm install --global corepack` using your Node installation. The commands below
select Wallet’s pinned pnpm version through Corepack. In Wallet:

```sh
corepack pnpm@10.0.0 install --frozen-lockfile
corepack pnpm@10.0.0 build
```

Then in User:

```sh
npm ci
npm test
```

The test command runs files sequentially to limit resource use. It uses disposable
files, keys, subprocesses and loopback endpoints. No private Settlement/Market source,
database, live chain or Provider checkout is needed. Protocol fixtures are loaded
from the pinned package; reference Skill fixtures live under `test/fixtures/`.
Some tests use real Wallet IPC; others deliberately simulate upstream interfaces.

For focused iteration:

```sh
node --check src/runtime-client.mjs
node --test test/runtime-client.test.mjs
node --test test/multi-service-runtime.test.mjs
```

Do not use `./run payment test` as an unattended unit test: it requires configured
services and explicit consent for a real paid Order on the configured test network.
Do not run install/setup against your personal state to prepare unit-test fixtures.

## Reading order

1. [Architecture/source map](architecture.md) and [design rationale](design.md).
2. `src/user-cli.mjs` for command routing; setup/repair modules for human flows.
3. `src/runtime-client.mjs` and `src/skill-client.mjs` for the Skill boundary.
4. `src/index.mjs`, `invocation-store.mjs` and `runtime-recovery.mjs` for one request
   from preparation through delivery and restart observation.
5. `owner-signer.mjs`, `safe-policy-plan.mjs` and the browser page before changing
   owner approval; inspect Wallet's authority checks separately.

Use [documentation by role](README.md) and the [test map](../test/README.md) to find
more focused material. Plans describe future work; local reference documents and
current source describe implemented behavior.

## Verification rules

Test user-observable outcomes through product entries. Keep exact signature/hash,
amount, expiry, capability and cross-Order rejection tests where they protect a
specific boundary. A mocked package manager tests orchestration, not installation;
a mocked Provider cannot prove funding or actual delivery. Recorded private
acceptance is not public-network or production approval.

Fault injection belongs only to the explicit test loader. If source layout changes,
update its anchors to the same durable boundary and rerun process recovery tests.
Never add test-only branches to normal Runtime or change request identity to make
recovery pass. At least two controlled business payloads must use the same engine;
normal operation must not depend on the random example.

## Maintainability and scope

Keep code multiline and comment trust decisions, saved-state transitions and
recovery ordering. Avoid comments that repeat statements. Preserve canonical bytes,
wire names and public errors during formatting. Prefer one focused regression over
several assertions about implementation shape.

User's current Wallet internals/version-pair coupling is tracked in the
[distribution plan](plans/user-wallet-distribution.md); do not claim that it is
already a stable independently versioned client. No automatic source downloads are
introduced by repair. Keep private platform experiments outside this repository.
