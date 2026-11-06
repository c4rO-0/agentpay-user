// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizationFields } from "../src/authorization-question-checkpoint.mjs";
import { saveAuthorizationInputs } from "../src/anvil-onboarding.mjs";
test("saved fields survive wording changes and cancellation stores no missing answer", async () => {
  let checkpoint = null;
  const save = async (v) => {
    checkpoint = structuredClone(v);
  };
  const answers = ["address", "q"];
  const first = authorizationFields({
    context: "deployment",
    ask: async () => answers.shift(),
    save,
    write: () => {},
  });
  await first("safe", "Old wording", (v) => v);
  await assert.rejects(
    first("budget", "Budget", (v) => v),
    (e) => e.code === "CANCELLED",
  );
  const second = authorizationFields({
    context: "deployment",
    checkpoint,
    ask: () => {
      throw Error("must reuse");
    },
    save,
    write: () => {},
  });
  assert.equal(await second("safe", "New wording", (v) => v), "address");
  assert.deepEqual(Object.keys(checkpoint.fields), ["safe"]);
});
test("wrong context and invalid saved fields stop instead of silently authorizing", async () => {
  const checkpoint = {
    version: 2,
    context: "old",
    fields: { budget: "invalid" },
  };
  assert.throws(
    () => authorizationFields({ context: "new", checkpoint }),
    /MISMATCH/,
  );
  const field = authorizationFields({
    context: "old",
    checkpoint,
    write: () => {},
  });
  await assert.rejects(
    field("budget", "Budget", () => {
      throw Error();
    }),
    /SAVED_AUTHORIZATION_FIELD_INVALID/,
  );
});
test("field checkpoint persistence replaces complete private bytes only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "authorization-inputs-"));
  try {
    const path = join(dir, "fields.json");
    await saveAuthorizationInputs(path, { version: 2, fields: {} });
    await saveAuthorizationInputs(path, {
      version: 2,
      fields: { safe: "public address" },
    });
    assert.equal(
      JSON.parse(await readFile(path, "utf8")).fields.safe,
      "public address",
    );
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("back clears the previous editable answer and dependent fields, retaining earlier context", async () => {
  let checkpoint;
  const field = authorizationFields({
    context: "x",
    checkpoint: {
      version: 2,
      context: "x",
      fields: { safe: "safe", budget: "10" },
    },
    ask: async () => "back",
    save: async (v) => {
      checkpoint = v;
    },
    write: () => {},
  });
  await field("safe", "Safe", (v) => v, "safe");
  await field("budget", "Budget", (v) => v);
  await assert.rejects(
    field("perPayment", "Limit", (v) => v),
    (e) => e.code === "AUTHORIZATION_BACK",
  );
  assert.deepEqual(checkpoint.fields, { safe: "safe" });
});
