# Compatibility retirement review — 2026-11-19

This is the bounded R11 supplement to the completed source review, not a repeated
whole-repository audit. Inspected current public entries, callers, persisted-state
readers and package exports. Public availability is not proof of zero external users.

| Surface | Disposition, evidence and exit condition |
| --- | --- |
| Old local setup locations | Retain: `installation-paths.mjs` reads only the selected source-installation fallback, imports private files without overwrite, and supports existing source-to-npm installations. Exit after a supported migration window and explicit missing-file recovery. |
| Installer lock marker | Retain: `installation-operation.mjs` serializes on a native descriptor lock and recognizes only its own v2 marker. Unknown older writers require review; age/PID guesses cannot authorize concurrent updates. Exit when older installer interoperability is deliberately retired. |
| Old invocation/result shapes | Retain: `invocation-store.mjs` and `runtime-recovery.mjs` preserve request identity and distinguish unverifiable results; they cannot create replacement purchases. Existing local histories are actual consumers. Exit only with an explicit validated data migration. |
| v1 timestamp ingress | Retain: `settlement-response.mjs` delegates to public Protocol validators; this is a read adapter, not relaxed spending authority. Retirement depends on wire and historical data support. |
| Grouped CLI and standalone/source installation | Keep grouped commands; do not restore flat aliases. npm and source entry points have distinct installation ownership but share product operations. Neither warrants deleting the other during review. |
| Native operation locks | Retain: they protect owner operations and installation switching, including interrupted children. No timer may silently release a live writer's exclusion. Linux evidence does not establish other-OS support. |

## Verification and closeout

Existing [static review](mainnet-static-review-2026-11-15.md) remains the R1–R10 evidence. The invocation-store test file passed again using local controlled storage. Earlier process-lock and dual-installation evidence is reused; no installation or paid test was repeated.

R11 is complete with the dispositions above. No new unresolved source blocker or
transaction-design decision was identified. Retained adapters have named consumers
or public compatibility boundaries; they are not unconditional removal TODOs.
Source completion does not publish packages or prove mainnet/deployment acceptance.
