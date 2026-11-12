// Durable purchase identity and checkpoint store. Conflicts must preserve the original
// request; losing an acknowledgement is not permission to issue a new paid attempt.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { currentTimeMs, localTimeMs } from "./local-time.mjs";
import { constants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const B32 = /^0x[0-9a-f]{64}$/;

export function createInvocationStore(path, serviceBinding = null) {
  if (!String(path || "").trim())
    throw new Error("AGENTPAY_USER_STATE_FILE is required");
  let tail = Promise.resolve();

  async function locked(operation) {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function load() {
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let parsed;
      try {
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.uid !== process.getuid() ||
          info.mode & 0o077 ||
          info.size > 32 * 1048576
        )
          throw coded(
            "INVOCATION_STATE_INVALID",
            "Invocation history must be a private regular file within the size limit",
          );
        parsed = JSON.parse(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
      if (
        parsed?.version !== "agentpay.user-invocations.v1" ||
        !parsed.invocations ||
        typeof parsed.invocations !== "object" ||
        Array.isArray(parsed.invocations) ||
        Object.entries(parsed.invocations).some(
          ([id, entry]) =>
            !B32.test(id) ||
            !entry ||
            typeof entry !== "object" ||
            Array.isArray(entry) ||
            entry.invocationId !== id ||
            !B32.test(entry.requestHash) ||
            !B32.test(entry.orderRequestId) ||
            !B32.test(entry.commitmentNonce) ||
            (entry.orderId !== null && !B32.test(entry.orderId)) ||
            typeof entry.paymentSubmitted !== "boolean" ||
            (entry.paymentPayload !== null &&
              typeof entry.paymentPayload !== "object"),
        )
      ) {
        throw coded(
          "INVOCATION_STATE_INVALID",
          "User invocation state is incompatible or damaged; preserve the file and recover it manually",
        );
      }
      for (const entry of Object.values(parsed.invocations))
        if (
          entry.routingVersion !== undefined &&
          (entry.routingVersion !== "agentpay.runtime-call.v1" ||
            typeof entry.serviceBinding !== "string")
        )
          throw coded(
            "INVOCATION_STATE_INVALID",
            "Invalid per-service routing state",
          );
      if (
        parsed.timeEncoding !== undefined &&
        parsed.timeEncoding !== "unix-ms"
      )
        throw coded(
          "INVOCATION_STATE_INVALID",
          "Unsupported invocation timestamp encoding; preserve the file",
        );
      for (const entry of Object.values(parsed.invocations)) {
        try {
          for (const key of ["createdAt", "updatedAt"]) {
            if (
              parsed.timeEncoding === "unix-ms" &&
              !Object.hasOwn(entry, key + "Ms")
            )
              throw Error("Missing invocation epoch");
            const ms = localTimeMs(entry, key);
            entry[key + "Ms"] = ms;
            entry[key] = new Date(ms).toISOString();
          }
        } catch {
          throw coded(
            "INVOCATION_STATE_INVALID",
            "Invocation timestamp is invalid; preserve the file and recover it manually",
          );
        }
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT")
        return { version: "agentpay.user-invocations.v1", invocations: {} };
      if (error instanceof SyntaxError)
        throw coded(
          "INVOCATION_STATE_INVALID",
          "User invocation state is invalid JSON; preserve the file and recover it manually",
        );
      throw error;
    }
  }

  async function save(document) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const stored = {
      ...document,
      timeEncoding: "unix-ms",
      invocations: Object.fromEntries(
        Object.entries(document.invocations).map(([id, entry]) => {
          const data = { ...entry };
          for (const key of ["createdAt", "updatedAt"]) {
            data[key + "Ms"] = localTimeMs(entry, key);
            delete data[key];
          }
          return [id, data];
        }),
      ),
    };
    const handle = await open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(`${JSON.stringify(stored, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      const directory = await open(dirname(path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  function checkBinding(entry, expected = serviceBinding, routing = null) {
    if (
      (entry.routingVersion ?? null) !== routing ||
      (expected !== null && entry.serviceBinding !== expected) ||
      (expected === null && entry.serviceBinding != null)
    ) {
      throw coded(
        "INVOCATION_SERVICE_BINDING_MISMATCH",
        "Preserve invocation history and restore its selected Skill before retrying",
      );
    }
  }
  return Object.freeze({
    async inventory() {
      const document = await load();
      return structuredClone(document.invocations);
    },
    async verifyServiceBinding() {
      const document = await load();
      for (const entry of Object.values(document.invocations)) {
        if (
          entry.routingVersion === "agentpay.runtime-call.v1" &&
          typeof entry.serviceBinding === "string"
        )
          continue;
        checkBinding(entry);
      }
    },
    async lookup({
      invocationKey,
      requestHash,
      binding = serviceBinding,
      routingVersion = null,
    }) {
      return locked(async () => {
        const existing = (await load()).invocations[
          hashInvocationKey(invocationKey)
        ];
        if (!existing)
          throw coded(
            "ORIGINAL_REQUEST_NOT_FOUND",
            "Original Runtime history is missing. Do not create a replacement purchase.",
          );
        checkBinding(existing, binding, routingVersion);
        if (existing.requestHash !== requestHash)
          throw coded("INVOCATION_CONFLICT", "Original request input differs.");
        return structuredClone(existing);
      });
    },
    async begin({
      invocationKey,
      requestHash,
      binding = serviceBinding,
      routingVersion = null,
      recoveryScope = null,
      readRecoveryScope = null,
      originalOrderRequestId = null,
    }) {
      if (
        routingVersion !== null &&
        routingVersion !== "agentpay.runtime-call.v1"
      )
        throw coded(
          "INVOCATION_STATE_INVALID",
          "Unsupported invocation routing version",
        );
      return locked(async () => {
        const document = await load();
        const invocationId = hashInvocationKey(invocationKey);
        const existing = document.invocations[invocationId];
        if (
          originalOrderRequestId !== null &&
          (!B32.test(originalOrderRequestId) ||
            !existing ||
            existing.orderRequestId !== originalOrderRequestId)
        )
          throw coded(
            "ORIGINAL_REQUEST_NOT_FOUND",
            "The original Runtime record changed or disappeared. No replacement purchase was created.",
          );
        if (existing) {
          checkBinding(existing, binding, routingVersion);
          if (existing.requestHash !== requestHash)
            throw coded(
              "INVOCATION_CONFLICT",
              "Idempotency-Key was already used with a different request",
            );
          return structuredClone(existing);
        }
        if (readRecoveryScope) {
          recoveryScope = await readRecoveryScope();
          if (
            !recoveryScope ||
            Object.keys(recoveryScope).sort().join(",") !==
              "module,network,policyId,safe" ||
            !/^eip155:[1-9][0-9]*$/.test(recoveryScope.network) ||
            ![recoveryScope.safe, recoveryScope.module].every((v) =>
              /^0x[0-9a-f]{40}$/i.test(v),
            ) ||
            !B32.test(String(recoveryScope.policyId).toLowerCase())
          )
            throw coded(
              "RUNTIME_RECOVERY_REQUIRED",
              "Wallet authorization is unavailable. Complete or update Wallet setup before starting a new request.",
            );
        }
        const atMs = currentTimeMs();
        const at = new Date(atMs).toISOString();
        const created = {
          invocationId,
          requestHash,
          orderRequestId: randomB32(),
          commitmentNonce: randomB32(),
          orderId: null,
          paymentPayload: null,
          paymentSubmitted: false,
          ...(recoveryScope ? { recoveryScope } : {}),
          ...(binding !== null ? { serviceBinding: binding } : {}),
          ...(routingVersion
            ? { routingVersion, quoteAcceptanceRequired: true }
            : {}),
          createdAt: at,
          updatedAt: at,
          createdAtMs: atMs,
          updatedAtMs: atMs,
        };
        document.invocations[invocationId] = created;
        await save(document);
        return structuredClone(created);
      });
    },
    async attachRecoveredOrder(expected, orderId, recoveryScope) {
      if (!B32.test(orderId))
        throw coded("ORDER_IDENTITY_MISMATCH", "Invalid recovered Order");
      return locked(async () => {
        const document = await load(),
          existing = document.invocations[expected.invocationId];
        if (
          !existing ||
          existing.orderId ||
          JSON.stringify(existing) !== JSON.stringify(expected)
        )
          return false;
        document.invocations[expected.invocationId] = {
          ...existing,
          orderId,
          ...(recoveryScope ? { recoveryScope } : {}),
          updatedAtMs: currentTimeMs(),
        };
        document.invocations[expected.invocationId].updatedAt = new Date(
          document.invocations[expected.invocationId].updatedAtMs,
        ).toISOString();
        await save(document);
        return true;
      });
    },
    async update(invocationId, expectedRequestHash, changes) {
      return locked(async () => {
        const document = await load();
        const existing = document.invocations[invocationId];
        if (!existing || existing.requestHash !== expectedRequestHash)
          throw coded(
            "INVOCATION_NOT_FOUND",
            "durable invocation checkpoint was not found",
          );
        if (
          existing.recoveryScope &&
          changes.recoveryScope &&
          JSON.stringify(existing.recoveryScope) !==
            JSON.stringify(changes.recoveryScope)
        )
          throw coded(
            "ORDER_IDENTITY_MISMATCH",
            "Original authorization cannot be replaced",
          );
        const atMs = currentTimeMs();
        const updated = {
          ...existing,
          ...changes,
          invocationId: existing.invocationId,
          requestHash: existing.requestHash,
          orderRequestId: existing.orderRequestId,
          ...(existing.serviceBinding !== undefined
            ? { serviceBinding: existing.serviceBinding }
            : {}),
          ...(existing.routingVersion !== undefined
            ? { routingVersion: existing.routingVersion }
            : {}),
          updatedAt: new Date(atMs).toISOString(),
          updatedAtMs: atMs,
        };
        document.invocations[invocationId] = updated;
        await save(document);
        return structuredClone(updated);
      });
    },
  });
}

export function hashInvocationKey(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(normalized))
    throw coded(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key must contain 8-128 safe characters",
    );
  return `0x${createHash("sha256").update(`agentpay.user-invocation.v1:${normalized}`).digest("hex")}`;
}

function randomB32() {
  return `0x${randomBytes(32).toString("hex")}`;
}
function coded(code, message) {
  return Object.assign(new Error(message), { code });
}
