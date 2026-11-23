// SPDX-License-Identifier: MPL-2.0
import {join} from "node:path";
import {connectMarket, marketOrigin} from "./connect-market.mjs";
import {readPrivateJson, deploymentChanges} from "./deployment-status.mjs";
import {readMarketStatus} from "./status-panel.mjs";
import {validatePublicDeployment} from "./prepare-onboarding.mjs";
import {officialTestPackageForNetwork, verifyOfficialTestDigest} from "./official-test-package.mjs";
import {fetchJsonWithTimeout} from "./transport.mjs";

// Website sign-in is optional. Use the ordinary connection guide, including its
// hidden password reader, and verify the saved receipt even if the user cancels.
export async function setupMarket({dataDir, ask, write, status = readMarketStatus, connect = connectMarket}) {
  const origin = async () => (await readPrivateJson(join(dataDir,"market-connection.json")))?.marketOrigin ||
    (await readPrivateJson(join(dataDir,"install-market.json")))?.origin;
  if ((await status(dataDir)).state === "saved") {
    write("Market: current Wallet connection saved.");
    return {origin:await origin()};
  }
  for (;;) {
    const choice = (await ask("View this Wallet’s Orders in Market? Type 'connect', 'skip', or 'q' to pause setup.\n> ")).trim().toLowerCase();
    if (choice === "q") return {paused:true};
    if (choice === "skip") return {origin:await origin()};
    if (choice !== "connect") continue;
    const savedOrigin = await origin();
    await connect(savedOrigin ? ["--market", marketOrigin(savedOrigin)] : [], {dataDir, write, inSetup:true});
    if ((await status(dataDir)).state === "saved") return {origin:await origin()};
    write("Market connection is unfinished. You can retry or skip it.");
  }
}

// Take only a newly published test mapping for the original deployment. Wallet
// configuration, endpoints, historical requests and Policy identity stay local.
export async function refreshSetupTest(config, origin, downloaded, fetchJson = fetchJsonWithTimeout) {
  const pin = officialTestPackageForNetwork(config.chainId);
  if (config.marketBundleMetadataUrl || !pin) return config;
  let source = downloaded;
  if (!source?.marketBundleMetadataUrl && origin) {
    const base = marketOrigin(origin);
    const {response,result} = await fetchJson(base + "/market/web/onboarding/user-config", {}, 10000);
    if (!response.ok) throw Error("Market test settings could not be read. Resume agentpay setup to retry.");
    source = result;
  }
  if (!source?.marketBundleMetadataUrl) return config;
  const published = validatePublicDeployment(source);
  if (deploymentChanges(config, published).length || published.tokenDecimals !== config.tokenDecimals)
    throw Error("Market deployment differs from this Wallet. Check agentpay status before testing.");
  verifyOfficialTestDigest(published.bundleSha256, pin);
  return {...config, marketBundleMetadataUrl:published.marketBundleMetadataUrl,
    maxUsageUnits:published.maxUsageUnits, bundleSha256:pin.sha256};
}
