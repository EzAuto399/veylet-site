#!/usr/bin/env node
/*
 * The pages the Veylet Capture app opens (/app/*) state no price and sell
 * nothing (App Store Guideline 3.1.1; launch plan C1). This fails when any of
 * them, rendered or in reach of their scripts in app mode, says "A$", "$",
 * "pack", "Super fast", "express", "/offer" or "price", or links out of /app.
 *
 * Two passes, both local and offline:
 * 1. Static: every dist/app/<page>/index.html, as a reader and a crawler see it
 *    (text, link targets, meta content, alt and label text, inline script
 *    strings). Comments are the authors' notes and are not read.
 * 2. Rendered: dist/account.js runs in app mode (data-app-mode="true") against
 *    the QA fixture's answers (tests/account-browser-fixture.js, which carries
 *    the full money shapes: plans with prices, card offers, bundles, fast
 *    renders, referral links, ended hosting with its extension price) on a
 *    stand-in DOM that records every string the script ever writes: text,
 *    link targets, values, labels and titles, including status lines that are
 *    replaced a moment later. The fixture's RPC log must hold no money call.
 *
 * Usage: node scripts/check-app-pages.mjs [dist directory]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');

export const BANNED = Object.freeze([
  ['A$', /A\$/],
  ['$', /\$/],
  ['pack', /\bpacks?\b/i],
  ['Super fast', /super[\s-]*fast/i],
  ['express', /\bexpress\b/i],
  ['/offer', /\/offer\b/i],
  ['price', /pric(?:e|ing)/i],
]);
// Functions that only exist to sell something. App mode never asks for them.
export const MONEY_CALLS = Object.freeze(['get_trial_offer', 'get_pack_offer', 'get_members_annual_offer', 'get_express_offer',
  'use_express_credit', 'get_referral_code', 'claim_workspace_referral', 'get_walkthrough_capacity']);

export function findBanned(text, where) {
  const found = [];
  for (const [name, pattern] of BANNED) {
    const match = pattern.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 40);
      found.push({ where, word: name, excerpt: text.slice(start, match.index + 40).replace(/\s+/g, ' ').trim() });
    }
  }
  return found;
}

export function appPages(dist) {
  const root = join(dist, 'app');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'index.html')))
    .map(entry => 'app/' + entry.name + '/index.html').sort();
}

const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** What a reader or a crawler gets from one page: text, then each attribute that names or links something. */
export function pageStrings(html) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const scripts = [...noComments.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const literals = scripts.flatMap(code => [...code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map(match => match[2]));
  const text = decode(noComments.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const attributes = [...noComments.matchAll(/\b(href|src|content|title|alt|aria-label|placeholder|value|action)\s*=\s*(["'])(.*?)\2/gi)]
    .map(match => ({ name: match[1].toLowerCase(), value: decode(match[3]) }));
  return { text, attributes, literals };
}

/** Links from an app page stay on the app's pages (or are mail links). */
export function outsideLinks(html) {
  return pageStrings(html).attributes.filter(({ name, value }) => name === 'href' && !/^(\/app\/[a-z/-]*|#[\w-]+|mailto:[^"]+|data:,?|\/media\/[\w.-]+|\/[\w./-]+\.css(\?v=[a-f\d]{16})?)$/.test(value))
    .map(({ value }) => value);
}

/* ---- the stand-in DOM: every string written is kept ---------------------- */

function standIn(written) {
  const note = value => { if (value !== undefined && value !== null && value !== '') written.push(String(value)); };
  class Element {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attributes = {};
      this.listeners = {}; this.hidden = false; this.disabled = false; this.style = {}; this._text = ''; this._value = ''; this._href = '';
      this.className = ''; this.type = ''; this.checked = false; this.open = false;
      const el = this;
      this.classList = { add(...names) { el.className = [...new Set([...el.className.split(/\s+/), ...names].filter(Boolean))].join(' '); },
        remove(...names) { el.className = el.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
        contains(name) { return el.className.split(/\s+/).includes(name); } };
    }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.children = []; this._text = String(value ?? ''); note(value); }
    get value() { return this._value; } set value(value) { this._value = String(value ?? ''); note(value); }
    get href() { return this._href; } set href(value) { this._href = String(value ?? ''); note(value); }
    get innerHTML() { return this._html || ''; } set innerHTML(value) { this.children = []; this._html = String(value ?? ''); note(String(value ?? '').replace(/<[^>]+>/g, ' ')); for (const m of String(value ?? '').matchAll(/aria-label="([^"]*)"/g)) note(m[1]); }
    set title(value) { this.attributes.title = String(value); note(value); } get title() { return this.attributes.title || ''; }
    set placeholder(value) { this.attributes.placeholder = String(value); note(value); }
    set download(value) { this.attributes.download = String(value); note(value); }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'string') { this._text += node; note(node); continue; } node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); if (!['class', 'style', 'id', 'role', 'aria-hidden', 'aria-busy', 'tabindex'].includes(name)) note(value); }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    removeEventListener() {}
    async fire(name) { for (const fn of this.listeners[name] || []) await fn({ preventDefault() {}, target: this }); }
    contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    querySelector() { return null; } querySelectorAll() { return []; }
    focus() {} blur() {} click() {} select() {} scrollIntoView() {} reset() {}
    getContext() { return { fillRect() {}, set fillStyle(v) {} }; }
    toBlob(done) { done({ size: 1 }); }
  }
  return Element;
}

/** Runs the app account page's scripts once for one fixture query and returns every string written. */
export async function renderAppAccount(dist, search = '', options = {}) {
  const html = readFileSync(join(dist, 'app/account/index.html'), 'utf8');
  const written = [];
  const Element = standIn(written);
  const ids = {};
  for (const match of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = new Element(match[1]); ids[match[2]].hidden = /\shidden\b/.test(match[0]);
  }
  const appMode = /<html\b[^>]*\bdata-app-mode="true"/.test(html);
  const listeners = {};
  const document = {
    hidden: false, activeElement: null, title: '', readyState: 'complete',
    documentElement: { dataset: appMode ? { appMode: 'true' } : {} },
    getElementById: id => ids[id] || null, createElement: tag => new Element(tag), querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (name, fn) => { listeners[name] = fn; }, head: new Element('head'), body: new Element('body'),
    execCommand: () => true,
  };
  const storage = new Map();
  const context = {
    document, URLSearchParams, URL: Object.assign(function FakeURL(...args) { return new URL(...args); }, { createObjectURL: () => 'blob:app-check', revokeObjectURL() {} }),
    TextEncoder, Response, Blob: class {}, Date, Intl, Math, JSON, Promise, console: { log() {}, warn() {}, error() {} },
    FormData: class { get() { return ''; } }, crypto: { getRandomValues: array => array },
    location: { pathname: '/app/account', search, hash: '', origin: 'https://veylet.com', href: 'https://veylet.com/app/account' + search, replace() {}, assign() {}, reload() {} },
    navigator: { onLine: true, clipboard: { writeText: async () => {} }, userAgent: 'app-check' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn, ms) => { if (!ms) setImmediate(fn); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener: (name, fn) => { listeners['window:' + name] = fn; }, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  context.window = context; context.self = context;
  vm.createContext(context);
  // The page's own scripts, in order, as the QA server serves them: the fixture in
  // place of the service configuration, no network SDK, no vendored generator.
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(match => match[1].split('?')[0]);
  for (const src of sources) {
    if (src === '/supabase-public.js') vm.runInContext(readFileSync(join(REPO, 'tests/account-browser-fixture.js'), 'utf8'), context);
    else if (src.startsWith('/vendor/')) continue;
    else vm.runInContext(readFileSync(join(dist, src.slice(1)), 'utf8'), context);
  }
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  // Press what a person could press on a drawn desk, so each answer's words are written too.
  if (options.press !== false) {
    const everything = () => Object.values(ids).flatMap(el => [el, ...el.all()]);
    const labels = ['Turn off sharing', 'Withdraw approval', 'Pause sharing', 'Copy link', 'Copy listing URL (portals, CRM)', 'Copy embed code',
      'Resume sharing', 'Show what to recapture', 'Delete my account', 'Refresh plan status'];
    for (const label of labels) {
      for (const el of everything().filter(node => node.textContent === label && node.tagName === 'BUTTON')) { await el.fire('click'); await settle(); }
    }
    for (const el of everything().filter(node => node.tagName === 'DETAILS')) { el.open = true; await el.fire('toggle'); }
    await settle();
  }
  written.push(document.title);
  return { written, calls: (context.VEYLET_QA_CALLS || []).map(call => call.name), appMode };
}

// Fixture queries that between them reach every state the app page can draw.
export const APP_ACCOUNT_CASES = Object.freeze([
  '', '?case=hosting-errors', '?case=new', '?case=operator', '?session=out',
  '?case=plan-pending', '?case=plan-trial', '?case=plan-trial-ending', '?case=plan-apple-trial', '?case=plan-active',
  '?case=plan-web-active', '?case=plan-apple-active', '?case=plan-monthly-banked', '?case=plan-annual-pool', '?case=plan-team-active',
  '?case=plan-trial-exhausted', '?case=plan-ended', '?case=plan-ended-after-active', '?case=plan-nomembership',
  '?express=offer&render=rendering', '?express=ordered&render=rendering', '?express=credit&render=waiting', '?render=all',
  '?referral=link&ref=0123456789ab', '?packs=credits', '?annual=scheduled', '?trial=choose&case=plan-pending',
  '?pause=paused', '?pause=missing', '?views=zero', '?contact=shown', '?case=correction', '?share=review',
]);

export async function checkAppPages(dist = join(REPO, 'dist')) {
  const problems = [];
  const pages = appPages(dist);
  if (!pages.length) problems.push({ where: 'dist/app', word: 'missing', excerpt: 'no app pages found' });
  for (const page of pages) {
    const html = readFileSync(join(dist, page), 'utf8');
    const { text, attributes, literals } = pageStrings(html);
    problems.push(...findBanned(text, page + ' (text)'));
    for (const { name, value } of attributes) problems.push(...findBanned(value, page + ' (' + name + ')'));
    for (const literal of literals) problems.push(...findBanned(literal, page + ' (inline script)'));
    for (const link of outsideLinks(html)) problems.push({ where: page + ' (link)', word: 'outside /app', excerpt: link });
    if (!/<meta name="robots" content="noindex/.test(html)) problems.push({ where: page, word: 'noindex', excerpt: 'no robots noindex meta' });
    if (/<nav\b[^>]*aria-label="Main"/.test(html)) problems.push({ where: page, word: 'navigation', excerpt: 'marketing navigation' });
  }
  let rendered = 0;
  if (pages.includes('app/account/index.html')) {
    for (const search of APP_ACCOUNT_CASES) {
      const { written, calls, appMode } = await renderAppAccount(dist, search);
      if (!appMode) problems.push({ where: 'app/account', word: 'mode', excerpt: 'data-app-mode="true" is missing on <html>' });
      rendered += written.length;
      for (const value of new Set(written)) problems.push(...findBanned(value, 'app/account' + (search || ' (default)') + ' rendered'));
      for (const call of new Set(calls)) if (MONEY_CALLS.includes(call)) problems.push({ where: 'app/account' + (search || ' (default)'), word: 'money call', excerpt: call });
    }
  }
  return { pages, cases: pages.includes('app/account/index.html') ? APP_ACCOUNT_CASES.length : 0, rendered, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(REPO, 'dist');
  const result = await checkAppPages(dist);
  if (result.problems.length) {
    for (const problem of result.problems.slice(0, 50)) console.error(`${problem.where}: ${problem.word} — ${problem.excerpt}`);
    console.error(`${result.problems.length} problem(s) on the pages the app opens.`);
    process.exitCode = 1;
  } else {
    console.log(`${result.pages.length} app pages clean; ${result.cases} rendered states of /app/account, ${result.rendered} written strings, no amount, purchase word or outside link.`);
  }
}
