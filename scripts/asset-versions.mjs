import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export const assetHash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const origin = 'https://build.invalid';

export function publicFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.')) return [];
    const path = posix.join(prefix, entry.name);
    return entry.isDirectory() ? publicFiles(root, path) : entry.isFile() ? [path] : [];
  }).sort();
}

function localAsset(raw, source) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return null;
  const url = new URL(raw.replaceAll('&amp;', '&'), `${origin}/${source}`);
  if (!/\.(?:js|css)$/.test(url.pathname)) return null;
  return url;
}

// Our source uses literal local dependency paths. Vendor code is hashed as-is.
// Unknown, missing and cyclic local dependencies fail the build rather than
// silently retaining an unversioned URL or producing an unstable fingerprint.
export function mapAssetReferences(text, source, visit) {
  const replace = (raw, html = false) => {
    const url = localAsset(raw, source);
    if (!url) return raw;
    const updated = visit(url.pathname.slice(1), url);
    return html ? updated.replaceAll('&', '&amp;') : updated;
  };
  if (source.endsWith('.html')) {
    return text.replace(/<(?:script|link)\b[^>]*>/gi, tag =>
      tag.replace(/\b(src|href)\s*=\s*(["'])(.*?)\2/gi,
        (match, attribute, quote, raw) => `${attribute}=${quote}${replace(raw, true)}${quote}`));
  }
  if (source.endsWith('.js') && !source.startsWith('vendor/')) {
    return text.replace(/(["'`])([\w./-]+\.(?:js|css)(?:\?[^"'`<>\\\s#]*)?(?:#[^"'`<>\\\s]*)?)\1/g,
      (match, quote, raw) => `${quote}${replace(raw)}${quote}`);
  }
  return text;
}

export function versionAssets(root) {
  const files = publicFiles(root);
  const available = new Set(files);
  const versions = new Map(), rewritten = new Map(), visiting = new Set();
  function version(path) {
    if (!available.has(path)) throw new Error(`Missing public asset: ${path}`);
    if (versions.has(path)) return versions.get(path);
    if (visiting.has(path)) throw new Error(`Cyclic public asset dependency: ${path}`);
    visiting.add(path);
    const original = readFileSync(join(root, path));
    const updated = mapAssetReferences(original.toString('utf8'), path, withVersion);
    const bytes = Buffer.from(updated);
    versions.set(path, assetHash(bytes));
    if (!bytes.equals(original)) rewritten.set(path, bytes);
    visiting.delete(path);
    return versions.get(path);
  }
  function withVersion(path, url) {
    url.searchParams.set('v', version(path));
    return url.pathname + url.search + url.hash;
  }
  for (const path of files.filter(path => /\.(?:js|css)$/.test(path))) version(path);
  for (const path of files.filter(path => path.endsWith('.html'))) {
    const original = readFileSync(join(root, path), 'utf8');
    const updated = mapAssetReferences(original, path, withVersion);
    if (updated !== original) rewritten.set(path, Buffer.from(updated));
  }
  // Finish dependency validation before touching any file.
  for (const [path, bytes] of rewritten) writeFileSync(join(root, path), bytes);
  return { versions: Object.fromEntries([...versions].sort()), changedFiles: [...rewritten.keys()].sort() };
}
