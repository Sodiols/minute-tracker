'use strict';
const base = require('./package.json').build;
const release = require('./release-config.json');
const signed = process.env.MINUTE_SIGNED_RELEASE === '1';
if (!/^[A-Za-z0-9-]+$/.test(release.owner) || !/^[A-Za-z0-9_.-]+$/.test(release.repo)) {
  throw new Error('Configure the explicit GitHub owner and repository in release-config.json.');
}
if (signed && (!release.publisherName || !process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD)) {
  throw new Error('Signed releases require publisherName, CSC_LINK and CSC_KEY_PASSWORD.');
}
module.exports = {
  ...base,
  directories: {output: 'release'},
  artifactName: 'Minute-Tracker-Setup-${version}-${arch}.${ext}',
  publish: [{provider: 'github', owner: release.owner, repo: release.repo, private: false, releaseType: 'draft'}],
  forceCodeSigning: signed,
  win: {...base.win, verifyUpdateCodeSignature: true,
    ...(release.publisherName ? {signtoolOptions: {publisherName: release.publisherName}} : {})},
  nsis: {...base.nsis, deleteAppDataOnUninstall: false},
  extraMetadata: {minuteUpdates: {configured: true, signed, owner: release.owner, repo: release.repo}}
};
