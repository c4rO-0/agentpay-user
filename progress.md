# AgentPay User progress

## User 0.3.25

Running `status` or `health` asks Runtime to retry recent Order connection failures. Concurrent requests share the check. A slow check continues in the background. This version pairs Wallet 0.3.7 with Protocol 0.14.4.

## User 0.3.24 — published 2026-11-19

This version pairs Wallet 0.3.6 with Protocol 0.14.4. Concurrent Policy setup, renewal and revocation now share an operation lock. Runtime handles malformed request targets and rejects unsafe credential file links.

Tag `v0.3.24` points to `32acfc9`. The registry archive matched the tested package byte for byte. A fresh directory-local npm install resolved User 0.3.24, Wallet 0.3.6 and Protocol 0.14.4, and the installed `agentpay help` entry ran successfully. All 485 behavior tests passed on Linux.

## Compatibility supplement — 2026-11-19

Completed R11 consumer/state compatibility review. [Dispositions and evidence](doc/records/compatibility-review-2026-11-19.md). Retained historical recovery and published interfaces have explicit exit conditions; no release or deployment.

Updated 2026-11-16. User runs installed Skills against a local Wallet; it does not
hold the Session Key or own platform transaction rules.

## Current source review

The bounded R1–R10 review is complete. Three defects were corrected: malformed HTTP
targets could stop Runtime, credential initialization could chmod a link target,
and concurrent authorization guides could create distinct renewal plans. The
approved correction serializes setup, renew, revoke, restore and advanced mutation
entries using the existing native-lock dependency. It does not expire locks or
change owner approval, budgets, contract rules or saved request identity.

[Review and evidence limits](doc/records/mainnet-static-review-2026-11-15.md) covers
code, comments, command behavior, dependencies, tests and documentation. Linux is
the verified platform; no macOS/Windows acceptance is claimed. Source corrections
are not an npm release and have not changed participant services or authorizations.

## Published and participant baseline

Participant acceptance below used User 0.3.23, Wallet 0.3.5 and Protocol 0.14.3. The official test used reviewed Skill package 1.2.1.

Participant configured B → A → B switching and updates preserved each installation's
own Wallet/Policy/Orders. Work PC subsequently updated to 0.3.23 and retained its
Market connection and two settled Orders; one historical result is absent locally.
That warning is not a stopped service and does not justify a replacement purchase.
See [participant closeout](doc/records/participant-dual-install-closeout-2026-11-14.md).

## Next closed loops

1. Commit this reviewed source and documentation. Do not push a publication tag
   without authorization.
2. At the coordinated release step, adopt reviewed public Wallet/Protocol versions,
   align the manifest, lockfile and update pair, and verify the installed artifact.
3. Complete selected deployment/participant gates from [TODO](doc/TODO.md) against
   the mainnet launch scope. This review does not add an endless regression stage.

## Earlier evidence

[Progress baseline](doc/archive/review-baseline-progress-2026-11-16.md) and
[TODO baseline](doc/archive/review-baseline-todo-2026-11-16.md) preserve the full
chronology. Old pending labels are not instructions to repeat completed work.
