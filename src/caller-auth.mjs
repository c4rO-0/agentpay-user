// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export async function readCallerToken(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let token;
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size > 1024
    )
      throw Error(
        "User Runtime caller credential must be a private regular file",
      );
    token = (await handle.readFile("utf8")).trim();
  } finally {
    await handle.close();
  }
  if (!TOKEN_PATTERN.test(token))
    throw new Error("User Runtime caller credential file is invalid");
  return token;
}

export function authorizeCaller(header, expectedToken) {
  const prefix = "Bearer ";
  const value =
    typeof header === "string" && header.startsWith(prefix)
      ? header.slice(prefix.length)
      : "";
  const actual = Buffer.from(value, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function initializeCallerCredential(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${randomBytes(32).toString("hex")}\n`, "utf8");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    await handle?.close();
  }
  // Existing credentials may need private permissions, but never chmod a link
  // target or another owner's file. Keep inspection and chmod on one descriptor.
  const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await existing.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || info.size > 1024)
      throw Object.assign(Error("Caller credential must be a regular file owned by you, without links."), {code: "UNSAFE_FILE"});
    await existing.chmod(0o600);
  } finally { await existing.close(); }
  return readCallerToken(path);
}
