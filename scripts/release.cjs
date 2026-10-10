'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
if (process.platform !== 'win32') throw new Error('Build signed Windows releases on Windows.');
process.env.MINUTE_SIGNED_RELEASE = '1';
require('../electron-builder.config.cjs');
function run(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], {stdio: 'inherit', env: process.env});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(path.join(__dirname, '../node_modules/@tailwindcss/cli/dist/index.mjs'), ['-i', './tailwind.input.css', '-o', './app/tailwind.css', '--minify']);
run(require.resolve('electron-builder/cli.js'), ['--config', 'electron-builder.config.cjs', '--win', 'nsis', '--x64', '--publish', 'never']);
run(path.join(__dirname, 'verify-package.cjs'), ['--signed']);
