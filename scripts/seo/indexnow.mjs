#!/usr/bin/env node
/*
 * Tell IndexNow search engines (Bing, Yandex, Seznam, Naver and others) which
 * public URLs changed. Reads the key file at the site root and the sitemap.
 *
 *   node scripts/seo/indexnow.mjs            # print what would be sent
 *   node scripts/seo/indexnow.mjs --send     # send it
 *
 * Run only after a deploy: the key file and every URL must already be live.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../../dist');
const key = readdirSync(dist).map(name => name.match(/^([a-f0-9]{32})\.txt$/)?.[1]).find(Boolean);
if (!key) throw new Error('No IndexNow key file (32 hex characters + .txt) in dist/');
const urls = [...readFileSync(join(dist, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const body = { host: 'veylet.com', key, keyLocation: `https://veylet.com/${key}.txt`, urlList: urls };

if (!process.argv.includes('--send')) {
  console.log(JSON.stringify(body, null, 2));
  console.log(`\n${urls.length} URLs. Add --send to submit.`);
} else {
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  console.log(`IndexNow → HTTP ${response.status} ${response.statusText}`);
  if (response.status >= 300) process.exitCode = 1;
}
