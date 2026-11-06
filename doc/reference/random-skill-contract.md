# Official random-service test example

The random service is the maintained post-setup payment connectivity example. Its
business input/output belongs to the reference Skill and Provider, not Runtime's
common protocol. Runtime accepts per-call service references and business JSON;
see [common invocation contract](multi-service-runtime.md).

The official test uses a release-pinned package digest from User. Market can supply
public download metadata but cannot replace trusted executable bytes. A new paid
test requires explicit quote confirmation; an interrupted test resumes its original
request. Normal startup, Orders, cache and Policy management do not require this
service to be selected globally.

The editable reference implementation is published in
[AgentPay Agent](https://github.com/c4rO-0/agentpay-agent). User's local test fixtures
are controlled copies for development, not a source of trusted production packages.
See [official package maintenance](../runbooks/official-test-package.md) and
[Skill author integration](../runbooks/runtime-skill-client.md).
