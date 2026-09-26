'use strict';
// Run the shipped SDK, with every network request captured by a synthetic transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const SDK = 'vendor/supabase-js-2.116.0.min.js';
const PUB = 'sb_publishable_synthetic_viewer';
const jwt = role => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role, aud: 'authenticated', sub: '00000000-0000-4000-8000-000000000001',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString('base64url'),
  Buffer.from('synthetic-signature').toString('base64url'),
].join('.');
const ANON = jwt('anon');
const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function load({ key = PUB, url = 'https://fixture.invalid', helper = true } = {}) {
  const requests = [], creations = [];
  const transport = async (input, init = {}) => {
    const url = String(input.url || input);
    const headers = new Headers(init.headers || input.headers);
    requests.push({ url, headers, body: init.body });
    if (url.includes('/auth/v1/user')) return Response.json({ id: '00000000-0000-4000-8000-000000000001' });
    if (url.includes('/storage/v1/')) return new Response('synthetic package');
    return Response.json([]);
  };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
  const page = { URL, URLSearchParams, Headers, Request, Response, Blob, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('Realtime is outside this fixture'); } },
    AbortController, crypto: webcrypto, performance, setTimeout, clearTimeout, setInterval, clearInterval,
    atob, btoa, console, fetch: transport, navigator: { onLine: true }, document,
    addEventListener() {}, removeEventListener() {},
    VEYLET_SUPABASE: { url, anonKey: key } };
  page.window = page;
  const context = vm.createContext(page);
  vm.runInContext(read(SDK), context, { filename: SDK });
  const createClient = page.supabase.createClient;
  page.supabase.createClient = (...args) => { creations.push(args); return createClient(...args); };
  if (helper) vm.runInContext(read('public-rpc.js'), context);
  vm.runInContext(read('tour-player.js'), context);
  return { page, player: page.VeyletPlayer, requests, creations };
}

async function useViewer(client) {
  const reply = await client.rpc('lookup_tour_share', { p_token: 'synthetic-share-token' });
  assert.equal(reply.error, null);
  const download = await client.storage.from('tours').download('synthetic/tour.zip');
  assert.equal(download.error, null);
}

test('shipped SDK public RPC and storage use publishable apikey without Bearer', async () => {
  const x = load();
  await useViewer(x.player.clientFor(AUTH));
  assert.equal(x.requests.length, 2);
  for (const request of x.requests) {
    assert.equal(request.headers.get('apikey'), PUB);
    assert.equal(request.headers.get('Authorization'), null);
  }
});

test('shipped SDK keeps the legacy anon JWT on public RPC and storage', async () => {
  const x = load({ key: ANON });
  await useViewer(x.player.clientFor(AUTH));
  assert.equal(x.requests.length, 2);
  for (const request of x.requests) {
    assert.equal(request.headers.get('apikey'), ANON);
    assert.equal(request.headers.get('Authorization'), 'Bearer ' + ANON);
  }
});

test('shipped SDK owner preview retains a real session JWT with either public key type', async () => {
  for (const key of [PUB, ANON]) {
    const x = load({ key }), accessToken = jwt('authenticated');
    const values = new Map();
    const storage = { getItem: name => values.get(name) || null, setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) };
    const client = x.player.clientFor({ ...AUTH, persistSession: true, storage });
    assert.equal((await client.auth.setSession({ access_token: accessToken, refresh_token: 'synthetic-refresh-token' })).error, null);
    assert.equal((await client.auth.getSession()).data.session.access_token, accessToken);
    await useViewer(client);
    assert.equal(x.requests.length, 3);
    for (const request of x.requests) {
      assert.equal(request.headers.get('apikey'), key);
      assert.equal(request.headers.get('Authorization'), 'Bearer ' + accessToken);
    }
  }
});

test('missing helper and rejected credential shapes stop before SDK construction or RPC', async () => {
  for (const configuration of [
    { helper: false }, ...[jwt('service_role'), jwt('authenticated'), jwt(null),
      'sb_secret_synthetic', 'bad-key', PUB + '\nheader', '', null].map(key => ({ key })),
  ]) {
    const x = load(configuration);
    assert.ok(x.player.clientFor(AUTH) === null, 'rejected configuration must not create a client');
    x.page.supabase = undefined;
    let sdkLoads = 0;
    x.player.loadScript = async () => { sdkLoads++; throw new Error('must not load SDK'); };
    let resolved = false;
    await x.player.boot({ els: { title: {}, body: {}, status: {}, frame: {}, stage: {} }, auth: AUTH,
      resolve: async () => { resolved = true; } });
    assert.equal(resolved, false);
    assert.equal(sdkLoads, 0);
    assert.equal(x.creations.length, 0);
    assert.equal(x.requests.length, 0);
  }
});

test('malformed project configuration stops before SDK construction', () => {
  for (const url of ['', null, 'not-a-url', 'http://fixture.invalid', 'https://user@fixture.invalid',
    'https://fixture.invalid/rest/v1', 'https://fixture.invalid?token=synthetic', 'https://fixture.invalid#x', 'https://fixture.invalid\n']) {
    const x = load({ url });
    assert.equal(x.player.clientFor(AUTH), null);
    assert.equal(x.creations.length, 0);
    assert.equal(x.requests.length, 0);
  }
});

test('cached client is bound to its validated project, key, and auth options', async () => {
  for (const mutate of [
    x => { x.page.VEYLET_SUPABASE.url = 'https://other-project.invalid'; },
    x => { x.page.VEYLET_SUPABASE.anonKey = 'sb_publishable_other_project'; },
    x => { x.page.VEYLET_SUPABASE.anonKey = jwt('service_role'); },
    x => { x.page.VeyletPublicRPC = undefined; },
  ]) {
    const x = load(), client = x.player.clientFor(AUTH);
    assert.equal(x.player.clientFor({ ...AUTH }), client);
    mutate(x);
    assert.ok(x.player.clientFor(AUTH) === null, 'changed configuration must not reuse a client: ' + mutate);
    // A previously retained reference must not send after configuration changes either.
    const reply = await client.rpc('lookup_tour_share', { p_token: 'synthetic-share-token' });
    assert.ok(reply.error);
    assert.equal(x.creations.length, 1);
    assert.equal(x.requests.length, 0);
  }
  const x = load();
  x.player.clientFor({ ...AUTH, persistSession: true });
  assert.equal(x.player.clientFor(AUTH), null);
  assert.equal(x.creations.length, 1);
  assert.equal(x.requests.length, 0);
});

test('release clears cache binding so a new project can create its own client', async () => {
  const x = load(), first = x.player.clientFor(AUTH);
  await x.player.releaseClient();
  x.page.VEYLET_SUPABASE.url = 'https://other-project.invalid';
  const second = x.player.clientFor(AUTH);
  assert.notEqual(second, first);
  await useViewer(second);
  assert.equal(x.creations.length, 2);
  assert.ok(x.requests.every(request => request.url.startsWith('https://other-project.invalid/')));
});

test('every production viewer entry point loads the pinned helper before the player', () => {
  const version = createHash('sha256').update(read('public-rpc.js')).digest('hex').slice(0, 16);
  for (const file of ['tour/index.html', 'handoff/index.html', 'embed/index.html', 'play/index.html']) {
    const html = read(file), helper = html.indexOf('/public-rpc.js?v=' + version);
    assert.ok(helper >= 0 && helper < html.indexOf('/tour-player.js?'), file);
  }
});
