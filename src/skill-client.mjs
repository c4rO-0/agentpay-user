import {withDefaultRequest} from "./default-request-owner.mjs";
// Generic Skill CLI glue. Business input/output validation is supplied by the Skill;
// payment authority and request recovery remain in the installed client/Runtime.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
export const skillClientCapabilities = Object.freeze([
  "input-snapshots-v1",
  "output-files-v1",
  "original-request-v1",
  "default-selection-v1",
]);
import {
  readServiceOffer,
  RuntimeClientError,
  loadRuntimeConnection,
  userDataDirectory,
  checkRuntime,
  selectInvocation,
  resumeInvocation,
  invokeService,
  completeInvocation,
  cacheResultFile,
} from "./runtime-client.mjs";
import { parseServiceReference } from "./service-reference.mjs";
export async function runSkill({
  service,
  args = process.argv.slice(2),
  env = process.env,
  validateRequest = (request) => request,
  inputFiles,
  prepareRequest,
  outputFiles,
  write = (value) => console.log(JSON.stringify(value)),
  notice = (value) => console.error(value),
} = {}) {
  let requestId;
  try {
    const reference = parseServiceReference(service),
      values = [...args],
      mode = values.shift();
    const connection = await loadRuntimeConnection({
      dataDir: userDataDirectory(env),
      env,
    });
    if (mode === "--quote" && values.length === 0) {
      write({
        ok: true,
        result: await readServiceOffer(connection, reference),
      });
      return 0;
    }
    if (mode === "--check" && values.length === 0) {
      write(await checkRuntime(connection, reference));
      return 0;
    }
    let checkpoint;
    if (mode === "--resume" && values.length === 1)
      checkpoint = await resumeInvocation(connection, reference, values[0]);
    else if (mode === "--invoke") {
      const inputText = values.shift();
      let force = false,
        units = "1",
        unitsSeen = false,
        acceptedTerms,
        requestId;
      while (values.length) {
        const flag = values.shift();
        if (
          flag === "--accept-terms" &&
          acceptedTerms === undefined &&
          values.length
        ) {
          try {
            acceptedTerms = JSON.parse(values.shift());
          } catch {
            throw new RuntimeClientError(
              "INVALID_ARGUMENTS",
              "Pass --accept-terms the JSON price/duration read from --quote.",
            );
          }
        } else if (flag === "--force" && !force) force = true;
        else if (flag === "--units" && !unitsSeen && values.length) {
          units = values.shift();
          unitsSeen = true;
        } else if (
          flag === "--request-id" &&
          requestId === undefined &&
          values.length
        )
          requestId = values.shift();
        else
          throw new RuntimeClientError(
            "INVALID_ARGUMENTS",
            "Use --invoke <JSON> [--units N] [--request-id ID] [--force], --check, --quote or --resume <request-id>.",
          );
      }
      if (force && requestId !== undefined)
        throw new RuntimeClientError(
          "INVALID_ARGUMENTS",
          "Choose --force or --request-id, not both.",
        );
      let request;
      try {
        request = JSON.parse(inputText);
      } catch {
        throw new RuntimeClientError(
          "INVALID_INPUT",
          "Provide the business input as JSON.",
        );
      }
      try {
        request = await validateRequest(request);
      } catch {
        throw new RuntimeClientError(
          "INVALID_INPUT",
          "Check the business input against this Skill’s instructions.",
        );
      }
      const select = (knownRequestIds) => selectInvocation(
        connection,
        reference,
        {
          request,
          requestedMaxUsageUnits: units,
          ...(acceptedTerms === undefined ? {} : { acceptedTerms }),
        },
        { force, knownRequestIds, ...(requestId === undefined ? {} : { requestId }) },
      );
      checkpoint = env.AGENTPAY_DEFAULT_SELECTION === '1'
        ? await withDefaultRequest({service:reference,input:{request},dataDir:connection.dataDir,force},select)
        : await select();
    } else
      throw new RuntimeClientError(
        "INVALID_ARGUMENTS",
        "Use --invoke <JSON> [--units N] [--force], --check, --quote or --resume <request-id>.",
      );
    requestId = checkpoint.requestId;
    notice(
      `Request: ${requestId}. Matching calls recover or reuse output; --force starts another paid request.`,
    );
    const result = await invokeService(connection, reference, checkpoint, {
      inputFiles,
      prepareRequest,
    });
    await completeInvocation(connection, reference, checkpoint);
    let files;
    if (outputFiles) {
      try {
        const declarations = await outputFiles(
          structuredClone(result.result.output),
        );
        if (!Array.isArray(declarations) || declarations.length > 20)
          throw Error("Invalid output file declarations");
        files = [];
        for (const file of declarations) {
          if (
            !file ||
            Object.keys(file).some(
              (k) => !["fileKey", "url", "filename", "sha256"].includes(k),
            )
          )
            throw Error("Invalid output file declaration");
          files.push(
            await cacheResultFile(connection, {
              ...file,
              orderId: result.result.orderId,
            }),
          );
        }
      } catch {
        write({
          ...result,
          requestId,
          fileCache: {
            state: "incomplete",
            message:
              "Delivery is saved. Retry this same request to finish saving files; do not use --force.",
          },
        });
        return 1;
      }
    }
    write({ ...result, requestId, ...(files ? { files } : {}) });
    return 0;
  } catch (error) {
    const known =
      error instanceof RuntimeClientError ||
      ["SERVICE_REFERENCE_INVALID", "ORIGINAL_INSTALLATION_REQUIRED", "ORIGINAL_REQUEST_AMBIGUOUS", "REQUEST_HISTORY_REVIEW_REQUIRED"].includes(error.code);
    write({
      ok: false,
      ...(requestId ? { requestId } : {}),
      error: {
        code: known ? error.code : "LOCAL_CLIENT_FAILED",
        message: known
          ? error.message
          : "Inspect local AgentPay setup and preserve existing requests.",
        ...(error.runtimeCode ? { runtimeCode: error.runtimeCode } : {}),
      },
    });
    return 1;
  }
}
