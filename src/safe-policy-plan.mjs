// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  Contract,
  getBytes,
  hashMessage,
  Interface,
  getAddress,
  isHexString,
  recoverAddress,
  Signature,
} from "ethers";

const ZERO = "0x0000000000000000000000000000000000000000";
const moduleAbi = [
  "function createPolicy(bytes32 policyId,address delegate,address token,address factory,address registry,uint256 maxPerPayment,uint256 totalBudget,uint64 validAfter,uint64 validUntil)",
  "function policies(address safe,bytes32 policyId) view returns (address delegate,address token,address factory,address registry,uint256 maxPerPayment,uint256 totalBudget,uint256 spent,uint64 validAfter,uint64 validUntil,bool revoked)",
];
const safeAbi = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isModuleEnabled(address) view returns (bool)",
];
const enableInterface = new Interface([
  "function enableModule(address module)",
]);
const policyInterface = new Interface(moduleAbi);

export function safeEthSignSignature(hash, signedMessage, ownerAddress) {
  if (
    !isHexString(hash, 32) ||
    recoverAddress(hashMessage(getBytes(hash)), signedMessage) !==
      getAddress(ownerAddress)
  ) {
    throw new Error("ANVIL_OWNER_SIGNATURE_MISMATCH");
  }
  // Safe v1.4.x interprets v=31/32 as an EIP-191 eth_sign signature.
  const parsed = Signature.from(signedMessage);
  return `${signedMessage.slice(0, -2)}${(parsed.v + 4).toString(16).padStart(2, "0")}`;
}

function positive(value, name) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))
    throw new Error(`${name} must be a positive atomic integer string`);
  return BigInt(value);
}
function address(value, name) {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${name} must be an address`);
  }
}
export function buildSafePolicyPlan(config, delegate) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("POLICY_CONFIG_INVALID");
  const chainId = Number(config.chainId);
  if (!Number.isSafeInteger(chainId) || chainId < 1)
    throw new Error("CHAIN_ID_INVALID");
  const rpcUrl = new URL(config.rpcUrl);
  if (
    !(
      rpcUrl.protocol === "https:" ||
      (rpcUrl.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(rpcUrl.hostname))
    )
  )
    throw new Error("RPC_URL_UNSAFE");
  if (!isHexString(config.policyId, 32) || /^0x0{64}$/i.test(config.policyId))
    throw new Error("POLICY_ID_INVALID");
  const safe = address(config.safe, "safe");
  const module = address(config.module, "module");
  const token = address(config.token, "token");
  const factory = address(config.factory, "factory");
  const registry = address(config.registry, "registry");
  const sessionDelegate = address(delegate, "delegate");
  const maxPerPayment = positive(config.maxPerPayment, "maxPerPayment");
  const totalBudget = positive(config.totalBudget, "totalBudget");
  if (totalBudget < maxPerPayment)
    throw new Error("BUDGET_BELOW_PER_PAYMENT_LIMIT");
  const validAfter = Number(config.validAfter);
  const validUntil = Number(config.validUntil);
  if (
    ![validAfter, validUntil].every(Number.isSafeInteger) ||
    validAfter < 0 ||
    validUntil <= validAfter ||
    validUntil <= Math.floor(Date.now() / 1000)
  )
    throw new Error("POLICY_VALIDITY_INVALID");
  const policyId = config.policyId.toLowerCase();
  const enableData = enableInterface.encodeFunctionData("enableModule", [
    module,
  ]);
  const createData = policyInterface.encodeFunctionData("createPolicy", [
    policyId,
    sessionDelegate,
    token,
    factory,
    registry,
    maxPerPayment,
    totalBudget,
    validAfter,
    validUntil,
  ]);
  return Object.freeze({
    chainId,
    rpcUrl: rpcUrl.toString(),
    safe,
    module,
    token,
    factory,
    registry,
    delegate: sessionDelegate,
    policyId,
    maxPerPayment,
    totalBudget,
    validAfter,
    validUntil,
    calls: [
      {
        purpose: "enable AgentPay Module",
        to: safe,
        value: "0",
        operation: 0,
        data: enableData,
      },
      {
        purpose: "create bounded Spending Policy",
        to: module,
        value: "0",
        operation: 0,
        data: createData,
      },
    ],
    walletPolicy: {
      version: "agentpay.safe-module.v1",
      chainId,
      module,
      safe,
      delegate: sessionDelegate,
      policyId,
      factory,
      registry,
      registryRpcUrl: rpcUrl.toString(),
      token,
      maxAmount: maxPerPayment.toString(),
      validUntil,
    },
  });
}

export async function inspectSafePolicy(provider, plan) {
  const chain = await provider.getNetwork();
  if (Number(chain.chainId) !== plan.chainId)
    throw new Error("CHAIN_ID_MISMATCH");
  for (const [name, at] of [
    ["safe", plan.safe],
    ["module", plan.module],
    ["token", plan.token],
    ["factory", plan.factory],
    ["registry", plan.registry],
  ]) {
    if ((await provider.getCode(at)) === "0x")
      throw new Error(`${name.toUpperCase()}_CODE_MISSING`);
  }
  const safe = new Contract(plan.safe, safeAbi, provider);
  const module = new Contract(plan.module, moduleAbi, provider);
  const [owners, threshold, moduleEnabled, policy] = await Promise.all([
    safe.getOwners(),
    safe.getThreshold(),
    safe.isModuleEnabled(plan.module),
    module.policies(plan.safe, plan.policyId),
  ]);
  const existing = policy.delegate !== ZERO;
  const policyMatches =
    existing &&
    policy.delegate === plan.delegate &&
    policy.token === plan.token &&
    policy.factory === plan.factory &&
    policy.registry === plan.registry &&
    policy.maxPerPayment === plan.maxPerPayment &&
    policy.totalBudget === plan.totalBudget &&
    Number(policy.validAfter) === plan.validAfter &&
    Number(policy.validUntil) === plan.validUntil &&
    !policy.revoked;
  return {
    owners,
    threshold: Number(threshold),
    moduleEnabled,
    policyExists: existing,
    policyMatches,
    policySpent: existing ? policy.spent.toString() : null,
  };
}
