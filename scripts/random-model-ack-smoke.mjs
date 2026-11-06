#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Private-test model emulator: receipt acknowledgement is a separate caller
// action after the random result, never an automatic Skill/Runtime side effect.
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadActiveSkill } from "../src/active-skill.mjs";
import {
  loadRuntimeConnection,
  prepareInvocation,
  invokeService,
  completeInvocation,
} from "../src/runtime-client.mjs";
import { callWallet } from "../../wallet/dist/src/ipc.js";

const [mode, dataArg, settlementArg, userArg] = process.argv.slice(2);
if (
  !["invoke", "confirm"].includes(mode) ||
  !dataArg ||
  !settlementArg ||
  !userArg ||
  process.argv.length !== 6
) {
  throw new Error(
    "usage: random-model-ack-smoke.mjs <invoke|confirm> <private-user-data-dir> <settlement-url> <user-url>",
  );
}
const dataDir = resolve(dataArg);
const settlementUrl = localUrl(settlementArg);
const userUrl = localUrl(userArg);
const runtimeDir = join(dataDir, "runtime");
const walletDir = join(dataDir, "wallet");
const checkpointName =
  process.env.AGENTPAY_MODEL_ACK_CHECKPOINT || "model-ack-smoke.json";
if (
  !["model-ack-smoke.json", "unconfirmed-smoke.json"].includes(checkpointName)
) {
  throw new Error("unsupported private-test checkpoint");
}
const path = join(runtimeDir, checkpointName);
await privateDirectory(runtimeDir);
await privateDirectory(walletDir);
const callerToken = await privateToken(join(runtimeDir, "caller.token"));
const walletToken = await privateToken(join(walletDir, "agent.token"));
let checkpoint;
try {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  ) {
    throw new Error("unsafe model-emulator checkpoint");
  }
  checkpoint = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT" || mode !== "invoke") throw error;
  checkpoint = {
    version: "agentpay.model-ack-smoke.v1",
    key: randomUUID(),
    orderId: null,
    outputHash: null,
    confirmed: false,
    routingVersion: "agentpay.runtime-call.v1",
  };
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(checkpoint)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
if (
  checkpoint.version !== "agentpay.model-ack-smoke.v1" ||
  !/^[0-9a-f-]{36}$/.test(checkpoint.key) ||
  (checkpoint.confirmed && mode === "invoke")
)
  throw new Error("invalid or completed model-emulator checkpoint");
if (
  mode === "confirm" &&
  (!/^0x[0-9a-f]{64}$/.test(checkpoint.orderId || "") ||
    !/^0x[0-9a-f]{64}$/.test(checkpoint.outputHash || ""))
)
  throw new Error("invoke must succeed before confirmation");

// Official test input stays here; transaction processing uses the shared client.
if (checkpoint.routingVersion !== "agentpay.runtime-call.v1")
  throw Error(
    "LEGACY_TEST_REVIEW_REQUIRED: preserve the existing request; do not replace its purchase",
  );
const material = await loadActiveSkill(join(runtimeDir, "active-skill.json"));
const connection = await loadRuntimeConnection({ dataDir });
if (new URL(connection.runtimeUrl).href !== userUrl.href)
  throw Error("TEST_RUNTIME_CONNECTION_MISMATCH");
const saved = await prepareInvocation(
  connection,
  material.reference,
  { request: { min: 10, max: 99 }, requestedMaxUsageUnits: "1" },
  checkpoint.key,
);
const body = await invokeService(connection, material.reference, saved);
await completeInvocation(connection, material.reference, saved);
const result = body.result;
if (
  !/^0x[0-9a-f]{64}$/.test(result?.orderId || "") ||
  result?.output?.kind !== "random" ||
  !Number.isSafeInteger(result.output.value) ||
  result.output.value < 10 ||
  result.output.value > 99 ||
  result.deliveryEvidenceVerified !== true ||
  result.confirmationRequired !== false ||
  !result.finalization
) {
  throw new Error("random result or delivery evidence invalid");
}
const outputHash = `0x${createHash("sha256").update(JSON.stringify(result.output)).digest("hex")}`;
if (
  checkpoint.orderId &&
  (checkpoint.orderId !== result.orderId ||
    checkpoint.outputHash !== outputHash)
) {
  throw new Error("retry returned a different Order or random result");
}
if (mode === "invoke") {
  checkpoint = { ...checkpoint, orderId: result.orderId, outputHash };
  await atomicCheckpoint(path, checkpoint);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        orderId: result.orderId,
        outputHash,
        randomResultReceived: true,
        deliveryEvidenceVerified: true,
        confirmationSubmitted: false,
        next:
          checkpointName === "unconfirmed-smoke.json"
            ? "do not confirm; observe Wallet reminder and delayed release"
            : "restart User Runtime, then run confirm with the same private checkpoint",
      },
      null,
      2,
    )}\n`,
  );
} else {
  if (!checkpoint.confirmed) {
    const deadline = Date.now() + 30_000;
    while (true) {
      try {
        await callWallet(
          join(walletDir, "wallet.sock"),
          walletToken,
          "confirmSettlementDelivery",
          { settlementUrl: settlementUrl.toString(), orderId: result.orderId },
        );
        break;
      } catch (error) {
        if (
          Date.now() >= deadline ||
          error?.code !== "SETTLEMENT_REQUEST_REJECTED" ||
          !String(error?.message || "").includes(
            "finalization cannot be confirmed",
          )
        )
          throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    checkpoint = { ...checkpoint, confirmed: true };
    await atomicCheckpoint(path, checkpoint);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        orderId: result.orderId,
        outputHash,
        sameOrderAndResultAfterRetry: true,
        modelEmulatorAcknowledgedReceipt: true,
        qualityNotJudged: true,
      },
      null,
      2,
    )}\n`,
  );
}

function localUrl(input) {
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("private loopback URL required");
  }
  return url;
}
async function privateDirectory(directory) {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  ) {
    throw new Error("private user directory required");
  }
}
async function privateToken(file) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  ) {
    throw new Error("private capability file required");
  }
  const token = (await readFile(file, "utf8")).trim();
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("capability invalid");
  return token;
}
async function atomicCheckpoint(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, file);
}
