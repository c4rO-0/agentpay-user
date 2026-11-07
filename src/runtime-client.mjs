// Shared Skill transport and recovery. Resolve local credentials privately; endpoint
// changes must not replace the original purchase identity or bypass retained checkpoints.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { withClientRequestLock } from "./client-request-lock.mjs";
import { normalizeServiceReference, hashPrivateRequest } from "@c4roa0/agentpay-protocol";
import {
  normalizeAcceptedTerms,
  normalizeRuntimeResult,
  serviceRequest,
  usageCap,
} from "./service-reference.mjs";
// Local harness transport only. Wallet and Runtime remain the payment authority.
import { constants } from "node:fs";
import {
  open,
  mkdir,
  link,
  unlink,
  rename,
  rmdir,
  readdir,
} from "node:fs/promises";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const FORMAT = "agentpay.runtime-connection.v1";
const ID = /^[A-Za-z0-9._:-]{16,128}$/;
export class RuntimeClientError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}
const fail = (code, message) => new RuntimeClientError(code, message);
export function userDataDirectory(env = process.env) {
  return resolve(
    env.AGENTPAY_USER_DATA_DIR || join(homedir(), ".local/share/agentpay/user"),
  );
}
export function runtimeBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail(
      "LOCAL_RUNTIME_URL_REQUIRED",
      "Use a loopback HTTP Runtime address.",
    );
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw fail(
      "LOCAL_RUNTIME_URL_REQUIRED",
      "Use a loopback HTTP Runtime address.",
    );
  return url.href;
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const st = await handle.stat();
    if (st.uid !== process.getuid() || st.mode & 0o077)
      throw fail(
        "LOCAL_STATE_UNSAFE",
        "Use an owner-held private AgentPay data directory.",
      );
  } finally {
    await handle.close();
  }
  // Persist a newly created directory's name before any paid request can use it.
  await syncDirectory(dirname(path));
}
export async function readPrivateFile(path, max = 16384) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (
      !st.isFile() ||
      st.uid !== process.getuid() ||
      st.mode & 0o077 ||
      st.size > max
    )
      throw fail(
        "LOCAL_STATE_UNSAFE",
        "Inspect the local AgentPay file permissions and size.",
      );
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path) {
  const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
async function publishJson(path, value, { replace = false } = {}) {
  const temp = join(dirname(path), `.client-${randomUUID()}.tmp`);
  const h = await open(temp, "wx", 0o600);
  try {
    try {
      await h.writeFile(JSON.stringify(value) + "\n");
      await h.sync();
    } finally {
      await h.close();
    }
    if (replace) await rename(temp, path);
    else await link(temp, path);
    await syncDirectory(dirname(path));
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
export async function saveRuntimeConnection({ dataDir, runtimeUrl }) {
  dataDir = resolve(dataDir);
  await privateDirectory(dataDir);
  await privateDirectory(join(dataDir, "runtime"));
  const path = join(dataDir, "runtime", "connection.json");
  const value = {
    version: FORMAT,
    runtimeUrl: runtimeBase(runtimeUrl),
    callerTokenFile: join(dataDir, "runtime", "caller.token"),
    clientModule: fileURLToPath(import.meta.url),
  };
  let old;
  try {
    old = JSON.parse(await readPrivateFile(path));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw fail(
        "LOCAL_SETUP_REQUIRED",
        "Inspect the saved local connection file before refreshing setup.",
      );
  }
  if (JSON.stringify(old) !== JSON.stringify(value))
    await publishJson(path, value, { replace: old !== undefined });
  return value;
}
export async function loadRuntimeConnection({
  dataDir = userDataDirectory(),
  env = process.env,
} = {}) {
  dataDir = resolve(dataDir);
  let value;
  try {
    value = JSON.parse(
      await readPrivateFile(join(dataDir, "runtime", "connection.json")),
    );
  } catch (error) {
    if (error.code === "ENOENT")
      throw fail(
        "LOCAL_SETUP_REQUIRED",
        "Local Runtime connection is missing. Run ./run repair, then retry the original request.",
      );
    throw fail(
      "LOCAL_SETUP_REQUIRED",
      "Local Runtime connection could not be read safely. Run ./run repair for diagnostics; keep your local files.",
    );
  }
  if (
    value?.version !== FORMAT ||
    !isAbsolute(value.callerTokenFile || "") ||
    !isAbsolute(value.clientModule || "")
  )
    throw fail(
      "LOCAL_SETUP_REQUIRED",
      "Run AgentPay setup to refresh the local Runtime connection.",
    );
  return {
    dataDir,
    runtimeUrl: runtimeBase(env.AGENTPAY_USER_URL || value.runtimeUrl),
    callerTokenFile:
      env.AGENTPAY_USER_CALLER_TOKEN_FILE || value.callerTokenFile,
  };
}
function identity(service) {
  try {
    return normalizeServiceReference(service);
  } catch {
    throw fail(
      "SKILL_SERVICE_INVALID",
      "Use a registered public service reference. Preserve older requests for recovery review.",
    );
  }
}
async function requestJson(url, options, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal,
    });
    const chunks = [];
    let length = 0;
    if (response.body)
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 2 * 1048576)
          throw fail(
            "RUNTIME_RESPONSE_TOO_LARGE",
            "Runtime response exceeded the local size limit. Keep the original request and inspect Runtime logs; do not create a replacement purchase.",
          );
        chunks.push(chunk);
      }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw fail(
        "RUNTIME_RESPONSE_INVALID",
        "Runtime returned unreadable data. Check ./run service logs runtime; keep the original request and do not create a replacement purchase.",
      );
    }
    return { response, body };
  } catch (error) {
    if (error instanceof RuntimeClientError) throw error;
    if (signal.aborted)
      throw fail(
        "RUNTIME_TIMEOUT",
        "Runtime did not finish responding in time. The request may still be running. Resume the same request; do not create a replacement purchase.",
      );
    throw fail(
      "RUNTIME_UNAVAILABLE",
      "Could not finish communicating with Runtime. Check ./run status and ./run service logs runtime, then resume the same request. Do not create a replacement purchase.",
    );
  }
}
async function callerToken(connection) {
  let token;
  try {
    token = (await readPrivateFile(connection.callerTokenFile, 256)).trim();
  } catch {
    throw fail(
      "LOCAL_CREDENTIAL_REQUIRED",
      "Complete local AgentPay setup to repair the caller credential. Never paste credentials into chat.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(token))
    throw fail(
      "LOCAL_CREDENTIAL_REQUIRED",
      "Complete local AgentPay setup to repair the caller credential.",
    );
  return token;
}
export async function checkRuntime(
  connection,
  service,
  { timeoutMs = 5000 } = {},
) {
  const expected = identity(service),
    token = await callerToken(connection);
  const { response, body } = await requestJson(
    new URL("/services/check", runtimeBase(connection.runtimeUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ service: expected }),
    },
    timeoutMs,
  );
  if (response.status === 401)
    throw fail(
      "UNAUTHORIZED",
      "Complete local AgentPay setup to repair the caller credential.",
    );
  let genericMatches = false;
  try {
    genericMatches =
      JSON.stringify(normalizeServiceReference(body.result?.service)) ===
      JSON.stringify(expected);
  } catch {}
  if (
    !response.ok ||
    body?.ok !== true ||
    body.result?.role !== "user-runtime" ||
    !genericMatches
  )
    throw fail(
      "RUNTIME_SERVICE_IDENTITY_MISMATCH",
      "Runtime must support the service reference supplied by this Skill.",
    );
  return {
    ok: true,
    runtimeIdentityMatches: true,
    purchaseReadinessChecked: false,
    orderCreated: false,
    originalRequestRecovery:
      body.result?.capabilities?.includes("agentpay.original-request.v1") ===
      true,
  };
}
function callInput(input, service) {
  identity(service);
  try {
    if (
      !input ||
      Object.keys(input)
        .filter((k) => k !== "acceptedTerms")
        .sort()
        .join(",") !== "request,requestedMaxUsageUnits"
    )
      throw Error();
    return {
      request: serviceRequest(input.request),
      requestedMaxUsageUnits: usageCap(input.requestedMaxUsageUnits),
      ...(input.acceptedTerms === undefined
        ? {}
        : { acceptedTerms: normalizeAcceptedTerms(input.acceptedTerms) }),
    };
  } catch {
    throw fail(
      "INVALID_INPUT",
      "Use bounded JSON input and a positive maximum usage string.",
    );
  }
}
function checkpointPath(connection, id) {
  if (typeof id !== "string" || !ID.test(id))
    throw fail(
      "INVALID_REQUEST_ID",
      "Use a request identifier of 16–128 letters, digits, dots, colons, underscores or hyphens.",
    );
  return join(
    connection.dataDir,
    "runtime",
    "client-requests",
    createHash("sha256").update(id).digest("hex") + ".json",
  );
}
export async function prepareInvocation(
  connection,
  service,
  input,
  requestId = randomUUID(),
) {
  input = callInput(input, service);
  const path = checkpointPath(connection, requestId);
  await privateDirectory(connection.dataDir);
  await privateDirectory(join(connection.dataDir, "runtime"));
  await privateDirectory(dirname(path));
  const checkpoint = {
    version: "agentpay.runtime-client-request.v1",
    requestId,
    runtimeUrl: runtimeBase(connection.runtimeUrl),
    service: identity(service),
    input,
    submissionState: "prepared",
    createdAtMs: Date.now(),
  };
  try {
    await publishJson(path, checkpoint);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  // A racing creator may have linked the file but not yet synced the directory.
  await syncDirectory(dirname(path));
  return resumeInvocation(connection, service, requestId, input);
}
export async function resumeInvocation(
  connection,
  service,
  requestId,
  expectedInput,
) {
  const path = checkpointPath(connection, requestId);
  let saved;
  try {
    saved = JSON.parse(await readPrivateFile(path, 2 * 1048576));
  } catch {
    throw fail(
      "REQUEST_NOT_FOUND",
      "The saved request cannot be read. Preserve local state; do not create a replacement purchase.",
    );
  }
  if (
    saved?.version !== "agentpay.runtime-client-request.v1" ||
    saved.requestId !== requestId ||
    JSON.stringify(saved.service) !== JSON.stringify(identity(service)) ||
    !Number.isSafeInteger(saved.createdAtMs)
  )
    throw fail(
      "REQUEST_CONFLICT",
      "Restore the original Skill and request input before resuming this request.",
    );
  let input = callInput(saved.input, service);
  try {
    if (saved.fileDeclarations !== undefined)
      validateFileDeclarations(saved.fileDeclarations);
    if (saved.preparedRequest !== undefined) {
      if (!saved.fileDeclarations?.length) throw Error();
      serviceRequest(saved.preparedRequest);
    }
    if (
      saved.fileDeclarations?.length &&
      saved.submissionState !== "prepared" &&
      saved.preparedRequest === undefined
    )
      throw Error();
    if (
      saved.originalOrderRequestId !== undefined &&
      !/^0x[0-9a-f]{64}$/.test(saved.originalOrderRequestId)
    )
      throw Error();
  } catch {
    throw fail(
      "REQUEST_STATE_INVALID",
      "Original input snapshot metadata needs review. No replacement purchase was started.",
    );
  }
  if (
    saved.submissionState !== undefined &&
    !["prepared", "possible"].includes(saved.submissionState)
  )
    throw fail(
      "REQUEST_STATE_INVALID",
      "Preserve the original request for review.",
    );
  if (
    expectedInput &&
    JSON.stringify(input) !== JSON.stringify(callInput(expectedInput, service))
  ) {
    const next = callInput(expectedInput, service);
    if (
      saved.quoteAcceptanceRejected === true &&
      JSON.stringify(input.request) === JSON.stringify(next.request) &&
      input.requestedMaxUsageUnits === next.requestedMaxUsageUnits &&
      !(await cachedResult(connection, saved))
    ) {
      saved = { ...saved, input: next, quoteAcceptanceRejected: false };
      await publishJson(path, saved, { replace: true });
      input = next;
    } else
      throw fail(
        "REQUEST_CONFLICT",
        "This request identifier already belongs to different input.",
      );
  }
  return { ...saved, input };
}
function verifiedResult(body, input, service) {
  try {
    if (body?.ok !== true) throw Error();
    return {
      ok: true,
      result: normalizeRuntimeResult(
        body.result,
        {
          reference: service,
          skillId: service.skillId,
          profileHash: service.profileHash,
          requestedMaxUsageUnits: input.requestedMaxUsageUnits,
        },
        hashPrivateRequest(input.request),
      ),
    };
  } catch {
    throw fail(
      "RUNTIME_RESPONSE_INVALID",
      "Runtime did not return verified delivery for this service and input. Retry the same call.",
    );
  }
}
async function cachedResult(connection, saved) {
  const path = checkpointPath(connection, saved.requestId).replace(
    /\.json$/,
    ".result.json",
  );
  let value;
  try {
    value = JSON.parse(await readPrivateFile(path, 2 * 1048576));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw fail(
      "REQUEST_STATE_INVALID",
      "Preserve the saved result for inspection; no replacement purchase was started.",
    );
  }
  if (
    value?.version !== "agentpay.runtime-client-result.v1" ||
    value.requestId !== saved.requestId
  )
    throw fail(
      "REQUEST_STATE_INVALID",
      "Preserve the saved result for inspection; no replacement purchase was started.",
    );
  return verifiedResult(value.body, effectiveInput(saved), saved.service);
}
function effectiveInput(saved) {
  return {
    ...saved.input,
    ...(saved.preparedRequest === undefined
      ? {}
      : { request: serviceRequest(saved.preparedRequest) }),
  };
}
export async function invokeService(
  connection,
  service,
  checkpoint,
  options = {},
) {
  const path = checkpointPath(connection, checkpoint.requestId);
  // A missing checkpoint must not create directories or acquire a replacement identity.
  await resumeInvocation(
    connection,
    service,
    checkpoint.requestId,
    checkpoint.input,
  );
  try {
    return await withClientRequestLock(path + ".lock", () =>
      invokeSaved(connection, service, checkpoint, options),
    );
  } catch (error) {
    if (error.code === "REQUEST_BUSY") throw fail(error.code, error.message);
    throw error;
  }
}
async function invokeSaved(
  connection,
  service,
  checkpoint,
  { timeoutMs = 300000, inputFiles, prepareRequest } = {},
) {
  // Re-read durable state: no POST is allowed for an unpersisted or changed request.
  let saved = await resumeInvocation(
    connection,
    service,
    checkpoint.requestId,
    checkpoint.input,
  );
  const cached = await cachedResult(connection, saved);
  if (cached) return { ...cached, reusedResult: true };
  const checked = await checkRuntime(connection, service);
  if (!checked.originalRequestRecovery)
    throw fail(
      "RUNTIME_UPDATE_REQUIRED",
      "Update and restart User Runtime before continuing this original request.",
    );
  const token = await callerToken(connection);
  let actualInput = effectiveInput(saved),
    originalOrderRequestId;
  if (saved.submissionState !== "prepared") {
    const history = await requestJson(
      new URL("/services/history", connection.runtimeUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "idempotency-key": saved.requestId,
        },
        body: JSON.stringify({
          version: "agentpay.runtime-call.v1",
          service: saved.service,
          ...actualInput,
        }),
      },
      10000,
    );
    const found = history.body?.result;
    if (
      !history.response.ok ||
      history.body?.ok !== true ||
      !/^0x[0-9a-f]{64}$/.test(found?.orderRequestId || "") ||
      (saved.originalOrderRequestId &&
        saved.originalOrderRequestId !== found.orderRequestId)
    )
      throw fail(
        "ORIGINAL_REQUEST_NOT_FOUND",
        "Original Runtime history is missing or differs. Keep this request; do not start a replacement purchase.",
      );
    originalOrderRequestId = found.orderRequestId;
    if (found.delivery) {
      const verified = verifiedResult(
        { ok: true, result: found.delivery },
        actualInput,
        saved.service,
      );
      await persistClientResult(connection, saved, verified);
      return { ...(await cachedResult(connection, saved)), reusedResult: true };
    }
  }
  saved = await prepareInputSnapshot(connection, saved, {
    inputFiles,
    prepareRequest,
  });
  actualInput = effectiveInput(saved);
  saved = {
    ...saved,
    submissionState: "possible",
    ...(originalOrderRequestId ? { originalOrderRequestId } : {}),
  };
  await publishJson(checkpointPath(connection, saved.requestId), saved, {
    replace: true,
  });
  const { response, body } = await requestJson(
    new URL("/services/invoke", connection.runtimeUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": saved.requestId,
        ...(originalOrderRequestId
          ? { "x-agentpay-original-request": originalOrderRequestId }
          : {}),
      },
      body: JSON.stringify({
        version: "agentpay.runtime-call.v1",
        service: saved.service,
        ...actualInput,
      }),
    },
    timeoutMs,
  );
  if (!response.ok || body?.ok !== true) {
    if (body?.error?.code === "QUOTE_TERMS_CHANGED")
      await publishJson(
        checkpointPath(connection, saved.requestId),
        { ...saved, quoteAcceptanceRejected: true },
        { replace: true },
      );
    const known = {
      ORIGINAL_REQUEST_NOT_FOUND:
        "Original Runtime history changed or disappeared. Preserve the request; no replacement purchase was created.",
      ORDER_EXPIRED:
        "This Order expired without payment. No result is expected. The original request will not make another payment.",
      ORDER_TERMS_MISMATCH:
        "The prepared Order differs from accepted conditions. No payment was signed. Run ./run orders list and preserve this Order for support; do not replace it.",
      QUOTE_TERMS_CHANGED:
        "Price or delivery time changed before Order creation. Read --quote, reevaluate the terms and continue this same request; do not use --force.",
      QUOTE_TERMS_CONFLICT:
        "This request already accepted other terms. Preserve its original identifier and check its Order.",
      ORDER_ALREADY_SETTLED:
        "This Order is settled but its local result is unavailable. Preserve the original request; do not repeat the purchase.",
      RUNTIME_RECOVERY_REQUIRED:
        "Runtime is running but local history needs review. Run ./run status; do not delete history or create replacement purchases.",
      ORDER_CLOSING:
        "Order closure is pending. Query this Order; do not submit another payment.",
      ORDER_CANCELLED: "This Order was cancelled. Preserve its saved request.",
      ORDER_REFUNDED:
        "This Order was refunded. Cumulative Policy spend is not restored.",
      LOCKED:
        "From the User repository, run ./run wallet unlock, then resume this request.",
      POLICY_UNBOUND:
        "Complete spending authorization and Wallet binding in AgentPay setup, then resume this request.",
      POLICY_MIGRATION_PENDING:
        "Finish the pending Policy migration in your terminal, then resume this request.",
      UNAUTHORIZED: "Run AgentPay setup to repair the local caller credential.",
      WALLET_LOCKED:
        "From the User repository, run ./run wallet unlock, then resume this request.",
      SERVICE_MAINTENANCE:
        "Service is under maintenance. Resume this request later.",
      SERVICE_NOT_READY:
        "Service is not ready. Check its status, then resume this request.",
    };
    const raw = body?.error?.code;
    const code = Object.hasOwn(known, raw) ? raw : "RUNTIME_REQUEST_FAILED";
    throw new RuntimeClientError(
      code,
      known[code] ||
        "Runtime could not finish this request. Check local Wallet/Runtime status, then resume the same request.",
      {
        ...(typeof raw === "string" &&
        /^[A-Z][A-Z0-9_]{0,79}$/.test(raw) &&
        !raw.includes(token)
          ? { runtimeCode: raw }
          : {}),
      },
    );
  }
  const verified = verifiedResult(body, actualInput, saved.service);
  await persistClientResult(connection, saved, verified);
  return { ...(await cachedResult(connection, saved)), reusedResult: false };
}

