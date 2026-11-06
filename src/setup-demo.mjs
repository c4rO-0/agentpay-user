// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// UI simulation: callbacks provide only demo initialization and draft collection.
export async function runSetupDemo({
  ask,
  write,
  check,
  state,
  initialize,
  preview,
}) {
  let approved = false,
    prepared = false,
    delivered = false,
    complete = false,
    draft = null,
    fields = null,
    advancing = false;
  const section = (title, text) =>
    write(
      `\n------------------------------------------------------------\n${title}\n------------------------------------------------------------\n${text}`,
    );
  const consent = async (text, details) => {
    while (true) {
      const answer = (
        await ask(`${text}\nType 'confirm', 'details', or 'q' to return\n> `)
      )
        .trim()
        .toLowerCase();
      if (answer === "q") return false;
      if (answer === "details") {
        write(JSON.stringify(details, null, 2));
        continue;
      }
      if (answer === "confirm") return true;
    }
  };
  write(
    "Demo only: no real permission, installation, process or payment. This simulation is not saved after exit.",
  );
  while (!complete) {
    if (!(await check()).ok) return { completed: false, stage: "preflight" };
    const local = await state();
    const stage =
      local.stage !== "initialized"
        ? "1/4 Create local Wallet"
        : !approved
          ? "2/4 Set spending permission"
          : !prepared
            ? "3/4 Prepare the official test Skill"
            : "4/4 Run the paid test";
    if (!advancing) {
      section(
        "> Continue setup",
        `${stage}\n  * 'continue'  Resume setup\n    'details'   Inspect demo progress\n    'q'         Quit`,
      );
      const answer = (await ask("> ")).trim().toLowerCase();
      if (answer === "q") return { completed: false, mode: "demo" };
      if (answer === "details") {
        write(
          JSON.stringify({ local, approved, prepared, delivered }, null, 2),
        );
        continue;
      }
      if (answer !== "continue") continue;
    }
    advancing = true;
    try {
      if (local.stage !== "initialized") {
        section(stage, "Set a practice unlock secret. No real key is created.");
        await initialize();
        continue;
      }
      if (!approved) {
        if (!draft) {
          const result = await preview(local.delegate, {
            collectOnly: true,
            checkpoint: fields,
            saveInputs: async (value) => {
              fields = structuredClone(value);
            },
          });
          if (!result?.draft) {
            advancing = false;
            continue;
          }
          draft = result.draft;
        }
        section(
          stage,
          `Safe: ${draft.safe}\nBudget: ${draft.budget} ${draft.currency}\nPer-payment limit: ${draft.perPayment} ${draft.currency}\nExpires: ${draft.expiry}\nEligible purchases can spend the whole budget automatically.`,
        );
        if (
          !(await consent(
            "Confirm to simulate owner authorization and independent Wallet binding.",
            { calls: draft.calls },
          ))
        ) {
          advancing = false;
          continue;
        }
        approved = true;
        write("Authorization and Wallet binding complete (demo).");
        continue;
      }
      if (!prepared) {
        section(
          stage,
          "Install and select the official random-number Skill, start Wallet / Runtime and check readiness (simulated). No payment yet.",
        );
        prepared = true;
        write(
          "Skill selected; Wallet / Runtime running; readiness checks passed (demo).",
        );
        continue;
      }
      if (!delivered) {
        section(
          stage,
          "Example test cost: 0.001 demo USDC. After verified delivery, Wallet confirms receipt automatically (demo). No real payment.",
        );
        if (
          !(await consent("Confirm to simulate the paid test.", {
            maximum: "0.001 demo USDC",
          }))
        ) {
          advancing = false;
          continue;
        }
        delivered = true;
        write("Test delivery verified (demo).");
      }
      write(
        "Official test delivery verified; Wallet confirms receipt automatically (demo). Provider payout may happen earlier.",
      );
      complete = true;
      section(
        "Setup demo complete",
        "Connectivity check passed (demo). You can now browse Market and choose Skills you like. This demo has finished; you can close this terminal.",
      );
    } catch (error) {
      advancing = false;
      write(
        error.code === "CANCELLED"
          ? "Paused; completed demo steps are retained until exit."
          : `Step stopped: ${error.message}`,
      );
    }
  }
  return { completed: true, mode: "demo", readyToPurchase: false };
}
