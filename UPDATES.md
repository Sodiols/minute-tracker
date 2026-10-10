# Minute Tracker Windows updates

## Status and scope

The updater is implemented using electron-updater 6.8.9 and electron-builder 26.15.3.
The explicit public release repository is https://github.com/Sodiols/minute-tracker.
The application is **Minute Tracker**, with existing app ID `com.minute.wintimer`.
Version 0.3.0 introduces the updater. An existing 0.2.0 installation needs one manual
NSIS upgrade before it can discover subsequent releases automatically.

Unsigned development installers are supported. No legal publisher identity has
been supplied. Do not describe this build as a signed, production-verified updater.
See UPDATE-VERIFICATION.md for checks actually performed and outstanding gates.

## User behavior

- Installed Windows builds check 15 seconds after startup and every six hours.
- Failed checks retry after one, five, and fifteen minutes, then every six hours.
- Settings displays installed/available versions, plain-text release notes,
  download progress, and separate Check, Download, and Install commands.
- A failed download or checksum/signature check leaves the current installation
  untouched. Retry is explicit. The user can keep working during downloads.
- Downloads never start automatically, and an ordinary quit never installs an update.
- Installation always opens a native confirmation with **Keep working** as default.
- After confirmation, the manual timer is checkpointed as paused, pending automatic
  samples are invalidated, activity JSON is saved with an atomic rename, Chromium
  storage is flushed, and a recovery snapshot is written before invoking NSIS.
- A save failure or missing renderer acknowledgement cancels installation and
  restores the previous tracking state. Manual timers remain paused after a
  successful restart; automatic tracking resumes only if already enabled.
- Stable updates only; no downgrade or prerelease opt-in. No renderer-supplied
  feed URLs, file paths, installer arguments, or publishing credentials are accepted.

## Storage and compatibility

Never change `name`, `productName`, `build.appId`, the NSIS installation scope,
or the data schema casually. The existing Windows profile is
`%APPDATA%\Minute Tracker`. Automatic history is `minute-activity.json`;
projects, sessions, goals, attention, and theme live in Chromium localStorage
under `minute.tracker.v1` and `minute.theme`. This change preserves both schemas,
the `file:` renderer origin, and the existing installation/data paths.

NSIS explicitly has `deleteAppDataOnUninstall: false`. Do not add an installer
cleanup step that removes userData. Keep version-specific files out of the data path.
Upgrade backups are stored locally in `userData\update-backups`; the newest three
JSON snapshots are retained. Each contains the pre-restart activity and workspace
and version. They contain private work history and must never be uploaded to releases.

For disaster recovery, quit Minute completely, preserve the damaged profile, and
restore a known-good **whole profile** backup into the same data path before launch.
Individual update snapshots can recover `activity` into `minute-activity.json` and
`workspace.state`/`workspace.theme` into their original localStorage keys using a
trusted recovery tool. There is deliberately no unrestricted filesystem or storage
editor exposed in the production renderer. Never restore data into a running app.

## Reproducible development builds

Use Windows x64 and Node 24.16.0 (the pinned CI version), with npm's committed lockfile:

```powershell
npm ci
npm audit
npm test
npm run test:electron
npm run dist:win
npm run verify:package
```

Artifacts are `release/Minute-Tracker-Setup-0.3.0-x64.exe`, its `.exe.blockmap`, and
`release/latest.yml`. The packaged `resources/app-update.yml` points to the explicit
GitHub repository. Do not hand-edit checksums or update manifests. Reproducible here
means locked dependencies, toolchain, and build procedure, not byte-identical signed
binaries (timestamps/signatures and upstream build tools can vary).

Development builds can exercise GitHub update discovery, downloads, SHA-512
verification and unsigned NSIS upgrades. `verifyUpdateCodeSignature` remains true;
there is no custom signature verifier or bypass. Without a configured certificate,
electron-updater has no publisher trust anchor and cannot authenticate a publisher.
HTTPS and SHA-512 protect transport and detect mismatched downloads; a checksum
from the same compromised release account is not an independent authenticity proof.
SmartScreen warnings are expected for unsigned builds. Do not bypass OS warnings
automatically. Use a disposable Windows VM for destructive/failure tests.

## Enable signed production releases

1. Obtain a Windows Authenticode code-signing certificate/service. Set the exact
   certificate publisher common name in `release-config.json` as `publisherName`.
   Do not guess the legal identity from the app name. Certificate rotation must
   retain the old publisher trust chain until existing clients can trust the new one.
