// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
export const installedUserDir = fileURLToPath(new URL("..", import.meta.url));
const stateDirectory = (userDir) =>
  join(dirname(resolve(userDir)), ".agentpay-install");
function privateInfo(info) {
  return (
    info.uid === process.getuid() &&
    (info.mode & 0o077) === 0 &&
    !info.isSymbolicLink()
  );
}
async function readState(userDir) {
  const directory = stateDirectory(userDir);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || !privateInfo(info))
      throw Error(
        "Installation record directory must be private and owned by you.",
      );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  let file;
  try {
    file = await open(
      join(directory, "state.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const info = await file.stat();
    if (!info.isFile() || !privateInfo(info) || info.size > 65536)
      throw Error("Installation record is not a private regular file.");
    const state = JSON.parse(await file.readFile("utf8"));
    if (
      state.version !== 1 ||
      (state.dataDir !== undefined &&
        (typeof state.dataDir !== "string" ||
          !isAbsolute(state.dataDir) ||
          state.dataDir.includes("\0")))
    )
      throw Error("Installation record is invalid.");
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  } finally {
    await file?.close();
  }
}
export async function resolveUserDataDir({
  argument,
  env = process.env,
  userDir = installedUserDir,
} = {}) {
  if (argument || env.AGENTPAY_USER_DATA_DIR)
    return resolve(argument || env.AGENTPAY_USER_DATA_DIR);
  const state = await readState(userDir);
  return state.dataDir || join(homedir(), ".local/share/agentpay/user");
}
// Uses the existing installer lock and preserves dependency/build checkpoints.
export async function rememberUserDataDir({
  userDir = installedUserDir,
  dataDir,
}) {
  const directory = stateDirectory(userDir);
  await mkdir(directory, { mode: 0o700 }).catch((e) => {
    if (e.code !== "EEXIST") throw e;
  });
  const info = await lstat(directory);
  if (!info.isDirectory() || !privateInfo(info))
    throw Error(
      "Installation record directory must be private and owned by you.",
    );
  const lockPath = join(directory, "install.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        "Another installation may be running. Retry after it finishes.",
      );
    throw error;
  }
  const temp = join(directory, `location-${randomUUID()}.tmp`);
  let file;
  try {
    const state = await readState(userDir);
    file = await open(temp, "wx", 0o600);
    await file.writeFile(
      JSON.stringify({ ...state, version: 1, dataDir: resolve(dataDir) }) +
        "\n",
    );
    await file.sync();
    await file.close();
    file = null;
    await rename(temp, join(directory, "state.json"));
  } finally {
    await file?.close();
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
