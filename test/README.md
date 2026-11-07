# User behavior tests

From User, after `npm ci`:

```sh
npm test
```

The default command runs test files sequentially. Focus a change with:

```sh
node --test test/runtime-client.test.mjs test/multi-service-runtime.test.mjs
node --test test/owner-approval-server.test.mjs test/owner-approval-browser.test.mjs
```

Protocol is installed from npm. Installation/repair fixtures intentionally have no
`vendor` directory; the pair checks reject an older Protocol version or archive-based
Wallet dependency. No private platform repository, database or real-chain setup is required. Wallet is installed from npm; some suites start its public CLI and use real IPC. This is not
the same as the explicitly paid `agentpay payment test` command.

## Find coverage

| Feature | Suites |
| --- | --- |
| CLI and local state | `user-cli`, `run-launcher`, `local-info`, `local-data-directory`, `status-panel`, `unlock`, `wallet-ipc-error` |
| Installation and guided setup | `install-*`, `prepare-*`, `guided-setup`, `user-setup-guide`, `setup-local`, `anvil-onboarding*`, `demo-*`, `authorization-question-checkpoint` |
| Services and repair | `local-services*`, `local-update`, `setup-autostart`, `autostart-cli`, `repair-market-wallet`, `uninstall-local` |
| Owner and permission | `owner-*`, `safe-policy-plan`, `policy-*`, `renew-policy`, `restore-wallet`, `deployment-status` |
| Invocation and recovery | `multi-service-runtime`, `runtime-client`, `runtime-recovery`, `runtime-connection-settings`, `invocation-store`, `invocation-result`, `transport-timeout` |
| Caller and service boundary | `caller-auth`, `http-caller-auth`, `service-client`, `service-prefix`, `provider-public-prefix`, `readiness-profile`, `settlement-response`, `finalization-disclosure` |
| Orders and Market | `connect-market`, `local-wallet-ipc`, `order-*`, `unpaid-expiry` |
| Files and cache | `cache-foundation`, `file-*`, `result-cache-view` |
| Packages and official test | `active-skill`, `skill-*`, `official-*` |

Names above omit `.test.mjs`. Read a suite's setup before interpreting its result.
Real process restart is exercised by `multi-service-runtime`; its Wallet/Provider
and platform responses are controlled fixtures. Different business payloads traverse
the same engine. Tests do not establish real chain funding or Provider delivery.

## Evidence levels

- Pure boundary tests protect hashes, schemas, amounts, authority and exact request
  identity. Their value is a specific invariant, not copying implementation shape.
- Simulated command/package-manager flows verify decisions and preserved state;
  they do not prove a fresh install, a systemd login or real owner signing.
- Local process/socket tests verify actual entry/transport/storage behavior against
  controlled dependencies. Browser tests use a controlled DOM/wallet environment,
  not an installed browser extension. Portable-export tests run the emitted Node
  server and exercise its HTTP access rules.
- Files deliberately prepared in an invalid/partial state are recovery regressions,
  not evidence of a real crash at that write. The explicit fault loader injects
  exits only into the test Runtime process; it is never loaded in normal startup.
- Participant installation, login/reboot, multisig, public-network and exact financial
  reconciliation require separately scoped acceptance.

## Review and maintenance rules

Prefer a complete observable path over assertions about internal calls. Keep
negative capability, signature, amount, time and cross-Order checks even when a
happy path is also covered. Assert that rejected/retried requests do not create a
new purchase or lose the original identity.

HTTP/IPC fixtures should dispatch by action, not by global request number: startup
checks may legitimately interleave with a purchase. For an interrupted purchase,
count that action's attempts and compare its original request ID. Avoid sleeps as
synchronization when a process event or response can establish the state.

Tests of generated pages should execute or serve them where practical. Checking
that a file contains a string is not proof that the page works. Inspecting exported
content for leaked secrets remains a valid separate security assertion.

Use temporary data, ephemeral loopback ports and cleanup on failure. Do not add
production test flags, private deployment scripts, database manipulation or live
credentials. `fixtures/README.md` documents the local reference package and its
MIT license; its bytes are not production trusted-package metadata.

## Public-source review changes

The initial independent run exposed obsolete flat-command Help expectations and a
Wallet fixture that counted startup status as preparation. These were corrected
against the current grouped commands and action-scoped behavior. The portable-page
test now executes the exported server instead of merely checking source strings.
No product authority was relaxed to make tests pass. Current verification results
are in [the source review](../doc/security/public-source-review-2026-11-06.md).
