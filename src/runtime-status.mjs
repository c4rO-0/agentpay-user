// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { join } from "node:path";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { readServiceSettings } from "./local-services.mjs";
import { readCallerToken } from "./caller-auth.mjs";
export async function readRuntimeStatus(dataDir = undefined) {
  dataDir ??= await resolveUserDataDir();
  const settings = await readServiceSettings(dataDir),
    token = await readCallerToken(join(dataDir, "runtime/caller.token"));
  const response = await fetch(settings.runtimeUrl + "/status", {
    headers: { authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(2500),
  });
  if (response.status === 404)
    throw Object.assign(Error("Runtime status requires a newer version."), {
      code: "STATUS_UNSUPPORTED",
    });
  if (!response.ok) throw Error("Runtime status unavailable");
  const body = await response.json(),
    s = body.result;
  if (
    body.ok !== true ||
    s?.role !== "user-runtime" ||
    !["checking", "complete", "blocked"].includes(s.inventory) ||
    !s.orders
  )
    throw Error("Invalid Runtime status");
  return s;
}
