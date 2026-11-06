#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { confirmSkillAction } from "../src/skill-install-prompt.mjs";
import {
  inspectInstalledBundle,
  selectInstalledBundle,
} from "../src/active-skill.mjs";
const [mode, data, directory] = process.argv.slice(2);
if (
  !["--preview", "--execute"].includes(mode) ||
  !data ||
  !directory ||
  process.argv.length !== 5
)
  throw new Error(
    "Usage: select-skill-bundle.mjs <--preview|--execute> DATA BUNDLE_DIRECTORY",
  );
const info = await inspectInstalledBundle(directory);
const details = { ok: true, mode, ...info, orderCreated: false };
if (mode === "--preview") console.log(JSON.stringify(details, null, 2));
if (mode === "--execute") {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error("SELECTION_TTY_REQUIRED");
  console.log(
    `Use this Skill in your local Runtime.\n${info.locallyModified ? "These files contain local edits. Review the details before confirming." : "Package files are unchanged since installation."}\nThis selects local files; it does not start a service or make a payment.`,
  );
  if (
    !(await confirmSkillAction({
      prompt:
        "Type 'confirm' to select, 'details' to view file and service information, or 'q' to cancel: ",
      details,
    }))
  )
    throw new Error("SELECTION_NOT_CONFIRMED");
  await selectInstalledBundle(data, directory, info.hashes);
  console.log("Skill selected. Next: start and unlock Wallet / Runtime.");
}
