// SPDX-License-Identifier: MPL-2.0
// Diagnostics never select an installation, repair files, sign, unlock or pay.
// Report only allowlisted values, not URLs, raw exceptions, tokens or histories.
import { join } from "node:path";
import { readFile, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { Contract } from "ethers";
import { ReadOnlyRpc } from "./read-only-rpc.mjs";
import {
  resolveUserDataDir,
  installedUserDir,
} from "./local-data-directory.mjs";
import { readPrivateJson } from "./deployment-status.mjs";
import { localWalletAdmin } from "./local-wallet-ipc.mjs";
import {
  failureGuidance,
  CHAIN_CHECK_TIMEOUT_MS,
} from "./setup-diagnostics.mjs";

export async function runHealth({
  write = console.log,
  resolveDirectory = resolveUserDataDir,
} = {}) {
  let failures = 0;
  write("\n> AgentPay health");
  write("Read-only checks · no signing, payment, repair or service changes.");
  write(
    "Report includes software versions, public contract addresses and timings.",
  );
  write(
    "URLs, credentials, personal file paths and Order contents are omitted.",
  );
  write("Checked: " + new Date().toISOString());
  async function check(label, work) {
    const started = Date.now();
    write(`\nChecking ${label}…`);
    try {
      const value = await work();
      write(
        `[OK] ${label} · ${Date.now() - started} ms${value ? " · " + value : ""}`,
      );
      return true;
    } catch (error) {
      failures++;
      const g = failureGuidance(error);
      write(
        `[!] ${label} · ${Date.now() - started} ms · ${g.code}\n  ${g.reason}\n  ${g.next}`,
      );
      return false;
    }
  }
  let dataDir, config, services, policy, fields, receipt;
  if (
    !(await check("Local settings", async () => {
      dataDir = await resolveDirectory();
      for (const path of [
        dataDir,
        join(dataDir, "runtime"),
        join(dataDir, "wallet"),
      ]) {
        const st = await lstat(path).catch((e) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        if (
          st &&
          (!st.isDirectory() ||
            st.isSymbolicLink() ||
            st.uid !== process.getuid() ||
            st.mode & 0o077)
        )
          throw Object.assign(Error(), { code: "UNSAFE_LOCAL_FILE" });
      }
      // No deployment importer: even an older installation must remain untouched.
      config =
        (await readPrivateJson(join(dataDir, "anvil-onboarding.json"))) ||
        (await readPrivateJson(join(dataDir, "user-deployment.json")));
      services = await readPrivateJson(
        join(dataDir, "runtime/local-services.json"),
      );
      policy = await readPrivateJson(join(dataDir, "wallet/policy.json"));
      fields = await readPrivateJson(
        join(dataDir, "runtime/authorization-fields.json"),
      );
      receipt = await readPrivateJson(join(dataDir, "market-connection.json"));
      if (!config && !services)
        throw Object.assign(Error(), { code: "LOCAL_SETTINGS_MISSING" });
    }))
  )
    return 1;
  await check("Installed software", async () => {
    const user = JSON.parse(
      await readFile(join(installedUserDir, "package.json"), "utf8"),
    );
    const req = createRequire(join(installedUserDir, "package.json"));
    const wallet = req("@c4roa0/agentpay-wallet/package.json");
    if (wallet.version !== user.dependencies?.["@c4roa0/agentpay-wallet"])
      throw Object.assign(Error(), { code: "SOFTWARE_VERSION_MISMATCH" });
    const version = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v : "unknown");
    return `User ${version(user.version)} · Wallet ${version(wallet.version)} · Node ${process.versions.node}`;
  });
  const cfg = { ...config, ...services };
  const expected = { ...config, ...policy };
  expected.safe = policy?.safe || fields?.fields?.safe || config?.safe;
  let rpc,
    rpcTimedOut = false;
  async function rpcRead(work) {
    let timer;
    try {
      return await Promise.race([
        work(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            rpcTimedOut = true;
            rpc.destroy();
            reject(Object.assign(Error(), { code: "CHAIN_CHECK_TIMEOUT" }));
          }, CHAIN_CHECK_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  if (cfg.rpcUrl) {
    try {
      rpc = new ReadOnlyRpc(cfg.rpcUrl);
      const connected = await check("Chain RPC", () =>
        rpcRead(async () => {
          const id = (await rpc.getNetwork()).chainId;
          if (id !== BigInt(expected.chainId))
            throw Object.assign(Error(), { code: "CHAIN_ID_MISMATCH" });
          return "chain " + String(id);
        }),
      );
      if (connected) {
        const present = {};
        for (const key of ["safe", "module", "token", "factory", "registry"]) {
          if (rpcTimedOut) break;
          if (!expected[key]) {
            write(`[WAIT] ${key} address not configured`);
            continue;
          }
          present[key] = await check(key + " contract", () =>
            rpcRead(async () => {
              if (!/^0x[0-9a-fA-F]{40}$/.test(expected[key]))
                throw Object.assign(Error(), { code: "INVALID_ADDRESS" });
              if ((await rpc.getCode(expected[key])) === "0x")
                throw Object.assign(Error(), {
                  code: key.toUpperCase() + "_CODE_MISSING",
                });
              return expected[key];
            }),
          );
        }
        if (present.safe && !rpcTimedOut) {
          const safe = new Contract(
            expected.safe,
            [
              "function getOwners() view returns(address[])",
              "function getThreshold() view returns(uint256)",
              "function isModuleEnabled(address) view returns(bool)",
            ],
            rpc,
          );
          await check("Safe ownership", () =>
            rpcRead(async () => {
              const [owners, threshold] = await Promise.all([
                safe.getOwners(),
                safe.getThreshold(),
              ]);
              if (
                config?.ownerAddress &&
                !owners.some(
                  (a) => a.toLowerCase() === config.ownerAddress.toLowerCase(),
                )
              )
                throw Object.assign(Error(), { code: "SAFE_OWNER_MISMATCH" });
              return `${owners.length} owners · ${threshold} required`;
            }),
          );
          if (present.module && !rpcTimedOut)
            await check("Safe Module setting", () =>
              rpcRead(async () => {
                const enabled = await safe.isModuleEnabled(expected.module);
                return enabled
                  ? "enabled"
                  : "disabled; owner approval is required before new payments";
              }),
            );
        }
        if (present.module && present.safe && !rpcTimedOut)
          await check("Policy contract read", () =>
            rpcRead(async () => {
              const module = new Contract(
                expected.module,
                [
                  "function policies(address,bytes32) view returns(address delegate,address token,address factory,address registry,uint256 maxPerPayment,uint256 totalBudget,uint256 spent,uint64 validAfter,uint64 validUntil,bool revoked)",
                ],
                rpc,
              );
              const p = await module.policies(
                expected.safe,
                policy?.policyId || "0x" + "0".repeat(64),
              );
              if (!policy) return "readable; no local Policy binding yet";
              if (p.delegate === "0x" + "0".repeat(40))
                throw Object.assign(Error(), { code: "POLICY_NOT_FOUND" });
              return p.revoked
                ? "revoked"
                : Number(p.validUntil) <= Date.now() / 1000
                  ? "expired"
                  : "readable; payment readiness is checked separately";
            }),
          );
      } else
        write(
          "[WAIT] Contract checks skipped until the network is reachable and matches.",
        );
    } catch (error) {
      await check("Chain settings", async () => {
        throw error;
      });
    } finally {
      if (rpcTimedOut)
        write(
          "[WAIT] Remaining chain checks skipped after timeout. Restore the RPC connection before retrying.",
        );
      rpc?.destroy();
    }
  } else write("[WAIT] Chain RPC not configured");

  if (!policy) write("[WAIT] Local services: setup is unfinished. Continue agentpay setup; services may not be started yet.");
  else await check("Local Wallet", async () => {
    const result = await localWalletAdmin(
      dataDir,
      "status",
      {},
      { timeoutMs: 5000 },
    );
    return result?.locked ? "running, locked" : "running";
  });
  async function http(label, base, path, validate) {
    await check(label, async () => {
      const url = new URL(base);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Object.assign(Error(), { code: "INVALID_SERVICE_URL" });
      const suffix = new URL(path, "http://placeholder");
      url.pathname = url.pathname.replace(/\/$/, "") + suffix.pathname;
      url.search = suffix.search;
      let response;
      try {
        response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (error.name === "TimeoutError")
          throw Object.assign(Error(), { code: "TIMEOUT" });
        throw error;
      }
      try {
        if (!response.ok)
          throw Object.assign(Error(), { code: "HTTP_" + response.status });
        if (validate) {
          const reader = response.body.getReader();
          let text = "",
            bytes = 0;
          const decoder = new TextDecoder();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 65536)
                throw Object.assign(Error(), {
                  code: "INVALID_HEALTH_RESPONSE",
                });
              text += decoder.decode(value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw Object.assign(Error(), { code: "INVALID_HEALTH_RESPONSE" });
          }
          if (!validate(parsed))
            throw Object.assign(Error(), { code: "INVALID_HEALTH_RESPONSE" });
        }
        return "reachable";
      } finally {
        await response.body?.cancel().catch(() => {});
      }
    });
  }
  if (policy && cfg.runtimeUrl)
    await http(
      "Local Runtime",
      cfg.runtimeUrl,
      "/health",
      (b) => b?.ok === true && b.result?.role === "user-runtime",
    );
  else if (policy) write("[WAIT] Local Runtime address not configured");
  if (cfg.settlementUrl)
    await http(
      "Settlement HTTP",
      cfg.settlementUrl,
      "/agentpay/purchase-readiness?skillId=0x" + "0".repeat(64) + "&profileHash=0x" + "0".repeat(64),
      (b) => b?.ok === true && Array.isArray(b.result?.blockers) &&
        Number.isSafeInteger(b.result?.settlementProfile?.chainId) &&
        ["assetAddress", "factoryAddress", "registryAddress"].every(k =>
          /^0x[0-9a-fA-F]{40}$/.test(b.result.settlementProfile[k])),
    );
  if (receipt?.marketOrigin)
    await http(
      "Market HTTP",
      receipt.marketOrigin,
      "/market/web/onboarding/user-config",
      (b) =>
        Number.isSafeInteger(b?.chainId) &&
        b.chainId > 0 &&
        ["module", "token", "factory", "registry"].every((k) =>
          /^0x[0-9a-fA-F]{40}$/.test(b[k]),
        ) &&
        typeof b.rpcUrl === "string" &&
        typeof b.settlementUrl === "string",
    );
  write(
    `\n${failures ? failures + " check(s) need attention." : "Available checks completed."} This report does not prove payment readiness or Order settlement.`,
  );
  write(
    "Share this report with support. Do not attach keys, tokens or your private data folder.",
  );
  return failures ? 1 : 0;
}
