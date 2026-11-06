// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { confirmDemoUnlockSecret } from "../src/demo-unlock-secret.mjs";
test("demo retries mismatch and discards matched input without logging secrets", async () => {
  const answers = [
      "practice-a",
      "practice-b",
      "demo-value-42",
      "demo-value-42",
    ],
    messages = [];
  const result = await confirmDemoUnlockSecret({
    readHidden: async () => answers.shift(),
    write: (text) => messages.push(text),
  });
  assert.equal(result, undefined);
  assert.equal(answers.length, 0);
  assert.ok(messages.some((text) => text.includes("do not match")));
  assert.doesNotMatch(
    messages.join("\n"),
    /practice-a|practice-b|demo-value-42/,
  );
});
