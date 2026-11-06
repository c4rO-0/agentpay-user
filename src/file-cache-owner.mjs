// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { realpath, open, lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileError } from "./file-download.mjs";
const owners = new Map();
// Keep the descriptor open for this Runtime's lifetime. OS file locks release on
// exit, including a crash. The empty lock file remains: never unlink or replace it,
// since another process may already have opened that same file to acquire its lock.
export async function cacheOwner(directory) {
  const canonical = await realpath(directory);
  if (owners.has(canonical)) return owners.get(canonical);
  const pending = (async () => {
    let handle;
    try {
      // Load only when file caching is used. An unavailable native binding must not
      // prevent Runtime startup, original Order checks or structured-result recovery.
      let tryLock;
      try {
        ({ tryLock } = await import("fs-native-extensions"));
      } catch {
        throw fileError(
          "FILE_CACHE_LOCK_UNAVAILABLE",
          "File cache support is not installed for this system. Run npm ci in User, then restart Runtime.",
        );
      }
      const path = join(canonical, "owner.lock");
      handle = await open(
        path,
        constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW || 0),
        0o600,
      );
      const stat = await handle.stat(),
        entry = await lstat(path);
      if (
        !stat.isFile() ||
        entry.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.dev !== entry.dev ||
        stat.ino !== entry.ino ||
        (typeof process.getuid === "function" &&
          (stat.uid !== process.getuid() || stat.mode & 0o077))
      ) {
        throw fileError(
          "FILE_CACHE_UNSAFE",
          "File cache lock ownership or permissions need review.",
        );
      }
      if (!tryLock(handle.fd))
        throw fileError(
          "FILE_CACHE_IN_USE",
          "Another Runtime owns this file cache. Stop that Runtime before retrying.",
        );
      // Retaining handle also prevents FileHandle garbage collection closing the lock.
      return { handle, tail: Promise.resolve(), initialized: false };
    } catch (error) {
      await handle?.close();
      if (error.code?.startsWith("FILE_")) throw error;
      throw fileError(
        "FILE_CACHE_LOCK_UNAVAILABLE",
        "Could not lock this cache directory. Check local filesystem support and permissions before retrying.",
      );
    }
  })();
  owners.set(canonical, pending);
  try {
    return await pending;
  } catch (error) {
    owners.delete(canonical);
    throw error;
  }
}
