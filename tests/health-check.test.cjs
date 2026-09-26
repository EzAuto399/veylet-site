const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

async function check(aasa) {
  const seen = new Set();
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname; seen.add(route);
    if (route === '/.well-known/apple-app-site-association' && aasa !== undefined) {
      res.setHeader('Content-Type', 'text/html'); res.end(aasa); return;
    }
    let file = path.resolve(dist, '.' + route);
    if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(404).end(); return; }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end('Missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('bash', ['scripts/health-check.sh', origin], { cwd: root });
      let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      child.once('error', reject); child.once('close', code => resolve({ code, output }));
    });
    return { ...result, seen };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('health check covers app entry pages, unsubscribe and real universal-link JSON', async () => {
  const result = await check();
  assert.equal(result.code, 0, result.output);
  for (const route of ['/app/terms', '/app/privacy', '/app/account', '/app/support', '/unsubscribe', '/.well-known/apple-app-site-association']) {
    assert.ok(result.seen.has(route), route);
  }
  assert.match(result.output, /app links: 200 JSON with applinks details/);
});

test('an HTML fallback with HTTP 200 fails universal-link health', async () => {
  const result = await check('<html>Not the app links document</html>');
  assert.equal(result.code, 1);
  assert.match(result.output, /FAIL\s+app links:/);
});
