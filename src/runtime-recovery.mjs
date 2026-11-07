// Read-only startup and periodic reconciliation. Keep financial state separate from
// local result availability; unresolved original scopes remain visible for review.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { localOrderReviews, reviewApplies } from "./order-review.mjs";
import { isUnpaidExpiry } from "./order-closure.mjs";
import { constants } from "node:fs";
import { open, rename, unlink, readdir, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readSettlementResult } from "./settlement-response.mjs";
import {
  providerOutput,
  parseServiceReference,
  normalizeRuntimeResult,
} from "./service-reference.mjs";
const fail = (code) => Object.assign(Error(code), { code });
const fingerprint = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const terminal = new Set(["Released", "Refunded", "Cancelled"]);
const resultIssue = (o) =>
  o?.resultState === "invalid"
    ? "RECOVERY_RESULT_INVALID"
    : o?.resultState === "legacy_unverified"
      ? "LEGACY_RESULT_UNVERIFIED"
      : o?.resultState === "pending"
        ? "RESULT_EVIDENCE_PENDING"
        : o?.financialState === "terminal" &&
            o.vaultState === "Released" &&
            o.resultState === "missing"
          ? "SETTLED_RESULT_UNAVAILABLE"
          : null;
const knownCodes = new Set([
  "LOCKED",
  "POLICY_UNBOUND",
  "POLICY_MIGRATION_PENDING",
  "ORDER_NOT_FOUND",
  "ORDER_IDENTITY_MISMATCH",
  "SETTLEMENT_RESPONSE_INVALID",
  "RECOVERY_RESULT_INVALID",
  "ORDER_STATE_CONFLICT",
  "RECOVERY_SCOPE_INVALID",
  "RECOVERY_POLICY_UNAVAILABLE",
  "RESULT_STORAGE_UNAVAILABLE",
]);
// Only authenticated read methods are injected. No payment or Provider operation.
export function createRuntimeRecovery({
  store,
  results,
  statePath,
  settlementUrl,
  readWallet,
  readOrder,
  readRequest = null,
  now = Date.now,
}) {
  let inventoryState = "checking",
    inventoryIssue = null,
    inventory = {},
    observations = {},
    walletState = "not_checked",
    lastCheckedAtMs = null,
    storageError = false,
    active = null,
    timer = null,
    stopped = false,
    cursor = 0,
    loaded = false,
    loading = null;
  const path = statePath + ".recovery.json";
  const reviews = localOrderReviews(statePath);
  let reviewNotes = {};
  async function readObservations() {
    let h;
    try {
      h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const s = await h.stat();
      if (
        !s.isFile() ||
        s.uid !== process.getuid() ||
        s.mode & 0o077 ||
        s.size > 16 * 1048576
      )
        throw fail("RECOVERY_STATE_INVALID");
      const doc = JSON.parse(await h.readFile("utf8"));
      if (
        doc.version !== "agentpay.runtime-recovery.v1" ||
        !doc.observations ||
        typeof doc.observations !== "object" ||
        Array.isArray(doc.observations)
      )
        throw fail("RECOVERY_STATE_INVALID");
      for (const [id, v] of Object.entries(doc.observations))
        if (
          !/^0x[0-9a-f]{64}$/.test(id) ||
          !v ||
          !/^([0-9a-f]{64})$/.test(v.fingerprint) ||
          !Number.isSafeInteger(v.checkedAtMs) ||
          !Number.isSafeInteger(v.nextCheckAtMs) ||
          !Number.isInteger(v.attempts) ||
          v.attempts < 0 ||
          v.attempts > 8 ||
          typeof v.source !== "string" ||
          !["unknown", "pending", "closing", "terminal"].includes(
            v.financialState,
          ) ||
          ![
            "missing",
            "verified",
            "invalid",
            "legacy_unverified",
            "pending",
          ].includes(v.resultState)
        )
          throw fail("RECOVERY_STATE_INVALID");
      observations = doc.observations;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    } finally {
      await h?.close();
    }
    loaded = true;
  }
  async function load() {
    if (loaded) return;
    if (!loading)
      loading = readObservations().finally(() => {
        loading = null;
      });
    return loading;
  }
  async function persist() {
    const parent = await lstat(dirname(path));
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== process.getuid() ||
      parent.mode & 0o077
    )
      throw fail("RECOVERY_STATE_INVALID");
    const temp = path + "." + randomUUID() + ".tmp";
    let h;
    try {
      h = await open(temp, "wx", 0o600);
      await h.writeFile(
        JSON.stringify({
          version: "agentpay.runtime-recovery.v1",
          observations,
        }) + "\n",
      );
      await h.sync();
      await h.close();
      h = null;
      await rename(temp, path);
      const d = await open(dirname(path), "r");
      try {
        await d.sync();
      } finally {
        await d.close();
      }
    } finally {
      await h?.close();
      await unlink(temp).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  }
  async function inspect() {
    try {
      await load();
      const entries = await store.inventory();
      if (Object.keys(entries).length > 10000) throw fail("HISTORY_TOO_LARGE");
      if (Object.keys(observations).some((id) => !Object.hasOwn(entries, id)))
        throw fail("HISTORY_MISSING");
      const names = await readdir(statePath + ".results").catch((e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      });
      if (
        names.some(
          (name) =>
            /^0x[0-9a-f]{64}\.json$/.test(name) &&
            !Object.hasOwn(entries, name.slice(0, -5)),
        )
      )
        throw fail("HISTORY_MISSING");
      const pendingNames = await readdir(statePath + ".pending-results").catch(
        (e) => {
          if (e.code === "ENOENT") return [];
          throw e;
        },
      );
      if (
        pendingNames.some(
          (name) =>
            /^0x[0-9a-f]{64}\.json$/.test(name) &&
            !Object.hasOwn(entries, name.slice(0, -5)),
        )
      )
        throw fail("HISTORY_MISSING");
      reviewNotes = (await reviews.load()).records;
      inventory = entries;
      inventoryState = "complete";
      inventoryIssue = null;
      return true;
    } catch (e) {
      inventoryState = "blocked";
      inventoryIssue = [
        "HISTORY_MISSING",
        "HISTORY_TOO_LARGE",
        "RECOVERY_STATE_INVALID",
      ].includes(e.code)
        ? e.code
        : "HISTORY_INVALID_OR_UNREADABLE";
      return false;
    }
  }
  function status() {
    const entries = Object.entries(inventory);
    let checked = 0,
      settled = 0,
      expired = 0,
      missingResult = 0,
      waiting = 0,
      review = 0,
      archived = 0;
    for (const [id, v] of entries) {
      const o = observations[id],
        hidden =
          reviewApplies(reviewNotes[id], v, o) &&
          (!o || o.source === settlementUrl);
      if (hidden) archived++;
      if (
        !o ||
        o.fingerprint !== fingerprint(v) ||
        o.source !== settlementUrl
      ) {
        if (!hidden) waiting++;
        continue;
      }
      checked++;
      if (o.financialState === "terminal") {
        if (o.expiredUnpaid) expired++;
        else settled++;
      }
      if (hidden) continue;
      if (resultIssue(o) === "SETTLED_RESULT_UNAVAILABLE") missingResult++;
      if (
        o.errorCode ||
        ["invalid", "legacy_unverified"].includes(o.resultState)
      )
        review++;
      else if (o.financialState !== "terminal" || o.resultState === "pending")
        waiting++;
    }
    const issues = entries
      .flatMap(([id, v]) => {
        const o = observations[id];
        if (
          reviewApplies(reviewNotes[id], v, o) &&
          (!o || o.source === settlementUrl)
        )
          return [];
        if (
          !o ||
          o.fingerprint !== fingerprint(v) ||
          o.source !== settlementUrl
        )
          return [];
        return o.errorCode || resultIssue(o)
          ? [
              {
                invocationId: id,
                orderId: v.orderId,
                code: o.errorCode || resultIssue(o),
                checkedAtMs: o.checkedAtMs,
              },
            ]
          : [];
      })
      .slice(0, 20);
    return {
      inventory: inventoryState,
      inventoryIssue,
      issues,
      wallet: walletState,
      paymentGate:
        inventoryState !== "complete" || storageError
          ? "blocked"
          : "normal_wallet_and_order_checks_required",
      purchaseReadinessChecked: false,
      orders: {
        total: entries.length,
        legacy: entries.filter(
          ([, v]) => v.routingVersion !== "agentpay.runtime-call.v1",
        ).length,
        checked,
        settled,
        expired,
        missingResult,
        waiting,
        review,
        archived,
      },
      lastCheckedAtMs,
      storageError,
      nextAction:
        inventoryState === "blocked" || storageError
          ? "Preserve local history and repair its storage; new paid calls are paused."
          : walletState === "locked"
            ? "Run agentpay wallet unlock; Order checks will continue automatically."
            : walletState === "unavailable"
              ? "Start Wallet or inspect agentpay service logs wallet."
              : walletState === "unbound"
                ? "Complete Wallet authorization before Order checks."
                : walletState === "migration_pending"
                  ? "Complete the existing Policy migration."
                  : review
                    ? "Some Orders require review; their original requests are preserved."
                    : missingResult
                      ? "Some settled Orders have no verified local result. Do not repeat their purchases."
                      : "Order checks run in the background; this is not proof that a new purchase is eligible.",
    };
  }
  async function cycle() {
    if (!(await inspect())) return;
    let w;
    try {
      w = await readWallet();
      if (typeof w?.locked !== "boolean" || typeof w?.bound !== "boolean")
        throw Error();
      walletState = w.policyMigrationPending
        ? "migration_pending"
        : w.locked
          ? "locked"
          : !w.bound
            ? "unbound"
            : "available";
    } catch {
      walletState = "unavailable";
      return;
    }
    if (walletState !== "available") return;
    const entries = Object.entries(inventory);
    let changed = false;
    for (let n = 0; n < Math.min(entries.length, 4) && !stopped; n++) {
      const [id, entry] = entries[cursor++ % entries.length],
        hash = fingerprint(entry),
        old = observations[id];
      if (
        old?.fingerprint === hash &&
        old.source === settlementUrl &&
        old.nextCheckAtMs > now()
      )
        continue;
      let row = {
        fingerprint: hash,
        source: settlementUrl,
        checkedAtMs: now(),
        financialState: "unknown",
        resultState: "missing",
        orderId: entry.orderId,
        attempts: Math.min((old?.attempts || 0) + 1, 8),
      };
      // Keep terminal evidence even when this attempt fails before receiving a response.
      if (old?.fingerprint === hash && old.source === settlementUrl) {
        const prior =
          old.previousTerminalState ||
          (old.financialState === "terminal" && terminal.has(old.vaultState)
            ? old.vaultState
            : null);
        if (prior) {
          row.previousTerminalState = prior;
          row.previousCheckedAtMs = old.previousCheckedAtMs || old.checkedAtMs;
        }
      }
      try {
        let context = null;
        if (entry.routingVersion === "agentpay.runtime-call.v1") {
          const binding = JSON.parse(entry.serviceBinding);
          if (binding.version !== "agentpay.runtime-service.v1")
            throw fail("ORDER_IDENTITY_MISMATCH");
          const reference = parseServiceReference(binding.reference);
          context = {
            reference,
            skillId: reference.skillId,
            profileHash: reference.profileHash,
            requestedMaxUsageUnits: binding.requestedMaxUsageUnits,
          };
        }
        try {
          const result = await results.read(entry);
          if (result) {
            if (context) {
              normalizeRuntimeResult(
                result,
                context,
                entry.requestHash,
                entry.orderId,
              );
              row.resultState = "verified";
            } else row.resultState = "legacy_unverified";
          }
        } catch {
          row.resultState = "invalid";
        }
        let pending = null;
        if (row.resultState === "missing" && results.readPending) {
          try {
            pending = await results.readPending(entry);
            if (pending) {
              if (!context) row.resultState = "legacy_unverified";
              else {
                pending = providerOutput(
                  { result: pending },
                  context,
                  null,
                  entry.orderId,
                  entry.requestHash,
                );
                row.resultState = "pending";
              }
            }
          } catch {
            row.resultState = "invalid";
          }
        }
        const c = entry.paymentPayload?.payload?.commitment;
        const recoveryScope =
          entry.recoveryScope ||
          (c?.policyId && w.recoveryScope
            ? {
                ...w.recoveryScope,
                policyId: c.policyId,
                safe: c.safe,
                network: entry.paymentPayload.accepted?.network,
              }
            : null);
        if (
          entry.recoveryScope &&
          c?.policyId &&
          String(entry.recoveryScope.policyId).toLowerCase() !==
            String(c.policyId).toLowerCase()
        )
          throw fail("ORDER_IDENTITY_MISMATCH");
        let lookup = null;
        if (!entry.orderId && readRequest) {
          lookup = readSettlementResult(
            await readRequest(entry.orderRequestId, recoveryScope),
          );
          if (
            lookup.orderRequestId !== entry.orderRequestId ||
            typeof lookup.found !== "boolean"
          )
            throw fail("SETTLEMENT_RESPONSE_INVALID");
          if (!lookup.found)
            row.errorCode = recoveryScope
              ? "ORDER_REQUEST_NOT_FOUND"
              : "ORIGINAL_POLICY_UNKNOWN";
        }
        if (!entry.orderId && !lookup?.found) {
          row.errorCode ||= "ORDER_ID_UNRESOLVED";
        } else {
          const response =
              lookup ||
              readSettlementResult(
                await readOrder(entry.orderId, recoveryScope),
              ),
            o = response.order;
          const resolvedOrderId = entry.orderId || o?.orderId;
          if (
            !o ||
            !/^0x[0-9a-f]{64}$/.test(resolvedOrderId || "") ||
            o.orderId !== resolvedOrderId ||
            o.requestHash !== entry.requestHash
          )
            throw fail("ORDER_IDENTITY_MISMATCH");
          const lower = (v) => String(v).toLowerCase();
          if (
            c &&
            (c.orderId !== o.orderId ||
              lower(c.vault) !== lower(o.vaultAddress) ||
              lower(c.safe) !== lower(o.buyerAddress) ||
              lower(c.token) !== lower(o.assetAddress) ||
              String(c.amount) !== String(o.prepaidAmountAtomic))
          )
            throw fail("ORDER_IDENTITY_MISMATCH");
          if (
            context &&
            (o.skillId !== context.skillId ||
              o.profileHash !== context.profileHash ||
              o.providerId !== context.reference.profile.providerId ||
              `eip155:${o.chainId}` !== context.reference.profile.network ||
              lower(o.assetAddress) !== lower(context.reference.profile.asset))
          )
            throw fail("ORDER_IDENTITY_MISMATCH");
          if (!context && !c) throw fail("ORDER_IDENTITY_MISMATCH");
          const network = entry.paymentPayload?.accepted?.network;
          if (network && network !== `eip155:${o.chainId}`)
            throw fail("ORDER_IDENTITY_MISMATCH");
          const closure = response.closure?.state,
            expiredUnpaid = isUnpaidExpiry(response);
          if (
            (closure && o.vaultState === "Released") ||
            (closure === "refunded" && o.vaultState !== "Refunded") ||
            (closure === "cancelled" &&
              o.vaultState !== "Cancelled" &&
              !expiredUnpaid)
          )
            throw fail("ORDER_IDENTITY_MISMATCH");
          if (
            row.previousTerminalState &&
            o.vaultState !== row.previousTerminalState
          )
            throw fail("ORDER_STATE_CONFLICT");
          if (!entry.orderId) {
            if (!store.attachRecoveredOrder)
              throw fail("ORDER_IDENTITY_MISMATCH");
            // Attach only after all original request/service/commitment checks passed.
            await store.attachRecoveredOrder(
              entry,
              resolvedOrderId,
              recoveryScope || w.recoveryScope,
            );
            continue; // Next cycle checks the new fingerprint; never pay from recovery.
          }
          if (
            pending &&
            context &&
            row.resultState === "pending" &&
            response.deliveryEvidence
          ) {
            const evidence = response.deliveryEvidence;
            if (
              String(evidence.outputHash).toLowerCase() !==
                pending.outputHash ||
              String(evidence.usageUnits) !== String(pending.usageUnits)
            )
              throw fail("RECOVERY_RESULT_INVALID");
            const result = normalizeRuntimeResult(
              {
                version: "agentpay.runtime-result.v1",
                orderId: entry.orderId,
                requestHash: entry.requestHash,
                service: {
                  skillId: context.skillId,
                  profileHash: context.profileHash,
                },
                output: pending.output,
                outputHash: pending.outputHash,
                usageUnits: pending.usageUnits,
                deliveryEvidenceVerified: true,
                finalization: response.finalization,
                deadlines: response.deadlines,
              },
              context,
              entry.requestHash,
              entry.orderId,
            );
            try {
              await results.save(entry, result);
            } catch {
              throw fail("RESULT_STORAGE_UNAVAILABLE");
            }
            row.resultState = "verified";
          }
          row.expiredUnpaid = expiredUnpaid;
          row.vaultState = o.vaultState;
          row.financialState =
            terminal.has(o.vaultState) || expiredUnpaid
              ? "terminal"
              : closure
                ? "closing"
                : "pending";
          row.attempts = 0;
        }
      } catch (e) {
        const code = e.settlementCode || e.code;
        row.errorCode = knownCodes.has(code) ? code : "ORDER_CHECK_UNAVAILABLE";
      }
      if (row.resultState === "invalid" && !row.errorCode)
        row.errorCode = "RECOVERY_RESULT_INVALID";
      row.nextCheckAtMs =
        now() +
        (row.financialState === "terminal" && row.resultState !== "pending"
          ? 3600000
          : row.errorCode
            ? Math.min(300000, 5000 * 2 ** row.attempts)
            : 30000);
      if (stopped) return;
      // A foreground call may have advanced while the read was in flight.
      const fresh = await store.inventory();
      if (!fresh[id] || fingerprint(fresh[id]) !== hash) continue;
      observations[id] = row;
      changed = true;
    }
    if (changed || storageError) {
      try {
        await persist();
        storageError = false;
      } catch {
        storageError = true;
      }
    }
    lastCheckedAtMs = now();
  }
  function refresh() {
    if (active) return active;
    active = cycle()
      .catch(() => {
        inventoryState = "blocked";
      })
      .finally(() => {
        active = null;
      });
    return active;
  }
  return {
    status,
    refresh,
    assertInvocation(entry) {
      const observation = observations[entry.invocationId];
      if (
        observation?.fingerprint === fingerprint(entry) &&
        observation.source === settlementUrl &&
        [
          "ORDER_IDENTITY_MISMATCH",
          "ORDER_STATE_CONFLICT",
          "RECOVERY_RESULT_INVALID",
          "SETTLEMENT_RESPONSE_INVALID",
        ].includes(observation.errorCode)
      )
        throw Object.assign(
          Error(
            "This original request needs review. Preserve its history; do not create a replacement purchase.",
          ),
          { code: "RUNTIME_RECOVERY_REQUIRED", status: 409 },
        );
    },
    async assertLocalHistory() {
      if (!(await inspect()) || storageError)
        throw Object.assign(
          Error(
            "Local history needs review. Runtime remains available; preserve existing requests and check agentpay status.",
          ),
          { code: "RUNTIME_RECOVERY_REQUIRED", status: 409 },
        );
    },
    start() {
      stopped = false;
      const tick = async () => {
        await refresh();
        if (!stopped) {
          timer = setTimeout(tick, 10000 + Math.floor(Math.random() * 1000));
          timer.unref();
        }
      };
      void tick();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await active;
    },
  };
}
