'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const yaml = require('js-yaml');
const pkg = require('../package.json');
const release = require('../release-config.json');
(async () => {
  const asar = await import('@electron/asar');
  const folder = path.resolve(__dirname, '../release');
  const archive = path.join(folder, 'win-unpacked/resources/app.asar');
  const entries = asar.listPackage(archive);
  const packed = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(packed.version, pkg.version);
  assert.equal(packed.name, 'minute-windows-tracker');
  assert.ok(packed.minuteUpdates.configured);
  for (const file of ['electron/updates.cjs', 'electron/update-checkpoint.cjs', 'electron/preload.cjs', 'app/updates.js', 'app/index.html']) {
    assert.ok(asar.extractFile(archive, file).length, file);
  }
  assert.ok(!entries.some(file => /^[/\\](test|scripts|audit|\.github)[/\\]/.test(file)));
  const feedText = fs.readFileSync(path.join(folder, 'win-unpacked/resources/app-update.yml'), 'utf8');
  const feed = yaml.load(feedText);
  assert.equal(feed.provider, 'github'); assert.equal(feed.owner, release.owner); assert.equal(feed.repo, release.repo);
  assert.ok(!/token|password|authorization/i.test(feedText));
  const latest = yaml.load(fs.readFileSync(path.join(folder, 'latest.yml'), 'utf8'));
  assert.equal(latest.version, pkg.version);
  const installer = path.join(folder, `Minute-Tracker-Setup-${pkg.version}-x64.exe`);
  const entry = latest.files.find(file => file.url === path.basename(installer));
  assert.ok(entry); assert.equal(entry.sha512, createHash('sha512').update(fs.readFileSync(installer)).digest('base64'));
  assert.ok(fs.statSync(`${installer}.blockmap`).size > 0);
  assert.ok(entries.some(file => /get-windows[/\\]lib[/\\]binding[/\\].*\.node$/.test(file)));
  if (process.argv.includes('--signed')) {
    assert.equal(packed.minuteUpdates.signed, true);
    assert.ok(release.publisherName);
    assert.ok([feed.publisherName].flat().includes(release.publisherName));
    for (const file of [installer, path.join(folder, 'win-unpacked/Minute Tracker.exe')]) {
      const escaped = file.replace(/'/g, "''");
      const status = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status.ToString()`], {encoding: 'utf8'}).trim();
      assert.equal(status, 'Valid', `Invalid signature: ${path.basename(file)}`);
    }
  }
  console.log(`Package verified: ${pkg.version}; GitHub feed, runtime assets, installer SHA-512 and blockmap${process.argv.includes('--signed') ? ', Authenticode signatures' : ' (unsigned development build)'}.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
