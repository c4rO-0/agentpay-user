// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { rememberUserDataDir } from "./local-data-directory.mjs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { runInstall } from "./install-user.mjs";
import { activateSetup } from './setup-service-selection.mjs';

export async function installAndSetup({
  userDir,
  market,
  dataDir,
  install = runInstall,
  start = startGuide,
  remember = rememberUserDataDir,
  activate = activateSetup,
  write = console.log,
}) {
  const result = await install({ userDir, market, dataDir, write,
    beforeApplySettings: () => activate({dataDir,write}),
  });
  if (result?.cancelled) return result.exitCode;
  if (!result?.completed)
    throw Error(
      "Installation did not complete. Run the same Install command to resume.",
    );
  await remember({ userDir, dataDir });
  return start({ userDir, dataDir });
}
function startGuide({ userDir, dataDir }) {
  return new Promise((resolve, reject) => {
    // Start only after the installed packages are verified. Keeping imports in the
    // child avoids requiring ethers before the installer has installed it.
    const child = spawn(
      process.execPath,
      [join(userDir, "scripts/user-setup.mjs"), "--guided", dataDir],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
