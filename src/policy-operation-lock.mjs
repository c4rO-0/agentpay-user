// SPDX-License-Identifier: MPL-2.0
import { constants } from "node:fs";
import { open, mkdir, lstat } from "node:fs/promises";
import { join } from "node:path";

const unsafe = () => Object.assign(
  Error("Authorization lock storage is not safe. Keep your data and check its ownership and permissions."),
  { code: "POLICY_LOCK_UNSAFE" },
);

// The dependency implements OS descriptor locks on Linux, macOS and Windows.
// Never expire/unlink this file: an old process may resume after a long pause.
// Do not pass this descriptor to browser or service children. Process exit closes
// it automatically; the next command must still resume the saved authorization.
export async function acquirePolicyOperation(dataDir) {
  for (const directory of [dataDir, join(dataDir, "runtime")]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        (process.platform !== "win32" &&
          (info.uid !== process.getuid() || info.mode & 0o022))) throw unsafe();
  }

  let tryLock;
  try {
    ({ tryLock } = await import("fs-native-extensions"));
  } catch (cause) {
    throw Object.assign(Error("The native authorization lock could not be loaded."), {
      code: "POLICY_LOCK_UNAVAILABLE", cause,
    });
  }

  const path = join(dataDir, "runtime", "policy-operation.lock");
  const file = await open(path,
    constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    const info = await file.stat();
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || entry.dev !== info.dev || entry.ino !== info.ino)
      throw unsafe();
    if (!info.isFile() || info.nlink !== 1 ||
        (process.platform !== "win32" &&
          (info.uid !== process.getuid() || info.mode & 0o077))) throw unsafe();
    if (!tryLock(file.fd)) {
      throw Object.assign(
        Error("Another setup, renewal, revocation or restoration is running for this Wallet. Finish it, or stop that command before retrying. Keep the saved authorization records."),
        { code: "POLICY_OPERATION_BUSY" },
      );
    }
    return () => file.close();
  } catch (error) {
    await file.close();
    throw error;
  }
}
