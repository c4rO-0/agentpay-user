// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { confirmSkillAction } from "../src/skill-install-prompt.mjs";
test("confirmation stays concise; details shows full information without accepting", async () => {
  const output = [];
  const answers = ["details", "invalid", "confirm"];
  assert.equal(
    await confirmSkillAction({
      prompt: "choice",
      details: { sha256: "verified", service: { id: "service" } },
      ask: async () => answers.shift(),
      write: (value) => output.push(value),
    }),
    true,
  );
  assert.deepEqual(JSON.parse(output[0]), {
    sha256: "verified",
    service: { id: "service" },
  });
  assert.match(output[1], /confirm.*details.*q/);
});
test("confirm and cancel do not dump package metadata", async () => {
  for (const answer of ["confirm", "q"]) {
    const output = [];
    assert.equal(
      await confirmSkillAction({
        prompt: "choice",
        details: { long: "metadata" },
        ask: async () => answer,
        write: (value) => output.push(value),
      }),
      answer === "confirm",
    );
    assert.deepEqual(output, []);
  }
});
