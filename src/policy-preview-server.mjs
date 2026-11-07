// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import {
  assertUnixMilliseconds,
  parseLegacyIsoMilliseconds,
} from "@c4roa0/agentpay-protocol";
import { isIP } from "node:net";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseUnits, JsonRpcProvider } from "ethers";
import { buildSafePolicyPlan, inspectSafePolicy } from "./safe-policy-plan.mjs";

export function createPolicyPreviewServer({
  deployment,
  delegate,
  demoNetworkPreview = false,
  inspect = async (plan) => {
    const rpc = new JsonRpcProvider(plan.rpcUrl);
    try {
      return await inspectSafePolicy(rpc, plan);
    } finally {
      rpc.destroy();
    }
  },
}) {
  const token = randomBytes(32).toString("hex");
  const policyId = `0x${randomBytes(32).toString("hex")}`;
  const trusted = Object.fromEntries(
    ["chainId", "rpcUrl", "module", "token", "factory", "registry"].map((k) => [
      k,
      deployment[k],
    ]),
  );
  const decimals = deployment.tokenDecimals;
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    typeof deployment.source !== "string" ||
    !deployment.source.trim()
  ) {
    throw new Error(
      "Public deployment file requires tokenDecimals (0–18) and source",
    );
  }
  buildSafePolicyPlan(
    {
      ...trusted,
      safe: delegate,
      policyId,
      maxPerPayment: "1",
      totalBudget: "1",
      validAfter: 0,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
    },
    delegate,
  );
  let busy = false;
  return createServer(async (req, res) => {
    const localOrigin = `http://127.0.0.1:${res.socket.localPort}`;
    let origin = localOrigin;
    let validHost = req.headers.host === new URL(localOrigin).host;
    if (demoNetworkPreview) {
      try {
        const requested = new URL(`http://${req.headers.host}`);
        validHost =
          (!!isIP(requested.hostname) || requested.hostname === "localhost") &&
          requested.host === req.headers.host;
        if (validHost) origin = requested.origin;
      } catch {
        validHost = false;
      }
    }
    const send = (status, data) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    );
    if (!validHost || req.headers["sec-fetch-site"] === "cross-site")
      return send(403, { error: "Use the local preview address directly" });
    try {
      if (req.method === "GET" && req.url === "/") {
        res.setHeader(
          "set-cookie",
          `preview=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end(
          await readFile(
            new URL("../web/policy-preview.html", import.meta.url),
            "utf8",
          ),
        );
      }
      if (req.method === "GET" && req.url === "/preview.js") {
        res.setHeader("content-type", "text/javascript; charset=utf-8");
        return res.end(
          await readFile(
            new URL("../web/policy-preview.js", import.meta.url),
            "utf8",
          ),
        );
      }
      if (
        !String(req.headers.cookie || "")
          .split(";")
          .some((item) => item.trim() === `preview=${token}`)
      )
        return send(403, { error: "Open the local page first" });
      if (req.method === "GET" && req.url === "/context")
        return send(200, {
          deployment: {
            ...trusted,
            tokenDecimals: decimals,
            source: deployment.source,
          },
          delegate,
          policyId,
        });
      if (req.method !== "POST" || req.url !== "/preview")
        return send(404, { error: "Not found" });
      if (
        req.headers.origin !== origin ||
        req.headers["content-type"] !== "application/json" ||
        req.headers["x-agentpay-preview"] !== "1"
      )
        return send(403, { error: "Local page request required" });
      if (busy)
        return send(409, {
          error: "A preview is already running; wait and retry",
        });
      busy = true;
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 4096)
            return send(413, { error: "Request too large" });
        }
        const input = JSON.parse(body);
        if (
          Object.keys(input).some(
            (k) =>
              ![
                "safe",
                "budget",
                "perPayment",
                "validUntil",
                "validUntilMs",
              ].includes(k),
          )
        )
          throw new Error("Unsupported preview field");
        for (const key of ["budget", "perPayment"])
          if (
            typeof input[key] !== "string" ||
            !/^\d+(\.\d+)?$/.test(input[key])
          )
            throw new Error("Amounts must be positive decimal values");
        const until = Object.hasOwn(input, "validUntilMs")
          ? assertUnixMilliseconds(input.validUntilMs)
          : parseLegacyIsoMilliseconds(input.validUntil);
        if (
          input.validUntil !== undefined &&
          parseLegacyIsoMilliseconds(input.validUntil) !== until
        )
          throw Error("Expiry representations disagree");
        if (!Number.isFinite(until)) throw new Error("Choose a valid expiry");
        const plan = buildSafePolicyPlan(
          {
            ...trusted,
            safe: input.safe,
            policyId,
            totalBudget: parseUnits(input.budget, decimals).toString(),
            maxPerPayment: parseUnits(input.perPayment, decimals).toString(),
            validAfter: Math.floor(Date.now() / 1000),
            validUntil: Math.floor(until / 1000),
          },
          delegate,
        );
        let state = null,
          chainError = null;
        try {
          state = await Promise.race([
            inspect(plan),
            new Promise((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error("timeout")),
                10000,
              );
              timer.unref();
            }),
          ]);
        } catch {
          chainError =
            "链上只读核对未通过。检查 RPC、网络和 Safe／合约地址；不能继续签名。";
        }
        send(200, {
          ok: true,
          draft: {
            safe: plan.safe,
            delegate: plan.delegate,
            chainId: plan.chainId,
            budget: input.budget,
            perPayment: input.perPayment,
            validUntil: new Date(until).toISOString(),
            validUntilMs: until,
            policyId: plan.policyId,
            calls: plan.calls,
          },
          chainState: state,
          chainError,
          readyToSign: false,
          readyToPurchase: false,
          mode: "preview_only",
        });
      } finally {
        busy = false;
      }
    } catch {
      send(400, {
        error:
          "请检查 Safe 地址、预算、单笔上限和未来的有效期；总预算不能小于单笔上限。",
      });
    }
  });
}
