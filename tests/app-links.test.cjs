/*
 * Universal links (dist/.well-known/apple-app-site-association): which veylet.com addresses
 * open the Veylet Capture app when it is installed. Only /app/account?tour= (ready-for-review
 * emails and desk deep links, opening the in-app Review) and /join?i= (team invites); the client
 * routes (/handoff, /tour, /embed) and help (/help/*, /app/help/*) are excluded explicitly, and
 * everything else stays on the web because nothing else matches. vercel.json serves the file,
 * which has no extension, as application/json.
 *
 * The matcher below follows Apple's documented rules for "components": they are read in order
 * and the first one whose path and query both match decides; "*" matches any run of characters,
 * "?" one character, and each named query item must be present and match its pattern.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const aasaPath = path.join(root, 'dist', '.well-known', 'apple-app-site-association');
const aasa = JSON.parse(fs.readFileSync(aasaPath, 'utf8'));
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function pattern(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$');
}

function opensApp(address) {
  const url = new URL(address, 'https://veylet.com');
  const [detail] = aasa.applinks.details;
  for (const component of detail.components) {
    if (component['/'] && !pattern(component['/']).test(url.pathname)) continue;
    const query = component['?'] || {};
    const queryMatches = Object.entries(query).every(([name, glob]) => {
      const value = url.searchParams.get(name);
      return value !== null && pattern(glob).test(value);
    });
    if (!queryMatches) continue;
    return !component.exclude;
  }
  return false;
}

test('the association file is the modern applinks form for the capture app', () => {
  assert.deepEqual(Object.keys(aasa), ['applinks']);
  assert.equal(aasa.applinks.details.length, 1);
  const [detail] = aasa.applinks.details;
  assert.deepEqual(detail.appIDs, ['4F4SMS88P8.dev.property3d.capture']);
  assert.ok(Array.isArray(detail.components) && detail.components.length > 0);
  assert.equal(detail.paths, undefined, 'no legacy paths list');
  for (const component of detail.components) {
    assert.equal(typeof component['/'], 'string', 'every component names a path');
    assert.ok(component['/'].startsWith('/'));
  }
  assert.ok(fs.readFileSync(aasaPath).length < 128 * 1024, 'Apple reads at most 128 KB');
});

test('review and invite links open the app', () => {
  for (const address of [
    '/app/account?tour=c3c3c3c3-2222-4333-8444-555555555555',
    '/app/account?utm_source=email&tour=c3c3c3c3-2222-4333-8444-555555555555',
    '/join?i=AbCdEfGhIjKlMnOpQrStUv_-0123456789',
  ]) {
    assert.equal(opensApp(address), true, address);
  }
});

test('client, portal, help and every other page stay on the web', () => {
  for (const address of [
    '/handoff?t=abcdefghijklmnop', '/handoff/?t=abcdefghijklmnop', '/tour?t=abcdefghijklmnop',
    '/tour/abc?t=abcdefghijklmnop', '/embed?t=abcdefghijklmnop', '/help/capture', '/app/help/capture',
    '/app/account', '/app/account?ref=abc', '/account?tour=c3c3c3c3-2222-4333-8444-555555555555',
    '/join', '/join?x=1', '/offer', '/', '/studio', '/app/privacy', '/auth/callback?code=abc',
  ]) {
    assert.equal(opensApp(address), false, address);
  }
});

test('client and help routes are excluded explicitly, before anything that opens the app', () => {
  const components = aasa.applinks.details[0].components;
  const excluded = components.filter((component) => component.exclude).map((component) => component['/']);
  for (const route of ['/handoff', '/tour', '/help/*', '/app/help/*']) assert.ok(excluded.includes(route), route);
  const firstInclude = components.findIndex((component) => !component.exclude);
  const lastExclude = components.map((component) => Boolean(component.exclude)).lastIndexOf(true);
  assert.ok(lastExclude < firstInclude, 'excludes come first');
});

test('vercel serves the association file as JSON', () => {
  const rule = vercel.headers.find((entry) => entry.source === '/.well-known/apple-app-site-association');
  assert.ok(rule, 'a header rule for the file');
  const type = rule.headers.find((header) => header.key.toLowerCase() === 'content-type');
  assert.equal(type && type.value, 'application/json');
  assert.equal((vercel.redirects || []).some((entry) => String(entry.source).includes('well-known')), false, 'never redirected');
});
