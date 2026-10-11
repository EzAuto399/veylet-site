import { readFile, writeFile, mkdir, rm, lstat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { headerNames, headersFor, routeFor, redirects } from './hosting-policy.mjs';

export const adapterRoot = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = dirname(adapterRoot);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const inputNames = [
  'build.mjs', 'verify.mjs', 'worker.mjs', 'hosting-policy.mjs', 'public-release.json',
  'package.json', 'package-lock.json', 'wrangler.preview.jsonc', 'wrangler.production.jsonc', 'live-release.json',
];

export async function walkPublic(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Public symlink rejected');
    if (entry.isDirectory()) files.push(...await walkPublic(join(root, entry.name), path + '/'));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Public special file rejected');
  }
  return files.sort();
}

export async function validateSource(root, release) {
  const expected = release.files.map(file => file.path).sort();
  assert.equal(new Set(expected).size, expected.length, 'Duplicate public allowlist path');
  for (const path of expected) {
    assert(!path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.' || !part), 'Invalid public allowlist path');
    assert(!path.includes('\\'), 'Backslash rejected in public allowlist');
  }
  assert.deepEqual(await walkPublic(join(root, 'dist')), expected, 'Public source selection changed; review and freeze the new release first');
  const bytes = new Map();
  for (const file of release.files) {
    const path = join(root, 'dist', file.path);
    assert((await lstat(path)).isFile(), 'Only regular public files may be copied');
    const body = await readFile(path);
    assert.equal(body.length, file.bytes, 'Public source byte count changed: ' + file.path);
    assert.equal(sha256(body), file.sha256, 'Public source hash changed: ' + file.path);
    assert.deepEqual(headersFor(file.path), release.observedHeaderProfiles[file.headerProfile], 'Effective hosting policy changed: ' + file.path);
    bytes.set(file.path, body);
  }
  assert.equal(sha256(await readFile(join(root, 'vercel.json'))), release.vercelConfigSha256, 'Original Vercel policy changed');
  return bytes;
}

export function transformAnalytics(file, body, transform) {
  if (file === transform.omittedAsset) return { body: null, changes: ['omit Vercel-only insights loader asset'] };
  if (!file.endsWith('.html')) return { body, changes: [] };
  let text = body.toString('utf8');
  const changes = [];
  const loaderExpected = transform.loaderPaths.includes(file);
  const loaderCount = text.split(transform.loaderTag).length - 1;
  assert.equal(loaderCount, loaderExpected ? 1 : 0, 'Vercel loader guard changed: ' + file);
  if (loaderExpected) {
    text = text.replace(transform.loaderTag, '');
    changes.push('remove one exact Vercel insights script tag');
  }
  const privacyExpected = transform.privacyPaths.includes(file);
  const privacyCount = text.split(transform.privacyParagraph).length - 1;
  assert.equal(privacyCount, privacyExpected ? 1 : 0, 'Vercel privacy paragraph guard changed: ' + file);
  if (privacyExpected) {
    text = text.replace(transform.privacyParagraph, '');
    changes.push('remove exact discontinued Vercel page-count paragraph');
  }
  assert(!text.includes('/insights.js') && !text.includes('/_vercel/insights/') && !text.includes('Vercel Web Analytics'), 'Unreviewed Vercel analytics reference: ' + file);
  return { body: changes.length ? Buffer.from(text) : body, changes };
}

export function policyFor(files) {
  const policy = { basis: 'Derived effective policy, reconciled against all frozen public headers', headerNames, profiles: [], routes: {}, redirects };
  for (const file of files) {
    const headers = headersFor(file.path);
    let profile = policy.profiles.findIndex(value => JSON.stringify(value) === JSON.stringify(headers));
    if (profile === -1) { profile = policy.profiles.length; policy.profiles.push(headers); }
    const route = routeFor(file.path);
    assert(!Object.hasOwn(policy.routes, route), 'Clean route collision');
    policy.routes[route] = { file: file.path, profile, bytes: file.bytes };
  }
  return policy;
}

export async function build() {
  const release = JSON.parse(await readFile(join(adapterRoot, 'public-release.json'), 'utf8'));
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'dist/'], { cwd: repositoryRoot }).toString().split('\0').filter(Boolean).map(path => path.slice(5)).sort();
  assert.deepEqual(tracked, release.files.map(file => file.path).sort(), 'Tracked public release changed');
  const source = await validateSource(repositoryRoot, release);
  const output = join(adapterRoot, 'output');
  // Only this adapter-owned generated directory is replaced. Never write dist/.
  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, 'site'), { recursive: true });
  const files = [];
  const omitted = [];
  for (const file of release.files) {
    const result = transformAnalytics(file.path, source.get(file.path), release.analyticsTransform);
    if (result.body === null) { omitted.push({ path: file.path, sourceSha256: file.sha256, changes: result.changes }); continue; }
    const target = join(output, 'site', file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, result.body);
    files.push({ path: file.path, bytes: result.body.length, sha256: sha256(result.body), sourceSha256: file.sha256, changes: result.changes });
  }
  const policy = policyFor(files);
  await writeFile(join(output, 'routing-policy.json'), JSON.stringify(policy, null, 2) + '\n');
  await writeFile(join(output, 'worker.mjs'), await readFile(join(adapterRoot, 'worker.mjs')));
  const inputs = [];
  for (const path of inputNames) inputs.push({ path, sha256: sha256(await readFile(join(adapterRoot, path))) });
  const generated = [];
  for (const path of ['worker.mjs', 'routing-policy.json']) generated.push({ path, sha256: sha256(await readFile(join(output, path))) });
  const manifest = {
    schemaVersion: 1, sourceCommit: release.sourceCommit,
    verifiedPublicDeployment: release.verifiedPublicDeployment,
    liveReleaseContext: JSON.parse(await readFile(join(adapterRoot, 'live-release.json'), 'utf8')),
    wranglerVersion: '4.143.0', compatibilityDate: '2026-10-03', inputs, generated, files, omitted,
    analytics: 'Vercel Web Analytics discontinued on this Cloudflare output; consent-gated Google Analytics unchanged; no replacement analytics added',
    totals: { sourceFiles: release.files.length, outputFiles: files.length, unchangedFiles: files.filter(file => !file.changes.length).length, transformedHtmlFiles: files.filter(file => file.changes.length).length, omittedProviderFiles: omitted.length },
  };
  await writeFile(join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await build();
  console.log(JSON.stringify({ sourceCommit: result.sourceCommit, ...result.totals }));
}
