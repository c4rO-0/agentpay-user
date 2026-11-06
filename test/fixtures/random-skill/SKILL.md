---
name: agentpay-random
description: Obtain a paid random integer through the user's local AgentPay Runtime.
---

# Random integer

Use this Skill when the user needs one integer in an inclusive range. Input must
satisfy `0 <= min <= max <= 1000000000`. The Provider generates the result;
this Skill does not generate a substitute locally.

Requires Node.js >=22.22.3 and a configured local AgentPay User Runtime/Wallet
with an unlocked Wallet and an active bounded Policy. AgentPay setup saves the
local connection; the wrapper loads its shared client from the installed User
repository. Keep that repository in place. For a non-default private User data
directory, set `AGENTPAY_USER_DATA_DIR` locally. Never read or paste caller tokens,
Provider credentials, Wallet keys or unlock secrets into the conversation.

Resolve commands below relative to this installed Skill's directory, regardless
of the harness's current workspace. Do not assume `scripts/` is in the workspace.

Inspect the package's `agentpay.json` service reference before using it.
Check local connectivity and service identity without purchasing:

```bash
node scripts/random.mjs --check
```

Call with the requested range. Matching unfinished work resumes automatically;
if a verified result already exists, it is returned without another payment:

```bash
node scripts/random.mjs --invoke 1 100
```

If the user deliberately requests another independent result with the same input,
use --force. It creates a new request and may pay again:

```bash
node scripts/random.mjs --invoke 1 100 --force
```

Never add --force or change input to recover a failure. The saved identifier is
reported on stderr and in JSON. --resume <saved-request-id> is a diagnostic option
for choosing one specific request, including when several unfinished requests
match after forced calls. If selection is ambiguous, stop rather than guess.

The script prints the Runtime JSON response, including the verified random
result on success. Price is resolved by Settlement at purchase time; this
package pins no price. The existing User Policy bounds payment, without another
routine owner signature. Installation and --check do not authorize or make a
purchase. --check is only a Runtime identity check, not full payment readiness.

On timeout or an uncertain result, repeat the original command without --force.
Never create a new identifier merely to recover from an error. Fix unavailable
Runtime, locked Wallet or Policy conditions before retrying. A deliberate new
purchase with the same input requires --force. Preserve the installed package version during
an unfinished invocation. Returning a result does not automatically acknowledge
receipt; receipt acknowledgement remains a separate user-side action.

This is a normal local script, not a sandbox. You may inspect and modify it;
local modifications are separate from the original publisher's release. Payment
eligibility remains enforced independently by Wallet and Settlement.

Read the current price and maximum delivery duration with `--quote`. To require
those exact conditions, pass `--accept-terms` JSON containing baseAmountAtomic,
unitPriceAtomic and serviceWindowSeconds. A Quote rejection happens before Order
creation: reevaluate the current offer and continue the same request. Transport
errors do not permit changing accepted conditions or replacing a purchase.

## Saved input and result

This version requires the User shared client capabilities `input-snapshots-v1`,
`output-files-v1` and `original-request-v1`. If asked to update User, do that before
retrying; do not bypass the capability check. The Skill package is not the Runtime.

User saves the validated JSON input before invocation and persists verified JSON
results. Random has no input or output files; its file hooks intentionally return
empty lists. Repeat the same command without `--force` to recover the original
request or reuse its saved result. Cache and Order history are managed by User,
not files beside this installed Skill. Do not remove history to force a retry.
