# Find your Wallet identity and keep a backup

From the User repository, run:

```bash
./run wallet info
```

This reads saved local information without starting/unlocking Wallet or contacting
Market or the chain. It shows your Safe, network, Module, Policy ID, Wallet execution
address, file locations and any saved Market connection. It does not confirm that
an authorization is still valid or a saved website connection is still active.
Missing or unsafe files are reported rather than replaced.

Keep the encrypted Session Key file shown by the command in a secure backup, and
keep its unlock password. A password alone cannot recover a lost Session Key.
Also keep the Safe/network/Module/Policy ID. Back up the full User data directory
to retain private results and transaction recovery records; protect it as sensitive
data. Do not upload key files, passwords or data-directory backups to Market or
send them to support. The command never displays their contents.

On Market, your Wallet cards in Account and Settings provide a Policy ID row.
Use the eye button to show the full value or the copy button to copy it. If browser
clipboard access fails, the value is shown for manual copying. A Policy ID is a
public identifier, not proof of control or spending authority.

## Restore the original identity

After installing compatible User and Wallet code, run from User:

```bash
./run wallet restore
```

If no key is present, choose your original encrypted Session Key backup and enter
its password in Wallet's hidden prompt. For a raw original Session Key, type `key`
and enter it only in the subsequent hidden Wallet prompt; choose a new local unlock
password. Never paste a key into a file-path, website, command argument or support
message. Encrypted backups must be private files owned by you (mode 0600); only the
Wallet's bounded scrypt backup format is supported, not arbitrary wallet exports.

Enter the original network, RPC, Module, Safe and Policy ID from your saved settings.
Wallet checks the chain and original key. Review the identity and confirm to save
its local binding. Existing limits, spent amount and expiry are unchanged. No
owner signature, chain transaction or payment is made. An exhausted Policy may be
restored for identity but cannot fund new purchases.

Existing keys are preserved; another local Policy is never overwritten. A failed
or interrupted bind can be retried with the same command and ID. Missing, revoked,
expired or not-yet-active Policies do not become a fresh authorization automatically.
Use `./run status` afterward, then `./run market connect` if you need website access.
Restoration does not recover lost private results or missing transaction records.

During initial setup, choose `restore` before creating a key. Before budget entry,
press Enter for new spending permission or enter your original Policy ID. A saved
restore draft stays a restore draft; failures cannot submit a new authorization.
The official connectivity purchase is a separate, explicitly confirmed step.

Source verification is complete; participant restoration acceptance is pending.
