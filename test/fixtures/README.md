# Controlled test fixtures

The sample ZIP writer and random Skill wrapper were copied from the public MIT
AgentPay Agent repository, revision `d5c1b47adc12331e014692db18a7bc88bc022d53`.
Their license is retained in `REFERENCE-SKILL-LICENSE`. This local snapshot lets
User tests exercise a packaged wrapper without a sibling Agent checkout. It is
not the official test release, does not update the runtime's trusted SHA and must
never become a source for production onboarding downloads.

`runtime-fault-loader.mjs` instruments the test child process only. Its source
anchors detect a changed injection boundary; they are not assertions that a
business implementation must retain particular formatting. Production startup
never imports this loader. Controlled HTTP/Wallet fixtures do not prove on-chain
funding or deployed recovery.
