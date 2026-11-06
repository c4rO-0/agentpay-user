# Update spending permission after contract changes

Run `./run setup` or `./run policy renew`. Both check the published deployment and
explain a mismatch before owner transactions. An existing Market connection supplies
the HTTPS (or private loopback) configuration source. Without one, the guide can
use the public deployment file downloaded by installation. `status` labels this
as downloaded evidence rather than a current platform check.

Review updated permission, using `details` to inspect old/new contracts. Factory and
Module changes are supported within the same network, Safe, execution key, token,
Registry and RPC. Network/token/Registry moves require separate review. Removing a
Module as an emergency stop is not silently undone by an ordinary renewal.

An update defaults to unspent allowance. Exhausted allowance has no automatic new
budget default. Remaining validity supplies the duration default; retaining that
default preserves the original expiry. Editing budget or duration deliberately
requests new limits, which the owner reviews before signing. Ordinary renewal
continues to offer a new budget and duration. No service-specific logic is involved.

Owner approval revokes the original Policy before creating its replacement, enabling
the destination Module if required. Wallet independently checks original revocation,
matching identity, destination chain data and zero destination spend before binding.
Original Policy scope and Orders remain in history. Temporary failure or leaving the
webpage resumes the saved plan; do not delete records or create replacement purchases.
A completed chain/binding operation with unfinished local synchronization retries
that synchronization before a subsequent fresh renewal.

After successful binding, setup settings/public Policy/draft projections are updated.
Previous setup/draft files are retained privately. Existing Market connection flow
continues; failure there does not undo authorization. No automatic login or new
spending authority is granted by merely downloading deployment settings.

`./run status` shares a 60-second success/error cache for deployment checks. A changed
deployment takes priority over local missing-result warnings; Orders retain their
warnings below. A failed check is unavailable, never healthy or proof of revocation.
Matching deployment does not guarantee a particular service or Order can be bought.

Development checks use controlled RPC/IPC fixtures. The recorded private participant
MetaMask renewal, payment journey and historical Order viewing passed within their
recorded scope. Full interruption/multisig and public-network acceptance remain
separate tasks in [TODO](../TODO.md); viewing history does not prove every support
mutation. No real-network compatibility is claimed by Anvil tests.
