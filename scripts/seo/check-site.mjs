#!/usr/bin/env node
// Usage: node scripts/seo/check-site.mjs [path/to/dist]
//
// Local static SEO audit of a built `dist/` — no network access, no external
// dependencies (Node built-ins only). For every HTML page it reports title,
// meta description, canonical, meta robots, H1 count, Open Graph presence and
// JSON-LD validity; it also checks internal <a href> links against what
// actually exists on disk (respecting Vercel `cleanUrls`), and cross-checks
// sitemap.xml against robots.txt and each page's own meta robots tag.
//
// Exit code: non-zero ONLY on hard errors — a broken internal link, a JSON-LD
// block that fails to parse, or a sitemap URL that is missing or noindex.
// Everything else (weak titles, missing canonical, pages absent from the
// sitemap, a sitemap URL blocked by robots.txt, etc.) is printed as a
// warning and does not affect the exit code.
//
// This intentionally does NOT duplicate scripts/check-asset-versions.mjs
// (which already verifies CSS/JS/versioned asset bytes) — link checking here
// is scoped to <a href> page/anchor links, not <link>/<script>/<img> assets.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://veylet.com';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(process.argv[2] || path.join(scriptDir, '..', '..', 'dist'));

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  console.error(`check-site: no such directory: ${distDir}`);
  process.exit(2);
}

const hardErrors = [];
const warnings = [];
function fail(msg) { hardErrors.push(msg); }
function warn(msg) { warnings.push(msg); }

// ---------------------------------------------------------------- helpers --

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Parses attributes out of a single tag string, e.g. `<meta name="x" content='y'>`.
function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function walkHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtmlFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Maps a dist/ file path to the clean-URL route Vercel would serve it at.
// 404.html is special (Vercel's not-found page, not a normal route) -> null.
function routeForFile(file) {
  const rel = path.relative(distDir, file).split(path.sep).join('/');
  if (rel === '404.html') return null;
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'/index.html'.length);
  if (rel.endsWith('.html')) return '/' + rel.slice(0, -'.html'.length);
  return null;
}

// Resolves a clean-URL pathname (leading slash, no query/hash) to a file on
// disk, respecting vercel.json's cleanUrls: /offer -> dist/offer/index.html
// or dist/offer.html; a path with a file extension is checked directly.
function resolveCleanUrlToFile(pathname) {
  if (pathname === '/') {
    const f = path.join(distDir, 'index.html');
    return fs.existsSync(f) ? f : null;
  }
  const trimmed = pathname.replace(/^\/+/, '');
  const last = trimmed.split('/').pop() || '';
  const hasExt = /\.[a-zA-Z0-9]{1,8}$/.test(last);
  if (hasExt) {
    const f = path.join(distDir, trimmed);
    return fs.existsSync(f) ? f : null;
  }
  const c1 = path.join(distDir, trimmed, 'index.html');
  if (fs.existsSync(c1)) return c1;
  const c2 = path.join(distDir, `${trimmed}.html`);
  if (fs.existsSync(c2)) return c2;
  return null;
}

function parseRobotsTxt(text) {
  // Single "User-agent: *" block is what this site uses; collect every
  // Disallow line (simple prefix-match semantics, per the robots.txt spec).
  const disallow = [];
  let inStar = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^user-agent:/i.test(line)) {
      inStar = /^user-agent:\s*\*/i.test(line);
      continue;
    }
    if (inStar && /^disallow:/i.test(line)) {
      const value = line.split(':').slice(1).join(':').trim();
      if (value) disallow.push(value);
    }
  }
  return disallow;
}

function isDisallowed(route, disallowPrefixes) {
  return disallowPrefixes.some((p) => route === p || route.startsWith(p));
}

function parseSitemap(text) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(text))) locs.push(m[1].trim());
  return locs;
}

// --------------------------------------------------------------- page scan --

