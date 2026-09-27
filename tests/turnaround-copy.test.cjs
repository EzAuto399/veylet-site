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


test('semantic final: studio operational thresholds cannot be read as customer delivery promises', () => {
  const words = read('studio/index.html').replace(/\s+/g, ' ');
  assert.match(words, /Standard rendering targets 1–2 hours after upload; pilot turnaround is not yet established\./);
  assert.match(words, /6-hour mark is a queue-promotion threshold/);
  assert.match(words, /12-hour founding and 24-hour standard marks are queue and escalation thresholds, not proven ready times\./);
  assert.match(words, /Super fast keeps its separate 30-minute promise\./);
  assert.doesNotMatch(words, /Target from upload to ready:.*12 hours.*24 hours/);
  assert.doesNotMatch(read('studio.js'), /usually 1–2/i);
});

test('semantic final: the LiDAR guide separates hard failures from non-blocking review findings', () => {
  const words = read('guides/iphone-lidar-vs-matterport/index.html').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(words, /Send from the app: it uploads in the background\. Check your account for rendering status\./);
  assert.match(words, /Standard rendering targets 1–2 hours after upload; pilot turnaround is not yet established\./);
  assert.match(words, /An automatic quality check stops a render that cannot work, such as one with no usable photos or depth; it retries once when a retry can help, then asks for a recapture of the named rooms\./);
  assert.match(words, /Other findings about photo match, coverage, stray artefacts and walkable paths do not block the render: they are flagged for you to check before approval\./);
  assert.match(words, /No person checks it; you then review the exact version on your phone before anyone else sees it\./);
});
