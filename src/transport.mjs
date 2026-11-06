// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
export async function fetchJsonWithTimeout(url, options, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("HTTP timeout must be positive");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw Object.assign(Error("HTTP redirects are not allowed"), {
        code: "TRANSPORT_REDIRECT_REJECTED",
      });
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024)
        throw Object.assign(
          Error("HTTP response exceeds the JSON size limit"),
          { code: "TRANSPORT_RESPONSE_TOO_LARGE" },
        );
      chunks.push(chunk);
    }
    let result;
    try {
      result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      result = null;
    }
    return { response, result };
  } catch (error) {
    if (controller.signal.aborted)
      throw Object.assign(new Error("HTTP peer did not complete in time"), {
        code: "TRANSPORT_TIMEOUT",
      });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
