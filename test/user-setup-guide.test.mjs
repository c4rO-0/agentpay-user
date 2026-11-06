// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runUserSetupGuide,
  inspectLocalUserSetup,
} from "../src/user-setup-guide.mjs";
test("existing setup previews with saved delegate, never initializes or uninstalls", async () => {
  const answers = ["authorization", "uninstall", "update", "q"];
  let initialized = 0,
    delegate;
  const output = [];
  await runUserSetupGuide({
    ask: async () => answers.shift(),
    write: (text) => output.push(text),
    check: async () => ({ ok: true }),
    state: async () => ({
      stage: "initialized",
      delegate: "public-address",
      policyPresent: true,
    }),
    initialize: async () => initialized++,
    preview: async (value) => (delegate = value),
  });
  assert.equal(initialized, 0);
  assert.equal(delegate, "public-address");
  assert.ok(
    output.some((text) => text.includes("Safe permissions remain unchanged")),
  );
});
test("choosing initialization creates Wallet without an extra confirmation", async () => {
  const answers = ["authorization", "initialize", "q"];
  let initialized = 0;
  await runUserSetupGuide({
    ask: async () => answers.shift(),
    write: () => {},
    check: async () => ({ ok: true }),
    state: async () => ({
      stage: initialized ? "initialized" : "not_initialized",
    }),
    initialize: async () => initialized++,
    preview: () => {
      throw Error("must not preview");
    },
  });
  assert.equal(initialized, 1);
});
test("public delegate inspection preserves files and fails on unsafe keystore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "user-setup-"));
  try {
    assert.equal((await inspectLocalUserSetup(dir)).stage, "not_initialized");
    await mkdir(join(dir, "wallet"), { mode: 0o700 });
    const file = join(dir, "wallet/session.keystore.json");
    await writeFile(file, JSON.stringify({ address: "a".repeat(40) }), {
      mode: 0o600,
    });
    const result = await inspectLocalUserSetup(dir);
    assert.equal(result.stage, "partial_setup");
    assert.equal(result.delegate, `0x${"a".repeat(40)}`);
    await chmod(file, 0o644);
    await assert.rejects(inspectLocalUserSetup(dir), /Unsafe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reset submenus explain unavailable operations without executing changes", async () => {
  const answers = [
      "reset",
      "change-password",
      "rotate-session-key",
      "rotate-caller-token",
      "back",
      "initialize",
      "q",
    ],
    output = [];
  await runUserSetupGuide({
    ask: async () => answers.shift(),
    write: (text) => output.push(text),
    check: async () => ({ ok: true }),
    state: async () => ({ stage: "initialized" }),
    initialize: () => {
      throw Error("must not reinitialize");
    },
    preview: () => {
      throw Error("must not authorize");
    },
  });
  assert.equal(
    output.filter((text) => text.includes("Not implemented yet. No key"))
      .length,
    3,
  );
  assert.ok(output.some((text) => text.includes("already initialized")));
});

test("completed preview is distinguished from actual authorization and no longer recommended", async () => {
  const answers = ["authorization", "q"],
    output = [];
  await runUserSetupGuide({
    ask: async () => answers.shift(),
    write: (text) => output.push(text),
    check: async () => ({ ok: true }),
    state: async () => ({ stage: "initialized" }),
    initialize: () => {
      throw Error();
    },
    preview: async () => ({ mode: "demo" }),
  });
  assert.ok(
    output.some((text) =>
      text.includes("Preview completed; actual authorization pending"),
    ),
  );
  const last = output
    .filter((text) => text.includes("Choose an action"))
    .at(-1);
  assert.match(last, /Review preview again/);
  assert.doesNotMatch(last, /next step/);
});

test("demo uses two meaningful confirmations and advances without repeated menus", async () => {
  const answers = ["continue", "confirm", "confirm"],
    output = [];
  const result = await runUserSetupGuide({
    demo: true,
    ask: async () => {
      assert.ok(answers.length);
      return answers.shift();
    },
    write: (s) => output.push(s),
    check: async () => ({ ok: true }),
    state: async () => ({ stage: "initialized", delegate: "demo-address" }),
    initialize: () => {
      throw Error();
    },
    preview: async () => ({
      mode: "demo",
      draft: {
        safe: "demo-safe",
        budget: "1",
        perPayment: "0.7",
        currency: "demo USDC",
        expiry: "tomorrow",
      },
    }),
  });
  assert.equal(result.completed, true);
  assert.equal(answers.length, 0);
  assert.ok(output.at(-1).includes("This demo has finished"));
  assert.equal(output.filter((s) => s.includes("> Continue setup")).length, 1);
});
