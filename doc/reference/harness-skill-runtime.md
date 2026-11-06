# Harness Skill and local payment integration

Implemented design reference. Current release/participant gates are tracked in
[TODO](../TODO.md); this document is not new deployment or payment authorization.

## User journey and responsibilities

1. Install/configure local AgentPay once. The human grants bounded Safe spending
   permission; Wallet independently verifies and binds it. Owner signing on real
   networks remains separate pending work.
2. Install a Skill in the selected harness through its supported discovery path.
   Package installation is distinct from Safe authorization and does not pay.
3. The harness reads SKILL.md and executes the package's thin business wrapper.
4. The wrapper uses a shared local AgentPay client to discover local connection
   settings, authenticate to Runtime, submit input and resume the same invocation.
5. Runtime orchestrates the purchase through Wallet's narrow APIs and Provider;
   Wallet owns keys and independent checks. Results return to the harness.

SKILL.md explains when to call, arguments, expected results and recovery actions.
The wrapper handles business input/output. The shared client owns local discovery,
transport/authentication and retry identity handling; it must not implement a
second payment engine. Runtime retains durable Order/payment recovery. Payment
admission and authoritative price/identity are checked by Settlement/Wallet, not
accepted from untrusted package text.

A new eligible service satisfying the existing dynamic Registry Policy needs no
new owner signature. Several Skills using the same Policy share that Policy's
budget; installing a Skill does not create an additional allowance. Harness tool
execution permission is separate from spending authority. A local caller token
allows requests within existing bounds; it is not a key or generic signer.

## Current source and concrete gaps

- The official reference package candidate 1.1.0 contains SKILL.md and a thin random.mjs
  bootstrap. It loads the installed User client from private connection.json.
  Setup publishes this connection; default/custom data directory discovery and
  explicit URL/credential-file overrides are implemented. Release and actual
  harness discovery remain pending.
- Runtime routes per-call registered references through a common JSON transport.
  It starts without a selected package. Business validation lives in the Skill and
  Provider. active-skill.json is retained only for official test material; it is
  not process-wide service configuration. Generic package saving and harness
  discovery remain separate operations.
- SKILL.md instructs resolving commands from the installed package. Actual
  harness execution must
  resolve the installed Skill's directory without assuming the current workspace.
- Installer download transport requires HTTPS or loopback HTTP. A Market page on
  public-IP HTTP cannot be used as an installer URL; do not weaken the
  transport rule to make that command work. The Market Web source now omits this
  rehearsal-only command from the public Skill guide (deployment pending).

## First implementation loop

The reusable local client and random wrapper now call the common Runtime
endpoint. They resolve settings from the user's installed AgentPay state;
keep credentials outside the Skill and read them only in the local process. Keep
explicit configuration available for non-default directories. Do not load scripts
or shell fragments from connection files or infer a different paid service.

Expose a non-paying connection/identity check and invocation with structured
results/errors. Distinguish connectivity, unlocked Wallet/Policy readiness and
actual delivery; a successful /health read does not establish payment readiness.
Document that prerequisite errors need human setup/unlock; the model must not be
asked for passwords, private keys or owner signing secrets.

The implemented interface is --invoke <min> <max> [--force]. Matching calls
resume unfinished work or reuse verified output; only --force deliberately creates
another request with the same input. The diagnostic --resume <request-id> remains
for selecting a specific record when forced calls create ambiguity. New calls
generate a UUID; checkpoints retain original input, service and Runtime URL before
POST. Transport does not retry or create replacement purchases automatically.

Generate a sufficiently long request identifier once per deliberate invocation
and durably retain it before sending. Retry of an uncertain request keeps that
identifier and identical input. The client must not invent a replacement purchase
on timeout. Keep Runtime's existing conflict detection and recovery authoritative;
default recovery and diagnostic selection are implemented.

Acceptance: missing/wrong settings, unavailable Runtime, invalid credential,
service mismatch and timeout-after-acceptance retain correct outcomes and request
identity. No secret should enter model-visible output. Use focused local-process
fixtures first; actual paid harness tests need a separately agreed payment scope.
The selected distribution is a local module in the installed User repository,
located through an owner-held connection file. No dependency download occurs
at invocation. Candidate 1.1.0 needs the updated User installation. Existing
published 1.0.1 bytes remain available but are not accepted as this new
service-reference format; no compatibility translation or rewrite is provided.
Release/deployment and actual harness execution remain unverified.

## Following loops

- Deploy the reviewed common Runtime contract and per-request state after checking
  older pending requests, matching dependencies and the official package.
  Preserve wire skillId meanings and private input/output boundaries. Supporting
  many installed Skills must not require global active-Skill replacement per call.
- Package the wrapper/client integration for both harnesses. Verify discovery,
  script-path resolution, local configuration access and tool permissions in each.
  Shared file conventions do not prove identical permission or sandbox behavior.
- Update Market installation copy and repository guides to show harness installation
  and the one-time Wallet prerequisite. Keep the specialized rehearsal installer in
  developer instructions. Do not advertise generic execution before it works.
- Run actual first-use and resume scenarios in both harnesses; retain exact private
  payment/reconciliation evidence separately from source/HTTP tests.

## Security and ownership

Session Keys, owner keys, unlock secrets and caller tokens never enter published
packages or model prompts. Local credential access is not OS isolation: a harness
with the user's filesystem permissions may read files that account can read.
Use narrow execution permissions where available; do not claim SKILL.md itself
is a security boundary. Private results stay on the local client/Runtime/Provider
path. Installation never expands Policy limits or grants arbitrary signing.

## Official reference surfaces

- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [DeepSeek Harness Skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)

These establish discovery/instruction mechanisms; they are not AgentPay compatibility
results. Verify exact supported versions and directories during implementation.
