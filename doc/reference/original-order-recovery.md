# Original-Policy and missing-Order recovery — 2026-11-02

## Scope

Runtime starts even when history needs review. Background recovery only performs
bounded authenticated reads; it cannot prepare Orders, submit payment, confirm
receipt, invoke a Provider, or replace the current Policy.

New invocation records save recoveryScope (network, Module, Safe, Policy ID) before
Order preparation. Existing records are never assigned the current Policy merely
because their original scope is missing. Existing saved payment metadata can
supply its original Policy/Safe/network; the configured Module remains pinned and
Wallet independently checks the on-chain Policy delegate against its local key.
Different network/Module/Safe, revocation, future activation or unavailable key
cannot be bypassed. Expiry alone permits bounded historical order.read requests.

## Interfaces

Wallet agent IPC readSettlementOrder accepts exactly one of orderId or
orderRequestId and an optional recoveryScope. No historical payment/action method
is added. Wallet obtains chain identity and Policy terms via its configured RPC,
signs order.read for the original Policy, and leaves policy.json unchanged.

Settlement order.read accepts exactly one selector. Request lookup uses existing
preparation rows scoped by Safe/Policy and joins Orders constrained by Module,
network and chain. It returns found=false with the original request ID, or found=true
with the ordinary buyer Order projection. Missing rows never trigger prepare().
The signed payload hash binds the chosen selector. Original orderId reads remain
unchanged. Auth, nonce consumption and expiry/revocation rules are retained.

Runtime validates returned request ID, request hash, service identity and any
saved payment commitment before attaching a recovered Order ID. The attachment
uses a compare-and-set under the local store lock so a foreground update is not
overwritten. A later scan reads its financial state. A missing lookup is not proof
of no on-chain payment; absent original scope and network errors stay distinct.
Original history is retained. New foreground preparations also pass expectedScope
to Wallet to prevent creating the original request under a different current Policy.

## Verification and deployment boundary

Controlled tests cover historical signing without rebinding, wrong key/revoked/
foreign scope, read-only request selection, unavailable reads, response mismatch,
concurrent attachment, and two business payloads through the common Runtime path.
Wallet TypeScript compiles to a separate temporary build; live dist is untouched.
No SQL schema or contract changes. Deploy Settlement + Wallet + User together, then
restart ordinary-user services and unlock in the terminal. Participant checks of
original history were checked on 2026-11-02: revoked original Policy and missing
original scope remain explicit review. Local archive acceptance remains pending.
No actual purchase is needed for this acceptance.

An existing request lacking both an Order ID and original Policy may still require
manual investigation; this implementation does not fabricate its authorization.

## Inspect and mark local records

```sh
./run orders list
./run orders details <ORDER_OR_REQUEST_ID>
./run orders status <ORDER_OR_REQUEST_ID>
./run orders archive <ORDER_OR_REQUEST_ID>
./run orders unarchive <ORDER_OR_REQUEST_ID>
```

`status` keeps Order warnings brief and directs users to `orders`. The local list
shows saved status and a readable warning for each record, followed by details and
archive/unarchive commands. Unknown payment is never presented as unpaid.

`orders` includes unfinished requests with no saved Order ID. Use a full ID or an
unambiguous prefix (at least 10 hexadecimal characters after `0x`). `details` is
also the default action: it works offline while Wallet is locked. `status` performs
an authenticated read and needs an unlocked Wallet; it does not initiate payment.

Archive asks for a short review note and confirmation. It hides only the warning
matching the saved record and check result. A changed state or problem is shown
again. Notes live in `runtime/invocations.json.reviews.json`, beside the unchanged
invocation history. Unarchive restores the reminder and records the action.

Archive does not cancel an Order, prove payment/nonpayment, revoke authorization,
remove history, or stop work already in flight. It prevents further preparation or
payment submission for that archived request. Background read-only checks continue.
Do not create a replacement request to recover an unknown payment. Notes must not
contain secrets. Concurrent note updates fail closed; if a process is interrupted
while writing, preserve the files and ask support to inspect the review lock before
retrying. Do not delete invocation history to clear a warning.

## Pending structured result persistence

A received, structurally valid Provider result is saved privately in
`runtime/invocations.json.pending-results/` before evidence polling. It cannot be
returned as a verified result until authenticated original-Order identity, output
hash and usage checks pass. Background recovery can perform this read-only promotion;
foreground same-request resume uses the saved copy before service/payment actions.
No service execution or new payment is used to promote a pending copy. An unavailable or mismatched original authorization remains a blocker;
spending expiry/revocation alone does not create replacement-purchase permission. Missing evidence retries with pending
state; mismatch/storage failure preserves the candidate and a distinct warning.
Verified records retain the existing `.results/` format. Both copies remain locally;
this loop does not implement automatic eviction or download files referenced by URL.
