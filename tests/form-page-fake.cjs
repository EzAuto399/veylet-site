'use strict';
// A stand-in page for the waitlist, report and launch-stage tests: every element with an id in the
// markup, the few DOM calls those scripts make, a FormData reader and a recording fetch. It is not a
// browser; layout, focus rings and 44px targets are checked in the headless renders.

class Element {
  constructor(tag, hidden = false, attributes = {}) {
    this.tagName = String(tag).toUpperCase();
    this.hidden = hidden;
    this.disabled = false;
    this.attributes = { ...attributes };
    this.children = [];
    this.events = {};
    this.focused = 0;
    this._text = '';
  }
  get textContent() { return this._text + this.children.map(child => (typeof child === 'string' ? child : child.textContent)).join(''); }
  set textContent(value) { this.children = []; this._text = String(value ?? ''); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
  async fire(name, event = {}) {
    const full = { preventDefault() { this.defaultPrevented = true; }, target: this, ...event };
    for (const handler of this.events[name] || []) await handler(full);
    return full;
  }
  querySelector(selector) { return (this.selectors && this.selectors[selector]) || null; }
  querySelectorAll(selector) { return (this.lists && this.lists[selector]) || []; }
  focus() { this.focused += 1; }
  links() { return this.children.filter(child => typeof child !== 'string' && child.tagName === 'A'); }
}

/** Every element carrying an id in the markup, keyed by id, with its hidden flag and attributes. */
function elementsById(markup) {
  const ids = {};
  const clean = markup.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of clean.matchAll(/<([\w-]+)\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[2]);
    if (!id) continue;
    const attributes = {};
    for (const attr of match[2].matchAll(/\b([\w-]+)(?:="([^"]*)")?/g)) attributes[attr[1]] = attr[2] ?? '';
    ids[id[1]] = new Element(match[1], 'hidden' in attributes, attributes);
  }
  return ids;
}

class FakeFormData {
  constructor(values) { this.values = values; }
  get(name) { const value = this.values[name]; return Array.isArray(value) ? (value[0] ?? null) : (value ?? null); }
  getAll(name) { const value = this.values[name]; return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
}

/** A fetch that answers from a queue: { status, body } or an Error to throw. */
function recordingFetch(answers) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  return { fetch, requests };
}

module.exports = { Element, elementsById, FakeFormData, recordingFetch };
