'use strict';
// The pasted embed sends only the host site's origin, so a view can be counted per site
// without the page path (or anything else) leaving the agent's website.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('embed code sends the host origin only (strict-origin), never the full page address', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'tour-sharing.js'), 'utf8');
  const sandbox = { window: { location: { origin: 'https://veylet.com' } }, location: { origin: 'https://veylet.com' }, URL };
  sandbox.self = sandbox.window; sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const api = sandbox.window.VeyletSharing || sandbox.VeyletSharing;
  assert.ok(api && typeof api.embedCode === 'function', 'VeyletSharing.embedCode is exposed');
  const code = api.embedCode('abcdefghijklmnop');
  assert.match(code, /referrerpolicy="strict-origin"/);
  assert.doesNotMatch(code, /referrerpolicy="(no-referrer|unsafe-url|origin-when-cross-origin)"/);
});
