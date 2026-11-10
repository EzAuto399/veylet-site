// Client pages, 10 November 2026, phase 2: the visit has a start, a place and an end. The page keeps its
// address on the stop the visitor is at, Share and the Email to the agent carry it, and the agent can be
// reached from inside the player.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');

function clientPage() {
  const window = {};
  const document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
  vm.runInNewContext(read('client-page.js'), { window, document, URLSearchParams, URL, setTimeout, clearTimeout, console, navigator: {}, location: { search: '' } });
  return window.VeyletClientPage;
}
const TOKEN = '0123456789abcdef0123456789abcdef';
function visitHarness(hash = '') {
  const page = clientPage();
  const sent = [], states = [], copied = [];
  const location = { origin: 'https://veylet.com', pathname: '/handoff', search: '?t=' + TOKEN + '&src=sms', hash };
  const window = { history: { state: { kept: 1 }, replaceState: (state, title, url) => { states.push([state, url]); location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } } };
  const navigator = { clipboard: { writeText: async text => { copied.push(text); } } };
  const visit = page.visitLink({ window, location, navigator, document: {}, token: TOKEN, beacon: { send: (...args) => sent.push(args) } });
  return { page, visit, sent, states, copied, location };
}

test('a link names a stop with #stop=N, and nothing else is read from it', () => {
  const { stopFromHash } = clientPage();
  assert.equal(stopFromHash('#stop=3'), 3);
  for (const hash of ['', '#', '#stop=0', '#stop=', '#stop=abc', '#stop=3x', '#stop=123', '#room=2', '#stop=-1']) assert.equal(stopFromHash(hash), null, hash);
  assert.equal(visitHarness('#stop=2').visit.startAt, 2);
  assert.equal(visitHarness().visit.startAt, null);
});

test('the address follows the visitor: replaceState on each stop, the token and its tag kept, no hash on the first stop', () => {
  const h = visitHarness();
  h.visit.onStop(1, 3);
  assert.deepEqual(h.states, [], 'the first stop leaves a fresh link as it was');
  h.visit.onStop(2, 3);
  assert.deepEqual(h.states, [[{ kept: 1 }, '/handoff?t=' + TOKEN + '&src=sms#stop=2']]);
  h.visit.onStop(2, 3);
  assert.equal(h.states.length, 1, 'no second write for the same stop');
  h.visit.onStop(1, 3);
  assert.equal(h.states[1][1], '/handoff?t=' + TOKEN + '&src=sms', 'back at the start the hash goes');
  // A browser that refuses the write changes nothing else.
  const refused = visitHarness();
  refused.visit.onStop = refused.visit.onStop.bind(refused.visit);
  refused.location.pathname = '/handoff';
  assert.doesNotThrow(() => clientPage().visitLink({ window: { history: { replaceState() { throw new Error('refused'); } } }, location: refused.location, token: TOKEN }).onStop(2, 3));
});

test('Share carries the stop, counts the tap as the page’s own Share does, and says what happened', async () => {
  const h = visitHarness();
  assert.equal(h.visit.url(), 'https://veylet.com/handoff?t=' + TOKEN, 'before the player has said where: the plain link, token only');
  h.visit.onStop(3, 4);
  assert.equal(await h.visit.share(), 'Link copied.');
  assert.deepEqual(h.copied, ['https://veylet.com/handoff?t=' + TOKEN + '#stop=3']);
  assert.deepEqual(h.sent, [['share_tap']]);
  // The page's own button reads the same address at the press.
  const button = { hidden: true, events: {}, addEventListener(name, fn) { this.events[name] = fn; } };
  const status = { textContent: '' };
  h.page.mountShare(button, { navigator: { clipboard: { writeText: async text => { h.copied.push(text); } } }, document: {}, status, url: h.visit.url, beacon: { send: (...args) => h.sent.push(args) } });
  await button.events.click();
  assert.equal(h.copied[1], 'https://veylet.com/handoff?t=' + TOKEN + '#stop=3');
  assert.equal(status.textContent, 'Link copied.');
  assert.deepEqual(h.sent, [['share_tap'], ['share_tap']]);
  // The system sheet: nothing to say after it, and a closed sheet changes nothing.
  const sheet = { share: async () => {} };
  assert.equal(await h.page.shareNow({ navigator: sheet, url: 'https://veylet.com/x' }), '');
  assert.equal(await h.page.shareNow({ navigator: { share: async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); } }, url: 'https://veylet.com/x' }), null);
});

