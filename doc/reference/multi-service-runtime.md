# Local multi-service Runtime contract

Current local interface; the Protocol dependency is pinned in package.json. This is a local
User interface, never a public platform listener. One Runtime routes many services
without installing a global active package for each call. The caller credential
is local and distinct from Wallet's Agent IPC capability. Wallet retains the key.

## Service reference and trust

A manifest's service object uses agentpay.service-reference.v1 with skillId,
profileHash, profile and adapter. Protocol's normalizeServiceReference verifies
profileHash over the exact canonical public profile: Provider/service identity,
controlled MCP/payment endpoints, seller, network and asset. References have no
price or actual usage fields. Wallet/Settlement/Module independently enforce
Registry qualification and bounded authorization; a matching profile hash alone
does not grant admission or certify quality.

The common agentpay.json.v1 transport carries Protocol invocation/result metadata
and application-owned JSON. Runtime has no business-specific adapter. Runtime does
not download or execute caller-provided adapter code. Arbitrary HTTP, binary or
streaming APIs need an explicit integration; JSON may contain application-level
artifact references, whose actual bytes need their own business validation.

## Local endpoints

All POSTs require Authorization: Bearer <local caller credential>. Reject before
parsing or touching Wallet when authentication fails.

POST /services/check accepts exactly {service}. It verifies the reference and
returns Runtime identity, the normalized reference, orderCreated=false and
purchaseReadinessChecked=false. It performs no Order, Wallet signature, online
qualification, balance or Quote reservation. Never describe it as payment readiness.

POST /services/invoke uses an Idempotency-Key and exactly:

```json
{
  "version": "agentpay.runtime-call.v1",
  "service": "<the complete service-reference object>",
  "request": {"text": "your private business input"},
  "requestedMaxUsageUnits": "1"
}
```

The service field above is an object, abbreviated as a string only in this
illustration. Input is bounded JSON: 256 KiB, depth 32. Requested usage is a
positive integer string and an upper bound, not a price or actual meter. The
local AGENTPAY_USER_MAX_REQUEST_USAGE_UNITS cap defaults to 1000000. Settlement
also constrains preparation by the authoritative Quote and Wallet's Policy.
Unknown top-level fields, including caller prices or payout overrides, fail.

Runtime hashes the canonical private input, prepares through Wallet, compares the
Order tuple/provider/network/asset/seller/usage with the profile before signing,
then uses the existing narrow commitment/payment/service-ready flow. It forwards
private JSON only to the bound Provider payment endpoint, refusing redirects.
Provider result orderId/requestHash/outputHash/usage must match the invocation and
accepted Settlement delivery evidence. Output hash verifies bytes, not quality.

The result version is agentpay.runtime-result.v1, with orderId, requestHash,
service {skillId, profileHash}, JSON output, outputHash, usageUnits,
deliveryEvidenceVerified, confirmationRequired, finalization and deadlines.
Settlement deadlines remain epoch milliseconds, with frozen chain-seconds fields
preserved by existing normalizers. Do not recompute schedules locally.

## Durable recovery

The existing invocation store remains one serialized ledger, with per-call
serviceBinding and routingVersion on new generic entries. The same Idempotency-Key
cannot switch service, adapter, input or usage cap; old random entry identifiers
are not reinterpreted. Startup retains older requests for read-only reconciliation and explicit review.
They cannot create replacement purchases. Current entries are checked against their
own reference on every begin.

Verified results are fsynced before HTTP success under <state-file>.results,
owner-held mode 0600 in a 0700 directory. The Runtime returns saved output after
restart without another Wallet/Provider call. The shared client separately retains
request checkpoints and verified output. Neither layer stores Service Authorization
plaintext. Signed payment recovery material keeps its existing private boundary.

Default calls recover the matching current request or reuse its verified result.
--force explicitly starts another independent request, preserving old records.
Adapter/usage edits are not silently considered new intent: the old full binding
rejects the change unless explicitly forced. Force never bypasses Policy or Quote
checks. When several unfinished forced requests make recovery ambiguous, stop;
select a recorded identifier diagnostically. After a forced request succeeds,
default repeats reuse that result rather than unexpectedly funding older work.

Runtime has no selected service and does not load active-skill.json at startup.
That retained filename is only the official test material checkpoint. Its legacy
selection format must not be treated as general Runtime configuration. New test
checkpoints record routingVersion; older test requests pause for explicit recovery
review and are never reinterpreted as new generic purchases. The old random route
is removed. Deployment must gate on pending older requests and update User/Agent,
matching types and official package together. No silent state reset is allowed.

The invocation ledger is owned by one Runtime process. Multiple processes must
not share its state file. The result is a delivery-time snapshot, not a continuously
updated finalization/payout status.

## Packaging and release

Use the publisher template: change package metadata, copy a registered Provider
reference, edit local validateRequest, business JSON and result.output handling.
Validate business input before any payment; Protocol JSON bounds are not a domain
schema. The shared User client does transport, credentials and recovery. A Skill
calling several services retains each step's input and resumes earlier paid steps.
All eligible calls share the existing bounded Policy; no new owner signature is
required merely because another qualified service is used.

The maintained template is published by AgentPay Agent and discovered by Market.
User's official executable test package has an independently pinned digest; template
availability does not authorize replacing that package. See
[official package maintenance](../runbooks/official-test-package.md).
Actual harness discovery and scoped deployed purchases need separate acceptance;
component tests with simulated Wallet evidence are not that.

Older routing records are preserved and shown for review without preventing the
Runtime process from starting. Invalid/corrupt history can still block paid activity.
Do not reset state or create replacement purchases to bypass an unresolved record.
