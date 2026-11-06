// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
export async function remindLockedWallet({
  env = process.env,
  status,
  notify,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return "headless";
  // The graphical-session oneshot stays active until logout, independently of service restarts.
  for (let i = 0; i < 15; i++) {
    try {
      const state = await status();
      if (state?.locked === false) return "unlocked";
      if (state?.locked === true) {
        try {
          await notify();
          return "notified";
        } catch {
          return "unavailable";
        }
      }
    } catch {}
    if (i < 14) await pause(2000);
  }
  return "wallet_unavailable";
}
