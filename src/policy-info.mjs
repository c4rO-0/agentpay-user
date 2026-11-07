// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { readAuthorizationStatus } from "./status-panel.mjs";
export async function showPolicyInfo({
  write = console.log,
  resolveDirectory = resolveUserDataDir,
} = {}) {
  try {
    const p = await readAuthorizationStatus(await resolveDirectory());
    write(
      "\n> Spending permission\n  Policy ID: " +
        p.policyId +
        "\n  Valid until: " +
        new Date(p.validUntil * 1000).toLocaleString(),
    );
    write(
      "  Status: " +
        (p.revoked
          ? "Revoked (last verified)"
          : p.validUntil <= Math.floor(Date.now() / 1000)
            ? "Expired"
            : "Within saved validity period"),
    );
    write(
      "\nRenew or change limits: agentpay policy renew\nRevoke permission: agentpay policy revoke\nWallet and network details: agentpay wallet info",
    );
    return 0;
  } catch (e) {
    write(
      e.code === "ENOENT"
        ? "No saved spending permission. Continue agentpay setup."
        : "Could not read the saved permission. Check agentpay wallet info.",
    );
    return 1;
  }
}
