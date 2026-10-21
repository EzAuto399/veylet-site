import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, adapterRoot, repositoryRoot, transformAnalytics, sha256, validateSource } from '../build.mjs';
import { verify, validateConfiguration } from '../verify.mjs';
import { headersFor } from '../hosting-policy.mjs';
import worker from '../output/worker.mjs';
import policy from '../output/routing-policy.json' with { type: 'json' };

const release = JSON.parse(await readFile(join(adapterRoot, 'public-release.json'), 'utf8'));
const prod = { CF_DEPLOYMENT_ENV: 'production' };
const preview = { CF_DEPLOYMENT_ENV: 'preview' };
const fetchAsset = async request => {
  const path = new URL(request.url).pathname.slice(1);
  const bytes = await readFile(join(adapterRoot, 'output/site', path));
  const etag = '"test-public-etag"';
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(request.method === 'HEAD' ? null : bytes, { headers: { ETag: etag, 'Content-Length': String(bytes.length) } });
};
const call = (path, env = prod, init = {}) => worker.fetch(new Request((env === prod ? 'https://veylet.com' : 'http://127.0.0.1:8896') + path, init), { ...env, ASSETS: { fetch: fetchAsset } });

test('maintained deployment rejects route removal, HTTP/broad routes and tenant/Worker identity drift', async () => {
  for (const name of ['wrangler.preview.jsonc', 'wrangler.production.jsonc']) {
    const config = JSON.parse(await readFile(join(adapterRoot, name), 'utf8')); validateConfiguration(config, name);
    assert.throws(() => validateConfiguration({ ...config, account_id: 'synthetic-wrong-tenant' }, name), /tenant mismatch/);
    assert.throws(() => validateConfiguration({ ...config, name: 'synthetic-wrong-worker' }, name), /identity mismatch/);
    assert.throws(() => validateConfiguration({ ...config, route: 'veylet.com/*' }, name), /Unexpected deploy/);
    if (name.includes('production')) {
      for (const routes of [[], [{ pattern: 'veylet.com/*', zone_name: 'veylet.com' }], [{ pattern: 'https://*.veylet.com/*', zone_name: 'veylet.com' }], config.routes.map(route => ({ ...route, pattern: route.pattern.replace('https:', 'http:') })), config.routes.map(route => ({ ...route, custom_domain: true }))]) {
        assert.throws(() => validateConfiguration({ ...config, routes }, name), /two live HTTPS routes/);
      }
      const missing = { ...config }; delete missing.routes; assert.throws(() => validateConfiguration(missing, name), /Unexpected deploy/);
    } else assert.throws(() => validateConfiguration({ ...config, routes: [{ pattern: 'https://veylet.com/*', zone_name: 'veylet.com' }] }, name), /Unexpected deploy/);
  }
});

test('build preserves the complete reviewed public selection and is deterministic', async () => {
  const first = await verify();
  assert.deepEqual(first.totals, { sourceFiles: 354, outputFiles: 353, unchangedFiles: 311, transformedHtmlFiles: 42, omittedProviderFiles: 1 });
  const second = await build();
  assert.deepEqual(second, first);
  await verify();
  for (const name of ['account.js', 'supabase-public.js', 'studio.js', 'tour-player-v2.js', 'analytics.js', 'analytics-config.js', '.well-known/apple-app-site-association']) {
    assert.deepEqual(await readFile(join(adapterRoot, 'output/site', name)), await readFile(join(repositoryRoot, 'dist', name)), 'Retained integration/public contract bytes: ' + name);
  }
});

test('analytics transform removes only exact provider tags/claims and rejects drift', async () => {
  for (const name of release.analyticsTransform.privacyPaths) {
    const original = await readFile(join(repositoryRoot, 'dist', name));
    const output = transformAnalytics(name, original, release.analyticsTransform).body.toString();
    assert(!output.includes('Vercel Web Analytics'));
    assert(!output.includes('<strong>Page counts.</strong>'));
    assert(output.includes('Google Analytics 4 loads only'));
    assert(output.includes('Privacy choices'));
    assert.throws(() => transformAnalytics(name, Buffer.from(original.toString().replace('Page counts.', 'Unreviewed counts.')), release.analyticsTransform), /paragraph guard/);
  }
  assert.throws(() => transformAnalytics('index.html', Buffer.from('<script src="/insights.js?v=unexpected" defer></script>'), release.analyticsTransform), /loader guard/);
});

