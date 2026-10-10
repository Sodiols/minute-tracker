# Update implementation verification

Date: 2026-10-10. Host: Windows 11 build 26200, x64. Node 24.16.0,
Electron 44.7.0, electron-builder 26.15.3, electron-updater 6.8.9.

## Verified

- `npm ci` completed successfully from the synchronized lockfile.
- `npm audit` and `npm audit --omit=dev`: zero vulnerabilities.
- 53 Node regression tests passed, including existing tracking/persistence coverage
  and new update scheduling, concurrency, confirmation, retry, checkpoint validation,
  disk failure, timeout, and renderer recovery tests.
- `npm run test:electron` passed on real Windows with a disposable profile: sandbox,
  exact-origin/main-frame IPC guards, rejected updater payloads, Windows native
  foreground sampling, tray tracking, Settings version display, inert release HTML,
  progress display, manual sessions, CSV, and simulated power events.
- `npm run test:updates:electron` passed real main/preload/renderer save coordination:
  canceled confirmation preserves running tracking, disk-full prevents installation,
  both stores are saved and backed up before installer invocation, and simulated
  installer failure restores the renderer and tracking. Network, dialog choice, and
  installer invocation are mocked in this test; this is not an installed auto-upgrade.
- The 0.3.0 unsigned x64 NSIS installer built and passed package verification: explicit
  GitHub feed, runtime assets/native binary, SHA-512 metadata, and blockmap.
- The existing **installed 0.2.0** application was paused and exited with user consent.
  Its full profile was backed up outside the repository. The real 0.3.0 NSIS installer
  upgraded the all-users installation in `C:\Program Files\Minute Tracker`, exit code 0.
- The installed ASAR reports 0.3.0 and the configured GitHub updater. The installed app
  was launched successfully. Settings displays 0.3.0 and the unsigned-build disclosure.
- Before/after profile inspections matched all four projects, manual session history,
  manual settings, theme, timer hash, paused status, and timer duration exactly.
  The saved timer duration was 5,024,846.400146484 ms. Automatic history retained its
  settings and recorded days, with no existing counter decreasing.
- The installed application's real startup update check failed recoverably while
  the repository contained zero published releases. The app remained usable.
- The signed release command was executed and correctly refused to proceed without
  the legal publisher identity and signing secrets.

Local evidence: `audit/electron-smoke.json`, `audit/electron-update-smoke.json`,
`audit/update-settings.png`, `audit/upgrade-before.json`, `audit/upgrade-after.json`.
The audit directory is excluded from Git and release artifacts. Whole-profile backup:
`%LOCALAPPDATA%\Minute Tracker Upgrade Backups\before-0.3.0-20261010`.

## Outstanding gates

The implementation must not be represented as fully operational production
auto-updating until a **published newer version is downloaded and installed through
the installed app's updater**. A manual 0.2.0-to-0.3.0 installer upgrade does not prove
GitHub release delivery. The repository had zero public/stable releases during the
installed startup test. No release publishing credential is embedded in the app.

No signing certificate/service or verified publisher name is available. Therefore
correct-signer/wrong-signer rejection, signed release publishing, certificate rotation,
and signed installed upgrades remain unverified. The normal verifier is not disabled
or replaced; unsigned builds lack a publisher trust anchor.

Physical network interruption during a real download, corrupt hosted artifacts,
canceled UAC, canceled NSIS, power loss during replacement, and disk-full inside NSIS
still require an isolated Windows VM. Failure paths covered by mocks are not reported
as real installer failure tests. ARM64 and per-user installation upgrades are not tested.

See UPDATES.md for the release process, migration constraints, recovery, and the full
installed Windows acceptance checklist.
