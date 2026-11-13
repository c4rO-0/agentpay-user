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
  const requestFailures = {
    SERVICE_MAINTENANCE: ["The service is under maintenance.", "Wait for maintenance to end, then resume the same request."],
    SERVICE_NOT_READY: ["The service is not ready to accept this request.", "Check the service status, then resume the same request."],
    ORDER_ALREADY_SETTLED: ["Payment is complete, but the original result is unavailable locally.", "Run agentpay orders list to review recovery options. Do not pay again for this result."],
    ORDER_CLOSING: ["The original Order is being closed.", "Check agentpay orders list; do not submit another payment."],
    ORDER_CANCELLED: ["The original Order was cancelled.", "Review it in agentpay orders list. Keep the saved request."],
    ORDER_REFUNDED: ["The original Order was refunded.", "Review it in agentpay orders list. Keep the saved request."],
    ORDER_EXPIRED: ["The original Order expired without payment.", "Review it in agentpay orders list; this request cannot complete the test."],
    ORDER_TERMS_MISMATCH: ["The Order differs from the accepted terms.", "Keep the original request and contact support before continuing."],
    POLICY_UNBOUND: ["Wallet has no verified spending permission bound.", "Resume agentpay setup to finish authorization and binding."],
    POLICY_MIGRATION_PENDING: ["A spending-permission update is unfinished.", "Resume the saved authorization update before continuing this request."],
    RUNTIME_RECOVERY_REQUIRED: ["Runtime history needs review before this request can continue.", "Run agentpay status and agentpay orders list. Keep the original records."],
    SETTLEMENT_REQUEST_REJECTED: ["Settlement did not accept this operation.", "Check the original Order status and service logs before resuming; do not create a replacement request."],
    RUNTIME_REQUEST_FAILED: ["Runtime could not finish this request.", "Run agentpay health and inspect agentpay service logs runtime. Keep the original request."],
  };
  const requestCode = codes.find(c => Object.hasOwn(requestFailures, c));
  if (requestCode) {
    const [reason, next] = requestFailures[requestCode];
    return {code: requestCode, reason, next};
  }
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
      "NETWORK_UNAVAILABLE",
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
  } else if (has("OWNER_APPROVAL_ASSET_MISSING")) {
    [code,reason,next]=['OWNER_APPROVAL_ASSET_MISSING','The installed program is missing the Safe approval page.','Update User, then resume agentpay setup. Your Wallet and draft are kept; this failure occurs before the approval page starts.'];
  } else if (has("SOFTWARE_VERSION_MISMATCH")) {
    [code, reason, next] = [
      "SOFTWARE_VERSION_MISMATCH",
      "Installed User and Wallet versions do not match.",
      "Run agentpay update, then agentpay repair if requested. Keep your private data.",
    ];
  } else if (has("SAFE_APPROVAL_MISMATCH", "ANVIL_SAFE_OWNER_OR_THRESHOLD_MISMATCH")) {
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
  } else if (has("CONTRACT_READ_FAILED", "CALL_EXCEPTION", "BAD_DATA")) {
    [code, reason, next] = [
      "CONTRACT_READ_FAILED",
      "A contract could not return the expected data.",
      "Run agentpay health to identify the contract; check its address and deployment version.",
    ];
  } else if (has("LOCAL_FILE_ACCESS", "EACCES", "EPERM", "UNSAFE_LOCAL_FILE")) {
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
      "LOCAL_SERVICE_UNAVAILABLE",
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
  } else if (has("LOCAL_SETUP_REQUIRED", "TEST_RUNTIME_CONNECTION_MISMATCH")) {
    [code, reason, next] = ["LOCAL_SETUP_REQUIRED", "The local Runtime connection is missing or does not match this setup.", "Run agentpay repair, then resume this saved setup. Keep the original test record."];
  } else if (has("ORIGINAL_REQUEST_NOT_FOUND", "REQUEST_NOT_FOUND", "REQUEST_CONFLICT", "LEGACY_TEST_REVIEW_REQUIRED")) {
    [code, reason, next] = ["REQUEST_CONFLICT", "The original test request could not be safely resumed.", "Check agentpay orders list and contact support. Keep the original request; do not start a replacement purchase."];
  } else if (has("QUOTE_TERMS_CHANGED", "QUOTE_TERMS_CONFLICT")) {
    [code, reason, next] = ["QUOTE_TERMS_CHANGED", "The quote differs from the terms accepted for this request.", "Review the original request and current quote before continuing. Do not create another request to bypass this check."];
  } else if (has("STEP_FAILED")) {
    [code, reason, next] = ["STEP_FAILED", "A helper program stopped without a recognized error category.", "Run agentpay health and share this step and report with support. For running services, inspect agentpay service logs wallet or agentpay service logs runtime."];
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
