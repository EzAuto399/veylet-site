const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const playerSource = fs.readFileSync(path.join(__dirname, '../dist/tour-player.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../dist/play/index.html'), 'utf8');
const source = markup.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
async function load(options = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) ids[match[2]] = { hidden: /\bhidden\b/.test(match[0]), textContent: '', addEventListener() {} };
  const calls = []; const revision = 'a'.repeat(64);
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'reviewer' } } } }) },
    from() { const query = { select() { return query; }, eq() { return query; }, limit: async () => ({ data: [{ id: 't1', storage_path: 'private/original.zip' }] }) }; return query; },
    rpc: async (name, args) => { calls.push([name, args]); return options.target || { data: [{ tour_id: 't1', storage_path: 'private/original.zip', package_revision: revision }] }; },
    storage: { from: () => ({ download: async storagePath => { calls.push(['download', storagePath]); return { error: { message: 'Stop fixture after download boundary' } }; } }) },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://fixture.invalid', anonKey: 'fixture' }, supabase: { createClient: () => client }, addEventListener() {} };
  // Every link in the page, as the script sees them (href attribute only).
  const links = [...markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/g)].map(match => {
    const attributes = { href: match[1] };
    return { getAttribute: name => attributes[name] ?? null, setAttribute: (name, value) => { attributes[name] = String(value); } };
  });
  const context = { window, document: { getElementById: id => ids[id], querySelector: () => null, querySelectorAll: selector => (selector === 'a[href]' ? links : []) },
    navigator: { onLine: true, userAgent: options.userAgent || '' }, location: { search: options.search ?? '?id=t1&review_revision=' + revision }, URLSearchParams, setTimeout, clearTimeout };
  vm.runInNewContext(playerSource, context);
  const boot = window.VeyletPlayer.boot; let done;
  window.VeyletPlayer.boot = options => (done = boot(options));
  vm.runInNewContext(source, context); await done;
  return { ids, calls, hrefs: () => links.map(link => link.getAttribute('href')) };
}
test('matching review revision is verified before any private package download', async () => {
  const h = await load();
  assert.deepEqual(h.calls.map(call => call[0]), ['get_tour_review_target', 'download']);
});
test('same-path replacement or changed path rejects the review preview before download', async () => {
  for (const target of [
    { tour_id: 't1', storage_path: 'private/original.zip', package_revision: 'b'.repeat(64) },
    { tour_id: 't1', storage_path: 'private/replaced.zip', package_revision: 'a'.repeat(64) },
  ]) {
    const h = await load({ target: { data: [target] } });
    assert.equal(h.calls.some(call => call[0] === 'download'), false);
    assert.equal(h.ids['tour-frame'].hidden, true);
    assert.equal(h.ids['play-review-recovery'].hidden, false);
    assert.match(h.ids['play-title'].textContent, /package changed/);
  }
});
test('malformed or unavailable review revision leaves the package unrendered', async () => {
  for (const options of [
    { search: '?id=t1&review_revision=' },
    { search: '?id=t1&review_revision=bad' },
    { target: { data: [] } },
    { target: { error: { message: 'unavailable' } } },
  ]) {
    const h = await load(options);
    assert.equal(h.calls.some(call => call[0] === 'download'), false);
    assert.equal(h.ids['play-review-recovery'].hidden, false);
    assert.match(h.ids['play-body'].textContent, /fresh review/);
  }
});
test('normal private previews remain compatible without a review revision', async () => {
  const h = await load({ search: '?id=t1' });
  assert.deepEqual(h.calls.map(call => call[0]), ['download']);
  assert.equal(h.ids['play-review-recovery'].hidden, true);
});

test('opened from the app, the preview’s links stay on the app’s pages; anywhere else they are as written', async () => {
  const revision = 'a'.repeat(64);
  const site = await load();
  assert.deepEqual(site.hrefs(), ['#main', '/', '/account', '/account', '/account', '/', '/privacy', '/terms']);
  const APP = ['#main', '/app/account', '/app/account', '/app/account', '/app/account', '/app/account', '/app/privacy', '/app/terms'];
  const fromApp = await load({ search: '?id=t1&review_revision=' + revision + '&from=app' });
  assert.deepEqual(fromApp.hrefs(), APP, 'the desk in app mode adds from=app to Open review preview');
  assert.deepEqual(fromApp.calls.map(call => call[0]), ['get_tour_review_target', 'download'], 'the review check is unchanged');
  // The app's own web view (WKWebView: an iPhone without the Safari token) or an app-named agent.
  const webView = await load({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
  assert.deepEqual(webView.hrefs(), APP);
  const named = await load({ userAgent: 'Mozilla/5.0 (Macintosh) VeyletCapture/1.0' });
  assert.deepEqual(named.hrefs(), APP);
  const safari = await load({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  assert.deepEqual(safari.hrefs(), site.hrefs(), 'Safari on an iPhone is the public site');
  const other = await load({ search: '?id=t1&from=elsewhere' });
  assert.deepEqual(other.hrefs(), site.hrefs());
});
