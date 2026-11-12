# Isolated client acceptance — 2026-11-11

Real public npm packages and public CLI processes were used in temporary homes,
installation/state/data directories. No real keys, services, Policies or Orders were
used. Retained sentinel bytes do not establish recovery of a funded transaction.

## Passed

- Fresh User 0.3.7 install resolved Wallet 0.3.3 and Protocol 0.14.3 without sibling
  repositories. CLI worked. Already-current update preserved fixture bytes.
- Unreachable registry stopped before replacing User 0.3.6. Restoring connectivity
  and retrying the same command upgraded to 0.3.7 with fixture bytes intact.
- Real terminal uninstall: cancellation and default removal preserved data; explicit
  delete confirmation removed only selected disposable data, retaining program files.
  No systemd units existed in this isolated home; their removal was not tested.
- Completion lacked directory-local npm removal instructions. Added in source;
  uninstall regression passed. Not yet published.

## Blocking finding

A real updater process group was killed with SIGKILL after printing
“1/3 Check the update requirements.” Program replacement had not begun. All
updater/npm processes in that group ended; fixture bytes remained intact. Retrying
reported another installation may be running. Empty install.lock persisted and
blocked progress. The failed scene and logs are retained; no manual lock removal
was used to pass this check.

The exclusive-create lock is shared by install, update, location writes and
endpoint changes. Repair uses install; uninstall treats lock existence as busy.
Recovery must cover all consumers. Deleting a lock after a timeout is unsafe:
a child npm writer can outlive its parent. Old empty locks cannot prove no writer
exists. Proposed next loop: agree a shared operation-lock lifecycle that preserves
child-writer exclusion, crash recovery and explicit legacy uncertainty handling;
then validate through real process interruption and competing commands.

Fresh setup/authorization, real systemd uninstall, mid-package-replacement recovery
and funded-Order recovery are not established. No production state changed.
