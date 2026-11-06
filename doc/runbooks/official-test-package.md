# Official connectivity-test package

The User onboarding installer trusts the ZIP SHA-256 embedded in
`src/official-test-package.mjs`. Market supplies the download location and metadata;
neither its response nor a command-line hash can override the official pin. The
installer hashes downloaded bytes before parsing or saving package contents.
A mismatched release stops installation. Never bypass this check by accepting the
hash reported by the same server that supplies the ZIP.

This pin applies only to the maintained onboarding test. Generic Runtime calls and
ordinary Skill installation do not require the random service or this package.
The current pin is the reviewed random Skill 1.2.0 private rehearsal package;
it includes its service reference. It is not a production-network release.

## Before publishing a User update

1. Check whether the maintained official Skill has a new published version.
2. Review its source and actual ZIP: instructions, scripts, manifest, service
   identity, endpoints and absence of secrets. Do not automatically trust a new
   Market version or copy its reported hash into the code.
3. If accepting that release, update the name, version and SHA-256 in
   `src/official-test-package.mjs` as a reviewed code change.
4. From the User repository, verify the actual file:

   ```sh
   node scripts/check-official-test-package.mjs /path/to/reviewed-skill.zip
   ```

   This checks the hardcoded hash, archive validity and package name/version.
   It does not execute scripts or prove service availability.
5. Run the official pin/download and onboarding regression tests, then publish
   the matching User release. Actual paid acceptance remains a separate step.

## Existing installations

Market's legacy deployment `bundleSha256` field no longer decides which ZIP may be
installed for a new official test. User supplies its embedded hash to the installer.
A changed Market hash alone is not a chain deployment change and never rewrites
saved configuration, Policy or test history.

An installed package used for a new test must match the current User pin and must
not have local edits. A saved prior test can continue with its original locally
verified package and saved hash only after its checkpoint is checked against local
invocation history. This exception cannot select a new package or start a replacement
purchase. Unknown/conflicting material stops for review. Old files are not deleted.
Updating User does not restart a completed paid test or renew an expired Policy.

For a new private rehearsal after updating User/Wallet and checking the new Policy,
run `./run payment test`. This uses the installed pinned package directly, without changing
the old selected package or its completed checkpoint. The first call shows the
current quote and requires explicit confirmation; after consent it saves a new
request identifier before invoking the Skill. A retry uses the saved identifier.
This release's official test is private-Anvil-only and does not install a third-party
Skill. Once a test has completed, the same command offers a new paid test with a new
quote and explicit confirmation. The old completed record is archived before a new
test. Cached replay alone is not a fresh payment-path check. Success confirms delivery
and receipt acknowledgement; final Provider payout follows the Order schedule.

The pin protects against replacement of the test ZIP by Market; it does not protect
against a compromised User installation, bad code accepted during release review,
or all risks of a compromised platform. Wallet's independent spending checks and
explicit confirmation before the paid test remain necessary.
