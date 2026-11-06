// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { installedUserDir } from "./local-data-directory.mjs";
import { validatePublicDeployment } from "./prepare-onboarding.mjs";
export async function readPrivateJson(path) {
  let h;
  try {
    h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = await h.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.size > 65536
    )
      throw Error("Unsafe local settings");
    return JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await h?.close();
  }
}
export async function writePrivateJson(path, value) {
  const temp = path + "." + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(value) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export function deploymentChanges(policy, config) {
  return ["chainId", "module", "factory", "registry", "token"].filter(
    (k) => String(policy[k]).toLowerCase() !== String(config[k]).toLowerCase(),
  );
}
export async function loadCurrentDeployment({
  dataDir,
  userDir = installedUserDir,
  fetchImpl = fetch,
  now = Date.now(),
  fresh = false,
} = {}) {
  const local = await readPrivateJson(
    join(dirname(userDir), "user-deployment.json"),
  );
  const receipt = await readPrivateJson(
    join(dataDir, "market-connection.json"),
  );
  if (!receipt?.marketOrigin)
    return local
      ? {
          config: validatePublicDeployment(local),
          source: "downloaded",
          checkedAtMs: null,
        }
      : null;
  const origin = new URL(receipt.marketOrigin);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    !(
      origin.protocol === "https:" ||
      (origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    )
  )
    throw Error("Cannot safely check the saved Market address.");
  const path = join(dataDir, "runtime/deployment-status.json");
  const cache = await readPrivateJson(path);
  if (
    !fresh &&
    cache?.origin === origin.href &&
    Number.isSafeInteger(cache.checkedAtMs) &&
    now >= cache.checkedAtMs &&
    now - cache.checkedAtMs < 60000
  ) {
    if (cache.error)
      throw Error("Platform deployment check temporarily unavailable.");
    return { ...cache, config: validatePublicDeployment(cache.config) };
  }
  try {
    const response = await fetchImpl(
      new URL("/market/web/onboarding/user-config", origin),
      { signal: AbortSignal.timeout(3000), redirect: "error" },
    );
    if (!response.ok) throw Error("Platform configuration unavailable");
    const reader = response.body.getReader();
    let raw = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) throw Error("Platform settings too large");
        raw += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    raw += decoder.decode();
    const result = {
      origin: origin.href,
      checkedAtMs: now,
      source: "platform",
      config: validatePublicDeployment(JSON.parse(raw)),
    };
    await mkdir(join(dataDir, "runtime"), { recursive: true, mode: 0o700 });
    await writePrivateJson(path, result);
    return result;
  } catch (e) {
    await mkdir(join(dataDir, "runtime"), { recursive: true, mode: 0o700 });
    await writePrivateJson(path, {
      origin: origin.href,
      checkedAtMs: now,
      error: true,
    });
    throw e;
  }
}
export async function inspectDeploymentStatus(dataDir, options = {}) {
  try {
    const policy = await readPrivateJson(join(dataDir, "wallet/policy.json"));
    if (!policy) return { state: "unbound" };
    const result = await loadCurrentDeployment({ dataDir, ...options });
    if (!result) return { state: "unknown" };
    const changed = deploymentChanges(policy, result.config);
    return {
      state: changed.length
        ? "changed"
        : result.source === "platform"
          ? "matching"
          : "downloaded",
      changed,
      checkedAtMs: result.checkedAtMs,
    };
  } catch {
    return { state: "unknown" };
  }
}
export async function syncSetupDeployment({
  dataDir,
  config,
  authorization,
  userDir = installedUserDir,
}) {
  const policy = await readPrivateJson(join(dataDir, "wallet/policy.json"));
  if (!policy || deploymentChanges(policy, config).length)
    throw Error("Verified Wallet binding does not match deployment settings.");
  const parent = dirname(userDir),
    path = join(parent, "anvil-onboarding.json"),
    saved = await readPrivateJson(path);
  // Preserve owner selection, Safe, Runtime address, recovery drafts and test requests.
  if (saved) {
    await writePrivateJson(path + "." + randomUUID() + ".previous", saved);
    await writePrivateJson(path, { ...saved, ...config, safe: policy.safe });
  }
  if (authorization) {
    if (authorization.policyId.toLowerCase() !== policy.policyId.toLowerCase())
      throw Error("Setup projection Policy mismatch.");
    const draft = join(dataDir, "runtime/authorization-draft.json"),
      oldDraft = await readPrivateJson(draft);
    if (oldDraft && oldDraft.policyId !== policy.policyId)
      await writePrivateJson(
        draft + "." + randomUUID() + ".previous",
        oldDraft,
      );
    if (saved)
      await writePrivateJson(draft, {
        ...authorization,
        version: 1,
        delegate: policy.delegate,
        ownerAddress: saved.ownerAddress,
      });
    const publicPath = join(dataDir, "public-policy.json"),
      oldPublic = await readPrivateJson(publicPath);
    if (oldPublic)
      await writePrivateJson(publicPath, { ...oldPublic, ...authorization });
  }
  await writePrivateJson(join(parent, "user-deployment.json"), config);
}
