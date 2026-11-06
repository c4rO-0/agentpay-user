# Onboarding writing rules

Confirmed with the User on 2026-10-06 through review of the English terminal
setup demo. Apply these rules to user onboarding documents, terminal prompts
and future Market guidance. They describe presentation, not new authorization
or protocol requirements.

## One action at a time

- Explain what the current step accomplishes and why it is needed.
- Keep the main screen focused on the current decision. Put technical addresses,
  generated identifiers and transaction data behind an explicit `details` action.
- Place relevant reminders immediately before the operation they concern.
- State exactly what to enter; quote literal commands and give useful examples.
- Explain amounts with a named currency and duration in days from now.
- Before a permission or paid test, explain its scope, cost and effect, then ask
  for agreement. Normal eligible purchases still use the existing bounded Policy
  without another owner signature per Order.

## Visual structure and recovery

- Separate each step with a consistent divider and a short title.
- Label action menus `> Choose an action`.
- Prefix the recommended action with `*` and retain `← next step`.
- Make progress labels agree with available actions and the completed steps.
- On invalid input, show allowed inputs and stay at the current prompt.
- Explain whether `q` cancels a step, returns to a menu or exits the program.
- Resume completed work without unnecessarily repeating it. State persistence
  limits: current demo progress survives only within the same process.

## Complete the first-use loop

Guide initialization → authorization → binding → startup → local checks →
official random Skill installation and connectivity test → explicit completion.
After the test passes, direct the user to Market to choose other Skills.
The test completion screen need not display the random number.

Current demo cost is explicitly an example: 0.001 demo USDC. Real integration
must display the validated current quote before test agreement; this example
is not a configured or guaranteed service price.

Clearly distinguish preview, simulation and executed operations. The demo
passes no real authorization, starts no process, installs no package and makes
no payment. Real onboarding must use actual command/API results. Write guides
against delivered scripts; mark remaining integrations explicitly.

English prompts and Linux with Node are the current scope. Browser opening
is not required; multilingual guidance and macOS verification remain deferred.
