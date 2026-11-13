// Temporary loopback approval UI for a fixed public plan, not a generic signer.
// Exported pages must exclude credentials and still verify chain execution.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, mkdtemp, writeFile, mkdir, open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Interface, isAddress, isHexString } from "ethers";

export function validateOwnerPlan({ source, calls }) {
  if (
    !Number.isSafeInteger(source.chainId) ||
    source.chainId < 1 ||
    !isAddress(source.safe) ||
    !isAddress(source.module) ||
    !Array.isArray(calls) ||
    !calls.length ||
    calls.length > 4
  )
    throw Error("Invalid owner plan.");
  if (source.previousModule && !isAddress(source.previousModule))
    throw Error("Invalid previous Module.");
  const module = new Interface([
    "function createPolicy(bytes32,address,address,address,address,uint256,uint256,uint64,uint64)",
    "function revokePolicy(bytes32)",
  ]);
  const safe = new Interface(["function enableModule(address)"]);
  for (const c of calls) {
    if (c.value !== "0" || c.operation !== 0 || !isHexString(c.data))
      throw Error("Unsupported owner operation.");
    if (c.to.toLowerCase() === source.safe.toLowerCase()) {
      if (
        safe.decodeFunctionData("enableModule", c.data)[0].toLowerCase() !==
        source.module.toLowerCase()
      )
        throw Error("Module mismatch.");
    } else if (
      c.to.toLowerCase() === source.module.toLowerCase() ||
      (source.previousModule &&
        isAddress(source.previousModule) &&
        c.to.toLowerCase() === source.previousModule.toLowerCase())
    ) {
      const parsed = module.parseTransaction({ data: c.data });
      if (
        c.to.toLowerCase() !== source.module.toLowerCase() &&
        parsed?.name !== "revokePolicy"
      )
        throw Error("Previous Module only allows revocation.");
      if (!["createPolicy", "revokePolicy"].includes(parsed?.name))
        throw Error("Unsupported Module operation.");
    } else throw Error("Unsupported owner target.");
  }
  return {
    version: 1,
    chainId: source.chainId,
    safe: source.safe,
    module: source.module,
    ...(source.previousModule ? { previousModule: source.previousModule } : {}),
    calls: calls.map((c) => ({
      purpose: c.purpose,
      to: c.to,
      value: "0",
      operation: 0,
      data: c.data,
    })),
  };
}
async function approvalAsset(path) {
  try { return await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw Object.assign(Error('Owner approval page assets are missing from the installed package.'), {code:'OWNER_APPROVAL_ASSET_MISSING'});
  }
}

