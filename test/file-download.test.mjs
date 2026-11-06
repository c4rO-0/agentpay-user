// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { gzipSync } from "node:zlib";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:https";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile } from "../src/file-download.mjs";
const source = new URL("../src/file-download.mjs", import.meta.url).href;
async function child(code, env) {
  return new Promise((resolve, reject) => {
    let err = "";
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    p.stderr.on("data", (b) => (err += b));
    p.once("error", reject);
    p.once("exit", (code) => (code === 0 ? resolve() : reject(Error(err))));
  });
}
test("default HTTPS client validates certificate and hostname, with actual DNS/lookup and no request override", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cache-tls-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cert = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  const server = createServer(
    { key: await readFile(join(dir, "key.pem")), cert: await readFile(cert) },
    (req, res) => {
      assert.equal(req.headers.authorization, undefined);
      res.end(Buffer.from([0, 255, 4]));
    },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const origin = `https://localhost:${server.address().port}`;
  const code = `import assert from 'node:assert/strict';import {downloadFile} from ${JSON.stringify(source)};const chunks=[];await downloadFile(${JSON.stringify(origin + "/file")},{privateOrigins:[${JSON.stringify(origin)}],maxBytes:20,write:async c=>chunks.push(c)});assert.deepEqual(Buffer.concat(chunks),Buffer.from([0,255,4]));`;
  await child(code, { ...process.env, NODE_EXTRA_CA_CERTS: cert });
  const env = { ...process.env };
  delete env.NODE_EXTRA_CA_CERTS;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  await assert.rejects(child(code, env));
  // Trust is present, but the certificate does not name this IP.
  await assert.rejects(
    child(code.replaceAll("localhost", "127.0.0.1"), {
      ...env,
      NODE_EXTRA_CA_CERTS: cert,
    }),
  );
});
test("default HTTP client follows revalidated redirects and bounds bytes/time", async (t) => {
  const server = createHttpServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/file" });
      return res.end();
    }
    if (req.url === "/blocked") {
      res.writeHead(302, { location: "http://169.254.169.254/metadata" });
      return res.end();
    }
    if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      return res.end();
    }
    if (req.url === "/gzip") {
      res.writeHead(200, { "content-encoding": "gzip" });
      return res.end(gzipSync("decoded file"));
    }
    if (req.url === "/bomb") {
      res.writeHead(200, { "content-encoding": "gzip" });
      return res.end(gzipSync("x".repeat(10000)));
    }
    if (req.url === "/slow") {
      res.writeHead(200);
      res.write("a");
      return;
    }
    res.end("binary bytes");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`,
    options = {
      privateOrigins: [origin],
      maxBytes: 100,
      write: async () => {},
    };
  assert.equal(await downloadFile(origin + "/redirect", options), 12);
  assert.equal(await downloadFile(origin + "/gzip", options), 12);
  await assert.rejects(downloadFile(origin + "/bomb", options), {
    code: "FILE_TOO_LARGE",
  });
  await assert.rejects(downloadFile(origin + "/blocked", options), {
    code: "FILE_DESTINATION_BLOCKED",
  });
  await assert.rejects(downloadFile(origin + "/loop", options), {
    code: "FILE_REDIRECT_LIMIT",
  });
  await assert.rejects(
    downloadFile(origin + "/file", { ...options, maxBytes: 2 }),
    { code: "FILE_TOO_LARGE" },
  );
  await assert.rejects(
    downloadFile(origin + "/slow", { ...options, timeoutMs: 50 }),
    { code: "FILE_DOWNLOAD_TIMEOUT" },
  );
});