async function persistClientResult(connection, saved, verified) {
  const resultPath = checkpointPath(connection, saved.requestId).replace(
    /\.json$/,
    ".result.json",
  );
  try {
    await publishJson(resultPath, {
      version: "agentpay.runtime-client-result.v1",
      requestId: saved.requestId,
      body: verified,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await syncDirectory(dirname(resultPath));
}

// Serialize only request selection/state changes; network calls never hold this lock.
// A crash in this short section leaves a lock and fails closed for operator review.
async function withPendingRequests(connection, service, input, work) {
  input = callInput(input, service);
  const reference = identity(service);
  // Adapter/cap edits are not a new purchase intent: find the old record and let
  // its full immutable binding reject changes unless the caller explicitly forces.
  const scopeService = {
    version: reference.version,
    skillId: reference.skillId,
    profileHash: reference.profileHash,
    profile: reference.profile,
  };
  const binding = { service: scopeService, input: input.request };
  const key = createHash("sha256")
    .update(JSON.stringify(binding))
    .digest("hex");
  const parent = join(connection.dataDir, "runtime", "client-pending");
  await privateDirectory(connection.dataDir);
  await privateDirectory(join(connection.dataDir, "runtime"));
  await privateDirectory(parent);
  const lock = join(parent, key + ".lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw fail(
        "REQUEST_SELECTION_BUSY",
        "Local request recovery is busy. Retry the same call; preserve state for inspection if this persists.",
      );
    throw error;
  }
  try {
    const path = join(parent, key + ".json");
    let saved;
    try {
      saved = JSON.parse(await readPrivateFile(path, 524288));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw fail(
          "REQUEST_STATE_INVALID",
          "Preserve local request state for inspection; no new purchase was started.",
        );
    }
    if (saved === undefined) {
      const names = await readdir(parent);
      if (names.some((n) => n.endsWith(".lock") && n !== key + ".lock"))
        throw fail(
          "REQUEST_SELECTION_BUSY",
          "Another request selection is active or needs review. Preserve the old selection records.",
        );
      if (names.length > 20000)
        throw fail(
          "REQUEST_STATE_INVALID",
          "Local request selection history needs review.",
        );
      const matches = [];
      for (const name of names.filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
        if (name === key + ".json") continue;
        let old;
        try {
          old = JSON.parse(await readPrivateFile(join(parent, name), 524288));
        } catch {
          throw fail(
            "REQUEST_STATE_INVALID",
            "Existing request selection could not be read. Preserve history.",
          );
        }
        if (
          old?.version === "agentpay.runtime-client-pending.v1" &&
          JSON.stringify({
            service: old.binding?.service,
            input: old.binding?.input,
          }) === JSON.stringify(binding)
        ) {
          if (
            !Array.isArray(old.pending) ||
            old.pending.some((id) => typeof id !== "string" || !ID.test(id)) ||
            (old.currentId !== undefined &&
              (typeof old.currentId !== "string" || !ID.test(old.currentId)))
          )
            throw fail(
              "REQUEST_STATE_INVALID",
              "Original request selection needs review.",
            );
          matches.push(old);
        }
      }
      if (matches.length) {
        const ids = new Set(
          matches.flatMap((r) => [
            ...(r.pending || []),
            ...(r.currentId ? [r.currentId] : []),
          ]),
        );
        saved = {
          version: "agentpay.runtime-client-pending.v2",
          binding,
          pending: [...ids],
          ...(ids.size === 1 ? { currentId: [...ids][0] } : {}),
        };
        await publishJson(path, saved);
      }
    }
    if (
      saved !== undefined &&
      (!saved ||
        saved.version !== "agentpay.runtime-client-pending.v2" ||
        JSON.stringify(saved.binding) !== JSON.stringify(binding) ||
        !Array.isArray(saved.pending) ||
        (saved.currentId !== undefined &&
          (typeof saved.currentId !== "string" || !ID.test(saved.currentId))) ||
        saved.pending.some((id) => typeof id !== "string" || !ID.test(id)) ||
        new Set(saved.pending).size !== saved.pending.length)
    )
      throw fail(
        "REQUEST_STATE_INVALID",
        "Preserve local request state for inspection; no new purchase was started.",
      );
    const state = saved || {
      version: "agentpay.runtime-client-pending.v2",
      binding,
      pending: [],
    };
    return await work(state, async () =>
      publishJson(path, state, { replace: saved !== undefined }),
    );
  } finally {
    await rmdir(lock);
  }
}
export async function selectInvocation(
  connection,
  service,
  input,
  { force = false, requestId } = {},
) {
  if (force && requestId !== undefined)
    throw fail(
      "INVALID_ARGUMENTS",
      "Use --force without an explicit request identifier.",
    );
  return withPendingRequests(
    connection,
    service,
    input,
    async (state, save) => {
      if (!force && requestId === undefined && state.pending.length > 1)
        throw fail(
          "REQUEST_AMBIGUOUS",
          "Several unfinished requests match. Resume the intended request by its saved identifier; no new purchase was started.",
        );
      const id =
        requestId || (!force ? state.currentId || state.pending[0] : undefined);
      const checkpoint = id
        ? await prepareInvocation(connection, service, input, id)
        : await prepareInvocation(connection, service, input);
      if (!state.pending.includes(checkpoint.requestId)) {
        const cached = await cachedResult(connection, checkpoint);
        if (!cached) state.pending.push(checkpoint.requestId);
        const changed = !cached || state.currentId !== checkpoint.requestId;
        state.currentId = checkpoint.requestId;
        if (changed) await save();
      }
      return checkpoint;
    },
  );
}
export async function completeInvocation(connection, service, checkpoint) {
  const saved = await resumeInvocation(
    connection,
    service,
    checkpoint.requestId,
    checkpoint.input,
  );
  if (!(await cachedResult(connection, saved)))
    throw fail(
      "REQUEST_STATE_INVALID",
      "Keep this request pending until verified delivery has been saved.",
    );
  if (saved.fileDeclarations?.length) {
    // Release only after both local verified-result persistence and independent
    // Runtime verification. Failure leaves input protected; it never loses delivery.
    try {
      const token = await callerToken(connection);
      await requestJson(
        new URL("/files/input-release", connection.runtimeUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "idempotency-key": saved.requestId,
          },
          body: JSON.stringify({
            version: "agentpay.runtime-call.v1",
            service: saved.service,
            ...effectiveInput(saved),
          }),
        },
        10000,
      );
    } catch {}
  }
  return withPendingRequests(
    connection,
    service,
    checkpoint.input,
    async (state, save) => {
      if (state.pending.includes(checkpoint.requestId)) {
        state.pending = state.pending.filter(
          (id) => id !== checkpoint.requestId,
        );
        await save();
      }
    },
  );
}

export async function readServiceOffer(
  connection,
  service,
  { timeoutMs = 7000 } = {},
) {
  const token = await callerToken(connection),
    expected = identity(service);
  const { response, body } = await requestJson(
    new URL("/services/offer", runtimeBase(connection.runtimeUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({ service: expected }),
    },
    timeoutMs,
  );
  if (!response.ok || body?.ok !== true)
    throw fail(
      "OFFER_UNAVAILABLE",
      body?.error?.message || "Current offer unavailable",
    );
  return body.result;
}

// Explicit file operations are independent of service execution and payment.
// The Skill chooses which URL to save. No links in output are fetched implicitly.
export async function cacheResultFile(
  connection,
  { orderId, fileKey, url, filename, sha256 },
) {
  return resultFileOperation(connection, "cache", {
    orderId,
    fileKey,
    url,
    ...(filename === undefined ? {} : { filename }),
    ...(sha256 === undefined ? {} : { sha256 }),
  });
}
export async function listResultFiles(
  connection,
  orderId,
  { offset = 0, limit = 100 } = {},
) {
  return resultFileOperation(connection, "list", { orderId, offset, limit });
}
export async function removeResultFile(
  connection,
  { orderId, fileKey, confirmed },
) {
  return resultFileOperation(connection, "remove", {
    orderId,
    fileKey,
    confirmed,
  });
}
async function resultFileOperation(connection, action, input) {
  const token = await callerToken(connection);
  const { response, body } = await requestJson(
    new URL("/files/" + action, runtimeBase(connection.runtimeUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
    action === "cache" ? 86410000 : 10000,
  );
  if (!response.ok || body?.ok !== true)
    throw fail(
      body?.error?.code || "FILE_OPERATION_FAILED",
      body?.error?.message ||
        "Local file operation failed. No new purchase was made.",
    );
  return body.result;
}

export async function cacheManagement(connection, input) {
  const token = await callerToken(connection);
  const { response, body } = await requestJson(
    new URL("/cache/manage", runtimeBase(connection.runtimeUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
    120000,
  );
  if (!response.ok || body?.ok !== true)
    throw fail(
      body?.error?.code || "FILE_OPERATION_FAILED",
      body?.error?.message ||
        "Cache management is unavailable. Update Runtime or use --offline after stopping it.",
    );
  return body.result;
}

function validateFileDeclarations(declarations) {
  if (!Array.isArray(declarations) || declarations.length > 20)
    throw fail("INPUT_FILES_INVALID", "Declare at most 20 input files.");
  const keys = new Set();
  for (const f of declarations) {
    if (
      !f ||
      typeof f !== "object" ||
      Array.isArray(f) ||
      Object.keys(f).some(
        (k) =>
          !["fileKey", "sourcePath", "url", "filename", "sha256"].includes(k),
      ) ||
      typeof f.fileKey !== "string" ||
      !/^[A-Za-z0-9._-]{1,80}$/.test(f.fileKey) ||
      keys.has(f.fileKey) ||
      (typeof f.sourcePath === "string") === (typeof f.url === "string") ||
      (typeof f.sourcePath === "string" &&
        (!isAbsolute(f.sourcePath) || f.sourcePath.length > 8192)) ||
      (typeof f.url === "string" && f.url.length > 8192) ||
      (f.filename !== undefined &&
        (typeof f.filename !== "string" || f.filename.length > 200)) ||
      (f.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(f.sha256))
    )
      throw fail(
        "INPUT_FILES_INVALID",
        "Declare unique file keys, one source per file and bounded metadata.",
      );
    keys.add(f.fileKey);
  }
}

async function prepareInputSnapshot(
  connection,
  saved,
  { inputFiles, prepareRequest },
) {
  if (saved.fileDeclarations === undefined) {
    // A historical or possibly submitted request must never reinterpret its input.
    if (saved.submissionState !== "prepared" || !inputFiles) return saved;
    const declarations = await inputFiles(structuredClone(saved.input.request));
    validateFileDeclarations(declarations);
    if (declarations.length && !prepareRequest)
      throw fail(
        "INPUT_ADAPTER_REQUIRED",
        "This Skill must prepare its business request from the saved file copies.",
      );
    saved = { ...saved, fileDeclarations: declarations };
    await publishJson(checkpointPath(connection, saved.requestId), saved, {
      replace: true,
    });
  }
  if (!saved.fileDeclarations.length) return saved;
  const rows = await inputFileOperation(connection, {
    requestId: saved.requestId,
    files: saved.fileDeclarations,
  });
  if (saved.preparedRequest === undefined) {
    if (saved.submissionState !== "prepared" || !prepareRequest)
      throw fail(
        "INPUT_ADAPTER_REQUIRED",
        "Restore this Skill’s input adapter to continue the original request.",
      );
    const request = serviceRequest(
      await prepareRequest({
        request: structuredClone(saved.input.request),
        files: rows,
        requestId: saved.requestId,
      }),
    );
    await inputFileOperation(connection, {
      requestId: saved.requestId,
      files: saved.fileDeclarations,
    });
    saved = { ...saved, preparedRequest: request };
    await publishJson(checkpointPath(connection, saved.requestId), saved, {
      replace: true,
    });
  }
  return saved;
}
async function inputFileOperation(connection, input) {
  const token = await callerToken(connection);
  const { response, body } = await requestJson(
    new URL("/files/input", runtimeBase(connection.runtimeUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
    86410000,
  );
  if (!response.ok || body?.ok !== true)
    throw fail(
      body?.error?.code || "INPUT_SNAPSHOT_FAILED",
      body?.error?.message ||
        "Input snapshot is incomplete. Preserve the original request.",
    );
  return body.result;
}
