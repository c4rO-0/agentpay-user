// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Only public authorization fields are persisted; never Wallet unlock input.
export function authorizationFields({
  context,
  checkpoint,
  ask,
  save,
  write,
  details,
}) {
  const allowed = ["safe", "policyChoice", "budget", "perPayment", "days"];
  if (
    checkpoint &&
    (checkpoint.version !== 2 ||
      checkpoint.context !== context ||
      !checkpoint.fields ||
      typeof checkpoint.fields !== "object" ||
      Array.isArray(checkpoint.fields) ||
      Object.entries(checkpoint.fields).some(
        ([key, value]) =>
          !allowed.includes(key) ||
          typeof value !== "string" ||
          value.length > 256,
      ))
  ) {
    throw Error("AUTHORIZATION_INPUT_CHECKPOINT_MISMATCH");
  }
  let state = checkpoint || { version: 2, context, fields: {} };
  if (Object.keys(state.fields).length)
    write("Continuing saved Safe and spending limits.");
  const visited = [];
  return async (key, prompt, validate, providedValue) => {
    const previous = visited.at(-1);
    if (providedValue === undefined) visited.push(key);
    if (!allowed.includes(key)) throw Error("AUTHORIZATION_FIELD_INVALID");
    if (Object.hasOwn(state.fields, key)) {
      try {
        validate(state.fields[key]);
      } catch {
        throw Error(`SAVED_AUTHORIZATION_FIELD_INVALID: ${key}`);
      }
      if (
        providedValue !== undefined &&
        validate(state.fields[key]) !== validate(providedValue)
      )
        throw Error(
          `SAVED_AUTHORIZATION_FIELD_MISMATCH: ${key}. Saved settings and authorization inputs differ; review before continuing.`,
        );
      return state.fields[key];
    }
    if (providedValue !== undefined) {
      const normalized = validate(providedValue);
      const next = {
        ...state,
        fields: { ...state.fields, [key]: String(normalized) },
      };
      await save(next);
      state = next;
      return state.fields[key];
    }
    while (true) {
      const value = (
        await ask(
          `${prompt}\n('back' for previous, 'details' for information, 'q' to return)\n> `,
        )
      ).trim();
      if (value.toLowerCase() === "back") {
        if (!previous) {
          write("This is the first editable item.");
          continue;
        }
        const start = allowed.indexOf(previous);
        const next = {
          ...state,
          fields: Object.fromEntries(
            Object.entries(state.fields).filter(
              ([name]) => allowed.indexOf(name) < start,
            ),
          ),
        };
        await save(next);
        throw Object.assign(Error("Return to previous item"), {
          code: "AUTHORIZATION_BACK",
          checkpoint: next,
        });
      }
      if (value.toLowerCase() === "q")
        throw Object.assign(Error("Setup paused; saved inputs are retained."), {
          code: "CANCELLED",
        });
      if (value.toLowerCase() === "details") {
        write(JSON.stringify(details, null, 2));
        continue;
      }
      let normalized;
      try {
        if (value.length > 256) throw Error();
        normalized = validate(value) ?? value;
      } catch (error) {
        write(error.message || "Check this value and try again.");
        continue;
      }
      const next = {
        ...state,
        fields: { ...state.fields, [key]: String(normalized) },
      };
      await save(next);
      state = next;
      return state.fields[key];
    }
  };
}