function scanPage(file, route) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(distDir, file);
  const page = { file: rel, route, html };

  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  page.title = titleMatch ? decodeEntities(titleMatch[1]) : null;

  // <meta ...> tags (name=description, name=robots, property=og:*)
  page.description = null;
  page.robots = null;
  page.ogCount = 0;
  for (const tagMatch of html.matchAll(/<meta\b[^>]*\/?>/gis)) {
    const attrs = parseAttrs(tagMatch[0]);
    const name = (attrs.name || '').toLowerCase();
    const property = (attrs.property || '').toLowerCase();
    if (name === 'description' && attrs.content !== undefined) {
      page.description = decodeEntities(attrs.content);
    } else if (name === 'robots' && attrs.content !== undefined) {
      page.robots = attrs.content.trim();
    } else if (property.startsWith('og:')) {
      page.ogCount++;
    }
  }

  // canonical <link>
  page.canonical = null;
  for (const tagMatch of html.matchAll(/<link\b[^>]*\/?>/gis)) {
    const attrs = parseAttrs(tagMatch[0]);
    if ((attrs.rel || '').toLowerCase() === 'canonical' && attrs.href) {
      page.canonical = attrs.href.trim();
      break;
    }
  }

  // H1 count
  page.h1Count = (html.match(/<h1\b[^>]*>/gi) || []).length;

  // JSON-LD blocks
  page.jsonLdBlocks = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1];
    const idx = m.index + m[0].indexOf(raw);
    try {
      JSON.parse(raw.trim());
      page.jsonLdBlocks.push({ ok: true });
    } catch (err) {
      page.jsonLdBlocks.push({ ok: false, error: err.message, line: lineOf(html, idx) });
      fail(`${rel}:${lineOf(html, idx)} unparseable JSON-LD (${err.message})`);
    }
  }

  // Effective noindex, from the meta tag only (this site carries no HTTP
  // X-Robots-Tag header for any route except /studio, which also carries the
  // matching meta tag, so the meta tag is a reliable signal here).
  page.noindex = !!(page.robots && /noindex/i.test(page.robots));

  // internal <a href> links
  page.links = [];
  for (const m of html.matchAll(/<a\b[^>]*>/gis)) {
    const attrs = parseAttrs(m[0]);
    if (!attrs.href) continue;
    page.links.push({ href: attrs.href, index: m.index });
  }

  return page;
}

// ------------------------------------------------------------------- main --

const robotsPath = path.join(distDir, 'robots.txt');
const sitemapPath = path.join(distDir, 'sitemap.xml');
const disallowPrefixes = fs.existsSync(robotsPath) ? parseRobotsTxt(fs.readFileSync(robotsPath, 'utf8')) : [];
if (!fs.existsSync(robotsPath)) warn('dist/robots.txt is missing');
if (!fs.existsSync(sitemapPath)) warn('dist/sitemap.xml is missing');
const sitemapLocs = fs.existsSync(sitemapPath) ? parseSitemap(fs.readFileSync(sitemapPath, 'utf8')) : [];

const htmlFiles = walkHtmlFiles(distDir).sort();
const pages = htmlFiles.map((f) => scanPage(f, routeForFile(f)));
const pagesByRoute = new Map(pages.filter((p) => p.route).map((p) => [p.route, p]));

console.log(`check-site: auditing ${pages.length} HTML file(s) in ${path.relative(process.cwd(), distDir) || '.'}\n`);

// ---- per-page report -------------------------------------------------------

