const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
const surfaces = [
  'index.html', 'llms.txt', 'offer/offer.json', 'offer/index.html', 'start/index.html',
  'see/index.html', 'guides/iphone-lidar-vs-matterport/index.html', 'account/index.html',
  'account.js', 'enquiry.js', 'studio/index.html', 'help/uploading/index.html',
  'app/help/uploading/index.html', 'help/render-status/index.html', 'app/help/render-status/index.html',
];

test('standard turnaround is a target with an unestablished pilot outcome, never an observed usual result', () => {
  let targetCount = 0;
  for (const file of surfaces) {
    const copy = read(file);
    for (const claim of copy.matchAll(/[^.!?\n]*1(?:–|-| to )2 hours?[^.!?\n]*[.!?]?/gi)) {
      assert.match(claim[0], /Standard rendering targets 1–2 hours after upload; pilot turnaround is not yet established\./,
        `${file}: an estimate must carry its evidence limit in the same sentence`);
      targetCount++;
    }
  }
  assert.ok(targetCount > 0, 'the approved standard rendering target remains available');
});

test('promotional metadata and organization descriptions do not advertise standard turnaround', () => {
  for (const file of ['index.html', 'offer/index.html', 'start/index.html']) {
    const html = read(file);
    const head = html.slice(0, html.indexOf('<body'));
    const descriptions = [...head.matchAll(/<meta\b[^>]*(?:name|property)="(?:description|og:description|twitter:description)"[^>]*>/g)]
      .map(match => match[0]);
    for (const match of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(match[1]);
      descriptions.push(...(data['@graph'] || [data])
        .filter(node => ['Organization', 'WebPage'].includes(node['@type'])).map(node => node.description || ''));
    }
    assert.doesNotMatch(descriptions.join('\n'), /1(?:–|-| to )2 hours?/i, file);
  }
});
