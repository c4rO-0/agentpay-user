// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { safeEthSignSignature } from "./safe-policy-plan.mjs";

// Rehearsal adapter only. Production sends the exported calls through the User's
// external owner wallet / Safe approval workflow, then uses the same chain checks.
export async function executeAnvilOwnerCall(plan, ownerInput, call) {
  const url = new URL(plan.source.registryRpcUrl);
  if (
    plan.source.chainId !== 31337 ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("ANVIL_OWNER_SIGNING_TEST_ONLY");
  const owner = getAddress(ownerInput);
  const rpc = new JsonRpcProvider(url.toString(), undefined, {
    batchMaxCount: 1,
  });
  try {
    if (BigInt(await rpc.send("eth_chainId", [])) !== 31337n)
      throw new Error("CHAIN_ID_MISMATCH");
    const safe = new Contract(
      plan.source.safe,
      [
        "function getOwners() view returns (address[])",
        "function getThreshold() view returns (uint256)",
        "function nonce() view returns (uint256)",
        "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
        "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)",
        "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
        "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
      ],
      await rpc.getSigner(owner),
    );
    if (
      (await safe.getThreshold()) !== 1n ||
      !(await safe.getOwners()).includes(owner)
    )
      throw new Error("ANVIL_OWNER_THRESHOLD_UNSUPPORTED");
    const zero = "0x0000000000000000000000000000000000000000";
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
    const signature = safeEthSignSignature(
      hash,
      await rpc.send("eth_sign", [owner, hash]),
      owner,
    );
    const tx = await safe.execTransaction(
      call.to,
      0,
      call.data,
      0,
      0,
      0,
      0,
      zero,
      zero,
      signature,
    );
    process.stdout.write(
      `${JSON.stringify({ safeCall: call.purpose, transactionHash: tx.hash, state: "submitted" })}\n`,
    );
    const receipt = await tx.wait(1, 60_000);
    const events =
      receipt?.logs.map((log) => {
        try {
          return safe.interface.parseLog(log);
        } catch {
          return null;
        }
      }) ?? [];
    if (
      receipt?.status !== 1 ||
      !events.some((e) => e?.name === "ExecutionSuccess") ||
      events.some((e) => e?.name === "ExecutionFailure")
    )
      throw new Error("SAFE_OWNER_CALL_FAILED");
    return {
      safeCall: call.purpose,
      transactionHash: tx.hash,
      safeNonce: nonce.toString(),
      confirmed: true,
    };
  } catch (error) {
    // RPC/ethers errors may contain raw signed Safe calldata. Do not place that
    // payload in terminal logs; the submitted hash above and chain status suffice
    // for recovery after an ambiguous send or receipt timeout.
    const publicCodes = new Set([
      "CHAIN_ID_MISMATCH",
      "ANVIL_OWNER_THRESHOLD_UNSUPPORTED",
      "ANVIL_OWNER_SIGNATURE_MISMATCH",
      "SAFE_OWNER_CALL_FAILED",
    ]);
    throw new Error(
      publicCodes.has(error?.message)
        ? error.message
        : "SAFE_OWNER_CALL_UNCONFIRMED_RECHECK_CHAIN",
    );
  } finally {
    rpc.destroy();
  }
}
