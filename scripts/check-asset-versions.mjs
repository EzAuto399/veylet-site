#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetHash, mapAssetReferences, publicFiles } from './asset-versions.mjs';

// Check the URLs a returning browser actually requests, not just bare files.
const root = join(dirname(fileURLToPath(import.meta.url)), '../dist');
const base = process.argv[2];
const fetched = new Map();
let references = 0;
// At most 8 requests in flight: the local QA server (ThreadingHTTPServer, a backlog of 5) refused
// connections when ~100 pages were requested at once, which read as asset failures that were not there.
const slots = { free: 8, waiting: [] };
async function limited(task) {
  if (slots.free > 0) slots.free--; else await new Promise(resolve => slots.waiting.push(resolve));
  try { return await task(); } finally { const next = slots.waiting.shift(); if (next) next(); else slots.free++; }
}
async function fetchBytes(path) {
  if (!fetched.has(path)) fetched.set(path, limited(async () => {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return { bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  }));
  return fetched.get(path);
}
const assets = new Map();
function inspect(text, source) {
  mapAssetReferences(text, source, (path, url) => {
    references++;
    const version = url.searchParams.get('v');
    if (!/^[a-f\d]{16}$/.test(version || '')) throw new Error(`${source}: unversioned ${url.pathname}`);
    const requestPath = url.pathname + url.search;
    if (!assets.has(requestPath)) assets.set(requestPath, (async () => {
      const { bytes } = await fetchBytes(requestPath);
      if (assetHash(bytes) !== version) throw new Error(`${source}: version does not match served bytes for ${requestPath}`);
      inspect(bytes.toString('utf8'), path);
    })());
    return requestPath + url.hash;
  });
}
try {
  if (!base) throw new Error('Usage: node scripts/check-asset-versions.mjs https://veylet.com');
  const pages = publicFiles(root).filter(path => path.endsWith('.html'));
  await Promise.all(pages.map(async path => {
    const route = '/' + (base.startsWith('https:') ? path.replace(/(?:^|\/)index\.html$/, '').replace(/\.html$/, '') : path);
    const { bytes, headers } = await fetchBytes(route);
    if (base.startsWith('https:') && !/max-age=0\b|no-cache|no-store/i.test(headers.get('cache-control') || '')) {
      throw new Error(`${route}: HTML does not require browser revalidation`);
    }
    inspect(bytes.toString('utf8'), path);
  }));
  // Deferred loaders can discover further dependencies while earlier ones finish.
  let checked = 0;
  while (checked !== assets.size) { checked = assets.size; await Promise.all(assets.values()); }
  if (!assets.size) throw new Error('No local JS/CSS references found');
  console.log(`${references} versioned references across ${pages.length} pages; ${assets.size} served JS/CSS files match their hashes${base.startsWith('https:') ? '; HTML revalidation verified' : ''}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
