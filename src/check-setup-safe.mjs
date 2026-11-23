// SPDX-License-Identifier: MPL-2.0
import { Interface } from "ethers";
import { ReadOnlyRpc } from "./read-only-rpc.mjs";
import manifest from "../package.json" with {type: "json"};
const versions = manifest.agentpaySafeVersions;

const abi = new Interface(["function VERSION() view returns(string)", "function getOwners() view returns(address[])"]);
// Registry metadata is advisory. Only the manifest shipped with this User
// installation can enable approval. No Safe address is sent to npm.
export async function unsupportedSafeMessage(version, fetchImpl = fetch) {
  const label = /^[\w.+-]{1,40}$/.test(version) ? version : "(unrecognized)";
  const reason = `User ${manifest.version} has no verified support for Safe ${label}.`;
  try {
    const response = await fetchImpl("https://registry.npmjs.org/@c4roa0%2fagentpay-user/latest", {
      redirect: "error", signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 65536) throw Error("Registry response too large");
        chunks.push(chunk);
      }
      const latest = JSON.parse(Buffer.concat(chunks));
      if (latest.name === manifest.name && /^\d+\.\d+\.\d+$/.test(latest.version)) {
        const current = manifest.version.split(".").map(Number);
        const difference = latest.version.split(".").map((n, i) => Number(n) - current[i]).find(n => n !== 0);
        if (difference > 0 && Object.hasOwn(latest.agentpaySafeVersions || {}, version))
          return `${reason} User ${latest.version} supports it. Update User and resume setup.`;
        return `${reason} No compatible update was confirmed. Resume setup when support is available.`;
      }
    }
  } catch {
    // Offline npm must not be reported as a chain outage.
  }
  return `${reason} Could not confirm an update. Check the User release notes for support.`;
}
export async function checkSetupSafe(deployment, safe, owner) {
  const rpc = new ReadOnlyRpc(deployment.rpcUrl);
  async function read(name) {
    const raw = await rpc.send("eth_call", [{to: safe, data: abi.encodeFunctionData(name)}, "latest"]);
    return abi.decodeFunctionResult(name, raw)[0];
  }
  try {
    if (BigInt(await rpc.send("eth_chainId", [])) !== BigInt(deployment.chainId))
      return {problem: "The RPC network differs from the downloaded settings."};
    if (await rpc.send("eth_getCode", [safe, "latest"]) === "0x")
      return {problem: "No Safe contract at this address on the selected network."};
    const version = await read("VERSION");
    if (!Object.hasOwn(versions, version)) {
      return {problem: await unsupportedSafeMessage(version)};
    }
    const owners = await read("getOwners");
    if (!owners.some(address => address.toLowerCase() === owner.toLowerCase()))
      return {problem: "The owner address is not listed among this Safe’s signers."};
    return {version};
  } catch (error) {
    if (["BAD_DATA", "CALL_EXCEPTION"].includes(error.code))
      return {problem: "The contract did not return the expected Safe information. Check the Safe address."};
    return {problem: "Could not read Safe information from the chain RPC. Check your connection and retry."};
  } finally {
    rpc.destroy();
  }
}
