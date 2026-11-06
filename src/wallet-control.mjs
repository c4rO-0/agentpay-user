// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { listenerPresent } from "./local-services.mjs";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function controlWallet(
  action,
  {
    args = process.argv.slice(2),
    env = process.env,
    terminal = Boolean(process.stdin.isTTY && process.stderr.isTTY),
    spawnWallet = spawn,
    inspect = lstat,
    probe = listenerPresent,
    resolveDirectory = resolveUserDataDir,
    write = (m) => process.stderr.write(m + "\n"),
    prompt = (m) => process.stderr.write(m),
  } = {},
) {
  if (!["unlock", "lock", "status"].includes(action))
    throw Error("Unsupported Wallet action");
  if (args.length > 1 || args[0]?.startsWith("-")) {
    write(`Usage: ./run ${action} [User data directory]`);
    return args.length === 1 && args[0] === "--help" ? 0 : 2;
  }
  if (action === "unlock" && !terminal) {
    write(
      "Open a terminal to unlock Wallet. Do not pass your password as an argument.",
    );
    return 1;
  }
  let dataDir;
  try {
    dataDir = await resolveDirectory({ argument: args[0], env });
  } catch {
    write(
      "Your saved installation directory could not be read. Check the installation record or explicitly select your existing User data directory.",
    );
    return 1;
  }
  const walletDir = join(dataDir, "wallet"),
    walletCli = fileURLToPath(
      new URL("../../wallet/dist/src/cli.js", import.meta.url),
    );
  try {
    if (!(await inspect(walletCli)).isFile()) throw Error();
  } catch {
    write(
      "Wallet executable could not be found or read. Complete ./run install --market YOUR_MARKET_URL first.",
    );
    return 1;
  }
  const privateEntry = (info) =>
    info.uid === process.getuid() &&
    (info.mode & 0o077) === 0 &&
    !info.isSymbolicLink();
  try {
    const dir = await inspect(walletDir);
    if (!dir.isDirectory() || !privateEntry(dir)) throw Error();
    const token = await inspect(
      join(walletDir, action === "status" ? "agent.token" : "admin.token"),
    );
    if (!token.isFile() || !privateEntry(token)) throw Error();
  } catch (error) {
    write(
      error.code === "ENOENT"
        ? `Wallet setup files are missing in: ${walletDir}`
        : `Cannot safely read Wallet setup in: ${walletDir}`,
    );
    write(
      `If you selected the wrong installation: ./run ${action} '/your/existing/User data directory'`,
    );
    return 1;
  }
  try {
    const sock = await inspect(join(walletDir, "wallet.sock"));
    if (!sock.isSocket() || !privateEntry(sock)) throw Error();
  } catch (error) {
    write(
      error.code === "ENOENT"
        ? "No Wallet socket was found for this installation. Run ./run service start, then ./run status."
        : "The Wallet socket could not be safely inspected. Check the selected data directory and socket ownership.",
    );
    return 1;
  }
  try {
    if (!(await probe(join(walletDir, "wallet.sock")))) {
      write(
        "No Wallet is listening on the saved socket (stale socket). Run ./run service start, then ./run status.",
      );
      return 1;
    }
  } catch {
    write(
      "Could not check the Wallet connection. Run ./run status; inspect ./run service logs wallet if it remains unavailable.",
    );
    return 1;
  }
  // stdin belongs directly to Wallet. Only public CLI output is captured; no password
  // arguments, shell, Runtime call, secret capture, or persistent output file.
  let output = "",
    errors = "",
    overflow = false,
    prompted = false;
  const code = await new Promise((done) => {
    const child = spawnWallet(
      process.execPath,
      [walletCli, action, walletDir],
      { stdio: ["inherit", "pipe", "pipe"], shell: false },
    );
    const collect = (part, isError) => {
      if (overflow) return;
      const text = part.toString();
      if (output.length + errors.length + text.length > 16384) {
        overflow = true;
        child.kill();
        return;
      }
      if (isError) {
        errors += text;
        if (errors.startsWith("Unlock secret: ")) {
          prompt("Wallet password (input hidden): ");
          prompted = true;
          errors = errors.slice("Unlock secret: ".length);
        }
      } else output += text;
    };
    child.stdout.on("data", (part) => collect(part, false));
    child.stderr.on("data", (part) => collect(part, true));
    child.once("error", () => done(1));
    child.once("close", (code) => done(code ?? 1));
  });
  if (prompted) prompt("\n");
  let result, error;
  try {
    result = JSON.parse(output.trim());
  } catch {}
  for (const line of errors.split("\n")) {
    try {
      const value = JSON.parse(line);
      if (value?.ok === false) error = value.error;
    } catch {}
  }
  const success =
    action === "status"
      ? typeof result?.locked === "boolean"
      : action === "lock"
        ? result?.locked === true
        : typeof result?.address === "string";
  if (code === 0 && !overflow && !error && success) {
    write(
      action === "status"
        ? `Wallet: running (${result.locked ? "locked" : "unlocked"}).`
        : action === "lock"
          ? "Wallet locked. Your on-chain spending permission is unchanged."
          : "Wallet unlocked. Order checks will continue. Use ./run status before resuming your original Skill request.",
    );
    return 0;
  }
  const messages = {
    UNLOCK_FAILED:
      "Could not unlock Wallet. Check your password and try again.",
    CANCELLED: "Unlock cancelled. Wallet was not unlocked.",
    UNAUTHORIZED:
      "Local Wallet access was rejected. Check that you selected the correct User data directory.",
    LOCKED: "Wallet is still locked.",
    TTY_REQUIRED: "Run unlock in an interactive terminal.",
  };
  write(
    messages[error?.code] ||
      `Wallet did not confirm ${action}. Run ./run status, then ./run service logs wallet for the cause.`,
  );
  if (error?.code && !messages[error.code])
    write(
      `Error code: ${/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "UNKNOWN_ERROR"}`,
    );
  return code || 1;
}
