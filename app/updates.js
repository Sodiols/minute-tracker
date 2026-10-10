'use strict';
(() => {
  const bridge = window.minuteDesktop?.updates;
  const node = id => document.getElementById(id);
  const messages = {
    disabled: 'Updates are available in the installed Windows application.',
    idle: 'No update is waiting to install.', checking: 'Checking for updates...',
    available: 'An update is available. Download it when you are ready.',
    downloading: 'Downloading update. You can keep working.',
    downloaded: 'Update downloaded. Ready to install when you are.',
    installing: 'Saving your workspace for restart...', error: 'Could not check for updates.'
  };
  function render(value) {
    node('updateCurrentVersion').textContent = value.currentVersion || '-';
    node('updateAvailableVersion').textContent = value.availableVersion ? ` / Available ${value.availableVersion}` : '';
    node('updateStatus').textContent = value.error || messages[value.phase] || '';
    node('updateTrust').textContent = value.enabled && !value.signed ? 'Unsigned development build. Publisher identity is not verified.' : '';
    node('updateCheck').disabled = !value.enabled || !['idle', 'available', 'error'].includes(value.phase);
    node('updateDownload').hidden = value.phase !== 'available';
    node('updateInstall').hidden = value.phase !== 'downloaded';
    node('updateProgress').hidden = value.phase !== 'downloading';
    node('updateProgressText').hidden = value.phase !== 'downloading';
    node('updateProgress').value = value.progress || 0;
    const mb = n => ((n || 0) / 1048576).toFixed(1);
    node('updateProgressText').textContent = `${Math.floor(value.progress || 0)}% - ${mb(value.transferred)} / ${mb(value.total)} MB - ${mb(value.bytesPerSecond)} MB/s`;
    node('updateNotesContainer').hidden = !value.releaseNotes;
    // Release text is untrusted. Never render Markdown HTML or external links.
    node('updateNotes').textContent = value.releaseNotes || '';
  }
  if (!bridge) { render({phase: 'disabled', enabled: false}); return; }
  for (const [id, method] of [['updateCheck', 'check'], ['updateDownload', 'download'], ['updateInstall', 'install']]) {
    node(id).addEventListener('click', async () => {
      node(id).disabled = true;
      try { render(await bridge[method]()); }
      catch { node(id).disabled = false; node('updateStatus').textContent = 'The update request could not complete. Please try again.'; }
      finally { if (id !== 'updateCheck') node(id).disabled = false; }
    });
  }
  const unsubscribe = [bridge.onStatus(render), bridge.onPrepare(async token => {
    if (typeof token !== 'string') return;
    document.body.inert = true;
    try {
      const workspace = prepareWorkspaceForUpdate();
      await bridge.checkpoint({token, ok: true, workspace});
    } catch {
      try { await bridge.checkpoint({token, ok: false}); } catch { /* Main handles timeout and cancellation. */ }
      document.body.inert = false;
      cancelWorkspaceUpdate();
    }
  }), bridge.onCancel(() => { document.body.inert = false; cancelWorkspaceUpdate(); })];
  bridge.status().then(render).catch(() => render({phase: 'error'}));
  window.addEventListener('pagehide', () => unsubscribe.forEach(remove => remove()), {once: true});
})();
