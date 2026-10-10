# Minute Tracker security and verification report

Date: 2026-10-10 (Asia/Dhaka). Work was performed in the existing nested `minute-windows-tracker` folder. No Git metadata was present.

## A. Dependency security

Original audit: **20 affected package entries: 8 moderate, 11 high, 1 critical**. Final full and production-only audits: **0 vulnerabilities**. These counts represent affected package entries, including inherited advisories, rather than twenty independently exploitable runtime defects. Electron ships in production even though npm classifies it as a development dependency.

All requested baseline commands were executed: `npm audit`, `npm audit --json`, `npm audit --omit=dev`, `npm outdated`, and `npm ls --all`. Baseline output, dependency tree, manifest and lockfile are in `audit/before-*`; final audit evidence is in `audit/after-*`. No forced audit fix, disabled audit checking or advisory suppression was used.

Direct dependencies retained: get-windows 9.3.0, electron-builder 26.15.3, and Tailwind CSS / CLI 4.3.3. These are pinned to their original installed versions. Electron changed from **38.8.6 to 44.7.0**. No new direct dependencies were added and no working feature was removed.

| Affected package | Severity | Root cause and exposure | Repair / compatibility |
| --- | --- | --- | --- |
| @electron/get | Moderate | Build/install downloader inherits vulnerable proxy/logger formatting stack | Electron uses 5.1.0; builder uses scoped 5.0.0. ESM requires Node >=22.12; actual build passed on Node 24.16.0. |
| @mapbox/node-pre-gyp | High | Production dependency used for native installation/resolution; old tar extraction | Scoped 1.0.11 to 2.0.3 under get-windows; prebuilt installation and runtime resolution passed. |
| @parcel/watcher | High | Development watcher inherits micromatch/braces recursion | Compatible minor update 2.5.1 to 2.6.0; upstream uses picomatch. CSS generation passed. |
| @tailwindcss/cli | High | Development-only inherited watcher advisory | Retain 4.3.3 and override its watcher; preserve CSS workflow. |
| app-builder-lib | Moderate | Build-only legacy downloader | Retain 26.15.3; scoped @electron/get 5.0.0 override. Required/dynamic-import APIs verified by NSIS build. |
| braces | High | Development pattern parser stack exhaustion | No patched original release; removed through maintained watcher parent update. |
| cacache | High | Native build/install cache inherits vulnerable tar | node-gyp update selects cacache 19.0.1 and patched tar. |
| dmg-builder | Moderate | macOS build tooling inherits vulnerable builder downloader | Resolved through builder override. macOS build not tested. |
| electron | High | Runtime isolation, navigation, permissions, protocol and memory-safety issues; vulnerable install extractor | Deliberate major update 38.8.6 to patched stable 44.7.0. Windows native, preload, dashboard and packaging verified. |
| electron-builder | Moderate | Build-only inherited app-builder-lib / dmg-builder advisories | Retain and pin 26.15.3; scoped transitive repair. |
| electron-builder-squirrel-windows | Moderate | Inherited builder issue; Squirrel is not this app's target | Absent from final tree; existing NSIS target preserved. |
| extract-zip | High | Install/build archive symlink traversal and arbitrary writes | Electron now uses maintained @electron-internal/extract-zip; legacy package removed. |
| get-windows | High | Production collector inherits vulnerable native install tools | Retain 9.3.0 with scoped node-pre-gyp / node-gyp updates. Runtime behavior verified. |
| global-agent | Moderate | Install/build proxy stack inherits roarr/sprintf-js | Removed by maintained downloader update. |
| make-fetch-happen | High | Install fetcher inherits vulnerable cacache/tar | Updated parent selects 14.0.3 and cacache 19.0.1. |
| micromatch | High | Development pattern matching inherits braces | Removed from watcher chain through parent update. |
| node-gyp | High | Optional production native build tool; vulnerable archive dependencies | Scoped get-windows override to 11.5.0. Prebuilt install works; native source compilation requires absent C++ tools. |
| roarr | Moderate | Install/build logger inherits sprintf-js | Removed with old downloader stack. |
| sprintf-js | Moderate | Unbounded precision specifiers cause resource exhaustion | No patched original release; maintained downloader parent removes this chain. |
| tar | Critical | Archive traversal, symlink/hardlink overwrite, parse/decompression/recursion DoS; install/build tooling | Every final copy is 7.5.22. Updated parents support tar 7; no incompatible blanket tar override. |

