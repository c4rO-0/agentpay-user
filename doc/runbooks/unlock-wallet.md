# Lock and unlock Wallet from User

From the User repository, run:

```bash
./run wallet unlock
```

Enter the Wallet unlock secret in the terminal. Input is hidden. The Wallet service
must already be running; this command does not start services, create a key or change
spending permission. Runtime itself does not need unlocking.

Install and successful local initialization remember your User data directory in
`.agentpay-install/state.json` beside the User and Wallet repositories. Lock/unlock
use that location automatically. If no installation location exists, they use
`$HOME/.local/share/agentpay/user`. To temporarily select another:

```bash
./run wallet unlock '/your/User data directory'
```

Selection order: explicit argument, `AGENTPAY_USER_DATA_DIR`, remembered installation,
standard default. A one-off lock/unlock argument does not change the saved location.
Install also reuses the saved location, so retrying Install does not silently switch
back to the standard directory. The record contains only the path and existing
installer checkpoints, never a password. Do not delete this file to recover a Wallet.
Pass the User data directory, not its `wallet` subdirectory. Keep the User and Wallet
repositories side by side and complete installation/build first.

After successful unlock, resume the original Skill request. Do not create a replacement
payment to work around an interrupted request. Existing Policy limits, expiry and
revocation still apply. Unlock success alone does not prove purchase readiness.

Passwords must not appear in command arguments, environment variables or files.
The command inherits your interactive terminal; Wallet owns hidden input and its
existing authenticated local administration call. Runtime does not receive the secret.

## Restart support status

Linux automatic startup and best-effort desktop reminders now have a separate
[management command](local-autostart.md). The terminal installer now offers to enable them after the connectivity test;
real desktop/login/reboot acceptance remains pending. No saved auto-unlock material.

## Lock Wallet

From the User repository:

```bash
./run wallet lock
```

Use the same optional User directory or `AGENTPAY_USER_DATA_DIR` as unlock. Lock
clears the decrypted signing key from Wallet memory. It does not revoke the on-chain
Policy, cancel Orders or reverse already signed/submitted payments.

Both commands check local setup, ownership/permissions and socket presence first.
A leftover socket still may not have a running process; a failed connection remains
an error, not proof that the password is wrong. Wallet public results are rendered
as short messages rather than raw JSON. Unknown failures retain a safe error code.

## Check before unlocking

Run `node scripts/status.mjs` to inspect the running local Wallet without a password.
The same remembered directory and optional override apply. Lock/unlock/status now
probe the socket connection, not only the socket file. A stale file reports that
Wallet is not running before asking for a secret; no socket or data is deleted.
A successful connection does not by itself prove authenticated IPC works; later
Wallet errors remain visible as concise results with a safe error code.
