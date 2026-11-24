'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const read = rel => fs.readFileSync(path.join(DIST, rel), 'utf8');

function scriptTags(html) {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map(match => ({ attrs: match[1], body: match[2], raw: match[0] }));
}

function linkTags(html) {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<link\b([^>]*)>/gi)]
    .map(match => match[1]);
}

function attr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : null;
}

test('buyer and account pages have zero render-blocking external scripts', () => {
  const pages = [
    'handoff/index.html',
    'tour/index.html',
    'embed/index.html',
    'play/index.html',
    'account/index.html',
    'app/account/index.html',
  ];
  for (const page of pages) {
    const tags = scriptTags(read(page));
    const external = tags.filter(tag => /\bsrc\s*=/.test(tag.attrs));
    assert.ok(external.length > 0, `${page} has external scripts`);
    for (const tag of external) {
      assert.match(tag.attrs, /\bdefer\b/i, `${page} external script must defer: ${tag.raw}`);
    }
  }
});

test('inline boot and failure-watch scripts on buyer pages run as modules after deferred scripts', () => {
  const handoffWatch = scriptTags(read('handoff/index.html'))
    .find(tag => /VeyletClientPage\.watchFailures/.test(tag.body));
  assert.ok(handoffWatch, 'handoff has watchFailures inline script');
  assert.equal(attr(handoffWatch.attrs, 'type'), 'module', 'handoff watchFailures uses type="module"');

  const tourBoot = scriptTags(read('tour/index.html'))
    .find(tag => /VeyletTourPage\.tour/.test(tag.body));
  assert.ok(tourBoot, 'tour has boot script');
  assert.equal(attr(tourBoot.attrs, 'type'), 'module', 'tour boot uses type="module"');

  const embedBoot = scriptTags(read('embed/index.html'))
    .find(tag => /VeyletTourPage\.embed/.test(tag.body));
  assert.ok(embedBoot, 'embed has boot script');
  assert.equal(attr(embedBoot.attrs, 'type'), 'module', 'embed boot uses type="module"');
});

test('PlayCanvas modulepreload is present on auto-playing buyer views and absent on / and /embed', () => {
  const playerJs = read('tour-player-v2.js');
  const enginePin = playerJs.match(/const ENGINE_URL = '(\/vendor\/playcanvas-2\.23\.2\.min\.js\?v=([0-9a-f]{16}))';/);
  assert.ok(enginePin, 'tour-player-v2.js pins PlayCanvas engine');

  for (const page of ['handoff/index.html', 'tour/index.html']) {
    const preloads = linkTags(read(page)).filter(attrs => attr(attrs, 'rel') === 'modulepreload');
    assert.ok(
      preloads.some(attrs => attr(attrs, 'href') === enginePin[1]),
      `${page} modulepreloads pinned ${enginePin[1]}`
    );
  }

  for (const page of ['index.html', 'embed/index.html']) {
    const preloads = linkTags(read(page)).filter(attrs => attr(attrs, 'rel') === 'modulepreload');
    assert.equal(
      preloads.some(attrs => /playcanvas/.test(attr(attrs, 'href') || '')),
      false,
      `${page} must not eagerly modulepreload PlayCanvas`
    );
  }
});

test('account, app/account, and play preconnect to Supabase and tours.veylet.com', () => {
  for (const page of ['account/index.html', 'app/account/index.html', 'play/index.html']) {
    const preconnects = linkTags(read(page))
      .filter(attrs => attr(attrs, 'rel') === 'preconnect' && /\bcrossorigin\b/i.test(attrs))
      .map(attrs => attr(attrs, 'href'));
    assert.ok(preconnects.includes('https://ntupgokxauegrnnvacqt.supabase.co'), `${page} preconnects Supabase`);
    assert.ok(preconnects.includes('https://tours.veylet.com'), `${page} preconnects tours.veylet.com`);
  }
});

test('tour-player-v2.js keeps manifest.json no-cache and allows HTTP cache on revisioned walkable.json', () => {
  const player = read('tour-player-v2.js');
  assert.match(
    player,
    /async function fetchJson\(url,\s*limit,\s*signal,\s*timeoutMs\s*=\s*15000,\s*cache\s*=\s*'no-cache'\)/,
    'fetchJson accepts cache parameter defaulting to no-cache'
  );
  assert.match(
    player,
    /fetch\(url,\s*\{\s*signal:\s*controller\.signal,\s*credentials:\s*'omit',\s*cache\s*\}\)/,
    'fetchJson passes cache option to fetch'
  );
  assert.match(
    player,
    /fetchJson\(base \+ 'manifest\.json',\s*MANIFEST_LIMIT,\s*signal\)/,
    'manifest.json keeps default no-cache'
  );
  assert.match(
    player,
    /fetchJson\(base \+ manifest\.walkable,\s*WALKABLE_LIMIT,\s*signal,\s*15000,\s*'default'\)/,
    'revisioned walkable.json uses default cache'
  );
});
