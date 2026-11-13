import {reportCommandFailure} from "./command-diagnostics.mjs";
// Deliberate account connection using a narrow Wallet proof. Website display grouping
// does not merge Policy authority; a saved receipt is not a live access check.
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { createInterface } from "node:readline/promises";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveUserDataDir } from "./local-data-directory.mjs";
import { checkServiceDirectory } from "./local-services.mjs";
import { localWalletAdmin } from "./local-wallet-ipc.mjs";
import { repairMarketWallet } from "./repair-market-wallet.mjs";
import { controlWallet } from "./wallet-control.mjs";
import { preparePlatformEndpoints } from "./platform-endpoints.mjs";
import { fetchJsonWithTimeout } from "./transport.mjs";
// Validate suggestions before rendering them, as well as the final chosen name.
const invalidLabelCharacters = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
function validWalletLabel(value) {
  return typeof value === "string" && !!value.trim() && value.trim().length <= 64 &&
    value.trim().normalize("NFKC").toLowerCase().length <= 64 &&
    !invalidLabelCharacters.test(value);
}
export function marketOrigin(value) {
  const u = new URL(value);
  if (
    u.href !== u.origin + "/" ||
    u.username ||
    u.password ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    )
  )
    throw Error(
      "Use your Market HTTPS address, or a local rehearsal address such as http://127.0.0.1:8080.",
    );
  return u.origin;
}
async function askTerminal(message, { hidden = false } = {}) {
  if (!process.stdin.isTTY)
    throw Error("Run this command in an interactive terminal.");
  if (!hidden) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return await rl.question(message + "\n> ");
    } finally {
      rl.close();
    }
  }
  process.stderr.write(message + " (input hidden): ");
  const previous = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (e) => {
      process.stdin.off("data", read);
      process.stdin.setRawMode(!!previous);
      process.stdin.pause();
      process.stderr.write("\n");
      const result = value;
      value = "";
      e ? reject(e) : resolve(result);
    };
    const read = (chunk) => {
      for (const c of chunk) {
        if (c === "\u0003" || c === "\u0004")
          return finish(
            Object.assign(Error("Connection cancelled."), {
              code: "CANCELLED",
            }),
          );
        if (c === "\r" || c === "\n") return finish();
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c >= " ") value += c;
        if (value.length > 4096) return finish(Error("Input is too long."));
      }
    };
    process.stdin.on("data", read);
  });
}
async function previousConnection(dataDir) {
  let h;
  try {
    h = await open(
      join(dataDir, "market-connection.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const s = await h.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.size > 16384
    )
      throw Error("Unsafe Market connection record.");
    return JSON.parse(await h.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await h?.close();
  }
}
async function saveConnection(dataDir, value) {
  await checkServiceDirectory(dataDir);
  const path = join(dataDir, "market-connection-" + randomUUID() + ".tmp");
  let h;
  try {
    h = await open(path, "wx", 0o600);
    await h.writeFile(JSON.stringify(value) + "\n");
    await h.sync();
    await h.close();
    h = null;
    await rename(path, join(dataDir, "market-connection.json"));
  } finally {
    await h?.close();
    await unlink(path).catch(() => {});
  }
}
export async function connectMarket(
  args,
  {
    dataDir: chosen,
    ask = askTerminal,
    write = console.log,
    wallet = localWalletAdmin,
    fetchJson = fetchJsonWithTimeout,
    load = previousConnection,
    save = saveConnection,
    repair = repairMarketWallet,
    unlock = controlWallet,
    prepareEndpoints = preparePlatformEndpoints,
  } = {},
) {
  let token, origin, completion;
  try {
    if (args.length && !(args.length === 2 && args[0] === "--market")) {
      write("Usage: agentpay market connect [--market URL]");
      return 2;
    }
    const dataDir = chosen || (await resolveUserDataDir());
    let scope;
    try {
      const local = await wallet(dataDir, "status");
      if (local.bound === false)
        throw Object.assign(Error("Wallet setup is incomplete."), {
          code: "POLICY_UNBOUND",
        });
      scope = await wallet(dataDir, "marketConnectionScope");
    } catch (e) {
      if (!["METHOD_NOT_ALLOWED", "WALLET_NOT_RUNNING"].includes(e.code))
        throw e;
      write(
        e.code === "METHOD_NOT_ALLOWED"
          ? "Wallet needs a service refresh before it can connect."
          : "Wallet is not running. Let’s prepare it for connection.",
      );
      write(
        "This will check installed packages and restart your local services, then continue here.",
      );
      if (
        (await ask("Type 'confirm' to continue, or 'q' to return")).trim() !==
        "confirm"
      ) {
        write("Connection cancelled.");
        return 0;
      }
      if (!(await repair({ dataDir, write }))) return 1;
      scope = await wallet(dataDir, "marketConnectionScope");
    }
    if ((await wallet(dataDir, "status")).locked) {
      if (
        (await unlock("unlock", {
          args: [dataDir],
          write: (m) => {
            if (!m.startsWith("Wallet unlocked.")) write(m);
          },
        })) !== 0
      )
        return 1;
      if ((await wallet(dataDir, "status")).locked)
        throw Object.assign(Error("Wallet is locked."), { code: "LOCKED" });
    }
    const previous = await load(dataDir);
    const answer =
      args[1] ||
      (await ask(
        "Market address" +
          (previous?.marketOrigin
            ? ` (Enter keeps ${previous.marketOrigin})`
            : ""),
      ));
    if (answer.trim() === "q") {
      write("Connection cancelled.");
      return 0;
    }
    origin = marketOrigin(answer.trim() || previous?.marketOrigin);
    write("Checking Market and platform addresses…");
    const changingOrigin = !!previous?.marketOrigin && marketOrigin(previous.marketOrigin) !== origin;
    const call = async (path, body, auth = true) => {
      const { response, result } = await fetchJson(
        origin + "/market" + path,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            ...(auth ? { authorization: "Bearer " + token } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        30000,
      );
      if (
        !response.ok &&
        result?.error?.code === "ORDER_CONNECTION_LABEL_TAKEN"
      )
        throw Object.assign(
          Error(
            "That nickname is already used by another Wallet. Choose a different name.",
          ),
          { code: "ORDER_CONNECTION_LABEL_TAKEN" },
        );
      if ((!response.ok || result?.ok !== true) && result?.error?.code === "ORDER_CONNECTION_LABEL_INVALID")
        throw Object.assign(Error("Use 1–64 characters without control or hidden formatting characters. The normalized name must also fit 64 characters."), {code:"ORDER_CONNECTION_LABEL_INVALID"});
      if (!response.ok || result?.ok !== true)
        throw Error(
          response.status === 401
            ? "Market sign-in was rejected. Check your account and password."
            : "Market could not complete the connection. Run the same command to retry.",
        );
      return result.result;
    };
    write(
      "\n------------------------------------------------------------\n1/3 Sign in to Market\n------------------------------------------------------------",
    );
    write("Market: " + origin);
    const email = (await ask("Market account email")).trim();
    if (email === "q") {
      write("Connection cancelled.");
      return 0;
    }
    let password = await ask("Market password", { hidden: true }),
      signedIn;
    try {
      signedIn = await call("/developers/login", { email, password }, false);
    } finally {
      password = null;
    }
    token = signedIn.sessionToken;
    if (typeof token !== "string" || !token || !signedIn.developer?.id)
      throw Error("Market returned an invalid sign-in response.");
    if (changingOrigin && previous.accountId !== signedIn.developer.id)
      throw Error("This is not your saved Market account. The previous connection and addresses were kept.");
    write(
      "\n------------------------------------------------------------\n2/3 Name your Wallet\n------------------------------------------------------------",
    );
    const listed = await call("/account/wallet/connections");
    if (!Array.isArray(listed?.connections))
      throw Error("Could not check your connected Wallets. Try again.");
    const existing = listed.connections.find((w) =>
      ["network", "module", "safe", "delegate"].every(
        (key) =>
          typeof scope[key] === "string" &&
          String(w[key]).toLowerCase() === scope[key].toLowerCase(),
      ),
    );
    // These authenticated record checks detect accidental cross-Market moves.
    // They are not a cryptographic server identity; the user chooses the URL.
    const originalConnectionMatches = !!previous?.connection?.id && !!existing &&
      ["network", "module", "safe", "delegate"].every(key =>
        typeof previous.connection[key] === "string" &&
        previous.connection[key].toLowerCase() === String(existing[key]).toLowerCase()) &&
      existing.policies?.some(p => p.id === previous.connection.id &&
        String(p.policyId).toLowerCase() === String(previous.connection.policyId).toLowerCase());
    if (changingOrigin && !originalConnectionMatches)
      throw Error("Your original Wallet connection was not found at this address. The previous connection and addresses were kept.");
    let endpoints;
    try {
      endpoints = previous ? await prepareEndpoints({dataDir,origin,scope,fetchJson,changingOrigin}) : {changed:false,apply:async()=>{}};
    } catch (error) {
      await reportCommandFailure(error,{operation:"Check Market addresses",write,effect:"Address verification failed; review the current saved connection before retrying."});
      const networkFailure = ["AbortError", "TimeoutError"].includes(error.name) ||
        ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(error.code || error.cause?.code) || error.message === "fetch failed";
      const reason = networkFailure
        ? "Could not reach the platform to check its settings. Check your network and the Market address."
        : error.message;
      write("\n[!] Platform address check stopped");
      write(reason);
      write("No local settings were changed by this check. Your Wallet and Order records are kept.");
      write("Next: resolve the issue above, then retry this command.");
      return 1;
    }
    if (endpoints.changed && (previous?.accountId !== signedIn.developer.id || !originalConnectionMatches))
      throw Error("Platform addresses changed, but your original account and Wallet connection could not be confirmed. Current addresses were kept.");
    if (!existing)
      write(
        "Choose a name to recognize this Wallet in Market, such as Home laptop.",
      );
    const savedDefaultLabel =
      previous?.accountId === signedIn.developer.id
        ? previous?.connection?.label || "My Wallet"
        : "My Wallet";
    const defaultLabel = validWalletLabel(savedDefaultLabel) ? savedDefaultLabel.trim() : "My Wallet";
    while (true) {
      const rawLabel =
        existing?.label ||
        (
          await ask(
            `Wallet nickname (Enter to use '${defaultLabel}', 'q' to cancel)`,
          )
        );
      const label = rawLabel.trim() || defaultLabel;
      if (label === "q") {
        write("Connection cancelled.");
        return 0;
      }
      // Check before trimming so pasted control characters are not silently removed.
      // Keep joiners used by ordinary scripts and emoji; reject display-direction overrides.
      if (invalidLabelCharacters.test(rawLabel) || !validWalletLabel(label)) {
        const message = "Use 1–64 characters without control or hidden formatting characters. The normalized name must also fit 64 characters.";
        if (existing) throw Object.assign(Error(message + " This Wallet's saved nickname needs review in Market; contact support."), {code:"ORDER_CONNECTION_LABEL_INVALID"});
        write(message);
        continue;
      }
      if (existing) write(`Using your Wallet name: ${label}`);
      try {
        // Check/reserve the nickname before consent; no Wallet proof or verified
        // connection is created until the participant confirms. Verify rechecks races.
        const challenge = await call("/account/wallet/connections/challenge", {
          scope,
          label,
          marketOrigin: origin,
        });
        for (const key of ["network", "module", "safe", "policyId"])
          if (challenge.scope?.[key] !== scope[key])
            throw Error(
              "Market requested a different Wallet authorization. Connection stopped.",
            );
        const payload = challenge.payload;
        if (
          payload?.accountId !== signedIn.developer.id ||
          payload.marketOrigin !== origin ||
          payload.label !== label ||
          !Number.isSafeInteger(payload.expiresAtMs) ||
          payload.expiresAtMs <= Date.now()
        )
          throw Error("Market returned a mismatched connection challenge.");
        write(`\nMarket account: ${email}\nWallet name: ${label}`);
        write(
          "View this Wallet’s Orders and request help on Market. No spending permission is added.",
        );
        if (endpoints.changed) write(`Also update platform addresses:
Settlement: ${endpoints.urls.settlementUrl}
Downloads: ${endpoints.urls.marketBundleMetadataUrl}
Runtime will restart; your spending permission stays the same.`);
        while (true) {
          const choice = (
            await ask(
              "Type 'confirm' to connect, 'details' for Wallet identity, or 'q' to cancel",
            )
          ).trim();
          if (choice === "q") {
            write("Connection cancelled.");
            return 0;
          }
          if (choice === "details") {
            write(
              `Safe: ${scope.safe}\nNetwork: ${scope.network}\nPolicy ID: ${scope.policyId}`,
            );
            continue;
          }
          if (choice === "confirm") break;
          write("Enter 'confirm', 'details' or 'q'.");
        }
        write("\n3/3 Verify connection…");
        const proof = await wallet(dataDir, "signMarketConnection", payload);
        const result = await call("/account/wallet/connections/verify", {
          challengeId: payload.challengeId,
          authorization: proof.authorization,
        });
        for (const key of ["network", "module", "safe", "policyId"])
          if (result.connection?.[key] !== scope[key])
            throw Error(
              "Connection response does not match this Wallet. Check Market Settings.",
            );
        if (
          scope.delegate &&
          result.connection?.delegate?.toLowerCase() !==
            scope.delegate.toLowerCase()
        )
          throw Error("Connection execution address differs from this Wallet.");
        if (result.connection.label !== label)
          throw Error("Connection nickname differs. Check Market Settings.");
        if (changingOrigin && previous.connection.policyId === scope.policyId &&
            result.connection.id !== previous.connection.id)
          throw Error("Market returned a different connection record. The previous local connection was kept.");
        const saveConnected = () => save(dataDir, {
          version: 1,
          marketOrigin: origin,
          accountId: signedIn.developer.id,
          connection: result.connection,
        });
        if (endpoints.changed) {
          await endpoints.apply({write,saveConnection:saveConnected});
        } else {
          try { await saveConnected(); }
          catch {
            if (changingOrigin)
              throw Error("The updated Market connection could not be saved. Retry the same command.");
            write("Market connected this Wallet, but the local shortcut could not be saved. Use --market URL next time.");
          }
        }
        completion = `\nWallet connected: ${label}\nView this Wallet’s Orders in Market → Account → My Orders.\nManage or disconnect it in Market Settings. This guide has finished.`;
        return 0;
      } catch (e) {
        if (!["ORDER_CONNECTION_LABEL_TAKEN", "ORDER_CONNECTION_LABEL_INVALID"].includes(e.code)) throw e;
        if (existing) {
          e.message += " This Wallet's saved nickname needs review in Market; contact support.";
          throw e;
        }
        write(e.message);
      }
    }
  } catch (e) {
    await reportCommandFailure(e,{operation:"Connect Market",write});
    write(
      ["LOCKED", "WALLET_LOCKED"].includes(e.code)
        ? "Wallet is locked. Run agentpay wallet unlock, then repeat this command."
        : e.code === "POLICY_UNBOUND"
          ? "Finish Wallet setup with agentpay setup, then connect again."
          : e.code === "POLICY_MIGRATION_PENDING"
            ? "Complete the pending Policy migration before connecting this Wallet."
            : e.code === "METHOD_NOT_ALLOWED"
              ? "Wallet still cannot connect. Run agentpay market connect again to prepare it."
              : String(e.message || "Could not connect Wallet."),
    );
    write("If the cause is unclear, run agentpay health. Your saved Wallet and Orders are kept.");
    return 1;
  } finally {
    if (token && origin) {
      try {
        const { response } = await fetchJson(
          origin + "/market/developers/logout",
          {
            method: "POST",
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json",
            },
            body: "{}",
          },
          10000,
        );
        if (!response.ok)
          write(
            "Temporary sign-in cleanup could not be confirmed. Its token was not saved locally.",
          );
      } catch {
        write(
          "Temporary sign-in cleanup could not be confirmed. Its token was not saved locally.",
        );
      }
    }
    token = null;
    if (completion) write(completion);
  }
}
