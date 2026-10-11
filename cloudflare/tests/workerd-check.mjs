// Actual local Worker/ASSETS HTTP checks. Only two fixed loopback addresses are
// used; HTTPS certificate verification is disabled solely for local workerd.
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { adapterRoot, sha256 } from '../build.mjs';
import { verify } from '../verify.mjs';

const manifest = await verify();
const policy = JSON.parse(await readFile(join(adapterRoot, 'output/routing-policy.json'), 'utf8'));
const previewCsp = "script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' blob:; form-action 'none'; object-src 'none'";
const receipts = [];
const logs = [];
let assertions = 0;
const equal = (actual, expected, note) => { assertions++; assert.equal(actual, expected, note); };
const bodyEqual = (actual, expected, note) => { assertions++; assert.deepEqual(actual, expected, note); };

function request(path, mode, options = {}) {
  const production = mode === 'production';
  const port = production ? 8897 : 8896;
  return new Promise((resolve, reject) => {
    const client = production ? https : http;
    const req = client.request({ hostname: '127.0.0.1', port, path, method: options.method || 'GET', rejectUnauthorized: !production,
      headers: { 'User-Agent': 'Mozilla/5.0 local-migration-proof', 'Accept-Encoding': 'identity', ...(production ? { Host: 'veylet.com' } : {}), ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}), ...options.headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('Local request timeout')));
    req.on('error', reject);
    req.end(options.body);
  });
}

