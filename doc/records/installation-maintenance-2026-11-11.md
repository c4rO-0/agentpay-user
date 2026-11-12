# Installation maintenance verification — 2026-11-11

This record covers working-tree changes; no release or participant service was changed.

## Behavior checked

- Inactive npm update and repair preserve the selected service pair and private data.
  Controlled npm metadata and systemctl responses isolate this orchestration check.
- Independent processes cannot enter maintenance while a writer holds the shared
  lock. Killing the caller with SIGKILL leaves its real child writer protected.
  After that child exits, another process succeeds without manual lock deletion.
- A short-lived administration child can inherit the lock; unrelated processes
  remain excluded. Command timeout waits for child closure before returning.
- Interrupted update after npm success still resumes repair. Retry retains the
  confirmed version; successful completion removes the recovery checkpoint.
- Uninstall preserves another installation's units, rejects shared active data,
  rechecks confirmation, supports partial-unit retry and recognizes v2 recovery.
- Installation bindings, address updates and service selection use the same
  maintenance boundary. Trailing path separators do not cause a false switch.

The final combined run passed 77 targeted checks. A subsequent marker-publication
interruption check also passed, along with the three existing process-lock checks.
Targeted suites cover installation-maintenance, npm-update, local-update,
local-data-directory, uninstall-local, service-selection and platform-endpoints.
Installation entry suites also cover install-user, install-and-setup,
install-selection, setup-service-selection and setup-autostart. Tests use private
throwaway directories; real process-lock evidence does not imply real systemd
or financial acceptance.

An independent offline `npm ci --ignore-scripts --no-audit --no-fund` installed the
pinned packages. Wallet 0.3.3, Protocol 0.14.3's public ESM entry and native locking
loaded successfully. The initial diagnostic incorrectly used require/package.json
against Protocol's ESM export map; the corrected ESM import succeeded. Worktree
installation tests initially found an older Wallet dependency; they passed in an
isolated copy using the correct dependencies. Existing worktree dependencies were
not changed to make tests pass.

## Limits and next gates

The maintenance lock serializes administrative writes across installations. Runtime
service operation continues during inactive maintenance. Unknown legacy installer
locks remain blocked, not automatically deleted. Direct external npm/file changes
are outside this coordination. Uninstall still refuses an occupied port whose owner
cannot be confirmed. Historical Skill requests are not retroactively scoped by this
work. Complete two-install systemd switching/login, actual package-update interruption
and participant acceptance remain required before rollout.
