'use strict';
/*
 * Share kit (slice D2, 11 Nov 2026): the three ways an agent hands a RELEASED walkthrough on.
 *
 * 1. Link for portals and CRM: https://veylet.com/tour?t=TOKEN, a plain https address with the
 *    share token only (no ?src= or other tag), served unbranded (/tour).
 * 2. Website embed: a responsive iframe of /embed?t=TOKEN with a title and
 *    allow="fullscreen; xr-spatial-tracking".
 * 3. Framing: only the released-walkthrough routes (/embed and the portal page /tour) may be
 *    framed by another site. The owner's private preview (/play), the desk (/studio), the
 *    account and review pages (/account, /app/*), the client handoff and every other page keep
 *    X-Frame-Options: DENY, and so would any future route that merely starts with "embed" or
 *    "tour".
 *
 * Both hosting policies are checked: vercel.json (current production) and the Cloudflare
 * adapter's hosting-policy.mjs (the prepared replacement).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function sharing() {
  const window = {};
  vm.runInNewContext(read('dist/tour-sharing.js'), { window, URL, navigator: {} });
  return window.VeyletSharing;
}

/* ---- 2. The embed snippet ------------------------------------------------------- */

test('the embed snippet is a titled, responsive iframe that allows fullscreen and spatial tracking', () => {
  const code = sharing().embedCode('abcdefghijklmnop');
  const frame = code.match(/<iframe\b[^>]*><\/iframe>/);
  assert.ok(frame, 'one iframe');
  const attrs = Object.fromEntries([...frame[0].matchAll(/\s([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  assert.equal(attrs.src, 'https://veylet.com/embed?t=abcdefghijklmnop');
  assert.equal(attrs.title, 'Explore this property in 3D');
  assert.deepEqual(attrs.allow.split(';').map(s => s.trim()), ['fullscreen', 'xr-spatial-tracking']);
  assert.match(attrs.style, /width:100%/);
  assert.match(attrs.style, /aspect-ratio:16\/9/);
  assert.doesNotMatch(attrs.style, /(^|;)\s*width:\s*\d+px/, 'no fixed desktop width');
  assert.equal(attrs.loading, 'lazy');
});

/* ---- Released walkthroughs only --------------------------------------------------- */

test('the frameable pages open released walkthroughs only, never an owner preview', () => {
  for (const file of ['dist/embed/index.html', 'dist/tour/index.html']) {
    const script = read(file).replace(/<!--[\s\S]*?-->/g, '');
    assert.match(script, /rpc\('lookup_tour_share'/, file + ' resolves the share token');
    // get_tour_package_base is the signed owner preview (/p/ on tours.veylet.com).
    assert.doesNotMatch(script, /get_tour_package_base|tours\.veylet\.com\/p\//, file);
  }
});

/* ---- 3. Framing ---------------------------------------------------------------------- */

// Vercel's header rules, applied the way Vercel applies them: every rule whose source
// matches the path adds its headers, later rules overriding earlier ones.
function vercelHeaders(route) {
  const config = JSON.parse(read('vercel.json'));
  const out = {};
  for (const rule of config.headers) {
    if (rule.has) continue;
    if (!new RegExp('^' + rule.source + '$').test(route)) continue;
    for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  }
  return out;
}

const FRAMEABLE = ['/embed', '/tour'];
const DENIED = [
  '/play', '/account', '/app/account', '/studio', '/handoff', '/report', '/', '/offer',
  // Not routes today: a page added later under these names must not inherit framing.
  '/embed-preview', '/embedded', '/embed/admin', '/tours', '/tour-admin',
];

test('vercel.json lets only the released-walkthrough routes be framed', () => {
  for (const route of FRAMEABLE) {
    const headers = vercelHeaders(route);
    assert.equal(headers['content-security-policy'], 'frame-ancestors *', route);
    assert.equal(headers['x-frame-options'], undefined, route);
  }
  for (const route of DENIED) {
    const headers = vercelHeaders(route);
    assert.equal(headers['x-frame-options'], 'DENY', route);
    assert.notEqual(headers['content-security-policy'], 'frame-ancestors *', route);
  }
});

test('the Cloudflare hosting policy lets only the released-walkthrough routes be framed', async () => {
  const { headersFor } = await import(path.join(root, 'cloudflare', 'hosting-policy.mjs'));
  for (const file of ['embed/index.html', 'tour/index.html']) {
    const headers = headersFor(file);
    assert.equal(headers['content-security-policy'], 'frame-ancestors *', file);
    assert.equal(headers['x-frame-options'], null, file);
  }
  for (const file of ['play/index.html', 'account/index.html', 'app/account/index.html', 'studio/index.html',
    'handoff/index.html', 'index.html', 'embed-preview/index.html', 'embedded.html', 'embed/admin/index.html',
    'tours/index.html']) {
    const headers = headersFor(file);
    assert.equal(headers['x-frame-options'], 'DENY', file);
    assert.equal(headers['content-security-policy'], null, file);
  }
});
