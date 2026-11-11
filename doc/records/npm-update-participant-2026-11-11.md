# Existing npm installation update acceptance

Date: 2026-11-11. Evidence: participant terminal output and website confirmation.

The participant updated a directory-local npm installation through `agentpay update`:
User 0.3.5 to 0.3.6, with matching Wallet 0.3.3. The update repaired service paths,
restarted Wallet and Runtime, and verified official test Skill 1.2.1 against the
built-in SHA-256 without starting a purchase. After deliberate unlock, status
reported Wallet 0.3.3 and Runtime 0.3.6 running, with local history checks complete.

Both saved Orders remained settled. Policy validity, login startup and the locally
saved Market connection remained present. The participant confirmed both Orders
were still visible on the website. The retained result cache listed its original
timestamp and Order association, and details reported the JSON result available
(28-byte content, approximately 3.4 KiB retained storage). No export or independent
byte-by-byte backup comparison was performed. The older Order's missing local
result was already present before updating and was not resolved by this update.

Two usability findings were corrected in source: show installed and target Wallet
versions separately, and clarify full Cache IDs with bounded unique short-ID lookup
for read-only details. Controlled tests passed; these fixes are not in npm 0.3.6.

This accepts the observed existing-installation update and retained records. It
is not fresh-install, interrupted-update recovery, financial reconciliation or
real-network acceptance. No new payment or authorization was required.
