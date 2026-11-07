# Publish User to npm

This publishes the User CLI and Runtime, with its exact reviewed Wallet dependency.
It does not deploy platform services or alter participant keys, Policies or Orders.

## Verify a release

From a clean reviewed source checkout, using Node 22.22.3 or newer:

```sh
npm ci --ignore-scripts
npm test
node scripts/test-package.mjs artifacts/npm
```

Review the package inventory and README. The archive check installs the package in
an isolated directory, checks the public command and starts disposable Wallet/Runtime
processes. It never uses a participant's private data. Keep the exact verified archive
for publication; do not rebuild it between verification and upload.

## First publication

Authenticate as the package maintainer, then publish the verified archive:

```sh
npm publish artifacts/npm/c4roa0-agentpay-user-0.3.0.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org/
node scripts/verify-npm-release.mjs artifacts/npm/c4roa0-agentpay-user-0.3.0.tgz 0.3.0
```

Never commit or share a publishing Token. If npm stages the first release, approve
it on npm before verifying. A timeout is not proof of failure: check the registry
before retrying publication. Published version numbers cannot be reused.

## GitHub Trusted Publisher

Create the GitHub environment `npm-publish` and restrict its deployment branch to
`main`. Add maintainer approval if desired. In the npm package's Trusted Publisher
settings, select GitHub Actions and enter:

| Field | Value |
| --- | --- |
| Organization/user | `c4rO-0` |
| Repository | `agentpay-user` |
| Workflow filename | `publish.yml` |
| Environment name | `npm-publish` |
| Allowed action | Direct publishing |

Run **Publish User to npm** on `main` with a new reviewed package version matching
`package.json` and `update-pair.json`. It tests, packs, verifies, publishes that exact
archive through OIDC, and compares registry integrity. No stored npm Token is needed.
The first successful OIDC release validates the connection; the initial Token upload
does not. Afterwards, disable bypass-2FA tokens and retire unused publishing tokens.
See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

Publication is not real-network or participant upgrade acceptance. Record the exact
source revision and verification outcome; test the published installation separately.
