/*
 * A stand-in desk for dist/account.js: the account page's ids as elements that keep
 * their children, listeners, attributes and focus, a Supabase client whose tables and
 * RPCs a test answers (anything unanswered is PGRST202, a backend without the
 * function), and helpers to find what a person would see. Used by the listing gate
 * and team tests; other tests keep their own stand-ins.
 */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dist = path.join(__dirname, '../dist');
const account = fs.readFileSync(path.join(dist, 'account.js'), 'utf8');
const sharing = fs.readFileSync(path.join(dist, 'tour-sharing.js'), 'utf8');
const missing = name => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name + ' in the schema cache' } });
const settle = async (rounds = 30) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };

class Element {
  constructor(tag = 'div', doc = null) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.checked = false; this.textContent = ''; this.value = ''; this.className = '';
    this.open = false; this.parent = null; this.doc = doc; this.id = '';
    const el = this;
    this.classList = {
      add(...names) { el.className = [...new Set([...el.className.split(/\s+/), ...names].filter(Boolean))].join(' '); },
      remove(...names) { el.className = el.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
      contains(name) { return el.className.split(/\s+/).includes(name); },
    };
  }
  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (typeof child === 'string') { this.textContent += child; continue; }
      if (child.parent) child.parent.children = child.parent.children.filter(node => node !== child);
      child.parent = this; this.children.push(child);
    }
  }
  prepend(...children) { const rest = this.children; this.children = []; this.append(...children); this.children.push(...rest); }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  removeEventListener() {}
  async fire(name) { for (const handler of this.listeners[name] || []) await handler({ preventDefault() {}, target: this }); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  shown() { return this.hidden ? [] : this.children.filter(child => !child.hidden).flatMap(child => [child, ...child.shown()]); }
  text() { return [this.textContent, ...this.children.map(child => child.text())].filter(Boolean).join(' '); }
  focus() { this.wasFocused = true; if (this.doc) this.doc.activeElement = this; }
  blur() {} scrollIntoView() {} select() {} reset() {} click() { this.clicked = (this.clicked || 0) + 1; }
}

/**
 * options: tables ({ properties, tours, memberships }), rpc ({ name: (args, h) => answer }),
 * approved (tour ids whose review is approved; default all), appMode, search, signedOut,
 * navigator, pathname, formData (what the sign-in form's fields hold).
 */
async function loadDesk(options = {}) {
  const markup = fs.readFileSync(path.join(dist, options.appMode ? 'app/account/index.html' : 'account/index.html'), 'utf8');
  const doc = { hidden: false, activeElement: null };
  const ids = {};
  for (const match of markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = new Element(match[1], doc); el.id = match[2]; el.hidden = /\shidden\b/.test(match[0]); ids[match[2]] = el;
  }
  const calls = [], redirects = [], otp = [];
  const user = { id: 'user-1', email: 'owner@example.invalid' };
  const tables = {
    properties: { data: [{ id: 'p1', title: 'Harbour loft', workspace_id: 'w1' }] },
    tours: { data: [{ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: null }] },
    memberships: { data: [{ workspace_id: 'w1', role: options.role || 'owner', status: 'active' }] },
    ...(options.tables || {}),
  };
  const approved = options.approved || null;
  const h = { ids, calls, redirects, otp, doc };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: options.signedOut ? null : { user, access_token: 'token-1' } } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signOut: async () => ({}),
      signInWithOtp: async args => { otp.push(JSON.parse(JSON.stringify(args))); return { error: null }; },
      verifyOtp: async () => ({ error: { message: 'not in this stand-in' } }),
    },
    from(name) {
      const answer = () => tables[name] || { data: [] };
      const builder = { select() { return builder; }, order() { return builder; }, eq() { return builder; }, limit() { return builder; },
        single() { const result = answer(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); },
        then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); } };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc?.[name]) return options.rpc[name](args, h);
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      if (name === 'get_tour_review') return { data: [{ approved: approved ? approved.includes(args.p_tour_id) : true }] };
      if (name === 'get_tour_review_target') {
        const tour = tables.tours.data.find(row => row.id === args.p_tour_id);
        return { data: [{ tour_id: tour?.id, storage_path: tour?.storage_path, package_revision: 'a'.repeat(64) }] };
      }
      return missing(name);
    },
  };
  const window = {
    VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase },
    VeyletPlace: { generalLocationProblem: () => '' }, VEYLET_HOOKS: { url: 'https://hooks.example.invalid' }, addEventListener() {},
  };
  const documentStub = Object.assign(doc, {
    getElementById: id => ids[id] || null, createElement: tag => new Element(tag, doc), addEventListener() {},
    head: { append() {} }, documentElement: { dataset: options.appMode ? { appMode: 'true' } : {} },
  });
  const context = {
    window, document: documentStub, Date, URL, URLSearchParams, Intl, TypeError,
    navigator: options.navigator || { onLine: true, clipboard: { writeText: async () => {} } },
    location: { pathname: options.pathname || (options.appMode ? '/app/account' : '/account'), search: options.search || '',
      replace: url => redirects.push(url), assign() {} },
    setTimeout: () => ({}), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    FormData: class { get(key) { return (options.formData || {})[key] ?? ''; } }, Blob: class {},
  };
  vm.runInNewContext(sharing, context);
  await vm.runInNewContext(account, context);
  await settle();
  Object.assign(h, {
    supabase, settle,
    status: () => ids['account-status'].textContent,
    gate: (index = 0) => ids['account-properties'].all().filter(el => el.className === 'dash-occupancy')[index] || null,
    card: (tourId = 't1') => ids['account-properties'].all().find(el => el.dataset?.tour === tourId) || null,
    find: (root, test) => root.all().find(test) || null,
    control: (root, name) => root.all().find(el => el.dataset?.control === name) || null,
    button: (root, label) => root.shown().find(el => el.tagName === 'BUTTON' && el.textContent === label) || null,
    words: root => root.shown().map(el => el.textContent).filter(Boolean),
    // Arguments as plain data: they were made in the page's own realm.
    called: name => calls.filter(([called]) => called === name).map(([, args]) => JSON.parse(JSON.stringify(args ?? null))),
  });
  return h;
}

module.exports = { Element, loadDesk, missing, settle };
