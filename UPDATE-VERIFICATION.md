# Update implementation verification

Dates: 2026-10-10 to 2026-10-11. Host: Windows 11 build 26200, x64. Node 24.16.0,
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
- The final 0.3.1 unsigned x64 NSIS installer also built and passed package verification.
  Every packaged app/electron/assets file matched the current source byte-for-byte.
  Installer SHA-256: `67f55fdf5a4bf1598a63ce4becf03667176b199e12d838e7b22bd1afd194a065`.
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

## Installed GitHub update: passed (unsigned test)

On 2026-10-11, the owner explicitly approved publication of the unsigned 0.3.1
development/test release at https://github.com/Sodiols/minute-tracker/releases/tag/v0.3.1.
The installer, blockmap, and latest.yml were uploaded to a draft, verified against
GitHub's recorded SHA-256 digests, then published together. No credentials were
written to the application, release artifacts, or repository.

The actual installed **0.3.0** app discovered 0.3.1 through its configured GitHub
provider. Its Settings UI displayed both versions, release-note availability, and
real download progress (48%, 52.2 / 108.1 MB observed). The manual timer continued
running during the download. The completed file in electron-updater's pending cache
matched the published installer's SHA-256 exactly.

The native confirmation was displayed and accepted. The real app paused and saved
the manual session, wrote the update checkpoint, exited, and launched NSIS from the
updater cache. NSIS completed and the installed app automatically relaunched from
`C:\Program Files\Minute Tracker`. Both its installed ASAR and Settings report
**0.3.1**. Its next real GitHub check reports no waiting update.

An isolated copy of the post-restart profile was compared with the pre-restart
checkpoint. Normalized-content hashes matched all four projects, the completed
session, manual settings, paused timer and theme. The timer retained exactly
1,928,317.7001953125 ms and restored paused. Automatic settings and recorded history
were preserved, with no counter decreasing. Automatic tracking resumed and recorded
further foreground activity after the restart. JSON object keys are sorted for
comparison because workspace loading reconstructs objects without changing records.

The **unsigned GitHub-to-installed-Windows update path is operational on the tested
x64 machine**. This does not establish signed production readiness or the untested
failure scenarios below. The live confirmation was accepted before the planned
cancellation exercise, so cancellation remains covered by automated integration
tests, not by this installed-app trial.

Local evidence: `audit/electron-smoke.json`, `audit/electron-update-smoke.json`,
`audit/update-settings.png`, `audit/upgrade-before.json`, `audit/upgrade-after.json`,
`audit/updater-after-031.json`, `audit/installed-upgrade-031.json`.
The audit directory is excluded from Git and release artifacts. Whole-profile backup:
`%LOCALAPPDATA%\Minute Tracker Upgrade Backups\before-0.3.0-20261010`.
The updater trial also has a whole-profile backup in
`%LOCALAPPDATA%\Minute Tracker Upgrade Backups\updater-before-0.3.1-20261011`,
and its normal recovery checkpoint under `%APPDATA%\Minute Tracker\update-backups`.

## Outstanding gates

The real installed GitHub delivery gate has passed for the unsigned development
build. Do not represent it as a signed, fully production-validated release.

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
