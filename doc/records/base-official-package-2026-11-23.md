# Base official payment-test package — 2026-11-23

Source now maps Base chain 8453 to official random Skill 1.2.2, ZIP SHA-256
`f49b96168a58cf3fa897c584a0ca1155d688fa13e2fd08a7fb168f4676111a73`.
The original Anvil 31337 / 1.2.1 mapping is retained. No Wallet, Policy, selected
package or previous payment-test record is migrated by this change.

## Package review

The published Market fixed-version ZIP is 5,483 bytes and matches the Provider's
original archive byte for byte. Its three instruction/script files match the
reviewed Agent source. The manifest references the existing official Base service
and USDC asset; it was checked against the service reference. No scripts were
executed during package inspection. The only runtime code change is the reviewed
network-to-package mapping; generic routing, authorization and payment are unchanged.

## Evidence

17 targeted tests passed: release pin enforcement, cross-network rejection,
substituted metadata/bytes, fixed-version failures, original-request recovery and
explicit payment confirmation. Paid-test tests use controlled dependencies;
they do not submit a real payment.

The normal preparation function downloaded the real published ZIP into disposable
private storage, installed it and verified it again without network access. Saved
history and selection sentinels remained byte-identical. The directory was removed
afterward. No service, key, authorization or Order was created.

README now introduces the official Market and separates installation, daily use,
data ownership and contributor links. Wallet's README offers the same official
entry while retaining its standalone integration role. Editorial/link review is
separate from financial acceptance.

## Pending

A reviewed User release must distribute the new mapping. Market's public installation
configuration must supply the matching official Skill metadata URL. The website
guide changes need deployment. Participant installation/authorization and the first
Base payment will be performed on the operator's other computer, using normal
product commands and explicit consent. No automatic network migration is intended.
