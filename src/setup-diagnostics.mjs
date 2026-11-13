// SPDX-License-Identifier: MPL-2.0
// Only reviewed categories reach the terminal; never forward RPC request bodies,
// credential-bearing URLs or child-process output as a diagnostic message.
export const CHAIN_CHECK_TIMEOUT_MS = 30000;
export function failureGuidance(error) {
  const codes = [];
  const pending = [error];
  for (let i = 0; i < pending.length && i < 16; i++) {
    const e = pending[i];
    if (!e || typeof e !== "object") continue;
    if (typeof e.code === "string") codes.push(e.code);
    if (["TimeoutError", "AbortError"].includes(e.name)) codes.push(e.name);
    if (
      typeof e.message === "string" &&
      /^[A-Z][A-Z_0-9]{2,80}$/.test(e.message)
    )
      codes.push(e.message);
    pending.push(e.cause, e.error, e.info);
  }
  const has = (...values) => values.some((c) => codes.includes(c));
  let code, reason, next;
  if (
    has(
      "CHAIN_CHECK_TIMEOUT",
      "ANVIL_RPC_TIMEOUT",
      "TIMEOUT",
      "ETIMEDOUT",
      "AbortError",
      "TimeoutError",
    )
  ) {
    [code, reason, next] = [
      "CHAIN_CHECK_TIMEOUT",
      "The network check took too long.",
      "Check the network or SSH tunnel, then retry the saved step.",
    ];
  } else if (
    has(
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "NETWORK_ERROR",
      "CHAIN_RPC_UNAVAILABLE",
    )
  ) {
    [code, reason, next] = [
      "NETWORK_UNAVAILABLE",
      "A required network connection is unavailable.",
      "Check your connection and any SSH tunnel. Run agentpay health to identify the failing service.",
    ];
  } else if (has("CHAIN_ID_MISMATCH", "MIGRATION_CHAIN_MISMATCH")) {
    [code, reason, next] = [
      "CHAIN_ID_MISMATCH",
      "The RPC is connected to a different network.",
      "Check the saved RPC and network settings; do not replace your Wallet.",
    ];
  } else if (
    codes.some((c) =>
      /^(SAFE|MODULE|TOKEN|FACTORY|REGISTRY)_CODE_MISSING$/.test(c),
    )
  ) {
    code = codes.find((c) =>
      /^(SAFE|MODULE|TOKEN|FACTORY|REGISTRY)_CODE_MISSING$/.test(c),
    );
    reason = `No ${code.split("_")[0].toLowerCase()} contract was found at the saved address.`;
    next = "Check the network and deployment addresses with agentpay health.";
  } else if (has("INVALID_HEALTH_RESPONSE")) {
    [code, reason, next] = [
      "INVALID_HEALTH_RESPONSE",
      "The service returned an unexpected response instead of its health data.",
      "Check the configured service path and proxy routing. Share this report with support if it persists.",
    ];
  } else if (has("SOFTWARE_VERSION_MISMATCH")) {
    [code, reason, next] = [
      "SOFTWARE_VERSION_MISMATCH",
      "Installed User and Wallet versions do not match.",
      "Run agentpay update, then agentpay repair if requested. Keep your private data.",
    ];
  } else if (has("STEP_FAILED")) {
    [code, reason, next] = [
      "STEP_FAILED",
      "A helper program stopped before this step could finish.",
      "Check the message above and run agentpay health. For running services, inspect agentpay service logs wallet or agentpay service logs runtime.",
    ];
  } else if (has("ANVIL_SAFE_OWNER_OR_THRESHOLD_MISMATCH")) {
    [code, reason, next] = [
      "SAFE_APPROVAL_MISMATCH",
      "The Safe owner or approval threshold does not match this setup.",
      "Check the Safe owners and required signatures before retrying. Keep the saved key and draft.",
    ];
  } else if (has("POLICY_NOT_FOUND")) {
    [code, reason, next] = [
      "POLICY_NOT_FOUND",
      "The saved Policy was not found on this network.",
      "Check the saved network, Safe and Module. Do not create a replacement to recover old Orders.",
    ];
  } else if (codes.some((c) => /^HTTP_[1-5][0-9]{2}$/.test(c))) {
    code = codes.find((c) => /^HTTP_[1-5][0-9]{2}$/.test(c));
    reason =
      "The service returned HTTP " +
      code.slice(5) +
      " instead of a successful health response.";
    next =
      "Check platform availability and the configured service path. If it persists, share this report with support.";
  } else if (has("SAFE_OWNER_MISMATCH")) {
    [code, reason, next] = [
      "SAFE_OWNER_MISMATCH",
      "The saved owner address is not an owner of this Safe.",
      "Check the owner account in your wallet and the Safe address; keep your saved key.",
    ];
  } else if (has("CALL_EXCEPTION", "BAD_DATA")) {
    [code, reason, next] = [
      "CONTRACT_READ_FAILED",
      "A contract could not return the expected data.",
      "Run agentpay health to identify the contract; check its address and deployment version.",
    ];
  } else if (has("EACCES", "EPERM", "UNSAFE_LOCAL_FILE")) {
    [code, reason, next] = [
      "LOCAL_FILE_ACCESS",
      "Local files could not be read safely.",
      "Check file ownership and permissions. Keep your data; do not create a replacement Wallet.",
    ];
  } else if (has("ENOENT", "LOCAL_SETTINGS_MISSING")) {
    [code, reason, next] = [
      "LOCAL_SETTINGS_MISSING",
      "Required local files are missing.",
      "Run agentpay health and check this installation’s data folder before continuing.",
    ];
  } else if (has("UNLOCK_FAILED")) {
    [code, reason, next] = [
      "UNLOCK_FAILED",
      "The Wallet could not be unlocked with that password.",
      "Check the password for this installation and retry. Do not replace the key file.",
    ];
  } else if (
    has(
      "LOCKED",
      "WALLET_LOCKED",
      "WALLET_NOT_RUNNING",
      "LOCAL_PROCESS_START_TIMEOUT",
      "LOCAL_PROCESS_EXITED",
    )
  ) {
    [code, reason, next] = [
      "LOCAL_SERVICE_UNAVAILABLE",
      "Wallet or Runtime is not ready.",
      "Run agentpay status; unlock Wallet if requested, or inspect agentpay service logs wallet and agentpay service logs runtime.",
    ];
  } else {
    code =
      codes.find((c) =>
        /^(HTTP_[1-5][0-9]{2}|INVALID_ADDRESS|INVALID_SERVICE_URL|INVALID_HEALTH_RESPONSE|STEP_FAILED)$/.test(
          c,
        ),
      ) || "CHECK_FAILED";
    reason = "This step could not complete; the cause has not been confirmed.";
    next =
      "Run agentpay health. Share its report and this error code with support.";
  }
  return { code, reason, next };
}
export function formatSetupFailure(error, { preflight = false } = {}) {
  const { code, reason, next } = failureGuidance(error);
  return `[!] ${reason}\n  Code: ${code}\n  ${next}\n  Saved progress is kept. ${preflight ? "No transaction was submitted by this check." : "If a transaction was already submitted, resume the same step to check it; do not create a replacement request."}`;
}
