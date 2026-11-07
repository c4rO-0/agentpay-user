# Local software repair

Current operation: [update and uninstall runbook](../runbooks/local-update.md).

User resolves its exact Wallet dependency through public package exports. Repair
checks package versions and fingerprints User src/scripts and Wallet lib/bin, then
refreshes managed service paths under the installer lock. Existing client connection
URLs and caller credentials must match before a client-module path can be refreshed.
A mismatch stops preparation rather than rewriting transaction identity.

Installation checkpoints live in XDG state storage; old source-install checkpoints
are read to preserve a custom data-directory selection. Deployment settings are
copied into private User data only when no canonical file exists. Neither path
changes keys, Policies, requests or recovery records.

A successful managed restart loads the reviewed installed package. Package metadata
alone does not identify a previously running daemon. Explicit version negotiation
remains planned; this implementation does not claim arbitrary-version compatibility.
