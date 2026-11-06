// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { open } from "node:fs/promises";
import { constants } from "node:fs";
const queues = new Map();
// Same portable OS lock primitive as the file store, but scoped to a client call.
// No PID files or stale-lock deletion: process exit releases the descriptor lock.
export async function withClientRequestLock(path, operation) {
  const previous = queues.get(path) || Promise.resolve();
  let release;
  const current = new Promise((r) => (release = r));
  queues.set(path, current);
  await previous;
  let handle;
  try {
    const { tryLock } = await import("fs-native-extensions");
    handle = await open(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    const s = await handle.stat();
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid() ||
      s.mode & 0o077
    )
      throw Error("Unsafe request lock");
    if (!tryLock(handle.fd))
      throw Object.assign(
        Error(
          "This original request is already running. Retry the same request shortly.",
        ),
        { code: "REQUEST_BUSY" },
      );
    return await operation();
  } finally {
    await handle?.close();
    release();
    if (queues.get(path) === current) queues.delete(path);
  }
}
