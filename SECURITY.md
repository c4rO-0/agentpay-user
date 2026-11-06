# Security reports

Report suspected vulnerabilities privately to **agentpay@mail.c4r.fun**. Include
User/Wallet versions, the affected interface and reproducible steps using disposable
data. Do not post keys, passwords, tokens, signed payments or private Order inputs
in public issues. Do not send them to support either.

User Runtime coordinates purchases; Wallet owns the Session Key and Safe enforces
on-chain permission. A local caller token is not a sandbox against code running
as the same operating-system user. Private Anvil tests do not establish real-funds
safety or a completed security audit.

If a key or computer may be compromised, use a trusted device and your Safe owner
wallet to stop payment permission. See [emergency instructions](doc/runbooks/emergency-payment-stop.md).
Deleting User, disconnecting Market or stopping a process does not revoke on-chain
authorization.
