# Two-installation systemd switch — 2026-11-12

This rehearsal used actual Linux user systemd services and public User commands.
Installation A was the source checkout; B was a folder-local npm installation of
an archive built from the reviewed User commit `a8e3d88`. It carried candidate code
under the existing 0.3.7 manifest; it was not published to npm. Both used Wallet
0.3.3 and Protocol 0.14.3. A's previous 0.3.2 dependency tree was retained for rollback
before an offline frozen dependency installation.

## Observed behavior

- B had separate private storage and a newly initialized, unfunded Wallet with no
  Policy. Its unlock secret was used only to initialize the encrypted key; B was
  never unlocked. Settings and caller credentials were controlled prerequisites.
- Public `service start` switching required confirmation. Cancelling preserved A's
  Runtime PID. Confirmation stopped A and started B on the same loopback port.
- B reported matching software versions, a locked Wallet, no Policy and no Orders.
  Its authenticated Runtime status endpoint responded successfully.
- Starting the selected B again preserved its Runtime PID.
- Switching back restored A. Its encrypted Session Key and Policy file hashes
  matched the pre-switch values. A's existing Orders and Market connection remained
  visible; this was not a byte-for-byte audit of every historical/cache file.
- Both services were active at completion and login startup remained enabled.
  Wallet stayed locked. No authorization, purchase, payment or chain write was
  initiated by the test.

The first attempt successfully switched to B and restored A, but the harness treated
B's nonzero status exit (locked/unconfigured Wallet) as an execution failure. The
harness was corrected to accept that expected status while still requiring real
service readiness. The subsequent full run passed. No product change was needed
for that harness correction.

## Evidence limits and retained state

This establishes live service switching and cancellation, not desktop login after
reboot, fresh guided installation/owner authorization, or funded recovery. Existing
unclassified request warnings remained visible; no third-party Skill or forced new
purchase was used to bypass them. The dedicated B installation/data and rollback
dependencies remain private, inactive test material for traceability. The active
selection is A. Logs/scripts are retained outside the public source tree.
