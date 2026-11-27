// SPDX-License-Identifier: MPL-2.0
import { createInterface } from "node:readline/promises";
export async function askTerminal(message, { hidden = false } = {}) {
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
            Object.assign(Error("Input cancelled."), {
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
