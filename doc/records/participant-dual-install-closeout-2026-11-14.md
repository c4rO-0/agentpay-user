# Participant two-installation acceptance — 2026-11-14

## Scope and evidence

The participant used public commands from two folder-local npm installations on
one Linux desktop, with real user systemd Wallet/Runtime services. Evidence is the
participant's terminal output supplied during the rehearsal, not a byte-level audit
of all private files. Both installations ultimately reported User 0.3.21 and Wallet
0.3.5. The private Anvil RPC still required the participant's SSH tunnel.

## Observed results

| Check | Installation A | Installation B |
| --- | --- | --- |
| Saved Wallet | Original identity and Market nickname retained | Separate identity and Market connection retained |
| Policy expiry | 2027-05-04 | 2027-05-12 |
| Order history | 2 saved, 2 settled, 0 waiting | 1 saved, 1 settled, 0 waiting |
| Services | Wallet unlocked, Runtime running, history check complete | Wallet unlocked, Runtime running, history check complete |
| Login startup | Both services enabled | Both services enabled |
| Final software | User 0.3.21 / Wallet 0.3.5 | User 0.3.21 / Wallet 0.3.5 |

The participant switched from configured B back to A through `service start`,
confirmed A's original data folder and execution identity using `wallet info`,
then returned to B and updated it. Both final status reports showed the expected
separate histories and original permissions. This closes the configured B → A → B
participant switching and update check; it does not assert that both pairs can run
simultaneously. Only the selected installation runs the managed pair.

A's full health report passed RPC/chain ID, all configured contracts, Safe ownership,
Module enablement, Policy read, local services and both platform HTTP probes.
B's final status was healthy; a separate full B health report was not supplied.

## Problems resolved and remaining limits

- A disconnected SSH tunnel initially prevented RPC reads. Restoring it allowed
  background checks to recover without a replacement purchase.
- Health formerly missed RPC settings when Setup projection files were absent.
  User 0.3.21 reads the Wallet binding's RPC as fallback; A's actual health run
  verified the chain checks now execute.
- Intermittent platform failures were observed, but their exact network cause was
  not established. User 0.3.21 increases the request bound, preserves safe error
  categories and shortens negative-cache time. A's final deployment check passed;
  this does not prove intermittent failures can never recur.
- A retains one historical settled Order with no verified result on this device.
  Its result has not been recovered. Do not pay again to obtain it. The clearer
  status/list wording is a source-only follow-up after 0.3.21.

No new payment, authorization or data deletion was requested for this switching
closeout. The earlier official paid setup test is separate evidence. There was no
new reboot/desktop-login test, real-network acceptance or independent cryptographic
audit of every saved file. Nickname negative-input participant acceptance remains
open; controlled regression tests are already recorded separately.