Exact original installed versions, affected ranges and individual advisory links are appended below. The four scoped overrides are limited to their named parents. `npm ci`, native loading, CSS generation and the NSIS build validate the combination. Existing upstream deprecation warnings, including glob/rimraf, remain visible; the advisory audit is zero.

Sources consulted: [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [Electron stable releases](https://releases.electronjs.org/?channel=stable), [get-windows source](https://github.com/sindresorhus/get-windows), installed dependency source and npm registry metadata.

## B. Bugs and security defects fixed

1. **Stale foreground queries:** pending results could survive pause, clear, preference changes and power transitions. Collector generations invalidate them; overlapping polls are rejected.
2. **Time attribution:** elapsed intervals previously belonged to the newly observed app, valid delays were capped at 2.5 seconds, and midnight intervals went into the wrong day. Accounting now uses monotonic elapsed time, attributes to the starting observed app, accepts intervals up to five seconds, and splits local midnight and idle-threshold crossings. Unobserved or locked gaps are discarded.
3. **Lock/suspend continuity:** explicit locked/suspended state blocks polling until unlock/resume. Restart begins without a previous sample. Collection remains in the main process lifecycle when the window is hidden to tray. Quit clears timers and closes the helper.
4. **Native stability:** get-windows 9.3.0 source leaks window-title buffers and some UWP handles, and invokes synchronous native APIs. A utility process isolates those calls, times out after five seconds and recycles after 1,800 samples. Only app names cross back. This bounds resource retention and isolates crashes/hangs; the upstream binary leak itself is not claimed fixed.
5. **Missing native addon:** get-windows could silently return undefined and still appear available. Startup now explicitly loads/checks the native binary before declaring availability.
6. **Concurrent app instances:** a single-instance lock prevents independent processes from overwriting the same history file.
7. **IPC sender validation:** owning WebContents, exact top-level frame and exact local page URL must match. Boolean and idle-threshold allowlists remain enforced. Preload exposes fixed methods and strips IPC event objects.
8. **Electron permissions:** context isolation, sandbox and web security are enabled; Node integration and packaged DevTools disabled. Permissions, display capture, webviews, popups and navigation are denied. CSP also denies frames, workers and connections. Inline styles remain for existing chart bars; inline scripts are prohibited.
9. **Packaged development capabilities:** fuses disable RunAsNode, NODE_OPTIONS and Node inspector arguments, and enable ASAR-only loading and embedded ASAR integrity validation. The actual package fuse bytes were checked.
10. **Consent/tray:** first-time enable directs the user to the existing App activity consent flow. Once consent is given, tray pause/resume works. Previously enabled settings migrate as prior consent. Users can disable tracking even if the collector is unavailable.
11. **Activity persistence:** schema, safe keys and nonnegative consistent counters are validated. Corrupt files are preserved byte-for-byte before fresh history is written. Atomic temporary-file writes flush content before replacement. Failed reset rolls memory back. Save errors no longer clear collector errors.
12. **Manual state corruption:** projects, colors, segments and settings are validated. Malformed localStorage is preserved under a recovery key. Overlapping segments and style injection are rejected.
13. **Short-session cancellation:** rejecting the discard confirmation no longer closes the segment while leaving the timer marked running. Manual elapsed time is monotonic. After restart, timers recover paused at their last save instead of accumulating offline time.
14. **CSV formula injection:** both exports neutralize spreadsheet formulas, including whitespace/control-character prefixes, while retaining escaping, UTF-8 BOM and CRLF rows.
15. **Misleading app names:** Claude desktop is labeled Claude, not Claude Code. VS Code and terminal usage never imply independently detected CLI-agent activity.
16. **Unreachable background app:** when tray setup fails, closing the last window now exits. Startup and local persistence failures are surfaced.

## C. Functionality verification

| Check | Result / limits |
| --- | --- |
| Final `npm ci` | PASS. An intermediate reinstall was blocked by DLLs held by a separate running project copy; the exact project processes were identified/stopped and installation was rerun successfully. |
| `npm test` | **37/37 PASS**. App classification, active/idle/movement, switching, midnight, clock correction, unmonitored gaps, no consent, concurrency, pause/resume/reset/power invalidation, helper timeout/recycle/recovery, persistence/corruption/reset failure, IPC, preload cleanup, CSV and manual projects/timers. |
| `npm run test:electron` | PASS on real Windows x64 / Electron 44.7.0. Actual sandbox/preload/IPC, all six views, project creation, manual timers, native foreground samples, immediate pause, and continued hidden-to-tray accounting. |
| CSV integration | Real manual CSV download and automatic export through bridge/IPC/filesystem passed. Automatic save-dialog selection was stubbed to a temporary path. |
| Power events | Lock/unlock/suspend/resume event handling passed using simulated Electron events. Physical Windows lock and sleep cycles were not performed. |
| Native apps | Recognized names tested for VS Code, Chrome, Illustrator, Photoshop, After Effects and CapCut. Smoke tests sampled real foreground apps, but did not exercise an interactive working session in every named application. |
| Design | Existing layout, typography rules, palette, sidebar, charts, responsive CSS and cards preserved. Desktop screenshot inspected; not an exhaustive device visual audit. |

Evidence: `audit/tests.txt`, `audit/electron-smoke.json`, `audit/electron-smoke.log`, and `audit/dashboard.png`. Electron tests use a disposable profile, never seed the user's existing workspace, and are excluded from the package.

## D. Windows packaging and installer

`npm run dist:win`: **PASS**, Windows x64 NSIS installer. The initial forced native rebuild failed because Visual Studio C++ Build Tools are absent. The get-windows Node-API 9 prebuilt actually loaded under Electron 44 (Node-API 10); `npmRebuild:false` packages that compatible binary instead. Native source compilation is not claimed tested.

Package inspection confirms current source, required HTML/CSS/JS/icon assets, unpacked native addon, excluded test/audit files and security fuse settings. Evidence: `audit/package-verification.json` and `audit/build.txt`.

INSTALLER_RESULT_PLACEHOLDER

The installer is **not Authenticode signed**. Builder output mentioning signing does not prove a trusted certificate was applied; `Get-AuthenticodeSignature` reports `NotSigned`.

## E. Remaining limitations

- Physical lock/unlock, suspend/resume, long-duration resource soak, all listed creative applications, ARM64, other Windows releases, elevated app boundaries, multiple displays/DPI and antivirus/SmartScreen behavior need further device testing.
- Sampling cannot reconstruct switches between observations. Gaps over five seconds and unmonitored intervals are discarded. Reading without input eventually becomes idle. Movement is a sampled estimate, never click or keystroke counts.
- Native buffer/handle retention is bounded by helper recycling; a maintained upstream fix is still desirable. No C++ toolchain was installed just to build a locally patched native module.
- Automatic history flushes roughly every 10–15 seconds and on orderly quit, lock and suspend. Hard crashes can lose the latest unsaved interval. Manual timers recover at their last save. Manual sessions remain deliberate elapsed-time timers, separate from OS idle accounting.
- Storage is local JSON and Chromium localStorage, not a transactional database. Data and recovery copies are plaintext under the current Windows account. No cloud storage, database migration, encryption-at-rest or multi-user access control is claimed.
- Recovery copies deliberately survive clearing the fresh store; remove them after recovery if all historical bytes need erasure.
- No IDE/CLI hooks, browser site/tab attribution, screen captures of other applications, typed-text recording, clipboard monitoring, exact click counts or automatic startup were introduced.
- Trusted code signing and broader physical-device validation remain release gates. Zero npm advisories does not establish absence of all software defects.