test('public source boundary rejects mutation, extra files, traversal and symlinks before output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'veylet-public-guard-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'index.html'), '<h1>Public fixture</h1>');
    await writeFile(join(root, 'vercel.json'), '{}');
    const sample = { files: [{ path: 'index.html', bytes: 23, sha256: sha256('<h1>Public fixture</h1>'), headerProfile: 0 }], observedHeaderProfiles: [headersFor('index.html')], vercelConfigSha256: sha256('{}') };
    sample.files[0].bytes = (await readFile(join(root, 'dist/index.html'))).length;
    await validateSource(root, sample);
    await writeFile(join(root, 'dist', 'index.html'), 'changed');
    await assert.rejects(validateSource(root, sample), /byte count changed/);
    await writeFile(join(root, 'dist', 'index.html'), '<h1>Public fixture</h1>');
    await writeFile(join(root, 'dist', 'unexpected.txt'), 'fixture');
    await assert.rejects(validateSource(root, sample), /selection changed/);
    await rm(join(root, 'dist', 'unexpected.txt'));
    await rm(join(root, 'dist', 'index.html'));
    await symlink(join(root, 'vercel.json'), join(root, 'dist', 'index.html'));
    await assert.rejects(validateSource(root, sample), /symlink rejected/);
    await assert.rejects(validateSource(root, { ...sample, files: [{ ...sample.files[0], path: '../private' }] }), /Invalid public allowlist/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('artifact verifier rejects tampered Worker/policy even when generated hashes are resealed', async () => {
  const root = join(adapterRoot, 'output');
  const originalManifest = await readFile(join(root, 'build-manifest.json'));
  for (const name of ['worker.mjs', 'routing-policy.json']) {
    const original = await readFile(join(root, name));
    try {
      let altered;
      if (name === 'worker.mjs') altered = Buffer.from(original.toString() + '\n// tampered artifact fixture\n');
      else {
        const alteredPolicy = JSON.parse(original);
        alteredPolicy.redirects['/apply'] = '//unexpected.example';
        altered = Buffer.from(JSON.stringify(alteredPolicy));
      }
      await writeFile(join(root, name), altered);
      const resealed = JSON.parse(originalManifest);
      resealed.generated.find(input => input.path === name).sha256 = sha256(altered);
      await writeFile(join(root, 'build-manifest.json'), JSON.stringify(resealed));
      await assert.rejects(verify(), name === 'worker.mjs' ? /differs from maintained source/ : /differs from reviewed rules/);
    } finally {
      await writeFile(join(root, name), original);
      await writeFile(join(root, 'build-manifest.json'), originalManifest);
    }
  }
  await verify();
});

test('missing or unknown modes remain restricted and origins are positive allowlists', async () => {
  for (const mode of [undefined, '', 'prod', 'PREVIEW', 'unknown', 'preview']) {
    const response = await call('/', { CF_DEPLOYMENT_ENV: mode });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
    assert.match(response.headers.get('Content-Security-Policy'), /form-action 'none'/);
    assert.match(response.headers.get('Content-Security-Policy'), /worker-src 'self' blob:/);
  }
  for (const [origin, mode] of [
    ['https://evil.example', 'production'], ['https://evil.example', 'preview'],
    ['https://preview-veylet-site-preview.yda31416.workers.dev', 'preview'],
    ['https://veylet.com.evil.example', 'production'], ['http://veylet.com', 'production'],
    ['https://veylet.com', undefined],
  ]) {
    const response = await worker.fetch(new Request(origin + '/'), { CF_DEPLOYMENT_ENV: mode });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  }
  for (const origin of ['https://veylet.com', 'https://www.veylet.com']) {
    const response = await worker.fetch(new Request(origin + '/'), { ...prod, ASSETS: { fetch: fetchAsset } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), null);
    assert.equal(response.headers.get('Content-Security-Policy'), null);
  }
});

test('clean canonical and policy redirects stay on the original trusted origin', async () => {
  for (const path of ['/privacy/', '/privacy/index.html', '/privacy.html', '/apply', '/pricing', '/prices', '//outside.example/', '///outside.example/index.html', '//outside.example.html', '/%2f%2foutside.example.html']) {
    const response = await call(path + '?kept=1');
    assert.equal(response.status, 308, path);
    const target = new URL(response.headers.get('Location'));
    assert.equal(target.origin, 'https://veylet.com', path);
    assert.equal(target.search, '?kept=1');
  }
  // Exercise policy-generated redirects, not just canonical input redirects.
  const original = policy.redirects['/apply'];
  try {
    for (const target of ['//outside.example/offer', '///outside.example/offer', '/\\outside.example/offer']) {
      policy.redirects['/apply'] = target;
      assert.equal(new URL((await call('/apply')).headers.get('Location')).origin, 'https://veylet.com');
    }
  } finally { policy.redirects['/apply'] = original; }
});

test('production framing, app association, studio privacy and v-query caches retain contracts', async () => {
  for (const path of ['/embed', '/tour']) {
    const response = await call(path);
    assert.equal(response.headers.get('X-Frame-Options'), null);
    assert.equal(response.headers.get('Content-Security-Policy'), 'frame-ancestors *');
  }
  const studio = await call('/studio');
  assert.equal(studio.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(studio.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(studio.headers.get('X-Frame-Options'), 'DENY');
  const aasa = await call('/.well-known/apple-app-site-association');
  assert.equal(aasa.headers.get('Content-Type'), 'application/json');
  assert.equal(aasa.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal((await call('/app/account')).headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal((await call('/style.css?v=')).headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal((await call('/style.css')).headers.get('Cache-Control'), 'public, max-age=14400, must-revalidate');
  assert.equal((await call('/robots.txt')).headers.get('X-Robots-Tag'), null);
  assert.equal(await (await call('/robots.txt', preview)).text(), 'User-agent: *\nDisallow: /\n');
});

test('unknown routes retain a complete 404 despite client validators/ranges', async () => {
  const expected = await readFile(join(adapterRoot, 'output/site/404.html'));
  for (const headers of [{}, { Range: 'bytes=0-7' }, { 'If-None-Match': '"test-public-etag"' }, { 'If-Modified-Since': 'Sun, 11 Oct 2026 00:00:00 GMT', 'If-Range': '"test-public-etag"', Range: 'bytes=0-7' }]) {
    const response = await call('/not-a-public-route', prod, { headers });
    assert.equal(response.status, 404);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  }
  for (const path of ['/cloudflare/worker.mjs', '/vercel.json', '/build-manifest.json', '/insights.js', '/_vercel/insights/script.js']) assert.equal((await call(path)).status, 404);
});

test('generated preview robots normalizes native partial and conditional metadata', async () => {
  for (const status of [206, 304]) {
    let observedRequest;
    const response = await worker.fetch(new Request('http://127.0.0.1:8896/robots.txt', { headers: { Range: 'bytes=0-7', 'If-Range': '"original"', 'If-None-Match': '"original"', 'If-Modified-Since': 'Sun, 11 Oct 2026 00:00:00 GMT' } }), { ...preview, ASSETS: { fetch: async request => {
      observedRequest = request;
      return new Response(status === 304 ? null : 'original', { status, statusText: status === 304 ? 'Not Modified' : 'Partial Content', headers: { 'Content-Range': 'bytes0-7/914', 'Accept-Ranges': 'bytes', 'Last-Modified': 'Sun, 11 Oct 2026 00:00:00 GMT', ETag: '"original"', 'Content-Length': '8' } });
    } } });
    for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) assert.equal(observedRequest.headers.get(name), null);
    assert.equal(response.status, 200);
    assert.equal(response.statusText, 'OK');
    assert.equal(await response.text(), 'User-agent: *\nDisallow: /\n');
    for (const name of ['Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag', 'Content-Length']) assert.equal(response.headers.get(name), null);
  }
});

test('public media ranges, conditional assets, HEAD and write denial work', async () => {
  const path = '/media/launch-reel.mp4';
  const bytes = await readFile(join(adapterRoot, 'output/site', path));
  const range = await call(path, prod, { headers: { Range: 'bytes=0-15' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
  assert.equal((await call(path, prod, { headers: { Range: 'bytes=999999999-' } })).status, 416);
  assert.equal((await call('/style.css', prod, { headers: { 'If-None-Match': '"test-public-etag"' } })).status, 304);
  const head = await call('/privacy', prod, { method: 'HEAD' });
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const path of ['/request', '/account', '/studio', '/api/private']) {
    const response = await call(path, preview, { method: 'POST', body: 'synthetic local request' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('Content-Security-Policy'), /form-action 'none'/);
  }
});

test('asset failure exposes no upstream body, cacheable error or indexable preview', async () => {
  for (const env of [prod, preview]) {
    for (const assetFailure of [async () => { throw new Error('private simulated failure'); }, async () => new Response('private simulated failure', { status: 500 })]) {
      const response = await worker.fetch(new Request((env === prod ? 'https://veylet.com' : 'http://127.0.0.1:8896') + '/privacy'), { ...env, ASSETS: { fetch: assetFailure } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
      assert.equal(await response.text(), 'Website temporarily unavailable');
    }
  }
});
