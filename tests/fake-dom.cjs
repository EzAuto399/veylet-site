'use strict';
// A small stand-in DOM for node:test + vm: enough for the player v2 and the
// hand-off kit to build their interface, fire events and be inspected. It is
// not a browser; rendering and layout are proven by the loopback browser runs.

function parseSelector(selector) {
  return selector.trim().split(/\s+/).map(part => {
    const tag = (part.match(/^[a-z][a-z0-9-]*/i) || [null])[0];
    const classes = [...part.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    const attrs = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map(m => [m[1], m[2]]);
    return { tag, classes, attrs };
  });
}
function matchesOne(node, { tag, classes, attrs }) {
  if (!node.tagName) return false;
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  const own = node.className.split(/\s+/);
  if (classes.some(name => !own.includes(name))) return false;
  for (const [name, value] of attrs) {
    const actual = name.startsWith('data-') ? node.dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] : node.getAttribute(name);
    if (actual === undefined || actual === null) return false;
    if (value !== undefined && String(actual) !== value) return false;
  }
  return true;
}
function matches(node, selector) {
  return selector.split(',').some(alternative => {
    const chain = parseSelector(alternative);
    if (!matchesOne(node, chain[chain.length - 1])) return false;
    let current = node.parentNode;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (current && !matchesOne(current, chain[i])) current = current.parentNode;
      if (!current) return false;
      current = current.parentNode;
    }
    return true;
  });
}

function createDocument({ onImage, onHeadAppend } = {}) {
  const document = { hidden: false, activeElement: null, fullscreenEnabled: false, listeners: new Map(), log: [] };
  class FakeNode {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.dataset = {};
      this.style = { setProperty(key, value) { this[key] = value; } };
      this.hidden = false;
      this.disabled = false;
      this.clientWidth = 0;
      this.clientHeight = 0;
      this._text = '';
      this._src = '';
      const node = this;
      this.classList = {
        add(...names) { const set = new Set(node.className.split(/\s+/).filter(Boolean)); names.forEach(n => set.add(n)); node.className = [...set].join(' '); },
        remove(...names) { node.className = node.className.split(/\s+/).filter(n => n && !names.includes(n)).join(' '); },
        contains(name) { return node.className.split(/\s+/).includes(name); },
      };
    }
    get className() { return this.attributes.get('class') || ''; }
    set className(value) { this.attributes.set('class', String(value)); }
    get id() { return this.attributes.get('id') || ''; }
    set id(value) { this.attributes.set('id', String(value)); }
    get title() { return this.attributes.get('title') || ''; }
    set title(value) { this.attributes.set('title', String(value)); }
    setAttribute(name, value) {
      if (name === 'hidden') { this.hidden = true; return; }
      if (name.startsWith('data-')) { this.dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(value); return; }
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      if (name === 'hidden') return this.hidden ? '' : null;
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    removeAttribute(name) { if (name === 'hidden') this.hidden = false; else this.attributes.delete(name); }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    get src() { return this._src; }
    set src(value) {
      this._src = String(value);
      document.log.push(this.tagName.toLowerCase() + ':' + this._src);
      if (this.tagName === 'IMG') onImage?.(this);
    }
    append(...nodes) {
      for (const node of nodes) {
        if (typeof node === 'string') { this._text += node; continue; }
        node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
        node.parentNode = this;
        this.children.push(node);
        if (this === document.head) onHeadAppend?.(node);
      }
    }
    replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
    remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
    get firstChild() { return this.children[0] || null; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get innerText() { return this.textContent; }
    set innerHTML(value) { this.replaceChildren(); this._html = String(value); }
    get innerHTML() { return this._html || ''; }
    addEventListener(type, listener, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ listener, once: Boolean(options && options.once) });
    }
    removeEventListener(type, listener) { const list = this.listeners.get(type) || []; this.listeners.set(type, list.filter(item => item.listener !== listener)); }
    dispatch(type, event = {}) {
      const payload = { type, target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...event };
      for (let node = this; node && !payload.stopped; node = node.parentNode) {
        const list = node.listeners.get(type) || [];
        node.listeners.set(type, list.filter(item => !item.once));
        for (const item of list) item.listener.call(node, payload);
      }
      return payload;
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
    contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
    querySelectorAll(selector) {
      const found = [];
      const walk = node => { for (const child of node.children) { if (matches(child, selector)) found.push(child); walk(child); } };
      walk(this);
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
    setPointerCapture() {}
    requestFullscreen() { return Promise.resolve(); }
  }
  document.createElement = tag => new FakeNode(tag);
  document.createElementNS = (ns, tag) => new FakeNode(tag);
  document.head = new FakeNode('head');
  document.body = new FakeNode('body');
  document.querySelector = selector => document.head.querySelector(selector) || document.body.querySelector(selector);
  document.querySelectorAll = selector => [...document.head.querySelectorAll(selector), ...document.body.querySelectorAll(selector)];
  const findById = id => { let hit = null; const walk = node => { for (const child of node.children) { if (child.id === id) hit = hit || child; walk(child); } }; walk(document.head); walk(document.body); return hit; };
  document.getElementById = findById;
  document.addEventListener = (type, listener) => { if (!document.listeners.has(type)) document.listeners.set(type, new Set()); document.listeners.get(type).add(listener); };
  document.removeEventListener = (type, listener) => document.listeners.get(type)?.delete(listener);
  document.FakeNode = FakeNode;
  return document;
}

module.exports = { createDocument, matches };
