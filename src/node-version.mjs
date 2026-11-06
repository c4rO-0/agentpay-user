// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
export const NODE_REQUIREMENT = "Node 22.22.3 or newer";
export function supportedNodeVersion(version) {
  if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version))
    return false;
  const [major, minor, patch] = version.split(".").map(Number);
  return (
    major > 22 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 3)))
  );
}
