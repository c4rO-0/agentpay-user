# AgentPay User progress

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

Published User is 0.3.23, paired with Wallet 0.3.5 and Protocol 0.14.3. Package/tag
and npm archive checks were recorded before this review; the dependency pins remain
unchanged. The official test uses reviewed package 1.2.1. Review corrections in
Wallet and Protocol still require authorized releases before User adopts them.

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
