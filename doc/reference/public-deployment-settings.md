# Public deployment settings and owner signer

## Public facts

User settings published by Market retain the existing fields: mode, chainId,
source, rpcUrl, settlementUrl, module, token, factory, registry, tokenDecimals,
tokenSymbol and the official-test metadata URL/digest/usage fields.
Supported mode labels are private-anvil and production; neither chooses a signer.
chainId must be a positive safe integer. HTTPS and loopback HTTP are permitted;
URL credentials, queries and fragments are rejected. Token decimals are 0–36.
Addresses must be valid nonzero EVM addresses. No participant Safe, owner, secret
or ownerSigner is accepted in the public User settings.

Provider settings retain network as eip155:<chainId> and assetAddress rather than
renaming their existing wire fields. Their numeric network and token constraints
match User settings. The Provider no longer defaults missing network to 31337.
This aligns the role-specific projections; it does not add a Protocol wire version
or claim the deployment scripts already generate one authoritative manifest.

Official package metadata remains release-pinned by User. Accepting another
network configuration never authorizes a substituted executable package.

## Local signer selection

Owner signing is selected independently of network:
- external: prepare operations for the Safe owner; never call an unlocked test account.
- anvil: explicit private test adapter; still requires chain 31337 and loopback HTTP.
  The adapter also verifies the actual RPC chain and single-owner test Safe.

The initial private guide asks for this choice (default external) and saves it in
its local settings. When the participant confirms owner operations, it persists
runtime/owner-signer.json inside the User data directory as a private file:
`{"version":1,"kind":"external"}` or `{"version":1,"kind":"anvil"}`.
Renew/revoke read this local choice. AGENTPAY_OWNER_SIGNER can explicitly override
it for the current process. No record means external; existing installations are
not silently opted into test signing based on chain ID.

For an existing private installation with no saved selection, an operator may use
`AGENTPAY_OWNER_SIGNER=anvil ./run policy renew` (or revoke) only when that actual
authorization change is intended. Do not run either command merely to configure
the signer. No local Wallet Policy/key/history is changed by reading the selection.

## Implemented approval and remaining acceptance

The common setup runner accepts configured EVM networks and uses the same draft,
plan, chain checks and Wallet binding. Its historical module/local settings filename
is retained for checkpoint continuity. External approval serves a temporary local
website for an injected owner wallet, with a portable export fallback. Setup, renewal
and revocation retain their operation plans and check actual chain effects before
continuing. An external signer can be selected on Anvil. See
[browser approval](../runbooks/safe-owner-web.md) for execution and recovery.
Single-owner private Anvil acceptance does not prove multisig, headless recovery or
public-network readiness; those acceptance gates remain in [TODO](../TODO.md).

The official test package/network map is still private-only. Another network pauses
before that package installation after retaining its verified authorization.
