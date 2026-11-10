// The words dist/tour-player.js shares between /handoff, /tour and /embed, read from the shipped file, and
// the two helpers pages call for a dead or cut-off link, for tests whose window.VeyletPlayer is a stand-in.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function realPlayer(extra = {}) {
  const window = { addEventListener() {}, removeEventListener() {} };
  const document = { hidden: false, title: '', addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({}), head: { append() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/tour-player.js'), 'utf8'),
    { window, document, performance, setTimeout, clearTimeout, AbortController, navigator: { onLine: true }, location: { reload() {} }, ...extra });
  return window.VeyletPlayer;
}
const WORDS = { ...realPlayer().WORDS };

/** Give a stand-in player the page-facing helpers, saying what the shipped ones say through its own showFailure. */
function withClientHelpers(player) {
  player.WORDS = WORDS;
  player.showIncomplete = els => player.showFailure(els, { heading: WORDS.incompleteHeading, body: WORDS.incompleteBody });
  player.showMissing = els => player.showFailure(els, { heading: WORDS.missingHeading, body: WORDS.missingBody, retry: true, definitive: true });
  return player;
}

module.exports = { WORDS, realPlayer, withClientHelpers };