export async function ownerAssets(input) {
  const plan = validateOwnerPlan(input);
  const assets = new Map([
    [
      "index.html",
      await approvalAsset(new URL("../web/owner-approval.html", import.meta.url)),
    ],
    [
      "owner-approval.js",
      await approvalAsset(new URL("../web/owner-approval.js", import.meta.url)),
    ],
    [
      "ethers.js",
      // Resolve the installed dependency: npm may hoist it above this package.
      await approvalAsset(join(dirname(createRequire(import.meta.url).resolve('ethers')), '..', 'dist', 'ethers.umd.min.js')),
    ],
    [
      "plan.js",
      Buffer.from(
        "window.agentpayOwnerPlan=" +
          JSON.stringify(plan).replace(/</g, "\\u003c") +
          ";",
      ),
    ],
  ]);
  assets.operationCount = plan.calls.length;
  return assets;
}
export function createOwnerServer(assets, { saveJournal } = {}) {
  const prefix = "/" + randomBytes(24).toString("hex") + "/";
  const server = createServer(async (req, res) => {
    const host = "127.0.0.1:" + server.address().port;
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (
      req.url === prefix + "journal" &&
      req.method === "POST" &&
      saveJournal
    ) {
      if (
        req.headers.host !== host ||
        req.headers.origin !== "http://" + host ||
        req.headers["content-type"] !== "application/json"
      ) {
        res.writeHead(403);
        return res.end();
      }
      try {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2048) throw Error();
        }
        const value = JSON.parse(raw);
        if (value !== null) {
          const count = assets.operationCount;
          if (
            value.callIndex !== undefined &&
            (!Number.isInteger(value.callIndex) ||
              value.callIndex < 0 ||
              value.callIndex >= count)
          )
            throw Error();
          if (value.kind === "intent") {
            if (!Number.isInteger(value.callIndex)) throw Error();
          } else if (
            !["approve", "execute"].includes(value.kind) ||
            !/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash) ||
            (value.kind === "execute" &&
              !/^0x[0-9a-fA-F]{64}$/.test(value.safeHash))
          )
            throw Error();
        }
        await saveJournal(value);
        res.end("ok");
      } catch {
        res.writeHead(400);
        res.end();
      }
      return;
    }
    if (
      req.headers.host !== host ||
      req.headers["sec-fetch-site"] === "cross-site" ||
      req.method !== "GET" ||
      !req.url.startsWith(prefix)
    ) {
      res.writeHead(403);
      return res.end("Open the authorization address shown in your terminal.");
    }
    const name = req.url.slice(prefix.length) || "index.html",
      body = assets.get(name);
    if (!body) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "content-type",
      name.endsWith(".js")
        ? "application/javascript"
        : "text/html; charset=utf-8",
    );
    res.end(body);
  });
  return { server, prefix };
}
export async function exportOwnerPage(assets, dataDir) {
  const parent = join(dataDir, "runtime");
  // The caller's private data directory is established by normal User setup.
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const folder = await mkdtemp(join(parent, "safe-authorization-"));
  for (const [name, original] of assets) {
    const body =
      name === "plan.js"
        ? Buffer.from(
            original
              .toString()
              .replace("window.agentpayJournalServer=true;", ""),
          )
        : original;
    await writeFile(join(folder, name), body, { mode: 0o600, flag: "wx" });
  }
  const script = `import {createServer} from 'node:http';\nimport {readFile} from 'node:fs/promises';\nconst names=new Set(['index.html','plan.js','ethers.js','owner-approval.js']);\nconst s=createServer(async(q,r)=>{const host='127.0.0.1:'+s.address().port;const n=q.url==='/'?'index.html':q.url.slice(1);if(q.method!=='GET'||q.headers.host!==host||q.headers['sec-fetch-site']==='cross-site'||!names.has(n)){r.writeHead(403);return r.end();}r.setHeader('cache-control','no-store');r.setHeader('x-content-type-options','nosniff');r.setHeader('content-type',n.endsWith('.js')?'application/javascript':'text/html; charset=utf-8');r.end(await readFile(new URL(n,import.meta.url)));});\ns.listen(0,'127.0.0.1',()=>console.log('Open http://127.0.0.1:'+s.address().port));\n`;
  await writeFile(join(folder, "serve.mjs"), script, {
    mode: 0o600,
    flag: "wx",
  });
  return folder;
}
export function tryBrowser(
  url,
  { env = process.env, platform = process.platform } = {},
) {
  const command =
    platform === "darwin"
      ? "open"
      : env.DISPLAY || env.WAYLAND_DISPLAY
        ? "xdg-open"
        : null;
  if (!command) return false;
  try {
    const child = spawn(command, [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
export async function approveOwnerOperations({
  source,
  calls,
  dataDir,
  ask,
  write = console.log,
  check,
  onSubmitted,
  openBrowser = tryBrowser,
}) {
  const assets = await ownerAssets({ source, calls });
  const digest = createHash("sha256")
    .update(assets.get("plan.js"))
    .digest("hex");
  const folder = join(dataDir, "runtime");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const journalPath = join(folder, "owner-operation-" + digest + ".json");
  let journal = null,
    h;
  try {
    h = await open(journalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = await h.stat();
    if (
      !st.isFile() ||
      st.uid !== process.getuid() ||
      st.mode & 0o077 ||
      st.size > 2048
    )
      throw Error("Unsafe owner operation journal.");
    journal = JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  } finally {
    await h?.close();
  }
  const persist = async (value) => {
    if (value) await onSubmitted?.(value);
    const { rename } = await import("node:fs/promises");
    const temp = journalPath + "." + randomBytes(8).toString("hex");
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, journalPath);
  };
  assets.set(
    "plan.js",
    Buffer.concat([
      assets.get("plan.js"),
      Buffer.from(
        "window.agentpayOwnerJournal=" +
          JSON.stringify(journal).replace(/</g, "\\u003c") +
          ";window.agentpayJournalServer=true;",
      ),
    ]),
  );
  const { server, prefix } = createOwnerServer(assets, {
    saveJournal: persist,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port,
    url = "http://127.0.0.1:" + port + prefix;
  write("\n> Approve with your Safe owner wallet\nOpen: " + url);
  openBrowser(url);
  const remoteHelp = `On a headless server, forward port ${port} through SSH, then open the same address on your computer.\nExample: ssh -N -L ${port}:127.0.0.1:${port} USER@SERVER`;
  try {
    for (;;) {
      const choice = (
        await ask(
          "After execution, enter 'check'. Enter 'help' for remote access, 'export' for a portable page, or 'q' to pause.",
        )
      ).trim();
      if (choice === "q") return false;
      if (choice === "help") {
        write(remoteHelp);
        continue;
      }
      if (choice === "export") {
        await onSubmitted?.({ kind: "export" });
        const folder = await exportOwnerPage(assets, dataDir);
        write(
          `Portable page: ${folder}\nCopy this directory to a trusted computer. In that directory run:\n  node serve.mjs\nOr:\n  python3 -m http.server 8765 --bind 127.0.0.1\nThen open http://127.0.0.1:8765 (Python) or the address printed by Node.\nKeep the files until this authorization is complete; remove the exported directory afterward.`,
        );
        continue;
      }
      if (choice !== "check") continue;
      try {
        if (await check()) {
          write("On-chain operations verified. Continuing.");
          return true;
        }
        write(
          "Not complete yet. Finish the Safe operations, then check again.",
        );
      } catch {
        write("Could not verify yet. Check your RPC connection, then retry.");
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
