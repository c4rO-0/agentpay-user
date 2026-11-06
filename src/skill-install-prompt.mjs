// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createInterface } from "node:readline/promises";

export async function confirmSkillAction({
  prompt,
  details,
  ask,
  write = console.log,
}) {
  const terminal = ask
    ? null
    : createInterface({ input: process.stdin, output: process.stderr });
  try {
    while (true) {
      const answer = (await (ask ? ask(prompt) : terminal.question(prompt)))
        .trim()
        .toLowerCase();
      if (answer === "details") {
        write(JSON.stringify(details, null, 2));
        continue;
      }
      if (answer === "confirm") return true;
      if (answer === "q") return false;
      write("Type 'confirm', 'details', or 'q'.");
    }
  } finally {
    terminal?.close();
  }
}
