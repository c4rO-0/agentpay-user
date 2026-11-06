#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { readFile } from "node:fs/promises";
import { createPolicyPreviewServer } from "../src/policy-preview-server.mjs";
try {
  const demo = process.argv[2] === "--demo";
  const [path, delegateArg, portArg = "6580"] = process.argv.slice(2);
  const delegate = demo ? `0x${"5".repeat(40)}` : delegateArg;
  const host = demo ? process.argv[4] || "127.0.0.1" : "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host))
    throw new Error("Preview host must be 127.0.0.1 or 0.0.0.0");
  const port = Number(demo ? process.argv[3] || "6580" : portArg);
  if (
    (demo
      ? process.argv.length > 5
      : !path || !delegate || process.argv.length > 5) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error(
      "Usage: preview-policy.mjs PUBLIC_DEPLOYMENT_JSON WALLET_DELEGATE [PORT] | --demo [PORT] [HOST]",
    );
  const deployment = demo
    ? {
        chainId: 31337,
        rpcUrl: "http://127.0.0.1:8545",
        module: `0x${"1".repeat(40)}`,
        token: `0x${"2".repeat(40)}`,
        factory: `0x${"3".repeat(40)}`,
        registry: `0x${"4".repeat(40)}`,
        tokenDecimals: 6,
        source: "界面演示：全部地址是虚构示例，不读取真实 Wallet 或链",
      }
    : JSON.parse(await readFile(path, "utf8"));
  const server = createPolicyPreviewServer({
    deployment,
    delegate,
    demoNetworkPreview: demo && host === "0.0.0.0",
    ...(demo
      ? {
          inspect: async () => ({
            demo: true,
            message: "仅展示页面流程；未执行链上核对，不可签名",
          }),
        }
      : {}),
  });
  server.on("error", () => {
    console.error("本地预览无法启动，请检查端口和配置。");
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `授权预览：http://${host === "0.0.0.0" ? "服务器IP" : host}:${port}/ （监听 ${host}，仅预览，不签名、不写链）`,
    ),
  );
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
