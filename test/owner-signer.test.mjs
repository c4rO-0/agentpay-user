// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import test from "node:test";
import assert from "node:assert/strict";
import { selectedOwnerSigner, checkTestSigner } from "../src/owner-signer.mjs";
test("signer is explicit local choice, never inferred from a chain ID", async () => {
  assert.equal(
    await selectedOwnerSigner({
      dataDir: "/unused",
      env: {},
      readState: async () => null,
    }),
    "external",
  );
  assert.equal(
    await selectedOwnerSigner({
      dataDir: "/unused",
      env: { AGENTPAY_OWNER_SIGNER: "anvil" },
      readState: async () => {
        throw Error("not read");
      },
    }),
    "anvil",
  );
  assert.equal(
    await selectedOwnerSigner({
      dataDir: "/unused",
      env: {},
      readState: async () => ({ version: 1, kind: "external" }),
    }),
    "external",
  );
  await assert.rejects(
    selectedOwnerSigner({
      dataDir: "/unused",
      env: { AGENTPAY_OWNER_SIGNER: "auto" },
    }),
  );
  await assert.rejects(
    selectedOwnerSigner({
      dataDir: "/unused",
      env: {},
      readState: async () => ({ version: 1, kind: "anvil", privateKey: "no" }),
    }),
  );
});
test("test signer restrictions remain independent of config mode; external is usable on Anvil", () => {
  checkTestSigner("external", {
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8547",
  });
  checkTestSigner("anvil", { chainId: 31337, rpcUrl: "http://127.0.0.1:8547" });
  for (const source of [
    { chainId: 1, rpcUrl: "http://127.0.0.1:8547" },
    { chainId: 31337, rpcUrl: "https://public.example" },
    { chainId: 31337, rpcUrl: "http://name:secret@127.0.0.1" },
  ])
    assert.throws(() => checkTestSigner("anvil", source));
});
