// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { NODE_REQUIREMENT, supportedNodeVersion } from "./node-version.mjs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { checkLocalInstallation } from "./install-preflight.mjs";

export function marketSettingsUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
  )
    throw Error(
      "Use the Market HTTPS origin, or a loopback HTTP origin for private rehearsal.",
    );
  return new URL("/market/web/onboarding/user-config", url).href;
}
export async function fingerprint(root, paths) {
  const hash = createHash("sha256");
  async function visit(name) {
    const full = join(root, name),
      info = await lstat(full);
    if (info.isSymbolicLink())
      throw Error(`Inspect the symbolic link before installing: ${full}`);
    if (info.isDirectory()) {
      for (const child of (await readdir(full)).sort())
        await visit(join(name, child));
    } else if (info.isFile()) {
      hash.update(name);
      hash.update("\0");
      hash.update(await readFile(full));
      hash.update("\0");
    } else throw Error(`Unexpected installation input: ${full}`);
  }
  for (const path of paths) await visit(path);
  return hash.digest("hex");
}
async function saveJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
    await file.close();
    await rename(temp, path);
  } finally {
    await file.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}
export async function runInstall({
  userDir,
  market,
  dataDir,
  run = runCommand,
  fetchImpl = fetch,
  write = console.log,
  nodeVersion = process.versions.node,
  prepareOnly = false,
  forceWalletBuild = false,
  beforePrepare,
  afterPrepare,
}) {
  userDir = resolve(userDir);
  const parent = dirname(userDir),
    walletDir = join(parent, "wallet");
  const endpoint = prepareOnly ? null : marketSettingsUrl(market);
  if (typeof process.getuid !== "function")
    throw Error(
      "This installer needs POSIX file ownership support. Native Windows installation is not available; use a supported Linux environment.",
    );
  if (!supportedNodeVersion(nodeVersion))
    throw Error(
      `Install ${NODE_REQUIREMENT} first. Detected Node ${nodeVersion}.`,
    );
  for (const [dir, name] of [
    [userDir, "@agentpay/user-runtime"],
    [walletDir, "agentpay-wallet"],
  ]) {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("Keep real User and Wallet folders side by side.");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if (pkg.name !== name) throw Error(`Unexpected repository at ${dir}`);
  }
  const privateDir = resolve(dataDir),
    stateDir = join(parent, ".agentpay-install");
  await mkdir(stateDir, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stateInfo = await lstat(stateDir);
  if (
    !stateInfo.isDirectory() ||
    stateInfo.isSymbolicLink() ||
    stateInfo.uid !== process.getuid() ||
    stateInfo.mode & 0o077
  )
    throw Error("Installation state directory must be owner-held and private.");
  const lockPath = join(stateDir, "install.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error(
        `Another installation may be running. Check ${lockPath} before removing a stale lock.`,
      );
    throw e;
  }
  const logPath = join(stateDir, `install-${Date.now()}-${randomUUID()}.log`),
    statePath = join(stateDir, "state.json");
  let state = { version: 1 };
  try {
    try {
      const info = await lstat(statePath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077
      )
        throw Error("Unsafe install checkpoint");
      state = JSON.parse(await readFile(statePath, "utf8"));
      if (state.version !== 1) throw Error("Unknown install checkpoint");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const initial = await checkLocalInstallation({
      userDir,
      dataDir: privateDir,
      nodeVersion,
    });
    const pathErrors = initial.checks.filter(
      (c) =>
        c.status === "failed" &&
        (c.code === "PRIVATE_PATH" || c.code.startsWith("PRIVATE_DIRECTORY_")),
    );
    if (pathErrors.length)
      throw Error(`${pathErrors[0].message}. ${pathErrors[0].fix || ""}`);
    const commands = [
      ["npm", ["--version"]],
      ["corepack", ["--version"]],
    ];
    for (const [command, args] of commands) {
      try {
        await run(command, args, { cwd: userDir, logPath });
      } catch {
        throw Error(
          command === "corepack"
            ? "Corepack is required to build Wallet. Install it with npm install --global corepack, then retry the same command. Node alone may not include Corepack."
            : "npm is required. Install a Node distribution that includes npm, and retry with its bin directory on PATH (or AGENTPAY_NODE pointing to that Node).",
        );
      }
    }
    // Update service handoff runs inside the same installer lock as dependency writes.
    const preparationContext = {
      logPath,
      state,
      initial,
      saveState: () => saveJson(statePath, state),
    };
    if (
      prepareOnly &&
      beforePrepare &&
      (await beforePrepare(preparationContext)) === false
    )
      return { completed: true, skipped: true, logPath };
    async function dependencyFailures(prefix) {
      const result = await checkLocalInstallation({
        userDir,
        dataDir: privateDir,
        nodeVersion,
      });
      return result.checks.filter(
        (c) =>
          c.status === "failed" && c.code.startsWith(prefix + "_DEPENDENCY_"),
      );
    }
    async function dependenciesPresent(prefix) {
      return (await dependencyFailures(prefix)).length === 0;
    }
    async function verifyDependencies(prefix) {
      const failed = await dependencyFailures(prefix);
      if (failed.length) {
        await appendFile(
          logPath,
          failed.map((c) => `${c.code}: ${c.message}`).join("\n") + "\n",
          { mode: 0o600 },
        );
        const message = `${prefix === "WALLET" ? "Wallet" : "User"} dependencies could not be verified: ${failed.map((c) => c.code.slice((prefix + "_DEPENDENCY_").length)).join(", ")}.`;
        throw Object.assign(Error(message), { preparationMessage: message });
      }
    }
    const walletInputs = await fingerprint(walletDir, [
      "package.json",
      "pnpm-lock.yaml",
      "vendor",
    ]);
    const walletChanged =
      state.walletDependencies !== walletInputs ||
      !(await dependenciesPresent("WALLET"));
    if (walletChanged) {
      write("1/4 Install Wallet dependencies. This may take a few minutes.");
      await run("corepack", ["pnpm@10.0.0", "install", "--frozen-lockfile"], {
        cwd: walletDir,
        logPath,
      });
      await verifyDependencies("WALLET");
      state.walletDependencies = walletInputs;
      delete state.walletBuild;
      await saveJson(statePath, state);
    } else write("1/4 Wallet dependencies ready.");
    const buildInputs = await fingerprint(walletDir, [
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "src",
      "vendor",
    ]);
    let outputs;
    try {
      outputs = await fingerprint(walletDir, ["dist/src"]);
    } catch {}
    if (
      forceWalletBuild ||
      walletChanged ||
      state.walletBuild?.inputs !== buildInputs ||
      state.walletBuild?.outputs !== outputs ||
      !outputs
    ) {
      write("2/4 Build Wallet. This may take a few minutes.");
      await run("corepack", ["pnpm@10.0.0", "build"], {
        cwd: walletDir,
        logPath,
      });
      state.walletBuild = {
        inputs: buildInputs,
        outputs: await fingerprint(walletDir, ["dist/src"]),
      };
      await saveJson(statePath, state);
    } else write("2/4 Wallet build ready.");
    const userInputs = await fingerprint(userDir, [
      "package.json",
      "package-lock.json",
      "vendor",
    ]);
    if (
      state.userDependencies !== userInputs ||
      !(await dependenciesPresent("USER"))
    ) {
      write("3/4 Install User dependencies.");
      await run("npm", ["ci"], { cwd: userDir, logPath });
      await verifyDependencies("USER");
      state.userDependencies = userInputs;
      await saveJson(statePath, state);
    } else write("3/4 User dependencies ready.");
    const checked = await checkLocalInstallation({
      userDir,
      dataDir: privateDir,
      nodeVersion,
    });
    if (!checked.ok) {
      const failed = checked.checks.find((c) => c.status === "failed");
      throw Error(`${failed.message}. ${failed.fix || ""}`);
    }
    if (prepareOnly) {
      if (afterPrepare) await afterPrepare(preparationContext);
      return { completed: true, logPath };
    }
    write("4/4 Download public Market settings.");
    let response;
    try {
      response = await fetchImpl(endpoint, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      const code =
        error.cause?.code || error.code || error.name || "NETWORK_ERROR";
      const safeCode = String(code)
        .replace(/[^A-Za-z0-9_]/g, "")
        .slice(0, 64);
      await appendFile(
        logPath,
        `Market settings request failed: ${endpoint} (${safeCode})\n`,
      );
      throw Error(
        `Cannot download Market settings from ${endpoint} (${safeCode}). Check the Market connection; for private rehearsal, keep the website SSH tunnel open and try 127.0.0.1 instead of localhost.`,
      );
    }
    if (!response.ok)
      throw Error(
        `Market settings unavailable (HTTP ${response.status}). Retry the same Install command later.`,
      );
    const chunks = [];
    let bytes = 0;
    if (!response.body) throw Error("Empty Market settings response.");
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16384) throw Error("Market settings response too large.");
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const { validatePublicDeployment } = await import(
      "./prepare-onboarding.mjs"
    );
    const config = validatePublicDeployment(JSON.parse(raw));
    await saveJson(join(parent, "user-deployment.json"), config);
    write(
      "Dependencies, Wallet build and Market settings are ready. Continuing to setup.",
    );
    return { completed: true, logPath };
  } catch (error) {
    await appendFile(logPath, `Installation stopped: ${error.message}\n`, {
      mode: 0o600,
    }).catch(() => {});
    write(
      `Installation stopped. ${error.message}\nAfter resolving the cause, rerun the same Install command. Log: ${logPath}`,
    );
    error.messageDisplayed = true;
    error.logPath = logPath;
    throw error;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
async function runCommand(command, args, { cwd, logPath }) {
  const log = await open(logPath, "a", 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          PATH:
            dirname(process.execPath) +
            (process.platform === "win32" ? ";" : ":") +
            (process.env.PATH || ""),
          COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
        },
        stdio: ["ignore", log.fd, log.fd],
      });
      child.once("error", (e) =>
        reject(
          Error(
            `${command} could not start (${e.code}). Check that it is installed and on PATH.`,
          ),
        ),
      );
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              Error(
                `${command} ${args.join(" ")} failed (exit ${code}). See the install log.`,
              ),
            ),
      );
    });
  } finally {
    await log.close();
  }
}
