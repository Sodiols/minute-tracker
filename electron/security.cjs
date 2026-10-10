'use strict';
const {pathToFileURL} = require('node:url');
function guardSender(event, window, pagePath) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid requesting frame');
  const url = new URL(event.senderFrame.url);
  url.hash = '';
  if (url.href !== pathToFileURL(pagePath).href) throw new Error('Invalid requesting origin');
}
module.exports = {guardSender};
