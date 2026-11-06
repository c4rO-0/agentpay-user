// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
export const fileError = (code, message) =>
  Object.assign(Error(message), { code, status: 409 });
export function publicFileAddress(address) {
  const kind = isIP(address);
  if (kind === 6) {
    const parts = address.split(":");
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !(
        parts[0].toLowerCase() === "2001" &&
        (parseInt(parts[1] || "0", 16) < 512 ||
          parseInt(parts[1] || "0", 16) === 0xdb8)
      ) &&
      !/^2002:/i.test(address) &&
      !/^3fff:/i.test(address)
    );
  }
  if (kind !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
// Validate and pin every hop; never forward local credentials or a Referer.
export async function downloadFile(
  url,
  {
    write,
    maxBytes,
    timeoutMs = 900000,
    resolveHost = lookup,
    requestHttps = request,
    requestHttp = httpRequest,
    privateOrigins = [],
  } = {},
) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs);
  const allowedUrl = (value) => {
    let u;
    try {
      u = new URL(value);
    } catch {
      throw fileError("FILE_URL_INVALID", "Use an HTTP or HTTPS file URL.");
    }
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hash
    )
      throw fileError(
        "FILE_URL_INVALID",
        "Use HTTP or HTTPS without embedded credentials or fragments.",
      );
    return u;
  };
  const localAddress = (a) =>
    a === "::1" ||
    /^(fc|fd)[0-9a-f]{2}:/i.test(a) ||
    (isIP(a) === 4 &&
      (() => {
        const [x, y] = a.split(".").map(Number);
        return (
          x === 127 ||
          x === 10 ||
          (x === 172 && y >= 16 && y <= 31) ||
          (x === 192 && y === 168)
        );
      })());
  async function addresses(target) {
    const host = target.hostname.replace(/^\[|\]$/g, "");
    let abort;
    try {
      return await Promise.race([
        isIP(host)
          ? [{ address: host, family: isIP(host) }]
          : resolveHost(host, { all: true, verbatim: true }),
        new Promise((_, reject) => {
          abort = () => reject(Error("aborted"));
          if (controller.signal.aborted) abort();
          else
            controller.signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
    } finally {
      controller.signal.removeEventListener("abort", abort);
    }
  }
  try {
    let target = allowedUrl(url);
    for (let hop = 0; hop <= 5; hop++) {
      const answers = await addresses(target),
        allowPrivate = privateOrigins.includes(target.origin);
      if (
        !answers.length ||
        answers.some(
          (a) =>
            !(
              publicFileAddress(a.address) ||
              (allowPrivate && localAddress(a.address))
            ),
        )
      )
        throw fileError(
          "FILE_DESTINATION_BLOCKED",
          "The file destination is not permitted.",
        );
      let response, last;
      for (const pinned of answers) {
        try {
          response = await new Promise((resolve, reject) => {
            const req = (
              target.protocol === "https:" ? requestHttps : requestHttp
            )(
              target,
              {
                agent: false,
                signal: controller.signal,
                headers: { accept: "*/*", "accept-encoding": "identity" },
                lookup: (_host, opts, cb) =>
                  cb(
                    null,
                    ...(opts?.all
                      ? [[pinned]]
                      : [pinned.address, pinned.family]),
                  ),
              },
              (res) => {
                clearTimeout(connectTimer);
                resolve(res);
              },
            );
            const connectTimer = setTimeout(
              () => req.destroy(Error("connection deadline")),
              Math.min(timeoutMs, 10000),
            );
            req.once("error", (error) => {
              clearTimeout(connectTimer);
              reject(error);
            });
            req.end();
          });
          break;
        } catch (error) {
          last = error;
          if (controller.signal.aborted) throw error;
        }
      }
      if (!response) throw last;
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.destroy();
        if (!location || hop === 5)
          throw fileError(
            "FILE_REDIRECT_LIMIT",
            "File link redirected too many times.",
          );
        const next = allowedUrl(new URL(location, target).href);
        if (target.protocol === "https:" && next.protocol === "http:")
          throw fileError(
            "FILE_REDIRECT_DOWNGRADE",
            "An encrypted file link redirected to unencrypted HTTP. Use the intended file URL.",
          );
        target = next;
        continue;
      }
      if (response.statusCode !== 200) {
        response.destroy();
        throw fileError(
          "FILE_HTTP_FAILED",
          "File link is unavailable. Obtain a fresh link to the original file and retry.",
        );
      }
      const encoding = String(
        response.headers["content-encoding"] || "identity",
      ).toLowerCase();
      const decoder =
        encoding === "gzip"
          ? createGunzip()
          : encoding === "deflate"
            ? createInflate()
            : encoding === "br"
              ? createBrotliDecompress()
              : null;
      if (encoding !== "identity" && !decoder) {
        response.destroy();
        throw fileError(
          "FILE_ENCODING_UNSUPPORTED",
          "Unsupported HTTP content encoding. Use a direct file download link.",
        );
      }
      const length = response.headers["content-length"];
      if (
        length !== undefined &&
        (!/^\d+$/.test(length) || Number(length) > maxBytes)
      ) {
        response.destroy();
        throw fileError(
          "FILE_TOO_LARGE",
          "File exceeds your configured local download limit.",
        );
      }
      let bytes = 0,
        wireBytes = 0;
      const stream = decoder || response;
      const broken = () =>
        stream.destroy(
          fileError(
            "FILE_TRANSFER_INCOMPLETE",
            "File transfer did not finish. Retry the same file.",
          ),
        );
      response.on("data", (chunk) => {
        wireBytes += chunk.length;
        if (wireBytes > maxBytes)
          stream.destroy(
            fileError(
              "FILE_TOO_LARGE",
              "File exceeds your configured transfer limit.",
            ),
          );
      });
      if (decoder) {
        response.on("error", broken);
        response.on("aborted", broken);
        response.pipe(decoder);
      }
      try {
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > maxBytes)
            throw fileError(
              "FILE_TOO_LARGE",
              "File exceeds your configured local download limit.",
            );
          await write(chunk);
        }
      } finally {
        decoder?.destroy();
        response.destroy();
      }
      if (length !== undefined && wireBytes !== Number(length))
        throw fileError(
          "FILE_TRANSFER_INCOMPLETE",
          "File transfer did not finish. Retry the same file.",
        );
      return bytes;
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw fileError(
        "FILE_DOWNLOAD_TIMEOUT",
        "File download exceeded your local time limit. Retry the same file or adjust the cache settings.",
      );
    if (error.code?.startsWith("FILE_")) throw error;
    throw fileError(
      "FILE_DOWNLOAD_FAILED",
      "File download failed. Retry the same file; no service purchase is needed.",
    );
  } finally {
    clearTimeout(timer);
  }
}
