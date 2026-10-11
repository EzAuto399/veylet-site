import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { adapterRoot, repositoryRoot, inputNames, sha256, walkPublic, validateSource, transformAnalytics, policyFor } from './build.mjs';

export async function verify() {
  const release = JSON.parse(await readFile(join(adapterRoot, 'public-release.json'), 'utf8'));
  const source = await validateSource(repositoryRoot, release);
  const output = join(adapterRoot, 'output');
  const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, release.sourceCommit);
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
    assert(!config.routes && !config.route && !config.triggers && !config.secrets, 'No bound domains, routes, crons or secrets');
    assert.deepEqual(Object.keys(config.vars), ['CF_DEPLOYMENT_ENV'], 'No API/auth configuration added');
    assert.equal(config.compatibility_date, '2026-10-03');
    assert.equal(config.main, './output/worker.mjs');
    assert.equal(config.assets.directory, './output/site');
    assert.equal(config.assets.run_worker_first, true);
    assert.equal(config.assets.html_handling, 'none');
    assert.equal(config.assets.not_found_handling, 'none');
    assert.equal(config.preview_urls, false);
    if (configName.includes('production')) {
      assert.equal(config.vars.CF_DEPLOYMENT_ENV, 'production');
      assert.equal(config.workers_dev, false);
    } else assert.equal(config.vars.CF_DEPLOYMENT_ENV, 'preview');
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
