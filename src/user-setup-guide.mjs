// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { runSetupDemo } from "./setup-demo.mjs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function inspectLocalUserSetup(dataDir) {
  async function file(name) {
    try {
      const info = await lstat(join(dataDir, name));
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077
      )
        throw Error("unsafe file");
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw Error(`Unsafe or unreadable local file: ${name}`);
    }
  }
  const walletPresent = await file("wallet/session.keystore.json");
  const callerPresent = await file("runtime/caller.token");
  const policyPresent = await file("wallet/policy.json");
  if (
    callerPresent &&
    !/^[0-9a-f]{64}$/.test(
      (await readFile(join(dataDir, "runtime/caller.token"), "utf8")).trim(),
    )
  )
    throw Error(
      "Existing caller credential is invalid; inspect it without regenerating Wallet identity",
    );
  let delegate = null;
  if (walletPresent) {
    const keystore = JSON.parse(
      await readFile(join(dataDir, "wallet/session.keystore.json"), "utf8"),
    );
    const address = String(keystore.address || "").replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{40}$/.test(address))
      throw Error(
        "Wallet public address is invalid; restore or inspect the existing keystore",
      );
    delegate = `0x${address}`;
  }
  return {
    walletPresent,
    callerPresent,
    policyPresent,
    delegate,
    stage: !walletPresent
      ? "not_initialized"
      : !callerPresent
        ? "partial_setup"
        : "initialized",
    policyStatus: policyPresent
      ? "local_record_present_not_chain_verified"
      : "not_configured",
    runtimeStatus: "not_checked",
    readyToPurchase: false,
  };
}

// Legacy preview entry: local initialization and read-only authorization preview.
// The public agentpay setup command uses runGuidedEntry for the complete flow,
// with explicit external-owner or guarded Anvil signer selection.
export async function runUserSetupGuide({
  ask,
  write,
  check,
  state,
  initialize,
  preview,
  demo = false,
}) {
  if (demo)
    return runSetupDemo({ ask, write, check, state, initialize, preview });
  write(
    "AgentPay · Local Wallet setup and authorization preview. Real setup needs an owner wallet and a Safe on the intended network.",
  );
  let previewed = false;
  while (true) {
    const report = await check();
    if (!report.ok) {
      for (const item of report.checks.filter(
        (item) => item.status === "failed",
      ))
        write(`${item.message}. ${item.fix || ""}`);
      return;
    }
    const local = await state();
    const initialized = local.stage === "initialized";
    const recommended = !initialized
      ? "initialize"
      : previewed || local.policyPresent
        ? null
        : "authorization";
    write(
      `\nYour progress\n  Wallet: ${initialized ? "Initialized" : "Not initialized"}\n  Authorization: ${previewed ? "Preview completed; actual authorization pending" : local.policyPresent ? "Saved locally; chain validity not checked" : "Not configured"}`,
    );
    write(
      `\n------------------------------------------------------------\n> Choose an action\n------------------------------------------------------------\n${[
        [
          "initialize",
          initialized ? "Already completed" : "Create local Wallet",
        ],
        [
          "authorization",
          previewed ? "Review preview again" : "Preview Safe and limits",
        ],
        ["status", "Inspect local state"],
        ["reset", "Credential options"],
        ["update", "Update information"],
        ["uninstall", "Uninstall information"],
        ["q", "Quit"],
      ]
        .map(
          ([name, label]) =>
            `  ${recommended === name ? "*" : " "} '${name}' ${label}${recommended === name ? " ← next step" : ""}`,
        )
        .join("\n")}`,
    );
    const action = (await ask("> ")).trim().toLowerCase();
    if (action === "q") return;
    if (action === "status") {
      write(JSON.stringify(local, null, 2));
      continue;
    }
    if (action === "update") {
      write("Guided updates are not implemented yet.");
      continue;
    }
    if (action === "uninstall") {
      write(
        "To uninstall, quit this guide and run agentpay uninstall. It requires confirmation before deleting local keys and history; Safe permissions remain unchanged.",
      );
      continue;
    }
    if (action === "reset") {
      while (true) {
        write(
          "Reset options: 'change-password', 'rotate-session-key', 'rotate-caller-token', 'back', 'q'.",
        );
        const option = (await ask("> ")).trim().toLowerCase();
        if (option === "q") return;
        if (option === "back") break;
        const explanations = {
          "change-password":
            "Changes encryption; preserves the Session Key and Policy.",
          "rotate-session-key":
            "Replacing the key requires explicit revocation and new owner authorization.",
          "rotate-caller-token":
            "Caller configuration must be updated; the Policy is unchanged.",
        };
        if (explanations[option])
          write(
            `${explanations[option]} Not implemented yet. No key, password, credential or Policy was changed.`,
          );
      }
      continue;
    }
    if (action === "initialize") {
      if (initialized) {
        write("Wallet is already initialized; the existing key is preserved.");
        continue;
      }
      await initialize();
      write("Local initialization complete.");
      continue;
    }
    if (action === "authorization") {
      if (!initialized) {
        write("Choose 'initialize' first.");
        continue;
      }
      try {
        const result = await preview(local.delegate);
        if (result?.mode === "read_only" || result?.mode === "demo") {
          previewed = true;
          write(
            "Owner signing is not implemented in this entry. This preview does not grant permission.",
          );
        }
      } catch (error) {
        if (error.code === "CANCELLED") write("Preview cancelled.");
        else throw error;
      }
    }
  }
}
