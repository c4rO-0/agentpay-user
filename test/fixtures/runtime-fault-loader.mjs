// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Explicit test-process instrumentation only. Never imported by the Runtime entry.
import { registerHooks } from "node:module";
const point = process.env.AGENTPAY_USER_CRASH_AFTER;
const anchors = {
  payment_submitted:
    "invocation = await invocationStore.update(\n        invocation.invocationId,\n        requestHash,\n        { paymentSubmitted: true },\n      );",
  provider_result:
    "const output = delivered.output,\n      outputHash = delivered.outputHash;",
  delivery_evidence_verified:
    "await resultStore.save(\n      invocation,\n      normalizeRuntimeResult(result, context, requestHash, orderId),\n    );",
};
if (!Object.hasOwn(anchors, point))
  throw Error("EXPLICIT_TEST_CRASH_POINT_REQUIRED");
const target = new URL("../../src/index.mjs", import.meta.url).href;
registerHooks({
  load(url, context, next) {
    const loaded = next(url, context);
    if (url !== target) return loaded;
    const source = String(loaded.source),
      anchor = anchors[point];
    if (source.split(anchor).length !== 2)
      throw Error("TEST_CRASH_BOUNDARY_CHANGED");
    return {
      ...loaded,
      source: source.replace(
        anchor,
        anchor +
          "\n    process.exit(86); // injected only by explicit test loader",
      ),
    };
  },
});
