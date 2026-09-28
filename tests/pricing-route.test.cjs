const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 29 September 2026: people and AI assistants look for prices at /pricing; the offer page is /offer.
test('/pricing and /prices send readers to the offer page, permanently', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  for (const source of ['/pricing', '/prices']) {
    const rule = (config.redirects || []).find((entry) => entry.source === source);
    assert.ok(rule, `${source} has a redirect`);
    assert.deepEqual(rule, { source, destination: '/offer', permanent: true });
  }
  // No page of its own competes with the redirect.
  assert.ok(!fs.existsSync(path.join(__dirname, '../dist/pricing')), 'no dist/pricing page');
});
