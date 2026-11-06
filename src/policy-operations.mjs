// Resumable owner-authorized permission changes. Keep original operation identity
// and verify chain effects before updating local binding or continuing connection.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { approveOwnerOperations } from "./owner-approval-server.mjs";
import { ownerSignerKind, checkTestSigner } from "./owner-signer.mjs";
import { Contract, Interface } from "ethers";
import { executeAnvilOwnerCall } from "./safe-owner-anvil.mjs";
const abi = [
  "function policies(address,bytes32) view returns(address delegate,address token,address factory,address registry,uint256 maxPerPayment,uint256 totalBudget,uint256 spent,uint64 validAfter,uint64 validUntil,bool revoked)",
  "function revokePolicy(bytes32 policyId)",
];
export async function revokeOnChain({
  rpc,
  policy,
  write = console.log,
  submit = executeAnvilOwnerCall,
  ownerSigner = "external",
  dataDir,
  ask,
  approve = approveOwnerOperations,
}) {
  const signer = ownerSignerKind(ownerSigner);
  checkTestSigner(signer, policy);
  const contract = new Contract(policy.module, abi, rpc);
  const current = await contract.policies(policy.safe, policy.policyId);
  if (current.delegate.toLowerCase() !== policy.delegate.toLowerCase())
    throw Error("Policy delegate could not be verified.");
  if (current.revoked) return true;
  const call = {
    purpose: "revoke previous spending permission",
    to: policy.module,
    value: "0",
    operation: 0,
    data: new Interface(abi).encodeFunctionData("revokePolicy", [
      policy.policyId,
    ]),
  };
  if (signer === "external")
    return approve({
      source: policy,
      calls: [call],
      dataDir,
      ask,
      write,
      check: async () =>
        Boolean(
          (await contract.policies(policy.safe, policy.policyId)).revoked,
        ),
    });
  const safe = new Contract(
    policy.safe,
    [
      "function getOwners() view returns(address[])",
      "function getThreshold() view returns(uint256)",
    ],
    rpc,
  );
  const owners = await safe.getOwners();
  if (Number(await safe.getThreshold()) !== 1 || owners.length !== 1)
    throw Error("Private rehearsal requires the sole prepared Safe owner.");
  await submit({ source: policy }, owners[0], call);
  if (!(await contract.policies(policy.safe, policy.policyId)).revoked)
    throw Error("Policy revocation has not been verified.");
  return true;
}
