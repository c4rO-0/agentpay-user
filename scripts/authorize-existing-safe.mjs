#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Private-Anvil existing-Safe authorization. Never accepts an owner key.
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Contract, getAddress, JsonRpcProvider } from "ethers";
import { Phase0Wallet } from "@c4roa0/agentpay-wallet/local";
import {
  buildSafePolicyPlan,
  inspectSafePolicy,
  safeEthSignSignature,
} from "../src/safe-policy-plan.mjs";

const [command, privateDirArg, configArg] = process.argv.slice(2);
if (
  !["preview", "authorize", "bind", "check"].includes(command) ||
  !privateDirArg ||
  !configArg ||
  process.argv.length !== 5
)
  throw new Error(
    "usage: authorize-existing-safe.mjs <preview|authorize|bind|check> <private-user-data-dir> <public-policy-config.json>",
  );
const dataDir = resolve(privateDirArg);
const config = JSON.parse(await readFile(resolve(configArg), "utf8"));
const walletDir = join(dataDir, "wallet");
const wallet = await Phase0Wallet.open(walletDir);
const delegate = await wallet.address();
const plan = buildSafePolicyPlan(config, delegate);
const ownerAddress = getAddress(config.ownerAddress);
const rpc = new JsonRpcProvider(plan.rpcUrl, plan.chainId, {
  staticNetwork: true,
});
try {
  const state = await inspectSafePolicy(rpc, plan);
  if (!state.owners.includes(ownerAddress) || state.threshold !== 1) {
    throw new Error(
      "C6 first rehearsal requires the selected Anvil owner to be the sole Safe signature threshold",
    );
  }
  const publicPlan = {
    chainId: plan.chainId,
    safe: plan.safe,
    ownerAddress,
    delegate: plan.delegate,
    module: plan.module,
    factory: plan.factory,
    registry: plan.registry,
    token: plan.token,
    policyId: plan.policyId,
    maxPerPaymentAtomic: plan.maxPerPayment.toString(),
    totalBudgetAtomic: plan.totalBudget.toString(),
    validAfter: plan.validAfter,
    validUntil: plan.validUntil,
    dynamicQualification:
      "AgentPay Registry at the fixed address; future qualified Skills need no new Policy",
    currentState: state,
    safeCalls: plan.calls,
  };
  if (command === "preview") {
    process.stdout.write(
      `${JSON.stringify({ ok: true, plan: publicPlan }, null, 2)}\n`,
    );
  } else {
    if (command === "authorize") {
      const url = new URL(plan.rpcUrl);
      if (
        plan.chainId !== 31337 ||
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ) {
        throw new Error("ANVIL_OWNER_SIGNING_TEST_ONLY");
      }
      if (state.policyExists && !state.policyMatches)
        throw new Error("EXISTING_POLICY_CONFLICT");
      if (!state.moduleEnabled || !state.policyExists) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, authorizationPreview: publicPlan }, null, 2)}\n`,
        );
        const expected = `AUTHORIZE ${plan.policyId}`;
        if (!process.stdin.isTTY || !process.stderr.isTTY)
          throw new Error("OWNER_AUTHORIZATION_TTY_REQUIRED");
        const prompt = createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        let answer;
        try {
          answer = await prompt.question(
            `Type '${expected}' to submit the displayed Safe calls: `,
          );
        } finally {
          prompt.close();
        }
        if (answer.trim() !== expected)
          throw new Error("OWNER_AUTHORIZATION_NOT_CONFIRMED");
        const calls = [
          ...(!state.moduleEnabled ? [plan.calls[0]] : []),
          ...(!state.policyExists ? [plan.calls[1]] : []),
        ];
        for (const call of calls)
          await executeSafeCall(rpc, plan.safe, ownerAddress, call);
      }
    }
    const final = await inspectSafePolicy(rpc, plan);
    if (!final.moduleEnabled || !final.policyMatches)
      throw new Error("CHAIN_POLICY_NOT_VERIFIED");
    if (command === "bind") {
      if (
        await stat(join(walletDir, "wallet.sock")).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        )
      )
        throw new Error("STOP_WALLET_SERVICE_BEFORE_LOCAL_BIND");
      if (wallet.policy) {
        if (JSON.stringify(wallet.policy) !== JSON.stringify(plan.walletPolicy))
          throw new Error("LOCAL_POLICY_CONFLICT");
      } else await wallet.bindPolicy(plan.walletPolicy);
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          chainPolicyVerified: true,
          moduleEnabled: final.moduleEnabled,
          policyMatches: final.policyMatches,
          localWalletBound: command === "bind" ? true : wallet.policy !== null,
          remainingBudgetAtomic: (
            plan.totalBudget - BigInt(final.policySpent)
          ).toString(),
        },
        null,
        2,
      )}\n`,
    );
  }
} finally {
  rpc.destroy();
}

async function executeSafeCall(rpc, safeAddress, ownerAddress, call) {
  const zero = "0x0000000000000000000000000000000000000000";
  const safe = new Contract(
    safeAddress,
    [
      "function nonce() view returns (uint256)",
      "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
      "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)",
      "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
      "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
    ],
    await rpc.getSigner(ownerAddress),
  );
  const nonce = await safe.nonce();
  const hash = await safe.getTransactionHash(
    call.to,
    0,
    call.data,
    0,
    0,
    0,
    0,
    zero,
    zero,
    nonce,
  );
  const signedMessage = await rpc.send("eth_sign", [ownerAddress, hash]);
  const safeSignature = safeEthSignSignature(hash, signedMessage, ownerAddress);
  const receipt = await (
    await safe.execTransaction(
      call.to,
      0,
      call.data,
      0,
      0,
      0,
      0,
      zero,
      zero,
      safeSignature,
    )
  ).wait();
  const events = receipt.logs.map((log) => {
    try {
      return safe.interface.parseLog(log);
    } catch {
      return null;
    }
  });
  if (
    receipt.status !== 1 ||
    !events.some((event) => event?.name === "ExecutionSuccess") ||
    events.some((event) => event?.name === "ExecutionFailure")
  )
    throw new Error("SAFE_OWNER_CALL_FAILED");
  process.stdout.write(
    `${JSON.stringify({
      safeCall: call.purpose,
      transactionHash: receipt.hash,
      safeNonce: nonce.toString(),
      confirmed: true,
    })}\n`,
  );
}
