const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const validator = path.join(__dirname, '../scripts/verify-release-candidate.py');

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'veylet-public-candidate-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'candidate');
  const files = { 'dist/account/index.html': Buffer.from('page'), 'dist/account.js': Buffer.from('script'), 'vercel.json': Buffer.from('{}') };
  const hash = crypto.createHash('sha256');
  const manifest = {};
  for (const relative of Object.keys(files).sort()) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), files[relative]);
    manifest[relative] = crypto.createHash('sha256').update(files[relative]).digest('hex');
    hash.update(relative + '\0' + files[relative].length + '\0').update(files[relative]);
  }
  const receipt = { candidate: root, candidate_file_sha256: manifest, deployment_input_sha256: hash.digest('hex'), upload_file_count: 3, public_file_count: 2, upload_bytes: 12 };
  const receiptPath = path.join(temporary, 'receipt.json');
  const save = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  save();
  return { root, receipt, save, files, run: () => spawnSync('python3', [validator, receiptPath], { encoding: 'utf8' }) };
}

test('release digest orders complete relative names with script before same-prefix directory', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).deployment_input_sha256, f.receipt.deployment_input_sha256);
  const componentHash = crypto.createHash('sha256');
  for (const relative of ['dist/account/index.html', 'dist/account.js', 'vercel.json']) {
    componentHash.update(relative + '\0' + f.files[relative].length + '\0').update(f.files[relative]);
  }
  f.receipt.deployment_input_sha256 = componentHash.digest('hex'); f.save();
  assert.notEqual(f.run().status, 0);
});

test('release validator rejects changed bytes and unexpected public files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'dist/account.js'), 'edited');
  assert.match(f.run().stderr, /bytes do not match/);
  fs.writeFileSync(path.join(f.root, 'dist/account.js'), f.files['dist/account.js']);
  fs.writeFileSync(path.join(f.root, 'dist/unexpected.txt'), 'extra');
  assert.match(f.run().stderr, /inventory does not match/);
});

test('release validator permits only ignored root metadata and refuses symlinked input', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, '.vercel'));
  fs.writeFileSync(path.join(f.root, '.vercel/project.json'), '{}');
  assert.equal(f.run().status, 0);
  fs.unlinkSync(path.join(f.root, 'dist/account.js'));
  fs.symlinkSync('account/index.html', path.join(f.root, 'dist/account.js'));
  assert.match(f.run().stderr, /symlink/);
});
