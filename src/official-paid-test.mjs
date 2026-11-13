import {reportCommandFailure} from "./command-diagnostics.mjs";
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, link, rename, unlink, mkdir, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { OFFICIAL_TEST_PACKAGE } from "./official-test-package.mjs";
import { inspectInstalledBundle } from "./active-skill.mjs";
import { loadRuntimeConnection, readServiceOffer } from "./runtime-client.mjs";
import { normalizeAcceptedTerms } from "./service-reference.mjs";
import { readPrivateFile } from "./runtime-client.mjs";
import { readServiceSettings } from "./local-services.mjs";
import { callWallet } from "@c4roa0/agentpay-wallet";
import { withClientRequestLock } from "./client-request-lock.mjs";

const run = promisify(execFile),
  version = "agentpay.official-paid-test.v1";
const input = { min: 10, max: 99 };
function serviceTime(seconds) {
  const [value, unit] =
    seconds % 3600 === 0
      ? [seconds / 3600, "hour"]
      : seconds % 60 === 0
        ? [seconds / 60, "minute"]
        : [seconds, "second"];
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}
async function readPrivate(path) {
  let h;
  try {
    h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = await h.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.size > 16384
    )
      throw Error("Official test record is unsafe");
    return JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await h?.close();
  }
}
async function save(path, value, replace = false) {
  const tmp = path + "." + randomUUID() + ".tmp";
  let h;
  try {
    h = await open(tmp, "wx", 0o600);
    await h.writeFile(JSON.stringify(value) + "\n");
    await h.sync();
    await h.close();
    h = null;
    if (replace) await rename(tmp, path);
    else await link(tmp, path);
    const dir = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await h?.close();
    await unlink(tmp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
async function prompt(question) {
  if (!process.stdin.isTTY)
    throw Error("Run agentpay payment test in your terminal.");
  const t = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await t.question(question + "\n> ")).trim().toLowerCase();
  } finally {
    t.close();
  }
}
async function archiveCompleted(dataDir, record) {
  const dir = join(dataDir, "runtime", "official-tests");
  await mkdir(dir, { mode: 0o700 }).catch((e) => {
    if (e.code !== "EEXIST") throw e;
  });
  const st = await lstat(dir);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    st.mode & 0o077
  )
    throw Error("Official test history directory is unsafe");
  const path = join(dir, `${record.requestId}.json`);
  try {
    await save(path, record);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const prior = await readPrivate(path);
    if (JSON.stringify(prior) !== JSON.stringify(record))
      throw Error("Official test history conflicts with the saved result");
  }
}
function resultIdentity(body) {
  const r = body?.result;
  if (
    body?.ok !== true ||
    !/^0x[0-9a-f]{64}$/.test(r?.orderId || "") ||
    !/^0x[0-9a-f]{64}$/.test(r?.outputHash || "") ||
    r.output?.kind !== "random" ||
    !Number.isSafeInteger(r.output.value) ||
    r.output.value < input.min ||
    r.output.value > input.max ||
    r.deliveryEvidenceVerified !== true
  )
    throw Error(
      "Official Skill did not return verified delivery. Keep the test record and retry the same request.",
    );
  return { orderId: r.orderId, outputHash: r.outputHash };
}
async function confirmDelivery(dataDir, orderId) {
  const token = (
    await readPrivateFile(join(dataDir, "wallet", "agent.token"), 256)
  ).trim();
  if (!/^[0-9a-f]{64}$/.test(token))
    throw Error("Local Wallet credential is invalid.");
  const { settlementUrl } = await readServiceSettings(dataDir);
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      return await callWallet(
        join(dataDir, "wallet", "wallet.sock"),
        token,
        "confirmSettlementDelivery",
        { settlementUrl, orderId },
      );
    } catch (e) {
      if (
        Date.now() >= deadline ||
        e.code !== "SETTLEMENT_REQUEST_REJECTED" ||
        !String(e.message || "").includes("finalization cannot be confirmed")
      )
        throw e;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
export async function runOfficialPaidTest({
  dataDir,
  write = console.log,
  ask = prompt,
  read = readPrivate,
  saveRecord = save,
  archive = archiveCompleted,
  lock = withClientRequestLock,
  offer = readServiceOffer,
  execute = run,
  ack = confirmDelivery,
  inspect = inspectInstalledBundle,
  connect = loadRuntimeConnection,
  tokenInfo = async (policy) => {
    const rpc = new JsonRpcProvider(policy.registryRpcUrl, policy.chainId, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    try {
      const token = new Contract(
        policy.token,
        [
          "function decimals() view returns(uint8)",
          "function symbol() view returns(string)",
        ],
        rpc,
      );
      const [decimals, symbol] = await Promise.all([
        token.decimals(),
        token.symbol(),
      ]);
      return { decimals: Number(decimals), symbol };
    } finally {
      rpc.destroy();
    }
  },
} = {}) {
  try {
    dataDir ??= await resolveUserDataDir();
    return await lock(
      join(dataDir, "runtime", "official-test.lock"),
      async () => {
        const path = join(
          dataDir,
          "runtime",
          `official-paid-test-${OFFICIAL_TEST_PACKAGE.version}.json`,
        );
        let record = await read(path);
        const directory = join(
          dataDir,
          "runtime",
          "skill-bundles",
          `${OFFICIAL_TEST_PACKAGE.name}-${OFFICIAL_TEST_PACKAGE.version}-${OFFICIAL_TEST_PACKAGE.sha256}`,
        );
        const installed = await inspect(directory);
        if (
          installed.sha256 !== OFFICIAL_TEST_PACKAGE.sha256 ||
          installed.locallyModified
        )
          throw Error(
            "The installed official Skill differs from this User release. Run agentpay repair first.",
          );
        const connection = await connect({ dataDir });
        if (
          record &&
          (record.version !== version ||
            record.packageSha256 !== OFFICIAL_TEST_PACKAGE.sha256 ||
            !/^[0-9a-f-]{36}$/.test(record.requestId || "") ||
            JSON.stringify(record.input) !== JSON.stringify(input) ||
            !record.terms ||
            (record.needsRequote && record.result) ||
            (record.result &&
              (!/^0x[0-9a-f]{64}$/.test(record.result.orderId || "") ||
                !/^0x[0-9a-f]{64}$/.test(record.result.outputHash || ""))))
        )
          throw Error(
            "Saved official test record needs review. It was preserved; no new request was started.",
          );
        const completed = record?.acknowledged === true;
        const previous = completed ? record : null;
        if (completed) record = null;
        if (!record || record.needsRequote) {
          const current = await offer(connection, installed.service.reference);
          if (
            current?.commercialReady !== true ||
            current.blockers?.length ||
            !current.quote ||
            BigInt(current.quote.maxUsageUnits || 0) < 1n
          )
            throw Error(
              "Official service is not ready for a paid test. Check agentpay status and retry later.",
            );
          const terms = normalizeAcceptedTerms({
            baseAmountAtomic: String(current.quote.baseAmountAtomic),
            unitPriceAtomic: String(current.quote.unitPriceAtomic),
            serviceWindowSeconds:
              current.orderDeadlinePolicy?.serviceWindowSeconds,
          });
          const policy = await read(join(dataDir, "wallet", "policy.json"));
          const ref = installed.service.reference;
          if (
            !policy ||
            policy.chainId !== 31337 ||
            policy.token?.toLowerCase() !==
              current.quote.asset?.toLowerCase() ||
            current.quote.network !== ref.profile.network ||
            current.quote.providerId !== ref.profile.providerId ||
            current.quote.skillId !== ref.skillId ||
            current.quote.profileHash !== ref.profileHash
          )
            throw Error(
              "Saved test Policy or service identity does not match the current offer on private Anvil.",
            );
          const { decimals, symbol } = await tokenInfo(policy);
          const maximum =
            BigInt(terms.baseAmountAtomic) + BigInt(terms.unitPriceAtomic);
          if (maximum > BigInt(policy.maxAmount))
            throw Error(
              "Current quote exceeds this Wallet’s per-payment limit.",
            );
          write(
            `\n> ${record ? "Review the updated test price" : "Test your payment connection"}\n\nUse the official test service to check payment and delivery.\n\nMaximum cost: ${formatUnits(maximum, Number(decimals))} ${symbol}\nService time limit: ${serviceTime(terms.serviceWindowSeconds)}\n\nAfter successful delivery, Wallet confirms receipt automatically.`,
          );
          if (previous)
            write(
              "Your previous test is complete. This will be a new paid test.",
            );
          if (
            (await ask("Type 'confirm' to pay and test, or 'q' to cancel")) !==
            "confirm"
          ) {
            write("Test cancelled. No new Order was started.");
            return 0;
          }
          write("Preparing your test…");
          if (record) {
            record = { ...record, terms, needsRequote: false };
            await saveRecord(path, record, true);
          } else {
            record = {
              version,
              packageSha256: OFFICIAL_TEST_PACKAGE.sha256,
              requestId: randomUUID(),
              input,
              terms,
            };
            if (previous) {
              await archive(dataDir, previous);
              await saveRecord(path, record, true);
            } else
              try {
                await saveRecord(path, record);
              } catch (e) {
                if (e.code !== "EEXIST") throw e;
                record = await read(path);
              }
          }
        } else
          write(
            "\n> Continue the unfinished payment test\nContinuing the original Order.",
          );
        if (
          record.version !== version ||
          record.packageSha256 !== OFFICIAL_TEST_PACKAGE.sha256 ||
          JSON.stringify(record.input) !== JSON.stringify(input)
        )
          throw Error(
            "Saved test record conflicts with this release. No request was started.",
          );
        normalizeAcceptedTerms(record.terms);
        const script = join(directory, "random-skill", "scripts", "random.mjs");
        const args = [
          script,
          "--invoke",
          String(input.min),
          String(input.max),
          "--units",
          "1",
          "--request-id",
          record.requestId,
          "--accept-terms",
          JSON.stringify(record.terms),
        ];
        const call = async () => {
          let stdout;
          try {
            ({ stdout } = await execute(process.execPath, args, {
              env: { ...process.env, AGENTPAY_USER_DATA_DIR: dataDir },
              timeout: 330000,
              maxBuffer: 2097152,
            }));
          } catch (error) {
            let response;
            try {
              response = JSON.parse(error.stdout);
            } catch {}
            if (response?.error?.code === "QUOTE_TERMS_CHANGED") {
              record = { ...record, needsRequote: true };
              await saveRecord(path, record, true);
              throw Error(
                "Price or service time changed before Order creation. Run agentpay payment test again to review the new quote with the same request ID.",
              );
            }
            throw error;
          }
          return resultIdentity(JSON.parse(stdout));
        };
        write("Waiting for the test result…");
        const first = await call();
        if (
          record.result &&
          (first.orderId !== record.result.orderId ||
            first.outputHash !== record.result.outputHash)
        )
          throw Error(
            "Retry returned different delivery. Preserve the Order for review.",
          );
        if (!record.result) {
          record = { ...record, result: first };
          await saveRecord(path, record, true);
        }
        write("Result received. Checking the saved result…");
        const repeat = await call();
        if (
          repeat.orderId !== first.orderId ||
          repeat.outputHash !== first.outputHash
        )
          throw Error(
            "Repeated call returned different delivery. Preserve the Order for review.",
          );
        if (!record.acknowledged) {
          write("Confirming receipt…");
          await ack(dataDir, first.orderId);
          record = { ...record, acknowledged: true };
          await saveRecord(path, record, true);
        }
        write(
          `Test complete. Payment and delivery are working.\nOrder ID: ${first.orderId}`,
        );
        return 0;
      },
    );
  } catch (e) {
    await reportCommandFailure(e,{operation:"Official payment test",write,effect:"A payment may already have been submitted. Keep the original request and test record; do not start a replacement purchase."});
    write(`Official test paused: ${e.message || "Unknown error"}`);
    write(
      "Retry agentpay payment test. Keep the original Order and local test record; do not start a replacement purchase.",
    );
    return 1;
  }
}
