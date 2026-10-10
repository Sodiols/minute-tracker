# Release notes

## 0.3.1

- Adds scheduled GitHub update checks and Settings controls for versions, release
  notes, download progress, and user-approved installation.
- Saves and pauses manual sessions, flushes automatic history, and creates local
  recovery snapshots before restarting. Failed saves cancel the restart.
- Preserves project data, automatic history, preferences, and the existing dashboard.
- Adds Windows update regression tests, package verification, and a protected
  signed-release workflow.

This is an unsigned development/test build. Publisher identity is not verified.
It retains the standard electron-updater verification behavior and SHA-512 checks.
Production signing requires a legal publisher identity and a signing certificate.

Existing 0.2.0 installations must first install an updater-enabled version manually.
