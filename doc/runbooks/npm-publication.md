# Publish User to npm

Push a reviewed `vX.Y.Z` tag to publish `@c4roa0/agentpay-user` through GitHub
Actions. The tag must match `package.json`. Ordinary branch pushes do not publish.
Keep `update-pair.json`, the lockfile and the reviewed Wallet dependency aligned.
Publish the required Wallet version before releasing User.

## One-time setup

In GitHub **Settings → Environments → npm-publish**, allow deployment from tags
matching `v*`. A rule allowing only the `main` branch will block tag releases.
Keep required reviewer approval if desired. Restrict creation, update and deletion
of release tags to maintainers through repository rules.

On npm, configure this package's Trusted Publisher:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization/user | `c4rO-0` |
| Repository | `agentpay-user` |
| Workflow filename | `publish.yml` |
| Environment name | `npm-publish` |
| Allowed action | Direct publishing |

Existing matching npm trust settings need no change. The first successful OIDC
publication validates a pending connection; a local token upload does not.
No stored npm token is needed by this workflow.

## Release a version

1. Update `package.json` and the changelog. Review code, documentation, dependencies
   and package contents; complete the repository's verification steps.
2. Commit and push the reviewed source to main, including the tag-triggered workflow.
3. Create an annotated tag at that exact commit and push it. Replace `X.Y.Z` and
   `REVIEWED_COMMIT` below with the release version and reviewed commit:

```sh
git tag -a vX.Y.Z REVIEWED_COMMIT -m "Release X.Y.Z"
git push origin vX.Y.Z
```

Pushing the tag starts **Publish User to npm** automatically. There is no version
input or separate Run workflow step. If the environment requires approval, approve
that deployment in GitHub. The workflow checks the tag against the manifest before
building, runs the existing verification gates, tests/packs the archive, publishes
with OIDC and checks public registry integrity. It builds the tagged source, even
if main advances. No production service or participant Wallet is upgraded.

## Verify or recover a publication

Check the run's **Verify public registry integrity** result and the package version
on npm. Record the tag, source commit and result in progress. Do not claim success
from tag creation alone. Actual OIDC validation requires the GitHub run.

If a run fails before upload, investigate before rerunning. If source needs a fix,
use a new version/tag; never move an existing release tag. If upload may have
succeeded, check registry state and archive integrity before rerunning; npm versions
are immutable and an already-published version must not be uploaded again.

Publication is not participant upgrade acceptance, cross-platform verification or
real-funds approval.
