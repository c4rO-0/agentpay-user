# Independent User and Wallet distribution

Approved direction: 2026-11-06. Planning only; current installation and version
checks have not yet changed.

## Product and repository boundaries

Keep User and Wallet in separate repositories, processes and releases. Wallet is
the bounded signing service; User owns AgentPay onboarding and Skill orchestration.
Wallet must remain independently usable. Do not merge repositories or introduce
submodules as an installation requirement.

## Installation choices

Ordinary users download one combined ZIP attached to a User release. Packaging
selects reviewed User and Wallet commits and records their independent versions,
commit IDs and integrity information. The extracted directory contains sibling
`user/` and `wallet/` folders; it contains no keys, local state or credentials.
Continue to require Node for this stage; platform binaries are a later decision.

Git users create one directory of their choice, clone agentpay-user into `user`
and agentpay-wallet into `wallet`, then run `./run install --market MARKET_URL`
from User. Do not require manual selection of a pair of identically named tags.
Current relative imports require these sibling names. Document the layout until
implementation deliberately removes that dependency.

## Compatibility, not equal release numbers

User declares the supported Wallet interface/version requirements. Compatible
independent versions may be used together. Tags identify stable releases, but
are not a substitute for checking compatibility. A newer version is not
necessarily compatible, and a declared version cannot prove arbitrary main-branch
code is bug-free. Maintain usable main branches and verify release combinations.

Check compatibility before installation changes, before repair pauses services,
and at startup before enabling incompatible operations. Distinguish source,
built executable and running service identities. Missing/unsupported metadata
must produce a concrete instruction identifying the component to update, never
an implicit latest-version download or a new payment. Preserve original keys,
Policies, Order history and recovery records. An incompatible process must not be
trusted for signing; retain local diagnostic access.

The current exact `update-pair.json` equality checks are implementation debt, not
the approved long-term contract. Define the smallest public Wallet client/IPC
boundary and supported range/capability semantics before replacing them. Avoid
unbounded capability lists or a new general update service. Do not add generic
signing or make Wallet dependent on User. `repair` continues to apply downloaded
local code; this decision does not authorize automatic code replacement.

## Implementation order and verification

1. Audit both current source trees, tracked archives, license/security notices,
   standalone docs and test/CI prerequisites before opening repositories.
2. Inventory User imports of Wallet internals, CLI and third-party dependency paths;
   specify the supported client/IPC boundary and source/build/running checks.
3. Implement compatibility checks and preserve useful error/recovery guidance.
   Test supported unequal versions, unsupported/missing versions, stale builds and
   stale running processes without replacing requests or spending authority.
4. Generate the combined archive from explicit reviewed commits, keeping Wallet
   independently distributable. Verify integrity, licenses, exclusions and layout.
5. Verify fresh combined-ZIP and Git installations, repair and failure recovery;
   update Market download guidance only when the actual artifacts are available.

No public visibility, history rewrite, package publication, service changes or
new paid acceptance is authorized by this plan. Each requires its applicable scope.