for (const page of pages) {
  const { route, file } = page;
  console.log(`=== ${route || file} ===`);

  const titleLen = page.title ? page.title.length : 0;
  console.log(`  title: ${page.title ? JSON.stringify(page.title) : '(missing)'} (${titleLen} chars)`);
  if (!page.title) warn(`${file}: missing <title>`);
  else if (titleLen < 15 || titleLen > 60) warn(`${file}: title length ${titleLen} outside the ~15-60 char guideline`);

  const descLen = page.description ? page.description.length : 0;
  console.log(`  description: ${page.description ? JSON.stringify(page.description) : '(missing)'} (${descLen} chars)`);
  if (!page.description) warn(`${file}: missing meta description`);
  else if (descLen < 50 || descLen > 160) warn(`${file}: meta description length ${descLen} outside the ~50-160 char guideline`);

  const canonicalOk = page.canonical && page.canonical.startsWith(`${SITE_ORIGIN}/`) || page.canonical === SITE_ORIGIN + '/';
  console.log(`  canonical: ${page.canonical || '(missing)'}${page.canonical && !canonicalOk ? '  [not https://veylet.com/...]' : ''}`);
  if (!page.canonical) warn(`${file}: missing canonical link`);
  else if (!canonicalOk) warn(`${file}: canonical "${page.canonical}" is not an absolute https://veylet.com/ URL`);
  else if (route) {
    const expected = route === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${route}`;
    if (page.canonical !== expected) warn(`${file}: canonical "${page.canonical}" does not match its own route (expected ${expected})`);
  }

  const effectiveRobots = page.robots || 'index,follow (default — no meta robots tag)';
  console.log(`  robots: ${effectiveRobots}`);

  console.log(`  h1: ${page.h1Count}`);
  if (page.h1Count === 0) warn(`${file}: no H1`);
  else if (page.h1Count > 1) warn(`${file}: ${page.h1Count} H1 elements (expected 1)`);

  console.log(`  open graph: ${page.ogCount > 0 ? `present (${page.ogCount} tags)` : 'absent'}`);
  if (page.ogCount === 0 && route && !page.noindex) warn(`${file}: no Open Graph tags on an indexable page`);

  console.log(`  json-ld: ${page.jsonLdBlocks.length} block(s)${page.jsonLdBlocks.length ? `, ${page.jsonLdBlocks.filter(b => !b.ok).length} unparseable` : ''}`);

  if (route && !page.noindex && isDisallowed(route, disallowPrefixes)) {
    warn(`${file}: disallowed by robots.txt but has no noindex meta tag (crawlers cannot fetch it to see the tag)`);
  }

  console.log('');
}

// ---- internal link check ---------------------------------------------------

let linksChecked = 0;
let linksBroken = 0;
for (const page of pages) {
  const base = `${SITE_ORIGIN}${page.route && page.route !== '/' ? page.route : '/'}`;
  for (const { href, index } of page.links) {
    if (!href || href.startsWith('#')) continue;
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue; // not a resolvable URL (unlikely given quoted hrefs above)
    }
    if (url.hostname !== 'veylet.com') continue; // external link, out of scope
    linksChecked++;
    const target = resolveCleanUrlToFile(url.pathname);
    if (!target) {
      linksBroken++;
      const ln = lineOf(page.html, index);
      fail(`${page.file}:${ln} broken internal link "${href}" -> ${url.pathname} has no matching file in dist/`);
    }
  }
}

console.log(`=== internal links ===`);
console.log(`  ${linksChecked} internal <a href> link(s) checked, ${linksBroken} broken\n`);

// ---- sitemap cross-check ----------------------------------------------------

console.log(`=== sitemap.xml ===`);
const sitemapRoutes = new Set();
for (const loc of sitemapLocs) {
  if (!loc.startsWith(SITE_ORIGIN)) {
    warn(`sitemap.xml: "${loc}" is not an absolute ${SITE_ORIGIN} URL`);
    continue;
  }
  const route = loc.slice(SITE_ORIGIN.length) || '/';
  sitemapRoutes.add(route);
  const file = resolveCleanUrlToFile(route);
  if (!file) {
    fail(`sitemap.xml: ${loc} has no matching file in dist/`);
    continue;
  }
  const page = pagesByRoute.get(route) || scanPage(file, route);
  if (page.noindex) {
    fail(`sitemap.xml: ${loc} is noindex (meta robots: "${page.robots}")`);
  }
  if (isDisallowed(route, disallowPrefixes)) {
    warn(`sitemap.xml: ${loc} is disallowed by robots.txt (crawlers cannot fetch a page they cannot reach)`);
  }
}
console.log(`  ${sitemapLocs.length} URL(s) in sitemap; ${hardErrors.filter(e => e.startsWith('sitemap.xml:')).length} missing/noindex\n`);

// Indexable pages missing from the sitemap.
console.log(`=== indexable pages not in sitemap.xml ===`);
let missingFromSitemap = 0;
for (const page of pages) {
  if (!page.route) continue; // 404.html etc.
  if (page.noindex) continue;
  if (isDisallowed(page.route, disallowPrefixes)) continue;
  if (sitemapRoutes.has(page.route)) continue;
  missingFromSitemap++;
  warn(`${page.route} looks indexable (no noindex, not robots-disallowed) but is not in sitemap.xml`);
  console.log(`  ${page.route}`);
}
if (missingFromSitemap === 0) console.log('  none\n');
else console.log('');

// ------------------------------------------------------------------ summary --

console.log('=== warnings ===');
if (warnings.length === 0) console.log('  none');
else warnings.forEach((w) => console.log(`  WARN  ${w}`));

console.log('\n=== hard errors ===');
if (hardErrors.length === 0) console.log('  none');
else hardErrors.forEach((e) => console.log(`  ERROR ${e}`));

console.log(`\nsummary: ${pages.length} pages, ${hardErrors.length} hard error(s), ${warnings.length} warning(s)`);

process.exitCode = hardErrors.length > 0 ? 1 : 0;
