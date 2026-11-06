// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { getAddress } from "ethers";
import { readFile, open, unlink } from "node:fs/promises";
const fields = [
  "mode",
  "chainId",
  "source",
  "rpcUrl",
  "module",
  "token",
  "factory",
  "registry",
  "tokenDecimals",
  "tokenSymbol",
  "settlementUrl",
  "marketBundleMetadataUrl",
  "bundleSha256",
  "maxUsageUnits",
];
export function validatePublicDeployment(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw Error(
      "Use the public User deployment file from Market; it must not contain participant data.",
    );
  if (
    !["private-anvil", "production"].includes(input.mode) ||
    !Number.isSafeInteger(input.chainId) ||
    input.chainId < 1
  )
    throw Error("Invalid deployment mode or chain ID.");
  for (const key of ["rpcUrl", "settlementUrl", "marketBundleMetadataUrl"]) {
    const u = new URL(input[key]);
    if (
      !(
        u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
      ) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw Error("Deployment URLs require HTTPS or loopback HTTP.");
    if (
      key === "marketBundleMetadataUrl" &&
      !/^\/(?:market\/)?skills\/bundles\/[^/]+\/metadata$/.test(u.pathname)
    )
      throw Error("Invalid test package URL.");
  }
  for (const key of ["module", "token", "factory", "registry"])
    if (getAddress(input[key]) === "0x" + "0".repeat(40))
      throw Error("Invalid contract address.");
  if (
    !Number.isInteger(input.tokenDecimals) ||
    input.tokenDecimals < 0 ||
    input.tokenDecimals > 36 ||
    typeof input.tokenSymbol !== "string" ||
    !/^[A-Za-z0-9_-]{1,20}$/.test(input.tokenSymbol) ||
    !/^[a-f0-9]{64}$/.test(input.bundleSha256) ||
    input.maxUsageUnits !== 1 ||
    typeof input.source !== "string" ||
    !input.source.trim()
  )
    throw Error("Invalid token or test package settings.");
  return Object.fromEntries(fields.map((key) => [key, input[key]]));
}
export async function prepareOnboarding({
  inputPath,
  outputPath,
  ask,
  write,
  continueAutomatically = false,
}) {
  const raw = await readFile(inputPath);
  if (raw.length > 16384) throw Error("Deployment file is too large.");
  const deployment = validatePublicDeployment(JSON.parse(raw.toString("utf8")));
  // Exclusive creation also rejects a symlink or existing participant configuration.
  const file = await open(outputPath, "wx", 0o600);
  let saved = false;
  try {
    const section = (title) =>
      write(
        `\n------------------------------------------------------------\n> ${title}\n------------------------------------------------------------`,
      );
    section("Local settings");
    write(
      `Network: eip155:${deployment.chainId}. Type 'q' at any input to cancel.`,
    );
    async function field(prompt, parse, error) {
      for (;;) {
        const value = (await ask(prompt)).trim();
        if (value.toLowerCase() === "q")
          throw Error("Cancelled; no configuration saved.");
        try {
          return parse(value);
        } catch {
          write(error);
        }
      }
    }
    const address = (value) => {
      const result = getAddress(value);
      if (result === "0x" + "0".repeat(40)) throw Error();
      return result;
    };
    section("1/3 · Safe");
    write(
      "The Safe holds your purchase funds. Enter its account address on the network shown above.",
    );
    const safe = await field(
      "Safe account address (0x…)",
      address,
      "Enter a valid Safe address: 0x followed by 40 hexadecimal characters.",
    );
    section("2/3 · Safe owner");
    write(
      "The owner is a wallet allowed to approve actions for the Safe. It has its own address.",
    );
    write(
      "Enter a public address of one Safe owner. Approval still requires the configured Safe signature threshold.",
    );
    const ownerAddress = await field(
      "Safe owner address (0x…)",
      (value) => {
        const a = address(value);
        if (a === safe) throw Error();
        return a;
      },
      "Enter a valid owner address, different from the Safe address.",
    );
    section("Owner approval");
    write(
      "Choose how to approve Safe operations. External uses your own wallet; anvil uses the prepared private test owner.",
    );
    const ownerSigner = await field(
      "Owner signer: external or anvil (Enter for external)",
      (v) => {
        v = v || "external";
        if (
          !["external", "anvil"].includes(v) ||
          (v === "anvil" &&
            (deployment.chainId !== 31337 ||
              new URL(deployment.rpcUrl).protocol !== "http:" ||
              !["127.0.0.1", "localhost", "[::1]"].includes(
                new URL(deployment.rpcUrl).hostname,
              )))
        )
          throw Error();
        return v;
      },
      "Enter external or anvil.",
    );
    section("3/3 · Local Runtime");
    write(
      "Your Agent connects to Runtime on this computer. Keep the default unless the port is already in use.",
    );
    const port = await field(
      "Runtime port (press Enter for 6490)",
      (value) => {
        const n = Number(value || 6490);
        if (
          !/^\d+$/.test(value || "6490") ||
          !Number.isInteger(n) ||
          n < 1024 ||
          n > 65535
        )
          throw Error();
        return n;
      },
      "Enter a whole-number port from 1024 to 65535, or press Enter for 6490.",
    );
    section("Review local settings");
    write(
      `Safe:          ${safe}\nOwner:         ${ownerAddress}\nLocal Runtime: http://127.0.0.1:${port}`,
    );
    write("Saving these settings does not authorize spending.");
    if (
      (await ask("Type 'confirm' to save, or 'q' to cancel")).trim() !==
      "confirm"
    )
      throw Error("Cancelled; no configuration saved.");
    const config = {
      ...deployment,
      safe,
      ownerAddress,
      ownerSigner,
      runtimeUrl: `http://127.0.0.1:${port}`,
    };
    await file.writeFile(JSON.stringify(config, null, 2) + "\n");
    await file.sync();
    saved = true;
    write(
      continueAutomatically
        ? "Local settings saved. Continuing to Wallet setup."
        : "Local settings saved. Continue with the setup command shown on the Market page. Wallet will verify the chain before authorization.",
    );
    return config;
  } finally {
    await file.close();
    if (!saved) await unlink(outputPath);
  }
}
