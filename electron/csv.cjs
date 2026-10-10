'use strict';
const quote = value => {
  const text = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+@\-\t\r\n]/.test(text) ? "'"+text : text;
  return '"'+safe.replaceAll('"','""')+'"';
};
function formatCsv(days) {
  const rows = [['Date','Application','Active minutes','Idle minutes','Total foreground minutes','Movement samples','Estimated cursor distance (pixels)']];
  for (const date of Object.keys(days).sort()) for (const app of Object.values(days[date].apps)) {
    rows.push([date,app.name,(app.activeMs/60000).toFixed(2),(app.idleMs/60000).toFixed(2),(app.foregroundMs/60000).toFixed(2),app.movementSamples,app.cursorDistancePixels]);
  }
  return '\uFEFF'+rows.map(row => row.map(quote).join(',')).join('\r\n');
}
module.exports = {quote, formatCsv};
