// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Advisory only: actual Order preparation repeats these checks in Settlement.
export function settlementProfileBlocker(plan, profile) {
  if (
    !profile ||
    !Number.isSafeInteger(profile.chainId) ||
    typeof profile.network !== "string" ||
    ![
      profile.assetAddress,
      profile.factoryAddress,
      profile.registryAddress,
    ].every((value) => typeof value === "string" && ADDRESS.test(value))
  ) {
    return "SETTLEMENT_PROFILE_UNAVAILABLE";
  }
  if (
    profile.chainId !== plan.chainId ||
    profile.network !== `eip155:${plan.chainId}` ||
    profile.assetAddress.toLowerCase() !== plan.token.toLowerCase() ||
    profile.factoryAddress.toLowerCase() !== plan.factory.toLowerCase() ||
    profile.registryAddress.toLowerCase() !== plan.registry.toLowerCase()
  ) {
    return "POLICY_PROFILE_MISMATCH";
  }
  return null;
}
