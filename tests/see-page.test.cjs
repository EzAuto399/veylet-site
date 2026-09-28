const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// /see ("See a result"): the labelled public example shown as a 3D walkthrough and as a
// walkthrough video. Brief: property-3d-studio/marketing/results-showcase-20260926/BRIEF.md.
const dist = path.join(__dirname, '../dist');
const read = rel => fs.readFileSync(path.join(dist, rel), 'utf8');
const html = read('see/index.html');
const css = read('see/see.css');
const js = read('see/see.js');
const offer = JSON.parse(read('offer/offer.json'));
const manifest = JSON.parse(read('samples/eyeful-apartment/manifest.json'));
const plan = offer.plans.find(entry => entry.code === 'solo');

const FULL_LABEL = 'Public research capture (Meta Eyeful Tower, MIT licence) processed by the Veylet pipeline. Not captured with Veylet Capture; not a client property.';
const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const flat = fragment => decode(fragment.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const body = html.slice(html.indexOf('<body'));
const visible = flat(body);
const aud = n => `A$${n.toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
// The markup between an element's opening tag (found by a unique attribute) and its closing tag.
const element = (marker, tag) => {
  const start = body.indexOf(marker);
  assert.ok(start >= 0, `${marker} is on the page`);
  const open = body.lastIndexOf('<' + tag, start);
  let depth = 0;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = open;
  for (let m; (m = re.exec(body));) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return body.slice(open, m.index + m[0].length);
  }
  throw new Error(`${marker} is not closed`);
};
const hero = element('data-see-hero', 'section');

test('the page states who made it, from its head: title, description, canonical and share image', () => {
  assert.match(html, /<title>See a result — Veylet<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/veylet.com\/see" \/>/);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]{80,200}"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/veylet.com\/media\/result-poster-16x9.webp" \/>/);
  assert.match(html, /<html lang="en">/);
  // Video dates are real: nothing after the day the cuts were exported.
  for (const date of html.matchAll(/"uploadDate": "([\d-]+)"/g)) assert.ok(date[1] <= '2026-09-26', date[1]);
  assert.equal([...html.matchAll(/"@type": "VideoObject"/g)].length, 2);
});

test('the full label sits once, directly under the paired frames; each frame carries a Research sample tag', () => {
  const stage = element('data-see-stage', 'div');
  const pair = element('class="see-pair"', 'div');
  assert.ok(stage.includes(pair), 'the pair is on the stage');
  // Directly under the pair, inside the stage: under the diptych on wide screens, and under
  // whichever frame a phone shows.
  const after = stage.slice(stage.indexOf(pair) + pair.length).trimStart();
  const label = after.match(/^<p class="see-label" id="see-label">([\s\S]*?)<\/p>/);
  assert.ok(label, 'the label is the next element after the pair');
  assert.equal(flat(label[1]), FULL_LABEL);
  assert.equal(visible.split(FULL_LABEL).length - 1, 1, 'the full label is on the page once');
  // The text column reads headline, intro, actions: no label in it.
  const column = hero.slice(0, hero.indexOf('data-see-stage'));
  assert.ok(!flat(column).includes('Public research capture'), 'the hero column carries no label');
  assert.ok(column.indexOf('class="see-intro"') < column.indexOf('data-hero-actions'), 'intro, then actions');
  const player = element('data-see-frame="explore"', 'figure');
  const video = element('data-see-frame="watch"', 'figure');
  for (const [name, frame, lead] of [['player', player, '3D walkthrough'], ['video', video, 'Walkthrough video']]) {
    assert.ok(pair.includes(frame), `the ${name} is in the pair`);
    assert.match(frame, /^<figure[^>]*aria-describedby="see-label"/, `the ${name} is described by the full label`);
    const head = frame.match(/<span class="see-caption-head">([\s\S]*?)<\/span><\/span>/);
    assert.ok(head, `the ${name} caption has a first line`);
    assert.equal(flat(head[0]), `${lead} Research sample`, `the ${name} caption names the frame with the tag beside it`);
    assert.match(head[0], /<span class="pill see-tag">Research sample<\/span>/);
  }
  // The walkthrough's own truth line says the same thing.
  assert.ok(manifest.truth_label.startsWith(FULL_LABEL), 'the package truth label matches the page');
  assert.match(video, /src="\/media\/result-social-9x16.mp4"/);
  assert.match(video, /src="\/media\/result-listing-16x9.mp4"/);
});

test('the example is described truthfully: the source, the licence, the rooms and what it is not', () => {
  const about = flat(element('aria-labelledby="about-title"', 'section'));
  for (const phrase of ['Meta’s Eyeful Tower research dataset', 'research camera rig', 'MIT licence', 'Copyright (c) Meta Platforms, Inc. and affiliates.',
    'Not captured with Veylet Capture, and not a client property.', 'an iPhone capture of your space will look different']) {
    assert.ok(about.includes(phrase), phrase);
  }
  // The licence notice is the page's own copy, so it never depends on the samples folder.
  assert.match(body, /<a href="\/see\/eyeful-tower-LICENSE.txt">Read the licence<\/a>/);
  assert.match(read('see/eyeful-tower-LICENSE.txt'), /^MIT License\n\nCopyright \(c\) Meta Platforms, Inc\. and affiliates\./);
  assert.equal(read('see/eyeful-tower-LICENSE.txt'), read('samples/eyeful-apartment/LICENSE.txt'));
  // The rooms named are the rooms a visitor can stop in; a room without a stop is not mentioned.
  const stopped = manifest.rooms.filter(room => manifest.stops.some(stop => stop.room === room.id)).map(room => room.name);
  assert.deepEqual(stopped, ['Kitchen', 'Living area', 'Workshop', 'Bedroom']);
  assert.ok(about.includes('Kitchen, living area, workshop and bedroom, with one stop in each.'));
  for (const room of manifest.rooms.filter(room => !stopped.includes(room.name))) {
    assert.doesNotMatch(visible, new RegExp(`\\b${room.name}\\b`, 'i'), `${room.name} has no stop and is not on the page`);
  }
});

test('the words: walkthrough, never scan, model or a customer result, and no heading implies a client made it', () => {
  const attributes = [...body.matchAll(/\b(?:alt|aria-label|title|content)="([^"]*)"/g)].map(match => decode(match[1]));
  const head = [...html.matchAll(/<meta[^>]+content="([^"]*)"/g)].map(match => decode(match[1]));
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  // "your iPhone model" is the phone, not the walkthrough.
  for (const text of [visible, ...attributes, ...head, ld].map(value => value.replace(/iPhone model/g, 'iPhone'))) {
    assert.doesNotMatch(text, /\bscan(?:s|ned|ning)?\b/i);
    assert.doesNotMatch(text, /\bmodels?\b/i);
    assert.doesNotMatch(text, /customer (?:result|example|tour)|client result|real listing|testimonial/i);
  }
  for (const heading of body.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/g)) {
    assert.doesNotMatch(flat(heading[1]), /customer|client|agent|result/i, flat(heading[1]));
  }
  // No kicker labels, step numbers or emoji.
  assert.doesNotMatch(body, /class="[^"]*eyebrow/);
  assert.doesNotMatch(visible, /\bSTEP 0\d\b|\p{Emoji_Presentation}/u);
  // The two-tone headline, as on the home page.
  assert.match(hero, /<h1 id="see-title">One capture\.<span[^>]*><\/span><br \/><em data-thread-em>Two ways to show it\.<\/em><\/h1>/);
});

test('every price on the page is offer.json 2026-09-29.1, set on data-price elements', () => {
  assert.equal(offer.version, '2026-09-29.1');
  const prices = Object.fromEntries([...body.matchAll(/<span data-price="([\w-]+)">([^<]+)<\/span>/g)].map(match => [match[1], match[2]]));
  assert.deepEqual(prices, {
    'see-hero-month': aud(plan.appAud),
    'see-free': 'A$0',
    'see-plan-month': aud(plan.appAud),
    'see-plan-year': aud(plan.annualAud),
    'see-plan-year-saving': aud(Math.round(12 * plan.appAud * 100 - plan.annualAppAud * 100) / 100),
    'see-plan-month-app': aud(plan.appAud),
  });
  const allowed = new Set(Object.values(prices));
  const amounts = [...html.matchAll(/A\$\d{1,3}(?:,\d{3})*(?:\.\d\d)?/g)].map(match => match[0]);
  assert.ok(amounts.length >= 4);
  for (const amount of amounts) assert.ok(allowed.has(amount), `${amount} is not an offer.json amount`);
  // The facts around the amounts, first the phones' line under the hero button.
  const heroLine = flat(element('class="see-actions-line"', 'p'));
  assert.equal(heroLine, `${offer.freeMonths.months} free month${offer.freeMonths.months === 1 ? '' : 's'} · ${offer.freeMonths.includedWalkthroughs} walkthroughs · then ${aud(plan.appAud)} a month through the App Store`);
  const statement = flat(element('class="statement see-statement"', 'aside'));
  assert.ok(statement.includes(`${aud(plan.appAud)} a month through the App Store`));
  assert.ok(statement.includes(`${aud(plan.annualAppAud)} upfront a year through the App Store`));
  assert.ok(statement.includes(`${plan.includedPerMonth} walkthroughs a month; unused ones roll over, up to ${plan.rollover.maxBanked} banked`));
  assert.ok(statement.includes(`The same ${plan.annualIncluded} walkthroughs a year, to use any time in the plan year`));
  assert.ok(statement.includes(`save ${aud(Math.round(12 * plan.appAud * 100 - plan.annualAppAud * 100) / 100)} on 12 monthly payments`));
  assert.equal(plan.annualIncluded, 12 * plan.includedPerMonth, 'the saving compares the same number of walkthroughs');
  assert.ok(statement.includes(`In the App Store, the Veylet plan is ${aud(plan.appAud)} a month.`));
  const terms = flat(element('id="offer"', 'section'));
  assert.ok(terms.includes(`${offer.freeMonths.includedWalkthroughs} walkthroughs included`));
  assert.ok(terms.includes(`${offer.freeMonths.months} free month`));
  assert.ok(terms.includes(offer.guarantee.text.replace("'", '’')), 'the first-walkthrough redo');
  assert.ok(terms.includes('included in the plan when video exports open'), 'listing videos are qualified');
  assert.ok(terms.includes('New accounts are admitted weekly. You need an iPhone Pro or iPad Pro with LiDAR.'));
  assert.match(terms, /New trials start through Apple’s free introductory offer in the app, if eligible/);
  assert.match(terms, /Existing card and invoice agreements retain their terms/);
  assert.doesNotMatch(terms, /by card or invoice|card payment on this website is coming later/);
  assert.equal(offer.freeMonths.cardRequired, true);
  assert.equal(offer.freeMonths.cancelAnytime, true);
});

test('the main action is Join the waitlist, to /waitlist, everywhere it appears', () => {
  const actions = element('data-hero-actions', 'div');
  assert.match(actions, /^<div class="see-actions" data-hero-actions>\s*<a class="button" href="\/waitlist">Join the waitlist <span class="icon-arrow"/);
  assert.match(actions, /<a class="text-link see-actions-more" href="#offer">What’s in the free month<\/a>/);
  const buttons = [...body.matchAll(/<a class="button[^"]*" href="([^"]+)">([^<]+)</g)].map(match => [match[1], match[2].trim()]);
  assert.ok(buttons.length >= 3);
  for (const [href, words] of buttons) assert.deepEqual([href, words], ['/waitlist', 'Join the waitlist']);
  assert.match(body, /<a class="text-link" href="\/offer">See the full offer<\/a>/);
  assert.match(body, /<nav class="sticky-cta"[\s\S]*?<a href="\/waitlist">Join the waitlist<\/a>/);
  assert.ok(body.includes('id="offer"'), 'the offer anchor exists');
});

test('without JavaScript the page is complete; with it, nothing heavy loads before the press', () => {
  // Videos: no preload, muted, looping, inline, with a poster and the browser's own controls.
  const videos = [...body.matchAll(/<video\b[^>]*>/g)].map(match => match[0]);
  assert.equal(videos.length, 2);
  for (const tag of videos) {
    for (const attribute of ['preload="none"', ' muted', ' loop', ' playsinline', ' controls', 'poster="/media/result-poster-']) assert.ok(tag.includes(attribute), `${attribute} in ${tag.slice(0, 60)}`);
  }
  // The player engine is not on the page; see.js fetches it only after the Explore press.
  assert.doesNotMatch(html, /tour-player|playcanvas/);
  assert.match(body, /<button class="button button-paper" type="button" data-explore>Explore the apartment<\/button>/);
  assert.ok(flat(element('data-see-frame="explore"', 'figure')).includes('Explore loads about 35 MB.'), 'the download size is under the frame');
  const mb = manifest.bytes.total / 1e6;
  assert.ok(mb > 30 && mb < 40, `the package is about 35 MB (${mb.toFixed(1)} MB)`);
  const press = js.indexOf("press.addEventListener('click'");
  assert.ok(press > 0 && js.indexOf('load()', press) > press && js.indexOf('waitForTap: false', press) > press, 'the engine loads inside the press');
  // Plain structure: five steps, the comparison table and the answers are HTML.
  assert.equal([...element('class="see-steps"', 'ol').matchAll(/<li class="see-step"/g)].length, 5);
  assert.equal([...body.matchAll(/<th scope="row">/g)].length, 5);
  assert.equal([...body.matchAll(/<details>/g)].length, 4);
  // Real screens are captioned as simulator screens, drawn ones as illustrations.
  assert.equal([...body.matchAll(/<figcaption>App screen \(iOS Simulator\)<\/figcaption>/g)].length, 2);
  assert.equal([...body.matchAll(/<figcaption>Illustration\b/g)].length, 2);
  // Motion only through gsap.matchMedia with reduced motion excluded, and the pin only from 801 px.
  assert.match(js, /media\.add\('\(min-width: 801px\) and \(prefers-reduced-motion: no-preference\)'/);
  assert.match(js, /visibilitychange/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /gradient|font-family: (?!ui-monospace)/, 'no gradients and no new face');
});

test('every local file the page, its script and its data point to exists in dist, at the current ?v= hash', async () => {
  const { assetHash } = await import(pathToFileURL(path.join(__dirname, '../scripts/asset-versions.mjs')));
  const references = new Set();
  for (const match of html.matchAll(/\b(?:src|href|poster)="([^"#]+)(?:#[^"]*)?"/g)) references.add(match[1]);
  for (const match of html.matchAll(/\bsrcset="([^"]+)"/g)) for (const part of match[1].split(',')) references.add(part.trim().split(/\s+/)[0]);
  for (const match of html.matchAll(/https:\/\/veylet\.com(\/[\w./-]+\.(?:webp|mp4|png|jpg))/g)) references.add(match[1]);
  for (const match of html.matchAll(/data-sample-base="([^"]+)"/g)) references.add(match[1]);
  for (const match of js.matchAll(/'(\/[\w./-]+(?:\.js)?(?:\?v=[a-f\d]{16})?)'/g)) references.add(match[1]);
  const local = [...references].filter(ref => ref.startsWith('/'));
  assert.ok(local.length > 25, `${local.length} local references`);
  for (const ref of local) {
    const [pathname, query] = ref.split('?');
    let file = path.join(dist, decodeURIComponent(pathname));
    if (pathname.endsWith('/')) file = path.join(file, pathname === '/samples/eyeful-apartment/' ? 'manifest.json' : 'index.html');
    else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `${ref} resolves to a file in dist`);
    const version = /(?:^|&)v=([a-f\d]{16})/.exec(query || '');
    if (version) assert.equal(version[1], assetHash(fs.readFileSync(file)), `${ref} carries its current hash`);
    else assert.doesNotMatch(pathname, /\.(?:js|css)$/, `${ref} is versioned`);
  }
  // Media the page publishes stay small enough for a phone.
  for (const ref of local.filter(ref => ref.startsWith('/media/result-'))) {
    const bytes = fs.statSync(path.join(dist, ref)).size;
    assert.ok(bytes < (ref.endsWith('.mp4') ? 6e6 : 2e5), `${ref} is ${bytes} bytes`);
  }
});

test('the sample package location is one switch: data-sample-base on the stage, read only by see.js', () => {
  const bases = [...html.matchAll(/data-sample-base="([^"]*)"/g)].map(match => match[1]);
  assert.deepEqual(bases, ['/samples/eyeful-apartment/'], 'the base appears exactly once');
  assert.match(element('data-see-stage', 'div'), /^<div class="see-stage" data-see-stage data-sample-base="/);
  // The comment beside it says what it becomes at release; the player accepts that origin.
  assert.match(html, /<!--[^>]*https:\/\/tours\.veylet\.com\/samples\/eyeful-apartment\/[^>]*-->\s*<div class="see-stage" data-see-stage data-sample-base=/);
  assert.match(read('tour-player-v2.js'), /PACKAGE_ORIGINS = Object\.freeze\(\['https:\/\/tours\.veylet\.com'\]\)/);
  assert.ok(fs.existsSync(path.join(dist, bases[0], 'manifest.json')), 'the package is there today');
  // see.js reads the attribute and names no package path of its own.
  assert.match(js, /stage\.dataset\.sampleBase/);
  assert.doesNotMatch(js, /\/samples\//);
});

test('the pinned phone is one frame: screens slide over each other on the scroll, and the page rests complete', () => {
  // The stacked frames are centred on the phone, not the figure, so captions of different length
  // cannot stack the phones at different heights; only the first frame draws the bezel and lift.
  assert.match(css, /\.see-flow\[data-mode="pinned"\] \.see-step-screen \{[^}]*translate: 0 calc\(var\(--flow-device\) \* -1\.0864\)/);
  assert.match(css, /\.see-step-screen:not\(\[data-screen="1"\]\) \.device-screen \{[^}]*border-color: transparent;[^}]*box-shadow: none;/);
  // The screen changes are scrubbed by the pin itself, not faded on a timer.
  assert.match(js, /animation: sheets,\s*scrub: true,/);
  assert.doesNotMatch(css, /\.see-step-screen\[data-shown\] \{\s*opacity: 1;/, 'no whole-frame cross-fade');
  // The render bar lives in the drawn (aria-hidden) screen and ends full in the still state.
  assert.match(element('data-ui="render"', 'div'), /<span class="see-ui-bar"><span data-ui-bar><\/span><\/span>/);
  assert.match(js, /setRender\('ready', 5\);\s*setBar\(1\);/);
  // Reveals never start hidden, are skipped under reduced motion, and a frame switch animates
  // only after a press, so the first paint never waits on an animation.
  assert.match(js, /media\.add\('\(prefers-reduced-motion: no-preference\)'/);
  for (const match of js.matchAll(/fromTo\([^,]+, \{ y: 36, opacity: ([\d.]+) \}/g)) assert.ok(Number(match[1]) >= 0.35, 'reveals start visible');
  assert.match(css, /\.see-stage\[data-switched\] \.see-frame/);
  assert.match(js, /stage\.dataset\.switched = '';\s*show\(button\.dataset\.show\);/);
});
