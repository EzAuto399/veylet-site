'use strict';
// The shared page library (dist/site-lib.js): every page script uses these
// copies instead of its own, so they get a test of their own.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source } = require('./site-lib.cjs');

const load = (extra = {}) => {
  const window = {};
  vm.runInNewContext(source, { window, document: { createElement: tag => ({ tag, className: '', textContent: '' }) }, setTimeout, clearTimeout, ...extra });
  return window.VeyletLib;
};

test('settled resolves value, error and a cleared timeout', async () => {
  const lib = load();
  const ok = await lib.settled(Promise.resolve(42));
  assert.equal(ok.value, 42); assert.equal(ok.error, undefined); assert.equal(ok.timedOut, undefined);
  const failure = new Error('no');
  assert.equal((await lib.settled(Promise.reject(failure))).error, failure);
  assert.equal((await lib.settled(new Promise(() => {}), 5)).timedOut, true);
});

test('failed treats a missing, timed-out or erroring answer as failed', async () => {
  const lib = load();
  assert.equal(lib.failed(null), true);
  assert.equal(lib.failed(undefined), true);
  assert.equal(lib.failed({ timedOut: true }), true);
  assert.equal(lib.failed({ error: new Error('x') }), true);
  assert.equal(lib.failed({ value: { error: { message: 'x' } } }), true);
  assert.equal(lib.failed({ value: { data: [] } }), false);
  assert.equal(lib.failed({}), false);
});

test('missingFunction knows the backend-without-function answers', () => {
  const lib = load();
  assert.equal(lib.missingFunction({ code: 'PGRST202' }), true);
  assert.equal(lib.missingFunction({ code: '42883' }), true);
  assert.equal(lib.missingFunction({ message: 'Could not find the function public.x in the schema cache' }), true);
  assert.equal(lib.missingFunction({ value: { error: { code: 'PGRST202' } } }), true);
  assert.equal(lib.missingFunction({ error: { code: 'PGRST202' } }), true);
  assert.equal(lib.missingFunction({ code: 'PGRST116' }), false);
  assert.equal(lib.missingFunction({ message: 'permission denied' }), false);
  assert.equal(lib.missingFunction(null), false);
});

test('plural and element keep the single copies the pages shared', () => {
  const lib = load();
  assert.equal(lib.plural(1, 'walkthrough'), '1 walkthrough');
  assert.equal(lib.plural(0, 'walkthrough'), '0 walkthroughs');
  assert.equal(lib.plural(3, 'stop'), '3 stops');
  const el = lib.element('span', 'note', 'hello');
  assert.equal(el.tag, 'span');
  assert.equal(el.className, 'note');
  assert.equal(el.textContent, 'hello');
  const bare = lib.element('div');
  assert.equal(bare.className, '');
  assert.equal(bare.textContent, '');
});

test('client builds the one Supabase options block each page used', () => {
  const calls = [];
  const client = {};
  const window = { VEYLET_SUPABASE: { url: 'https://x.invalid', anonKey: 'key' }, supabase: { createClient: (...args) => { calls.push(args); return client; } } };
  vm.runInNewContext(source, { window });
  assert.equal(window.VeyletLib.client({ detectSessionInUrl: true }), client);
  assert.equal(calls[0][0], 'https://x.invalid');
  assert.equal(calls[0][1], 'key');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
});
