#!/usr/bin/env node
/*
 * Write dist/build-info.json so any deployed page can name the revision it is
 * serving. Run before a deploy: node scripts/write-build-info.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const sha = process.env.VERCEL_GIT_COMMIT_SHA || git('rev-parse HEAD') || 'unknown';
const short = sha === 'unknown' ? 'unknown' : sha.slice(0, 7);
const dirty = git('status --porcelain') !== '';
const pkgPath = join(root, 'package.json');
let version = '0.0.0';
try {
  version = JSON.parse(readFileSync(pkgPath, 'utf8')).version || version;
} catch {
  /* no package.json is fine */
}

const info = {
  name: 'veylet-site',
  version,
  commit: sha,
  shortCommit: short,
  dirty,
  builtAt: new Date().toISOString(),
  environment: process.env.VERCEL_ENV || (process.env.VERCEL ? 'preview' : 'local'),
};

writeFileSync(join(root, 'dist', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`build-info.json → ${short}${dirty ? ' (dirty tree)' : ''} ${info.environment}`);
