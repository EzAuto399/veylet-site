#!/usr/bin/env node
// Share cards (Open Graph / Twitter) for the public marketing pages.
//
//   node scripts/share-cards/build.mjs            render every card, then point the page heads at the new bytes
//   node scripts/share-cards/build.mjs --check    render nothing; fail if a card or a page's ?v= is out of step
//   node scripts/share-cards/build.mjs --preview DIR   also write chat-style 400px previews into DIR
//
// Each card is a small HTML template here (card.css, fit.js) rendered at 1200x630 by a local
// headless Chrome, converted to an sRGB JPEG with macOS `sips`, and written to dist/media/share/.
// The page heads carry https://veylet.com/media/share/<card>.jpg?v=<first 16 hex of SHA-256>,
// the same fingerprint scripts/asset-versions.mjs uses. The /help index head is rendered by
// tests/help-articles.cjs, which fingerprints dist/media/share/help.jpg itself; rerun
// `node tests/help-articles.cjs --write` after rebuilding the help card.
// No network: templates load only files from this folder and dist/media.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assetHash } from '../asset-versions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'media/share');
const WIDTH = 1200, HEIGHT = 630, MAX_BYTES = 300 * 1024;
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';

// card -> the page whose head names it (null: the head is rendered elsewhere, see above).
export const CARDS = {
  home: 'index.html',
  offer: 'offer/index.html',
  start: 'start/index.html',
  guides: 'guides/index.html',
  help: null,
};

export const cardUrl = name => `https://veylet.com/media/share/${name}.jpg?v=${assetHash(readFileSync(join(OUT, name + '.jpg')))}`;

// Prefer Playwright's chrome-headless-shell (exits cleanly after --screenshot); the full Chrome app's
// new headless mode can linger after writing the file on macOS, so it is the fallback.
function chrome() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shells = existsSync(cache) ? readdirSync(cache).filter(dir => dir.startsWith('chromium_headless_shell-')).sort().reverse()
    .flatMap(dir => ['mac-arm64', 'mac-x64', 'mac'].map(arch => join(cache, dir, `chrome-headless-shell-${arch}`, 'chrome-headless-shell'))) : [];
  const candidates = [process.env.CHROME, ...shells, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) throw new Error('No local Chrome/Chromium found; set CHROME=/path/to/chrome');
  return found;
}

function run(bin, args) {
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, timeout: 60_000 });
}

function headless(profile, width, height, extra) {
  const mode = /headless-shell$/.test(chrome()) ? [] : ['--headless=new'];
  return [...mode, '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--force-device-scale-factor=1', '--force-color-profile=srgb',
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--virtual-time-budget=5000', ...extra];
}

export function render(file, png, { width = WIDTH, height = HEIGHT, fit = true } = {}) {
  const bin = chrome(), url = pathToFileURL(file).href;
  const profile = mkdtempSync(join(tmpdir(), 'veylet-card-'));
  try {
    if (fit) {
      const dom = run(bin, headless(profile, width, height, ['--dump-dom', url]));
      const status = (dom.match(/<html[^>]*\bdata-fit="([^"]*)"/) || [])[1];
      if (status !== 'ok') throw new Error(`${file}: ${status || 'fit check did not run'}`);
    }
    run(bin, headless(profile, width, height, [`--screenshot=${png}`, url]));
  } finally { rmSync(profile, { recursive: true, force: true }); }
  const size = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', png]);
  const [w, h] = [/pixelWidth: (\d+)/, /pixelHeight: (\d+)/].map(re => Number(size.match(re)[1]));
  if (w !== width || h !== height) throw new Error(`${png}: rendered ${w}x${h}, expected ${width}x${height}`);
}

export function toJpeg(png, jpg) {
  for (const quality of [86, 80, 72, 64]) {
    run('sips', ['-m', SRGB, '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), png, '--out', jpg]);
    if (statSync(jpg).size <= MAX_BYTES) return quality;
  }
  throw new Error(`${jpg}: over ${MAX_BYTES} bytes even at quality 64`);
}

function pointHead(name, page) {
  const file = join(DIST, page), url = cardUrl(name);
  const html = readFileSync(file, 'utf8');
  const updated = html.replace(new RegExp(`https://veylet\\.com/media/share/${name}\\.jpg\\?v=[a-f\\d]{16}`, 'g'), url);
  if (!updated.includes(url)) throw new Error(`${page}: no og:image for ${name}.jpg to update`);
  if (updated !== html) writeFileSync(file, updated);
  return updated !== html;
}

export function check() {
  const problems = [];
  for (const [name, page] of Object.entries(CARDS)) {
    const jpg = join(OUT, name + '.jpg');
    if (!existsSync(jpg)) { problems.push(`missing ${jpg}`); continue; }
    const info = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', jpg]);
    if (!/pixelWidth: 1200/.test(info) || !/pixelHeight: 630/.test(info) || !/format: jpeg/.test(info)) problems.push(`${name}.jpg is not a 1200x630 JPEG`);
    if (statSync(jpg).size > MAX_BYTES) problems.push(`${name}.jpg is over ${MAX_BYTES} bytes`);
    if (!page) continue;
    const html = readFileSync(join(DIST, page), 'utf8'), url = cardUrl(name);
    for (const tag of ['property="og:image"', 'name="twitter:image"']) {
      const found = (html.match(new RegExp(`<meta\\s+${tag}\\s+content="([^"]*)"`)) || [])[1];
      if (found !== url) problems.push(`${page}: ${tag} is ${found}, not ${url}`);
    }
  }
  return problems;
}

function preview(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [name, source] of Object.entries(CARDS)) {
    const head = readFileSync(join(DIST, source || `${name}/index.html`), 'utf8');
    const meta = key => (head.match(new RegExp(`<meta\\s+property="og:${key}"\\s+content="([^"]*)"`)) || [])[1] || '';
    const page = join(dir, `preview-${name}.html`);
    writeFileSync(page, readFileSync(join(HERE, 'preview.html'), 'utf8')
      .replaceAll('{{IMAGE}}', pathToFileURL(join(OUT, name + '.jpg')).href)
      .replaceAll('{{FONT}}', pathToFileURL(join(DIST, 'media')).href)
      .replaceAll('{{URL}}', meta('url')).replaceAll('{{TITLE}}', meta('title')).replaceAll('{{DESC}}', meta('description')));
    render(page, join(dir, `preview-${name}.png`), { width: 460, height: 700, fit: false });
    rmSync(page);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (!args.includes('--check')) {
    mkdirSync(OUT, { recursive: true });
    const work = mkdtempSync(join(tmpdir(), 'veylet-cards-'));
    try {
      for (const [name, page] of Object.entries(CARDS)) {
        const png = join(work, name + '.png'), jpg = join(OUT, name + '.jpg');
        render(join(HERE, name + '.html'), png);
        const quality = toJpeg(png, jpg);
        const changed = page ? pointHead(name, page) : false;
        console.log(`${name}.jpg  ${statSync(jpg).size} bytes  q${quality}  ${cardUrl(name)}${changed ? `  -> ${page}` : ''}`);
      }
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
  const at = args.indexOf('--preview');
  if (at >= 0) preview(args[at + 1]);
  const problems = check();
  for (const problem of problems) console.error('share card: ' + problem);
  if (problems.length) process.exit(1);
  console.log('share cards: ok');
}
