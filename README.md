# Minute Tracker

An Electron desktop companion to the existing HTML, CSS, JavaScript and Tailwind work-session website. The existing manual timer and projects remain separate from the desktop collector.

## Download for Windows

[Download the Minute Tracker 0.3.1 installer for Windows x64](https://github.com/Sodiols/minute-tracker/releases/download/v0.3.1/Minute-Tracker-Setup-0.3.1-x64.exe)

Download and run the installer on Windows 10 or 11. This 0.3.1 release is an **unsigned development/test build**; a verified publisher identity is not yet configured. See the [release page](https://github.com/Sodiols/minute-tracker/releases/tag/v0.3.1) for its files and notes. Once installed, future updates can be checked in **Settings**.

## Run from source on Windows 10 or 11

1. Install Node.js 22.12 or newer and npm (Node 24 is verified).
2. Unzip the source, open PowerShell or Command Prompt in this folder.
3. Run `npm ci` with the supplied lockfile. Quit existing Minute instances first so Windows can replace Electron DLLs.
4. Run `npm start`.
5. In the app, select **App activity**, read the privacy explanation, and choose **Enable tracking**.
6. Open VS Code, Chrome, Photoshop, Illustrator, After Effects, CapCut or another app. Your usage will appear on the dashboard.

To package an installer on Windows, run `npm run dist:win`. The Electron Builder configuration targets a Windows NSIS installer. Test and code-sign before production distribution.

The automatic activity history is stored in Electron's userData folder as `minute-activity.json`. The manual session history and projects continue to use the app's localStorage data. They are **not** automatically combined; adding the two totals together would double count overlapping time.

## Features

- Foreground application detection via `get-windows` (the maintained successor of `active-win`), sampled approximately every second.
- Windows combined input-idle status using Electron `powerMonitor.getSystemIdleTime()` and lock detection.
- Active, idle, and foreground time per app, daily and 7-day graphs, application switching count.
- Approximate cursor-movement intervals and pixel-distance estimate using Electron `screen.getCursorScreenPoint()`. Only the aggregate is stored, never cursor coordinates. **No click counts or keyboard stroke counts** are implemented.
- Start/pause from the app or tray. No auto-start. Recording is off by default until you opt in.
- First-time consent is given in App activity. The tray can resume tracking after consent. Previously enabled automatic tracking resumes on application restart.
- Ignore all other apps unless you explicitly enable **Include other applications**.
- CSV export, local data deletion, adjustable idle threshold (1 / 2 / 5 / 10 minutes).

### Limitations

- VS Code extensions and Claude Code / Codex inside a terminal or VS Code are attributed to the foreground **host app**. Distinguishing these requires IDE/CLI hooks and a separate integration.
- Browser URLs and tabs are **not tracked**. A Chrome extension is needed for site-level attribution.
- This is a sampling-based approximation, not an exact input event log. It does not record precise click counts or keystroke counts.
- No screenshots, window titles, browser URLs, process paths, key contents, or cursor positions are saved.
- Time spent reading without input becomes idle after the configured threshold; that is adjustable.
- Manual timer data uses Chromium localStorage, while activity summaries use a local JSON file. This is a proof of concept, not a hardened multiuser product.
- Windows x64 / Electron 44.7.0 native collection and the dashboard have been exercised by `npm run test:electron`. See `SECURITY-AUDIT.md` for the exact build, installer and physical-device test coverage.
- Manual timers restore paused at their last saved checkpoint after restart. Automatic history is flushed about every 10–15 seconds and on orderly shutdown, lock and suspend; an abrupt crash can lose the last unsaved interval.
- Foreground activity is an approximately one-second sample. Intervals start at the last observed app; unobserved or locked gaps are discarded. Cursor movement is an estimate, not an input-event log. Manual timers remain deliberate elapsed-time sessions, separate from OS idle accounting.

## Security model

The Electron renderer has context isolation and sandboxing enabled, and Node integration disabled. A minimal preload bridge allows only known activity and update commands from the exact local main frame. Permissions, popups, webviews, external navigation and screen capture are denied. The page loads local assets with a restrictive Content Security Policy. Inline styles support the existing chart bars; inline scripts are prohibited. Packaged DevTools, RunAsNode, NODE_OPTIONS and Node inspector arguments are disabled, with ASAR integrity validation enabled. Projects and activity history remain local unless a user exports them. Installed builds contact GitHub to check for updates and download installers; these requests do not upload tracking data.

Native foreground queries run in an isolated Electron utility process, with a five-second timeout and recycling after 1,800 samples. This bounds upstream get-windows 9.3.0 native buffer/handle retention and keeps native hangs out of the main process. Only the application name crosses back to the collector. Damaged activity history is preserved as a `.bak` file before a fresh store is used; damaged manual workspace data is preserved under a separate localStorage key. These recovery copies remain local and may be removed after recovery.

The Windows build uses the package's Node-API 9 prebuilt binary (`npmRebuild: false`); Electron 44 supports it. This avoids requiring Visual Studio C++ Build Tools. Missing or incompatible binaries fail collector startup visibly instead of silently reporting tracking. Builds are verified for x64 only. Audit output and compatibility notes for the narrowly scoped npm overrides are in `SECURITY-AUDIT.md`.

## Windows updates

Version 0.3.0 adds GitHub Releases updates and Settings controls. See [UPDATES.md](UPDATES.md)
for unsigned development builds, signing setup, data preservation, and the exact release
procedure. See [UPDATE-VERIFICATION.md](UPDATE-VERIFICATION.md) for installed Windows test
results and limitations. The first upgrade from 0.2.0 is manual because it has no updater.

## Tests

Run `npm test` for accounting, persistence, IPC, CSV, renderer-state and native-helper regression tests. Run `npm run test:electron` for a Windows integration smoke test using a disposable temporary profile; it records synthetic manual sessions and briefly samples foreground app names with other-app collection enabled, then clears that activity. The harness is excluded from the packaged app. A dashboard-only screenshot and results are written to `audit/`.
