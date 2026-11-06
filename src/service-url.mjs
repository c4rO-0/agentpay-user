// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// A deployment base may include an ingress prefix. Local control stays separate.
export function serviceBase(value, label = "Service URL") {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.includes("\\")
  )
    throw Error(`Invalid ${label}`);
  const rawPath = /^[a-z]+:\/\/[^/?#]+([^?#]*)/.exec(value)?.[1];
  if (
    rawPath === undefined ||
    !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(rawPath || "/")
  )
    throw Error(`Invalid ${label} path`);
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw Error(`${label} must use HTTPS or loopback HTTP`);
  return url.origin + url.pathname.replace(/\/+$/, "");
}
export function serviceUrl(base, path) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("#") ||
    path.includes("\\")
  )
    throw Error("Invalid service endpoint");
  const normalized = serviceBase(String(base));
  const url = new URL(path.slice(1), normalized + "/");
  if (
    url.origin !== new URL(normalized).origin ||
    !url.pathname.startsWith(
      new URL(normalized).pathname.replace(/\/$/, "") + "/",
    )
  )
    throw Error("Endpoint escapes service base");
  return url;
}