async function server(mode, run) {
  const production = mode === 'production';
  const child = spawn(join(adapterRoot, 'node_modules/.bin/wrangler'), ['dev', '--local', '--config', 'wrangler.' + mode + '.jsonc', '--ip', '127.0.0.1', '--port', production ? '8897' : '8896', '--local-protocol', production ? 'https' : 'http'], {
    cwd: adapterRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Local workerd exited before ready');
      try { await request('/', mode); ready = true; break; } catch { await delay(100); }
    }
    assert(ready, 'Local workerd did not start within10seconds');
    await run(mode);
  } finally {
    child.kill('SIGTERM');
    const exit = new Promise(resolve => child.once('exit', resolve));
    await Promise.race([exit, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([exit, delay(1000)]); }
  }
}

function expectHeaders(response, asset, mode) {
  const profile = policy.profiles[asset.profile];
  for (const name of policy.headerNames) {
    let expected = profile[name];
    if (mode === 'preview' && name === 'x-robots-tag') expected = 'noindex, nofollow';
    if (mode === 'preview' && name === 'content-security-policy') expected = expected ? expected + '; ' + previewCsp : previewCsp;
    equal(response.headers[name] ?? null, expected, name + ' ' + asset.file + ' ' + mode);
  }
}

await server('preview', async mode => {
  for (const file of manifest.files) {
    const [route, asset] = Object.entries(policy.routes).find(([, item]) => item.file === file.path);
    const response = await request(route, mode);
    equal(response.status, 200, route);
    expectHeaders(response, asset, mode);
    if (route === '/robots.txt') equal(response.body.toString(), 'User-agent: *\nDisallow: /\n', 'preview robots');
    else equal(sha256(response.body), file.sha256, 'public output body ' + route);
  }
  const denied = await request('/', mode, { headers: { Host: 'evil.example' } });
  equal(denied.status, 403, 'unapproved preview origin');
  equal(denied.headers['x-robots-tag'], 'noindex, nofollow');
  for (const headers of [{ Range: 'bytes=0-7' }, { 'If-None-Match': '*' }, { 'If-Modified-Since': 'Sun, 11 Oct 2026 00:00:00 GMT', 'If-Range': '"original"', Range: 'bytes=0-7' }]) {
    const robots = await request('/robots.txt', mode, { headers });
    equal(robots.status, 200); equal(robots.body.toString(), 'User-agent: *\nDisallow: /\n');
    for (const name of ['content-range', 'accept-ranges', 'last-modified', 'etag']) equal(robots.headers[name] ?? null, null);
  }
  receipts.push({ mode, assets: manifest.files.length, matchingOutputBodies: 349, intentionalRobotsOverride: 1, fullRobotsValidatorRangeVariants: 3, unapprovedOriginStatus: denied.status });
});

await server('production', async mode => {
  // Canonical HTTPS Host is evaluated by real workerd, using the exact production
  // config. This is still loopback proof, not an external domain/deployment claim.
  for (const route of ['/', '/privacy', '/app/privacy', '/embed', '/tour', '/studio', '/app/account', '/account', '/auth/callback', '/offer', '/request', '/handoff', '/robots.txt', '/sitemap.xml', '/build-info.json', '/.well-known/apple-app-site-association', '/media/launch-reel.mp4']) {
    const asset = policy.routes[route];
    const response = await request(route, mode);
    equal(response.status, 200, route);
    expectHeaders(response, asset, mode);
    bodyEqual(response.body, await readFile(join(adapterRoot, 'output/site', asset.file)), 'production canonical body ' + route);
  }
  for (const path of ['/privacy/', '/privacy/index.html', '/privacy.html', '/apply', '/pricing', '/prices', '//outside.example/', '///outside.example/index.html', '//outside.example.html', '/%2f%2foutside.example.html', '/%5coutside.example.html']) {
    const response = await request(path + '?kept=1', mode);
    equal(response.status, 308, path);
    equal(new URL(response.headers.location).origin, 'https://veylet.com', 'same-origin redirect ' + path);
    equal(new URL(response.headers.location).search, '?kept=1');
  }
  const redirectHead = await request('/privacy/', mode, { method: 'HEAD' });
  equal(redirectHead.status, 308); equal(redirectHead.body.length, 0);
  const fallback = await request('/404', mode);
  for (const headers of [{}, { Range: 'bytes=0-7' }, { 'If-None-Match': fallback.headers.etag }, { 'If-Modified-Since': 'Sun, 11 Oct 2026 00:00:00 GMT', 'If-Range': fallback.headers.etag, Range: 'bytes=0-7' }]) {
    const response = await request('/not-a-public-route', mode, { headers });
    equal(response.status, 404); bodyEqual(response.body, fallback.body, 'complete unknown404');
    equal(response.headers['content-length'] ? Number(response.headers['content-length']) : response.body.length, fallback.body.length);
  }
  for (const route of ['/cloudflare/worker.mjs', '/vercel.json', '/build-manifest.json', '/insights.js', '/_vercel/insights/script.js', '/.env']) {
    const response = await request(route, mode); equal(response.status, 404); bodyEqual(response.body, fallback.body, 'public input exclusion ' + route);
  }
  const css = await request('/style.css', mode);
  const conditional = await request('/style.css', mode, { headers: { 'If-None-Match': css.headers.etag } });
  equal(conditional.status, 304); equal(conditional.body.length, 0);
  equal((await request('/style.css?v=', mode)).headers['cache-control'], 'public, max-age=31536000, immutable');
  const media = await readFile(join(adapterRoot, 'output/site/media/launch-reel.mp4'));
  for (const [range, start, end] of [['bytes=0-15', 0, 15], ['bytes=-16', media.length - 16, media.length - 1], ['bytes=16-', 16, media.length - 1]]) {
    const response = await request('/media/launch-reel.mp4', mode, { headers: { Range: range } });
    equal(response.status, 206); equal(response.headers['content-range'], `bytes ${start}-${end}/${media.length}`); bodyEqual(response.body, media.subarray(start, end + 1));
  }
  equal((await request('/media/launch-reel.mp4', mode, { headers: { Range: 'bytes=999999999-' } })).status, 416);
  equal((await request('/media/launch-reel.mp4', mode, { headers: { Range: 'bytes=0-15', 'If-Range': '"not-current"' } })).status, 200);
  const head = await request('/privacy', mode, { method: 'HEAD' }); equal(head.status, 200); equal(head.body.length, 0);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await request('/request', mode, { method, body: 'synthetic local proof' }); equal(response.status, 405, 'write method ' + method); equal(response.headers.allow, 'GET, HEAD'); equal(response.headers['cache-control'], 'no-store');
  }
  const denied = await request('/', mode, { headers: { Host: 'evil.example' } }); equal(denied.status, 403); equal(denied.headers['x-robots-tag'], 'noindex, nofollow');
  receipts.push({ mode, canonicalHttpsHost: 'veylet.com', publicRoutes: 17, canonicalRedirects: 11, complete404Variants: 4, excludedPaths: 6, mediaRanges: 3, conditionalStatus: 304, forbiddenMethods: 4, unapprovedOriginStatus: denied.status });
});

await mkdir(join(adapterRoot, 'verification'), { recursive: true });
const report = { checkedAt: new Date().toISOString(), proof: 'Actual local workerd and ASSETS, pinned Wrangler4.143.0, exact preview/production config; loopback only', sourceCommit: manifest.sourceCommit, manifestSha256: sha256(await readFile(join(adapterRoot, 'output/build-manifest.json'))), assertions, receipts, stoppedServers: [8896, 8897], limits: ['No hosted deployment, browser-rendered acceptance, positive auth/payment/capture integration or installed-device universal-link validation'] };
await writeFile(join(adapterRoot, 'verification/local-workerd.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(join(adapterRoot, 'verification/local-workerd.log'), logs.join(''));
console.log(JSON.stringify(report));
