'use strict';
// The page library every dist script shares; pages load it before their page scripts.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /** Never leave the desk waiting on one unanswered request. */
  async function settled(promise, ms = 20000) {
    let timer = null;
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), ms);
    });
    const result = await Promise.race([
      promise.then((value) => ({ value })).catch((error) => ({ error })),
      expired,
    ]);
    if (timer) clearTimeout(timer);
    return result;
  }

  function failed(result) { return !result || Boolean(result.timedOut || result.error || result.value?.error); }

  function firstRow(data) { return Array.isArray(data) ? data[0] : data; }

  // A backend without the function answers PGRST202 ("Could not find the
  // function"), or Postgres undefined_function 42883. Accepts either a settled
  // result ({ value } | { error } | { timedOut }) or a raw error object.
  function missingFunction(x) {
    const e = x?.value?.error || x?.error || x;
    return String(e?.code) === 'PGRST202' || String(e?.code) === '42883' || /could not find the function/i.test(String(e?.message || ''));
  }

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function plural(number, word) { return number + ' ' + word + (number === 1 ? '' : 's'); }

  /** The one Supabase client options block the site pages create. */
  function client({ detectSessionInUrl = false } = {}) {
    return root.supabase.createClient(root.VEYLET_SUPABASE.url, root.VEYLET_SUPABASE.anonKey, {
      auth: { persistSession: true, detectSessionInUrl, flowType: 'pkce' },
    });
  }

  root.VeyletLib = Object.freeze({ settled, failed, firstRow, missingFunction, element, plural, client });
})();
