const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Design spec v2, 3.1 and 3.9: one token set, checked against design-tokens.json, with every
// text and control pair passing WCAG contrast in both appearances.
const root = path.join(__dirname, '..');
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'design-tokens.json'), 'utf8'));
const css = fs.readFileSync(path.join(root, 'dist/style.css'), 'utf8');

function luminance(hex) {
  const [r, g, b] = hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function block(selectorStart) {
  const at = css.indexOf(selectorStart);
  assert.notEqual(at, -1, selectorStart + ' exists');
  const open = at + selectorStart.indexOf('{');
  return css.slice(open + 1, css.indexOf('}', open));
}
function value(text, name) {
  const match = text.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  return match && match[1].trim();
}

test('the light tokens in style.css match design-tokens.json, stage included', () => {
  const light = block(':root {\n  /* Design tokens v2');
  for (const [name, hex] of Object.entries({ ...tokens.colour.light, ...tokens.colour.stage })) {
    assert.equal(value(light, name), hex, '--' + name);
  }
  for (const [name, px] of Object.entries(tokens.radius)) assert.equal(value(light, 'radius-' + name), px + 'px', '--radius-' + name);
});

test('product surfaces switch to the dark tokens, and marketing pages never do', () => {
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark) {\n  :root[data-surface="product"] {');
  assert.notEqual(darkAt, -1, 'dark tokens are scoped to product surfaces');
  const dark = css.slice(css.indexOf('{', darkAt + 40) + 1, css.indexOf('}', darkAt));
  for (const [name, hex] of Object.entries(tokens.colour.dark)) assert.equal(value(dark, name), hex, 'dark --' + name);
  assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{/, 'no unscoped dark root');
  for (const page of ['account/index.html', 'app/account/index.html', 'handoff/index.html', 'play/index.html']) {
    const html = fs.readFileSync(path.join(root, 'dist', page), 'utf8');
    assert.match(html, /<html lang="en" data-surface="product"/, page + ' is a product surface');
    assert.match(html, /<meta name="color-scheme" content="light dark" \/>/, page + ' lets the browser draw controls in both appearances');
  }
  const home = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.doesNotMatch(home, /data-surface="product"/, 'the marketing home stays light');
});

test('the deprecated names stay as aliases for one release', () => {
  const light = block(':root {\n  /* Design tokens v2');
  for (const [old, now] of Object.entries(tokens.aliases)) assert.equal(value(light, old), 'var(--' + now + ')', '--' + old);
});

test('every listed pair passes its contrast minimum in light, dark and Increase Contrast', () => {
  const failures = [];
  const check = (palette, label, pairs) => {
    for (const [fg, bg, min] of pairs) {
      const ratio = contrast(palette[fg], palette[bg]);
      if (ratio < min) failures.push(label + ': ' + fg + ' on ' + bg + ' is ' + ratio.toFixed(2) + ', needs ' + min);
    }
  };
  check(tokens.colour.light, 'light', tokens.contrastPairs.pairs);
  check(tokens.colour.dark, 'dark', tokens.contrastPairs.pairs);
  check({ ...tokens.colour.light, ...tokens.colour.increaseContrast.light }, 'light, Increase Contrast', tokens.contrastPairs.pairs);
  check({ ...tokens.colour.dark, ...tokens.colour.increaseContrast.dark }, 'dark, Increase Contrast', tokens.contrastPairs.pairs);
  check(tokens.colour.stage, 'stage', tokens.contrastPairs.stagePairs);
  assert.deepEqual(failures, []);
});

test('the desk and buyer view stylesheets draw from tokens, not light-only literals', () => {
  for (const file of ['account-guide.css', 'account-journey.css']) {
    const text = fs.readFileSync(path.join(root, 'dist', file), 'utf8').replace(/@media print \{[\s\S]*$/, '');
    const literal = text.split('\n').filter(line => /background: (#fff|white|#f[0-9a-f]{5}|#e[0-9a-f]{5});/i.test(line) && !/qr/i.test(line));
    assert.deepEqual(literal, [], file + ' paints no fixed light ground');
    assert.doesNotMatch(text, /#897033/, file + ' focus comes from --focus');
  }
});
