#!/usr/bin/env node
/*
 * Write dist/build-info.json so any deployed page can name the revision it is
 * serving. Run before a deploy: node scripts/write-build-info.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionAssets } from './asset-versions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// Resolve dependency fingerprints before identifying the final public bytes.
// Repeated builds reuse URLs; changing a dependency also versions its loader.
const assetVersions = versionAssets(join(root, 'dist'));

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

// A dirty checkout's commit alone cannot identify the served candidate.
// Fingerprint only the public distribution, excluding this self-referential file.
const publicRoot = join(root, 'dist');
function filesIn(folder, prefix = '') {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.')) return [];
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return filesIn(join(folder, entry.name), relative + '/');
    return entry.isFile() && relative !== 'build-info.json' ? [relative] : [];
  });
}
const publicFiles = filesIn(publicRoot).sort();
const content = createHash('sha256');
let publicBytes = 0;
for (const path of publicFiles) {
  const bytes = readFileSync(join(publicRoot, path));
  publicBytes += bytes.length;
  content.update(path + '\0' + bytes.length + '\0').update(bytes);
}
info.publicContentSha256 = content.digest('hex');
info.publicFileCount = publicFiles.length;
info.publicBytes = publicBytes;
info.assetVersions = assetVersions.versions;

writeFileSync(join(root, 'dist', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`build-info.json → ${short}${dirty ? ' (dirty tree)' : ''} ${info.environment}`);
console.log(`asset versions → ${Object.keys(assetVersions.versions).length} JS/CSS files, ${assetVersions.changedFiles.length} files updated`);
