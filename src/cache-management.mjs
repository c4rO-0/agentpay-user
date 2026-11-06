// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { fileError } from "./file-download.mjs";
// Shared by the authenticated local route and the explicit offline CLI. No
// import/download/financial operation is exposed through this management surface.
export async function manageCache(cache, body) {
  const fields = {
    summary: [],
    list: ["purpose", "state", "orderId", "requestId", "offset", "limit"],
    details: ["id"],
    verified: ["id"],
    preview: [],
    clean: ["items", "confirmed"],
    settings: ["overrides"],
  };
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Object.hasOwn(fields, body.action) ||
    Object.keys(body).some(
      (k) => k !== "action" && !fields[body.action].includes(k),
    )
  )
    throw fileError(
      "FILE_INPUT_INVALID",
      "Choose a supported cache operation.",
    );
  const { action, ...args } = body;
  switch (action) {
    case "summary":
      return cache.summary();
    case "list":
      return cache.listAll(args);
    case "details":
      return cache.details(args.id);
    case "verified":
      return cache.verified(args.id);
    case "preview":
      return cache.cleanPreview();
    case "clean":
      return cache.clean(args);
    case "settings":
      return cache.settings(args.overrides);
  }
}
