import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { adapterRoot, repositoryRoot, inputNames, sha256, walkPublic, validateSource, transformAnalytics, policyFor } from './build.mjs';

export const productionRoutes = [
  { pattern: 'https://veylet.com/*', zone_name: 'veylet.com' },
  { pattern: 'https://www.veylet.com/*', zone_name: 'veylet.com' },
];
export function validateConfiguration(config, name) {
  assert(['wrangler.preview.jsonc', 'wrangler.production.jsonc'].includes(name));
  const production = name === 'wrangler.production.jsonc';
  const keys = ['$schema', 'name', 'account_id', 'compatibility_date', 'main', 'workers_dev', 'preview_urls', 'vars', 'assets', ...(production ? ['routes'] : [])];
  assert.deepEqual(Object.keys(config).sort(), keys.sort(), 'Unexpected deploy configuration: no custom domains, crons, secrets or app bindings');
  assert.equal(config.account_id, '195cf1d6da99ca2d1e64e0069e0d87c6', 'Cloudflare tenant mismatch');
  assert.equal(config.name, production ? 'veylet-site' : 'veylet-site-preview', 'Worker identity mismatch');
  assert.equal(config.compatibility_date, '2026-10-03'); assert.equal(config.main, './output/worker.mjs');
  assert.deepEqual(config.assets, { directory: './output/site', binding: 'ASSETS', run_worker_first: true, html_handling: 'none', not_found_handling: 'none' }, 'Only reviewed Static Assets are allowed');
  assert.deepEqual(config.vars, { CF_DEPLOYMENT_ENV: production ? 'production' : 'preview' }, 'No API/auth configuration added');
  assert.equal(config.workers_dev, !production); assert.equal(config.preview_urls, false);
  if (production) assert.deepEqual(config.routes, productionRoutes, 'Preserve exactly the two live HTTPS routes and retained HTTP origin');
}

export async function verify() {
  const release = JSON.parse(await readFile(join(adapterRoot, 'public-release.json'), 'utf8'));
  const source = await validateSource(repositoryRoot, release);
  const output = join(adapterRoot, 'output');
  const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, release.sourceCommit);
  const liveContext = JSON.parse(await readFile(join(adapterRoot, 'live-release.json'), 'utf8'));
  assert.deepEqual(manifest.liveReleaseContext, liveContext, 'Live release context changed');
  assert.deepEqual(liveContext.routes, productionRoutes); assert.equal(liveContext.workerName, 'veylet-site'); assert.equal(liveContext.accountId, '195cf1d6da99ca2d1e64e0069e0d87c6');
  assert.deepEqual(manifest.inputs.map(input => input.path), inputNames, 'Deployment input list changed');
  for (const input of manifest.inputs) assert.equal(sha256(await readFile(join(adapterRoot, input.path))), input.sha256, 'Stale deployment input: ' + input.path);
  assert.deepEqual(manifest.generated.map(input => input.path), ['worker.mjs', 'routing-policy.json']);
  for (const input of manifest.generated) assert.equal(sha256(await readFile(join(output, input.path))), input.sha256, 'Changed generated input: ' + input.path);
  assert.deepEqual(await readFile(join(output, 'worker.mjs')), await readFile(join(adapterRoot, 'worker.mjs')), 'Generated Worker differs from maintained source');
  const expected = release.files.filter(file => file.path !== release.analyticsTransform.omittedAsset).map(file => file.path).sort();
  assert.deepEqual(await walkPublic(join(output, 'site')), expected, 'Unexpected public output');
  assert.deepEqual(manifest.files.map(file => file.path).sort(), expected, 'Artifact allowlist changed');
  for (const file of manifest.files) {
    const actual = await readFile(join(output, 'site', file.path));
    const transformed = transformAnalytics(file.path, source.get(file.path), release.analyticsTransform);
    assert.deepEqual(actual, transformed.body, 'Output differs from declared provider-only transform: ' + file.path);
    assert.equal(sha256(actual), file.sha256, 'Public output hash changed: ' + file.path);
    assert.equal(actual.length, file.bytes);
    assert.equal(file.sourceSha256, sha256(source.get(file.path)));
    assert.deepEqual(file.changes, transformed.changes);
  }
  assert.deepEqual(JSON.parse(await readFile(join(output, 'routing-policy.json'), 'utf8')), policyFor(manifest.files), 'Generated hosting policy differs from reviewed rules');
  for (const configName of ['wrangler.preview.jsonc', 'wrangler.production.jsonc']) {
    const config = JSON.parse(await readFile(join(adapterRoot, configName), 'utf8'));
    validateConfiguration(config, configName);
  }
  const packageJson = JSON.parse(await readFile(join(adapterRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(adapterRoot, 'package-lock.json'), 'utf8'));
  assert.equal(packageJson.devDependencies.wrangler, '4.143.0');
  assert.equal(lock.packages['node_modules/wrangler'].version, '4.143.0');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verify();
  console.log(JSON.stringify({ verified: true, ...result.totals }));
}
