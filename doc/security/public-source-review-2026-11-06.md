# Public-source preparation review — 2026-11-06

## Completed cleanup

- Original User code and documentation use owner-approved MPL 2.0. LICENSE,
  NOTICE, SECURITY and CONTRIBUTING explain licensing, reporting and contributions.
  The public Protocol artifact and attributed Agent test fixtures retain MIT.
- Removed eleven historical Protocol archives from the publication tree. The one
  required 0.14.1 archive is rebuilt from public Protocol commit `1c6ffab`, with
  provenance, SHA-256, license and matching package-lock integrity.
- Privately archived platform/MySQL harnesses, old operational records and previous
  document snapshots. Removed the unused MySQL dependency. Product onboarding
  scripts remain; script names alone were not grounds for removal.
- Tests use the pinned package's Protocol fixtures and attributed local Skill
  fixtures instead of sibling Agent/Protocol source. User imports its own declared
  ethers dependency; built sibling Wallet remains required.
- Reorganized current documentation by reader and function, rewrote source maps,
  and separated implemented references from the future distribution plan.
- Formatted maintained code and added comments explaining trust, persistence and
  recovery boundaries. No payment, authorization or wire-format redesign was made.

## Verification

Independent verification uses only a temporary User checkout and the built public
Wallet, without private Settlement, Agent or Protocol source checkouts. Offline
`npm ci --ignore-scripts` installed the pinned dependencies successfully.

The complete behavioral suite passed all 364 tests, with zero failures or skips.
Tests exercise controlled local processes, sockets, HTTP boundaries and fixtures;
these are not evidence of real-network payment, desktop login or participant browser
acceptance. The portable approval-page test starts the exported server and checks
actual responses and access restrictions instead of checking source text.

Existing timeout tests were corrected to serve the current pre-purchase offer and
separate status probes from preparation attempts. They still assert bounded timeout,
lock release, the same request after restart and no Wallet call on invalid history.
Grouped-command tests now use the current command surface.

Syntax-tree comparison of 112 production source/script/browser files before and
after formatting found no structural changes (comments and redundant parentheses
excluded). Local Markdown links resolve, and `git diff --check` passes.

## Follow-up documentation review

A second pass found stale per-Policy Market grouping and expired-Policy connection
instructions, along with pre-browser-signing descriptions in several runbooks.
Those guides now use the implemented Wallet tuple and independently verified Policy
scopes, explicit signer selection and the current browser approval flow. Implemented
support remains distinct from uncompleted public-network/multisig acceptance.
README/onboarding/developer prerequisites explicitly include npm and Corepack.
The legacy preview's module comment now points to the public guided setup entry.

This correction changed documentation and comments only. Local links, obsolete-claim
search, JavaScript syntax and `git diff --check` passed; the prior behavioral suite
was not repeated for prose-only edits.

## Security scope and remaining decisions

The bounded current-tree inventory found no literal private key, PEM private key
or GitHub token; credential-bearing URL matches were negative-test fixtures.
This is not a security audit or a guarantee against every secret format. Historical
Git objects are outside this review and must not be assumed clean.

User still imports Wallet compiled internals and enforces an exact update pair.
The supported compatibility boundary and combined release archive remain separate
work in the [distribution plan](../plans/user-wallet-distribution.md).
No automatic source download, service change, payment, history rewrite, push or
public-visibility change was performed. Owner review and the publication/history
steps remain open in [TODO](../TODO.md).
