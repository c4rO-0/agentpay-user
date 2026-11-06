#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Invoke the installed Skill with a durable key; reject/silence are expected negative responses.
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [dataArg, userArg] = process.argv.slice(2);
if (!dataArg || !userArg || process.argv.length !== 4)
  throw new Error("usage: random-reject-smoke.mjs <user-dir> <user-url>");
const mode = process.env.AGENTPAY_PROVIDER_NEGATIVE_CASE || "reject";
if (!["reject", "silence"].includes(mode))
  throw new Error("unsupported Provider negative case");
const userUrl = new URL(userArg);
if (
  userUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(userUrl.hostname)
)
  throw new Error("loopback User URL required");
const dataDir = resolve(dataArg);
const runtimeDir = join(dataDir, "runtime");
const info = await lstat(runtimeDir);
if (
  !info.isDirectory() ||
  info.isSymbolicLink() ||
  info.uid !== process.getuid() ||
  info.mode & 0o077
)
  throw new Error("unsafe User runtime directory");
const tokenPath = join(runtimeDir, "caller.token");
const tokenInfo = await lstat(tokenPath);
if (
  !tokenInfo.isFile() ||
  tokenInfo.isSymbolicLink() ||
  tokenInfo.uid !== process.getuid() ||
  tokenInfo.mode & 0o077
)
  throw new Error("unsafe caller credential");
const token = (await readFile(tokenPath, "utf8")).trim();
if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("invalid caller credential");
const checkpointName =
  process.env.AGENTPAY_PROVIDER_NEGATIVE_CHECKPOINT ||
  (mode === "silence" ? "silence-smoke.json" : "rejection-smoke.json");
if (
  ![
    "silence-smoke.json",
    "silence-crash-smoke.json",
    "rejection-smoke.json",
  ].includes(checkpointName) ||
  (mode === "reject") !== (checkpointName === "rejection-smoke.json")
)
  throw new Error("invalid negative-case checkpoint name");
const checkpointPath = join(runtimeDir, checkpointName);
let checkpoint;
try {
  const checkpointInfo = await lstat(checkpointPath);
  if (
    !checkpointInfo.isFile() ||
    checkpointInfo.isSymbolicLink() ||
    checkpointInfo.uid !== process.getuid() ||
    checkpointInfo.mode & 0o077
  )
    throw new Error("unsafe rejection checkpoint");
  checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  checkpoint = {
    version:
      mode === "reject"
        ? "agentpay.rejection-smoke.v1"
        : "agentpay.silence-smoke.v1",
    key: randomUUID(),
  };
  const handle = await open(checkpointPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(checkpoint)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
if (
  checkpoint.version !==
    (mode === "reject"
      ? "agentpay.rejection-smoke.v1"
      : "agentpay.silence-smoke.v1") ||
  !/^[0-9a-f-]{36}$/.test(checkpoint.key)
)
  throw new Error("invalid negative-case checkpoint");

const referenceFile = process.env.AGENTPAY_TEST_SERVICE_REFERENCE_FILE;
if (!referenceFile)
  throw Error(
    "Set AGENTPAY_TEST_SERVICE_REFERENCE_FILE to the official public service reference",
  );
const serviceReference = JSON.parse(await readFile(referenceFile, "utf8"));
const response = await fetch(new URL("/services/invoke", userUrl), {
  method: "POST",
  redirect: "error",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "idempotency-key": checkpoint.key,
  },
  body: JSON.stringify({
    version: "agentpay.runtime-call.v1",
    service: serviceReference,
    request: { min: 10, max: 99 },
    requestedMaxUsageUnits: "1",
  }),
  signal: AbortSignal.timeout(mode === "silence" ? 180_000 : 120_000),
});
const body = await response.json();
const expectedCode =
  mode === "silence" ? "PROVIDER_RECOVERY_TIMEOUT" : "PROVIDER_REJECTED";
if (response.status !== 502 || body?.error?.code !== expectedCode) {
  throw new Error(
    `expected ${expectedCode}, got HTTP ${response.status} ${body?.error?.code || "UNKNOWN"}`,
  );
}
const invocationId = `0x${createHash("sha256").update(`agentpay.user-invocation.v1:${checkpoint.key}`).digest("hex")}`;
const document = JSON.parse(
  await readFile(join(runtimeDir, "invocations.json"), "utf8"),
);
const invocation = document.invocations?.[invocationId];
if (
  !/^0x[0-9a-f]{64}$/.test(invocation?.orderId || "") ||
  !invocation.paymentSubmitted ||
  !/^0x[0-9a-f]{64}$/.test(invocation.orderRequestId || "")
)
  throw new Error("funded Order invocation checkpoint missing");
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      orderId: invocation.orderId,
      providerOutcome:
        mode === "silence" ? "no_response_timeout" : "explicit_rejection",
      sameKeyRecoverable: true,
      paymentSubmitted: true,
    },
    null,
    2,
  )}\n`,
);
