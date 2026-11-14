# Official test deployment mapping

User's reviewed release owns the executable trust anchor. Market supplies download
locations and public deployment facts, but cannot add a trusted package or override
its SHA-256. The maintained mapping is `OFFICIAL_TEST_DEPLOYMENTS` in
`src/official-test-package.mjs`; currently only the existing private-Anvil deployment
has a reviewed package. This does not establish public-network acceptance.

A maintainer adds a supported network by reviewing its official Provider registration
and service reference, publishing the official package, checking its exact ZIP,
and including that package's name/version/SHA-256 under the network in a reviewed
User release. The normal shared invocation/payment implementation does not change.
Package input/output validation stays in the official example Skill/Provider.

Setup, package preparation and the paid test use this mapping rather than a
chain-ID permission branch. The paid test also verifies that Wallet, quote and
package service reference agree on network, asset and service identity. Installation
checks reject an untrusted requested digest before download; metadata and raw bytes
are independently checked against the release-selected package.

Public deployment settings may omit the entire official mapping (metadata URL,
ZIP SHA-256 and one-unit test setting). A partial mapping is invalid. Without a
matching reviewed test, generic Wallet/Runtime setup can complete and start services;
the terminal explicitly states that no official paid test was performed. It never
substitutes another network's package or requires a third-party Skill. Repair/update
without a known supported network likewise preserves files and reports unavailable.

Old test checkpoints and installed package files remain available for their original
recovery path. Completing generic setup does not delete, replace or pay for an old
test. Network changes never rewrite original Order/Policy identity or authorize
another purchase. A new network needs a reviewed package/release and explicit
network acceptance; configuration alone cannot grant executable trust.
