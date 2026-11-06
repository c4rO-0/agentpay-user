// Private result persistence. Received output and verified replayable output are distinct
// states; storing bytes alone does not establish delivery or final settlement.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { open, mkdir, lstat, link, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
function resultFiles(statePath, pending = false) {
  const directory = statePath + (pending ? ".pending-results" : ".results");
  const version = pending
    ? "agentpay.pending-result.v1"
    : "agentpay.invocation-result.v1";
  const name = (id) => {
    if (!/^0x[0-9a-f]{64}$/.test(id || ""))
      throw Error("INVOCATION_RESULT_ID_INVALID");
    return join(directory, id + ".json");
  };
  return {
    async read(invocation) {
      try {
        const dir = await lstat(directory);
        if (
          !dir.isDirectory() ||
          dir.isSymbolicLink() ||
          dir.uid !== process.getuid() ||
          dir.mode & 0o077
        )
          throw Error("INVOCATION_RESULT_UNSAFE");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }

      let file;
      try {
        file = await open(
          name(invocation.invocationId),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      let value;
      try {
        const st = await file.stat();
        if (
          !st.isFile() ||
          st.uid !== process.getuid() ||
          st.mode & 0o077 ||
          st.size > 2 * 1048576
        )
          throw Error("INVOCATION_RESULT_UNSAFE");
        value = JSON.parse(await file.readFile("utf8"));
      } finally {
        await file.close();
      }
      if (
        value?.version !== version ||
        value.invocationId !== invocation.invocationId ||
        value.requestHash !== invocation.requestHash ||
        value.serviceBinding !== invocation.serviceBinding ||
        !value.result ||
        typeof value.result !== "object" ||
        Array.isArray(value.result)
      )
        throw Error("INVOCATION_RESULT_CONFLICT");
      return value.result;
    },
    async save(invocation, result) {
      const content =
        JSON.stringify({
          version,
          invocationId: invocation.invocationId,
          requestHash: invocation.requestHash,
          serviceBinding: invocation.serviceBinding,
          result,
        }) + "\n";
      if (Buffer.byteLength(content) > 2 * 1048576)
        throw Error("INVOCATION_RESULT_TOO_LARGE");
      await mkdir(directory, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      const st = await lstat(directory);
      if (
        !st.isDirectory() ||
        st.isSymbolicLink() ||
        st.uid !== process.getuid() ||
        st.mode & 0o077
      )
        throw Error("INVOCATION_RESULT_UNSAFE");
      const parent = await open(dirname(directory), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      const target = name(invocation.invocationId),
        temporary = join(directory, ".result-" + randomUUID());
      const file = await open(temporary, "wx", 0o600);
      try {
        try {
          await file.writeFile(content);
          await file.sync();
        } finally {
          await file.close();
        }
        await link(temporary, target).catch(async (error) => {
          if (error.code !== "EEXIST") throw error;
          const existing = await this.read(invocation);
          const immutable = (v) => {
            if (pending) return v;
            const { finalization, deadlines, ...content } = v;
            return content;
          };
          if (
            JSON.stringify(immutable(existing)) !==
            JSON.stringify(immutable(result))
          )
            throw Error("INVOCATION_RESULT_CONFLICT");
        });
        const dir = await open(directory, "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
  };
}

export function invocationResults(statePath) {
  const verified = resultFiles(statePath),
    pending = resultFiles(statePath, true);
  return {
    read: verified.read.bind(verified),
    save: verified.save.bind(verified),
    readPending: pending.read.bind(pending),
    savePending: pending.save.bind(pending),
  };
}
