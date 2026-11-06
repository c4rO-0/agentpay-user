// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// UI exercise only. Never persists or returns the entered secret.
export async function confirmDemoUnlockSecret({ readHidden, write }) {
  write(
    "Demo: use a temporary practice secret, not a real password.\nInput is hidden and will not be saved.",
  );
  while (true) {
    let first = await readHidden("Create demo unlock secret: ");
    let second = await readHidden("Confirm demo unlock secret: ");
    const matched = first.length > 0 && first === second;
    first = null;
    second = null;
    if (matched) {
      write("Demo unlock secret confirmed. No secret was saved.");
      return;
    }
    write(
      "Secrets are empty or do not match. Try again, or press Ctrl+C to cancel.",
    );
  }
}
export function readHiddenTerminal(
  prompt,
  input = process.stdin,
  output = process.stderr,
) {
  if (!input.isTTY || typeof input.setRawMode !== "function")
    throw Error("Hidden input requires an interactive terminal.");
  output.write(prompt);
  const previousRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let secret = "";
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(!!previousRaw);
      input.pause();
      output.write("\n");
      const value = secret;
      secret = "";
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003" || character === "\u0004")
          return finish(
            Object.assign(Error("Demo cancelled; nothing was saved."), {
              code: "CANCELLED",
            }),
          );
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b")
          secret = secret.slice(0, -1);
        else if (character >= " ") secret += character;
      }
    };
    input.on("data", onData);
  });
}
