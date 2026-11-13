// SPDX-License-Identifier: MPL-2.0
import { FetchRequest, JsonRpcProvider } from "ethers";
import { CHAIN_CHECK_TIMEOUT_MS } from "./setup-diagnostics.mjs";

// Provider.destroy() alone does not cancel ethers' in-flight HTTP requests.
// Setup/diagnostics need cancellation to close the process, not just reject a race.
// This transport is used only by existing read-only inspection paths.
export class ReadOnlyRpc extends JsonRpcProvider {
  #state;
  constructor(url, options = {}) {
    const state = { closed: false, requests: new Set() };
    const request = new FetchRequest(url);
    request.getUrlFunc = async (req, cancel) => {
      if (state.closed)
        throw Object.assign(Error("CHAIN_CHECK_TIMEOUT"), {
          code: "CHAIN_CHECK_TIMEOUT",
        });
      const controller = new AbortController();
      state.requests.add(controller);
      const timer = setTimeout(
        () => controller.abort(),
        CHAIN_CHECK_TIMEOUT_MS,
      );
      try {
        cancel?.addListener(() => controller.abort());
        const response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          // Let ethers retain its existing redirect policy.
          redirect: "manual",
          signal: controller.signal,
        });
        const chunks = [];
        let size = 0;
        if (response.body)
          for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > 1024 * 1024)
              throw Object.assign(Error(), { code: "BAD_DATA" });
            chunks.push(chunk);
          }
        return {
          statusCode: response.status,
          statusMessage: response.statusText,
          headers: Object.fromEntries(response.headers),
          body: Buffer.concat(chunks),
        };
      } catch (error) {
        if (controller.signal.aborted)
          throw Object.assign(Error("CHAIN_CHECK_TIMEOUT"), {
            code: "CHAIN_CHECK_TIMEOUT",
          });
        throw error;
      } finally {
        clearTimeout(timer);
        controller.abort();
        state.requests.delete(controller);
      }
    };
    super(request, undefined, { batchMaxCount: 1, ...options });
    this.#state = state;
  }
  destroy() {
    this.#state.closed = true;
    for (const controller of this.#state.requests) controller.abort();
    super.destroy();
  }
}
