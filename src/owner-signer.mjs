// Explicit owner signer selection. A chain ID never implicitly grants access to
// unlocked test accounts; external owners approve fixed plans outside local Wallet.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

export function ownerSignerKind(value = "external") {
  if (!["external", "anvil"].includes(value))
    throw Error("Owner signer must be external or anvil.");
  return value;
}
async function read(path) {
  let h;
  try {
    h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = await h.stat();
    if (
      !st.isFile() ||
      st.uid !== process.getuid() ||
      st.mode & 0o077 ||
      st.size > 4096
    )
      throw Error("Unsafe owner signer settings.");
    return JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await h?.close();
  }
}
export async function selectedOwnerSigner({
  dataDir,
  choice,
  readState = read,
  env = process.env,
} = {}) {
  const explicit = choice ?? env.AGENTPAY_OWNER_SIGNER;
  if (explicit !== undefined) return ownerSignerKind(explicit);
  const saved = await readState(join(dataDir, "runtime", "owner-signer.json"));
  if (saved === null || saved === undefined) return "external";
  if (
    saved.version !== 1 ||
    Object.keys(saved).some((k) => !["version", "kind"].includes(k))
  )
    throw Error("Invalid owner signer settings.");
  return ownerSignerKind(saved.kind);
}
// This guard is independent of any chain mode label downloaded from Market.
export function checkTestSigner(kind, source) {
  ownerSignerKind(kind);
  if (kind !== "anvil") return;
  const rpc = new URL(source.registryRpcUrl || source.rpcUrl);
  if (
    source.chainId !== 31337 ||
    rpc.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(rpc.hostname) ||
    rpc.username ||
    rpc.password ||
    rpc.search ||
    rpc.hash
  )
    throw Error("Anvil owner signer requires chain 31337 and loopback HTTP.");
}
