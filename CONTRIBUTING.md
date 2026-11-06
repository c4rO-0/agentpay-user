# Contributing to AgentPay User

Start with the [developer guide](doc/develope.md) and [source map](doc/architecture.md).
Explain the user-visible problem and the intended behavior before changing public
interfaces, payment/recovery rules or persisted identity. Keep fixes focused and
include meaningful behavioral evidence with its limits.

Use disposable data and controlled local fixtures. Never add private platform source,
real credentials, owner keys or participant records to tests. Financial changes need
negative authorization, duplicate/conflict and recovery checks; tests of helper shape
or source text alone are not acceptance. See the [test guide](test/README.md).

Report security issues through [SECURITY.md](SECURITY.md), not a public issue.
Contributions to MPL-covered files are provided under MPL 2.0. Preserve the separate
licenses of vendored dependencies and attributed test fixtures. Do not submit code
whose license or ownership you cannot grant on those terms.