2. The included signing path uses electron-builder's `CSC_LINK` (PFX file/base64 or
   supported certificate source) and `CSC_KEY_PASSWORD`. Store them as GitHub
   environment secrets, never repository files, renderer code, or release assets.
   Hardware-backed/EV or Azure Trusted Signing deployments can configure the
   corresponding builder signing options in `electron-builder.config.cjs` without
   changing the updater protocol; adapt the release preflight to that provider.
3. Create the protected GitHub environment `production-release`, require reviewer
   approval, restrict it to version tags, enable account 2FA, and protect the default
   branch and release tags. The repository must be public for credential-free clients.
4. `npm run release:win` requires signing, builds without publishing, verifies
   Authenticode on the app and installer, and checks the embedded publisher name.
   It deliberately fails until publisher and signing credentials are configured.
5. Validate a real signed older-to-newer installed upgrade on a disposable Windows VM
   before approving a public production release. An unsigned-to-signed transition
   lacks a signature trust anchor on the old unsigned client; distribute the first
   signed version through a trusted manual channel if strong authenticity is required.

## Publish every future update

1. Work from the repository root containing package.json. Commit application changes
   and keep the existing application identity and data schemas compatible.
2. Run `npm version patch --no-git-tag-version` (or `minor`/`major` intentionally).
   This updates package.json and package-lock.json together. Never reuse a published
   version. Add clear release notes describing changes and migrations.
3. Run the development verification commands above and the installed-upgrade checklist
   below. Review the actual packaged application, not only `npm start`.
4. Commit the version and lockfile, create the matching tag (for example `v0.3.1`),
   and push the commit and tag to `Sodiols/minute-tracker`.
5. `.github/workflows/release.yml` runs on version tags (or manually on a tag), checks
   the repository and version, installs from the lockfile, audits, tests, and builds
   signed NSIS assets on Windows. Actions are pinned by commit. A short-lived
   `github.token` is supplied only to the release-upload step, never to the app build.
6. The workflow creates a **draft** containing exactly the installer, blockmap, and
   `latest.yml`. It fails if that release already exists, preventing accidental
   replacement. Check the release notes, checksums, and successful Windows QA record.
7. Publish the draft as a normal stable GitHub release after QA. Drafts and prereleases
   are not offered to these clients. Keep all three artifacts together; do not upload
   a manifest that references missing files. Keep older releases for recovery.
8. Launch an installed older updater-enabled build, check Settings, download, keep
   working, then confirm installation. Record old/new versions and persistence checks.
   Watch for early failures before wider distribution. If a release is bad, withdraw
   it and ship a higher fixed version. Do not enable automatic downgrades.

The included production workflow never publishes unsigned builds. For an explicitly
approved development trial, build two distinct versions with `dist:win`, install the
older one, and attach the newer build's three artifacts to a GitHub test release.
Use an isolated distribution repository or coordinate all testers: publishing a stable
release in the configured repository makes it discoverable by every installed client.
No release is uploaded just by running a local build.

## Installed Windows acceptance checklist

Record OS/build, architecture, old/new versions, installation scope/path, and artifact hashes.

1. Install an older updater-enabled version with NSIS. Seed projects, completed and
   running manual sessions, preferences, automatic history, and a theme.
2. Publish the higher stable test release and confirm startup and Settings discovery,
   correct release notes, progress, and version display.
3. Cancel the install confirmation during active tracking. Confirm both collectors
   keep working. Quit without installing and confirm the old version still launches.
4. Download again; confirm installation. Confirm a recovery snapshot exists, the
   installed executable version changed, manual time resumes paused, automatic time
   excludes downtime, and projects/history/preferences/theme remain intact.
5. Repeat with a lost connection, 404/missing artifact, truncated download, and wrong
   SHA-512. The installer must not run; old version and data must remain available.
6. On signed builds, test unsigned and wrong-publisher installers. Both must be
   rejected by the built-in verifier. Test correct signed installers and certificate
   rotation before shipping it. Never replace the verifier with one returning success.
7. Test denied writes/disk-full and missing/crashed renderer during checkpointing.
   Restart must not proceed. Test canceled UAC and canceled installer, then reopen
   the old version and confirm data recovery. NSIS is not a transactional OS updater;
   power loss or disk failure during file replacement requires separate VM testing
   and may require reinstalling the last known-good installer with data retained.
8. Test per-user and per-machine installs, tray-only operation, sleep/lock, restart,
   and CSV export. Record unexecuted scenarios honestly.

Reference: https://www.electron.build/v26/docs/features/auto-update/ and
https://www.electron.build/docs/win/ . The installed, pinned library source is the
authority for version-specific behavior.
