'use strict';
/*
 * dist/app/terms and dist/app/privacy are generated from the public /terms and
 * /privacy pages by scripts/app-legal.cjs; this test holds dist to that source.
 * Run `node scripts/app-legal.cjs --write` (or scripts/write-build-info.mjs,
 * which regenerates them) after editing either public page.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('../scripts/app-legal.cjs');

const DIST = path.join(__dirname, '../dist');

test('dist/app/terms and dist/app/privacy are exactly what scripts/app-legal.cjs renders (run it with --write after editing)', () => {
  for (const [file, html] of Object.entries(render())) {
    assert.equal(fs.readFileSync(path.join(DIST, file), 'utf8'), html, `dist/${file} is stale; run node scripts/app-legal.cjs --write`);
  }
});