test('the agent inside the player: Call and Email, counted as the bar counts them, and the Email says which stop', async () => {
  const h = visitHarness();
  h.visit.setTitle('12 Example Street');
  h.visit.setContact({ name: 'Alex Example', phone: '+61 400 000 000', email: 'alex@example.invalid' });
  const contact = await h.visit.contact;
  assert.equal(contact.name, 'Alex Example');
  assert.deepEqual(JSON.parse(JSON.stringify(contact.actions.map(action => [action.label, action.href]))), [
    ['Call', 'tel:+61400000000'],
    ['Email', 'mailto:alex@example.invalid?subject=' + encodeURIComponent('Walkthrough: 12 Example Street')],
  ]);
  h.visit.onStop(2, 3);
  const now = contact.actions[1].hrefNow();
  assert.ok(now.startsWith(contact.actions[1].href + '&body='));
  assert.equal(decodeURIComponent(now.split('&body=')[1]), 'I’m at stop 2 of 3 in the walkthrough.\nhttps://veylet.com/handoff?t=' + TOKEN + '#stop=2\n\n');
  contact.actions[0].press(); contact.actions[1].press();
  assert.deepEqual(h.sent, [['call_tap'], ['email_tap']]);
  // No contact, or one with nothing to press: the player is told there is none.
  const none = visitHarness();
  none.visit.setContact(null);
  assert.equal(await none.visit.contact, null);
  const bare = visitHarness();
  bare.visit.setContact({ name: 'Alex Example' });
  assert.equal(await bare.visit.contact, null);
  // Without a stop yet, the Email is the one the card always wrote.
  assert.equal(h.page.mailtoHref('alex@example.invalid', 'A'), 'mailto:alex@example.invalid?subject=' + encodeURIComponent('Walkthrough: A'));
});

test('said once: the truth line, the agent and the loading message each have one place on a phone', () => {
  const stageCss = read('tour-stage.css'), css = read('client-page.css'), glue = read('tour-player.js'), handoff = read('handoff/index.html');
  // The page's line under the title is the truth line; the player's label repeats it only where that line cannot be seen.
  assert.match(stageCss, /\.client-page \.v2:not\(\.v2-research\) \.v2-truth \{\s*display: none;/);
  assert.match(stageCss, /\.client-page \.v2-stage:is\(\.v2-filled, :fullscreen\) \.v2-truth \{\s*display: block;/);
  // With the Call/Email bar on screen the card above the stage goes, and the end card does not repeat the bar.
  const phone = css.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/)[1];
  assert.match(phone, /body\.has-agent-bar \.agent-card \{\s*display: none;/);
  assert.match(stageCss, /body\.has-agent-bar \.client-page \.v2-stage:not\(\.v2-filled, :fullscreen\) \.v2-end-contact,\s*body\.has-agent-bar \.client-page \.v2-stage:not\(\.v2-filled, :fullscreen\) \.v2-contact \{\s*display: none;/);
  assert.match(stageCss, /@media \(max-width: 768px\) \{[\s\S]*?--tour-stage-above: 215px;/);
  // Once the player is on screen it says how loading goes; the page's line is cleared.
  assert.match(glue, /onVisible: \(\) => \{\s*if \(surface\.frame\) surface\.frame\.hidden = true;[^}]*player\.showProgress\(surface, ''\);/);
  assert.match(glue, /visit: options\.visit,/);
  assert.match(handoff, /page\?\.visitLink\?\.\(\{ window, document, location, navigator, token, beacon \}\)/);
});
