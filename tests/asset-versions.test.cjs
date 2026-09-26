const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const api = import(pathToFileURL(path.join(__dirname, '../scripts/asset-versions.mjs')));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veylet-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, body) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body); };
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  return { root, write, read };
}

test('versions final dependency bytes, nested HTML and pinned vendor URLs; repeat build is stable', async t => {
  const { versionAssets, assetHash } = await api;
  const f = fixture(t);
  f.write('vendor/sdk-1.0.js', 'window.SDK = 1;');
  f.write('loader.js', "loadScript('/vendor/sdk-1.0.js');");
  f.write('style.css', 'body{color:green}');
  f.write('account/index.html', '<link href="../style.css?theme=site&amp;v=old" rel="stylesheet"><script defer src="/loader.js"></script><script src="https://external.invalid/sdk.js"></script>');
  const result = versionAssets(f.root);
  assert.match(f.read('loader.js'), new RegExp(`sdk-1.0.js\\?v=${assetHash(f.read('vendor/sdk-1.0.js'))}`));
  assert.match(f.read('account/index.html'), new RegExp(`/loader.js\\?v=${assetHash(f.read('loader.js'))}`));
  assert.match(f.read('account/index.html'), /\/style.css\?theme=site&amp;v=[a-f\d]{16}/);
  assert.match(f.read('account/index.html'), /https:\/\/external.invalid\/sdk.js/);
  assert.deepEqual(versionAssets(f.root), { versions: result.versions, changedFiles: [] });
});

test('dependency changes invalidate the loader and its HTML URL without invalidating unchanged files', async t => {
  const { versionAssets } = await api;
  const f = fixture(t);
  f.write('vendor/sdk-1.0.js', 'window.SDK = 1;');
  f.write('loader.js', "loadScript('/vendor/sdk-1.0.js');");
  f.write('stable.js', 'window.stable = true;');
  f.write('index.html', '<script src="loader.js"></script><script src="stable.js"></script>');
  const before = versionAssets(f.root);
  f.write('vendor/sdk-1.0.js', 'window.SDK = 2;');
  const after = versionAssets(f.root);
  assert.notEqual(after.versions['vendor/sdk-1.0.js'], before.versions['vendor/sdk-1.0.js']);
  assert.notEqual(after.versions['loader.js'], before.versions['loader.js']);
  assert.equal(after.versions['stable.js'], before.versions['stable.js']);
  assert.equal(after.changedFiles.includes('stable.js'), false);
  assert.match(f.read('index.html'), new RegExp(after.versions['loader.js']));
});

test('missing and cyclic local dependencies fail without partially rewriting sources', async t => {
  const { versionAssets } = await api;
  const f = fixture(t);
  f.write('a.js', "loadScript('/b.js');");
  f.write('index.html', '<script src="a.js"></script>');
  assert.throws(() => versionAssets(f.root), /Missing public asset/);
  assert.equal(f.read('a.js'), "loadScript('/b.js');");
  f.write('b.js', "loadScript('/a.js');");
  assert.throws(() => versionAssets(f.root), /Cyclic public asset/);
  assert.equal(f.read('index.html'), '<script src="a.js"></script>');
});

test('every ?v= in dist names the current bytes of its file, so no page can pin a stale player (VIEWER-23)', async () => {
  const { assetHash, mapAssetReferences, publicFiles } = await api;
  const dist = path.join(__dirname, '../dist');
  const stale = [];
  let checked = 0;
  for (const source of publicFiles(dist).filter(file => /\.(?:html|js|css)$/.test(file) && !file.startsWith('vendor/'))) {
    mapAssetReferences(fs.readFileSync(path.join(dist, source), 'utf8'), source, (target, url) => {
      const version = url.searchParams.get('v');
      if (version !== null) {
        checked++;
        const actual = assetHash(fs.readFileSync(path.join(dist, target)));
        if (version !== actual) stale.push(`${source} → /${target}?v=${version} (file is ${actual})`);
      }
      return url.pathname + url.search + url.hash;
    });
  }
  assert.ok(checked > 50, `${checked} versioned references`);
  // S13 may write only its own files (docs/OWNERSHIP.md). /see is another writer's page: its pin of the
  // player is re-pinned by `node scripts/write-build-info.mjs` when the release candidate is prepared
  // (README). Only that one pin may lag here; any other stale pin, or a new one, fails.
  const RELEASE_REPIN = ['see/see.js → /tour-player-v2.js'];
  const lagging = stale.filter(line => RELEASE_REPIN.some(entry => line.startsWith(entry + '?v=')));
  assert.deepEqual(stale.filter(line => !lagging.includes(line)), [], 'run node scripts/write-build-info.mjs and commit its changes');
  assert.ok(lagging.length <= RELEASE_REPIN.length);
});
