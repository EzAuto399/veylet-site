'use strict';
/* Account Activity and walkthrough Insights. No private state is persisted in browser storage. */
(function (root) {
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const words = { ready_for_review: 'Ready to review', needs_recapture: 'Recapture needed', render_failed: 'Did not render', sharing_on: 'Sharing turned on', sharing_waits: 'Sharing waits' };
  const count = value => Number.isInteger(value) && value >= 0 ? value : null;
  const row = value => Array.isArray(value) ? value[0] : value;
  const missing = error => error?.code === 'PGRST202' || error?.code === '42883';
  const accessLost = error => [401, 403, 404].includes(Number(error?.status || error?.code)) || ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code);
  const unread = item => item.unread_eligible !== false && !item.read_at;
  const when = (value, utc = false) => { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(utc ? { timeZone: 'UTC' } : {}) }) : 'Time unavailable'; };
  async function call(rpc, name, args) {
    let timer;
    try {
      const answer = await Promise.race([Promise.resolve().then(() => rpc(name, args)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 12000); })]);
      if (answer?.error) throw Object.assign(new Error('request failed'), { code: answer.error.code, status: answer.status || answer.error.status });
      return row(answer?.data);
    } finally { clearTimeout(timer); }
  }
  function activityStore({ rpc, changed = () => {}, arrived = () => {} }) {
    let user = null, generation = 0, request = 0, readRequest = 0;
    let state = blank(); const seen = new Set();
    function blank() { return { phase: 'idle', items: [], unread: null, attention: null, cursor: null, snapshot: null, asOf: null, busy: false, reading: false, error: '' }; }
    const emit = () => changed(state);
    return {
      get state() { return state; },
      setUser(id) { if (id === user) return; user = id || null; generation++; request++; readRequest++; seen.clear(); state = blank(); emit(); },
      async load(more = false) {
        if (!user || state.reading || (more && !state.cursor)) return;
        const owner = generation, ticket = ++request, previous = state;
        state = { ...state, busy: true, error: '', phase: state.items.length ? state.phase : 'loading' }; emit();
        try {
          const data = await call(rpc, 'list_activity', { p_limit: 50, p_cursor: more ? previous.cursor : null });
          if (owner !== generation || ticket !== request) return;
          if (!data || !Array.isArray(data.items) || count(data.unread_count) === null || !data.items.every(item => item && UUID.test(item.id) && words[item.kind] && typeof item.needs_attention === 'boolean' && (item.unread_eligible === undefined || typeof item.unread_eligible === 'boolean'))) throw new Error('invalid response');
          const ids = new Set(previous.items.map(item => item.id)), firstSeen = data.items.filter(item => !seen.has(item.id));
          for (const item of data.items) seen.add(item.id);
          while (seen.size > 2000) seen.delete(seen.values().next().value);
          const items = more ? [...previous.items, ...data.items.filter(item => !ids.has(item.id))] : data.items;
          state = { phase: 'ready', items, unread: data.unread_count, attention: count(data.attention_count), cursor: data.next_cursor || null, snapshot: data.snapshot_token || previous.snapshot, asOf: data.as_of, busy: false, reading: previous.reading, error: '' }; emit();
          if (!more && previous.phase === 'ready') for (const item of firstSeen) if (unread(item) && item.kind === 'ready_for_review' && item.needs_attention && item.action === 'review') { arrived(item); break; }
        } catch (error) {
          if (owner !== generation || ticket !== request) return;
          if (accessLost(error) && !missing(error)) { state = { ...blank(), phase: 'error', error: 'Activity is no longer available for this account. Sign in or refresh your access.' }; emit(); return; }
          state = { ...previous, busy: false, phase: previous.items.length ? 'stale' : missing(error) ? 'unavailable' : 'error', error: missing(error) ? 'Activity is not available yet.' : 'Activity could not refresh. Try again.' }; emit();
        }
      },
      async mark(ids = [], all = false) {
        if (!user || state.reading || (!all && !ids.length) || (all && (!state.snapshot || !state.unread))) return false;
        const eligible = state.items.filter(unread);
        const chosen = new Set((all ? eligible : eligible.filter(item => ids.includes(item.id))).map(item => item.id));
        if (!all && !chosen.size) return false;
        const owner = generation, ticket = ++readRequest, before = state;
        ++request; // An older refresh cannot restore unread markers after this write.
        state = { ...state, busy: false, reading: true, error: '', unread: all ? 0 : state.unread === null ? null : Math.max(0, state.unread - chosen.size), items: state.items.map(item => chosen.has(item.id) ? { ...item, read_at: item.read_at || new Date().toISOString() } : item) }; emit();
        try {
          const data = await call(rpc, 'mark_activity_read', { p_event_ids: all ? [] : [...chosen], p_snapshot_token: all ? before.snapshot : null });
          if (owner !== generation || ticket !== readRequest) return false;
          if (!data || !Array.isArray(data.read_ids) || count(data.unread_count) === null) throw new Error('invalid response');
          const read = new Set(data.read_ids), original = new Map(before.items.map(item => [item.id, item.read_at]));
          state = { ...state, reading: false, unread: data.unread_count, items: state.items.map(item => item.unread_eligible !== false && read.has(item.id) ? { ...item, read_at: item.read_at || new Date().toISOString() } : chosen.has(item.id) ? { ...item, read_at: original.get(item.id) || null } : item) }; emit();
          return true;
        } catch (error) {
          if (owner !== generation || ticket !== readRequest) return false;
          if (accessLost(error)) { state = { ...blank(), phase: 'error', error: 'Activity is no longer available for this account. Sign in or refresh your access.' }; emit(); return false; }
          const original = new Map(before.items.map(item => [item.id, item.read_at]));
          state = { ...state, reading: false, unread: before.unread, items: state.items.map(item => chosen.has(item.id) ? { ...item, read_at: original.get(item.id) || null } : item), error: 'Read status could not save. Try again.' }; emit();
          return false;
        }
      },
    };
  }
  function el(doc, tag, text, cls) { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
  function button(doc, text, action, cls = 'tour-action') { const n = el(doc, 'button', text, cls); n.type = 'button'; n.dataset.journeyFocus = text; n.addEventListener('click', action); return n; }
  function toast(doc, text, action, key = text) {
    const host = doc.getElementById('journey-toast'); if (!host) return;
    const state = host._journey || (host._journey = { queue: [], current: null, timer: null });
    if (state.current?.key === key || state.queue.some(item => item.key === key)) return;
    const draw = () => {
      clearTimeout(state.timer); const item = state.queue.shift(); state.current = item || null;
      host.replaceChildren(); host.hidden = !item; if (!item) return;
      const message = el(doc, 'span', item.text); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
      host.append(message);
      if (item.action) host.append(button(doc, item.action.title || 'View', () => { const run = item.action.run; draw(); run(); }));
      const close = button(doc, '×', draw); close.setAttribute('aria-label', 'Dismiss message'); host.append(close);
      if (!item.action) state.timer = setTimeout(draw, 4000);
    };
    state.queue.push({ text, action, key }); if (state.queue.length > 3) state.queue.shift();
    if (!state.current) draw();
  }
  function clearToast(doc) { const host = doc.getElementById('journey-toast'); if (host?._journey) { clearTimeout(host._journey.timer); host._journey = null; host.replaceChildren(); host.hidden = true; } }
  function mountActivity({ document: doc, rpc, open }) {
    const host = doc.getElementById('account-activity'), launch = doc.getElementById('account-activity-open');
    if (!host || !launch) return null;
    let filter = null, identity = null;
    const store = activityStore({ rpc, changed: draw, arrived: item => {
      if (!doc.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(doc.activeElement?.tagName || '') && host.hidden) toast(doc, 'Your walkthrough is ready to review', { title: 'View', run: () => navigate(item) }, item.id);
    } });
    function navigate(item) { void store.mark([item.id]); open(item); }
    function draw(state) {
      const priorFocus = host.contains?.(doc.activeElement) ? doc.activeElement?.dataset?.journeyFocus : null;
      launch.textContent = state.unread === null ? 'Activity' : 'Activity' + (state.unread ? ' · ' + state.unread : '');
      launch.setAttribute('aria-label', state.unread === null ? 'Activity' : `Activity, ${state.unread} unread updates`);
      launch.setAttribute('aria-expanded', String(!host.hidden));
      if (host.hidden) return;
      const header = el(doc, 'div', undefined, 'journey-heading');
      const title = el(doc, 'h2', 'Activity'); title.id = 'account-activity-title';
      const mark = button(doc, 'Mark all read', () => { void store.mark([], true); }); mark.disabled = !state.snapshot || !state.unread || state.reading;
      header.append(title, mark);
      const intro = el(doc, 'p', 'Reading an update clears its unread marker. Tasks stay until completed.', 'contact-note');
      const controls = el(doc, 'div', undefined, 'journey-tabs');
      const attention = state.items.some(item => item.needs_attention);
      const selected = filter || (attention ? 'attention' : 'all');
      for (const [value, text] of [['attention', 'Needs attention'], ['all', 'All updates']]) {
        const b = button(doc, text, () => { filter = value; draw(store.state); }); b.setAttribute('aria-pressed', String(selected === value)); controls.append(b);
      }
      host.replaceChildren(header, intro, controls);
      if (state.error) { const error = el(doc, 'p', state.error, 'journey-error'); error.setAttribute('role', 'status'); host.append(error); }
      if (state.phase === 'loading' && !state.items.length) host.append(el(doc, 'p', 'Loading Activity…', 'contact-note'));
      const items = state.items.filter(item => selected !== 'attention' || item.needs_attention);
      if (!items.length && state.phase === 'ready') host.append(el(doc, 'p', selected === 'attention' ? state.cursor ? 'More updates may need attention. Load more to check.' : 'Nothing needs your attention.' : 'No updates yet. Your capture results will appear here.', 'journey-empty'));
      let group = null;
      for (const item of items) {
        const nextGroup = item.needs_attention ? 'Needs attention' : 'Recent updates';
        if (selected === 'all' && nextGroup !== group) { host.append(el(doc, 'h3', nextGroup, 'journey-group')); group = nextGroup; }
        const article = el(doc, 'article', undefined, 'journey-event'); article.dataset.eventId = item.id;
        const heading = el(doc, 'h3', words[item.kind]);
        if (unread(item)) { const unread = el(doc, 'span', 'Unread', 'journey-unread'); heading.append(unread); }
        article.append(heading, el(doc, 'p', item.space_name || 'Your space', 'journey-context'), el(doc, 'p', when(item.occurred_at), 'tour-when'));
        if (item.needs_attention) article.append(el(doc, 'p', 'Needs attention', 'journey-task'));
        const labels = { review: 'Review walkthrough', capture: 'See capture details', sharing: 'See sharing', space: 'Open space' };
        if (labels[item.action] && (UUID.test(item.tour_id || '') || UUID.test(item.property_id || ''))) { const link = button(doc, labels[item.action], () => navigate(item), 'tour-action tour-action-primary'); link.dataset.journeyFocus = 'open:' + item.id; article.append(link); }
        if (unread(item)) { const b = button(doc, 'Mark read', () => { void store.mark([item.id]); }); b.disabled = state.reading; b.dataset.journeyFocus = 'read:' + item.id; article.append(b); }
        host.append(article);
      }
      const foot = el(doc, 'div', undefined, 'journey-heading');
      const refresh = button(doc, state.busy ? 'Refreshing…' : 'Refresh Activity', () => { void store.load(); }); refresh.disabled = state.busy; refresh.dataset.journeyFocus = 'refresh-activity'; foot.append(refresh);
      if (state.cursor) { const more = button(doc, 'More updates', () => { void store.load(true); }); more.disabled = state.busy; foot.append(more); }
      host.append(foot);
      if (state.asOf) host.append(el(doc, 'p', (state.phase === 'stale' ? 'Saved update: ' : 'Updated: ') + when(state.asOf), 'tour-when'));
      if (priorFocus) {
        const buttons = [...host.querySelectorAll('button')];
        const match = buttons.find(b => b.dataset.journeyFocus === priorFocus && !b.disabled)
          || (priorFocus.startsWith('read:') && buttons.find(b => b.dataset.journeyFocus === 'open:' + priorFocus.slice(5)))
          || buttons.find(b => b.getAttribute('aria-pressed') === 'true' && !b.disabled)
          || refresh;
        match.focus({ preventScroll: true });
      }
      host.append(el(doc, 'p', 'Activity works without push notifications. Device settings remain on the device you capture with.', 'contact-note'));
    }
    launch.addEventListener('click', () => { host.hidden = !host.hidden; draw(store.state); if (!host.hidden && store.state.phase === 'idle') void store.load(); });
    return { setUser(id) { if (identity === id) return; identity = id; filter = null; host.hidden = true; store.setUser(id); clearToast(doc); }, load: () => store.load(), open() { host.hidden = false; draw(store.state); }, store };
  }
  function decodeInsights(data, tourID) {
    if (!data || data.schema_version !== 1 || data.tour_id?.toLowerCase() !== tourID.toLowerCase() || !['available', 'no_observations', 'not_shared', 'disabled', 'insufficient_data', 'unavailable'].includes(data.availability)) throw new Error('invalid insights');
    if (!data.totals || !data.coverage || !Array.isArray(data.stops)) throw new Error('invalid insights');
    for (const key of ['opens', 'explores', 'call_taps', 'email_taps', 'share_taps']) if (data.totals[key] !== null && data.totals[key] !== undefined && count(data.totals[key]) === null) throw new Error('invalid count');
    if (!data.stops.every(stop => /^s\d{1,3}$/.test(stop.id || '') && count(stop.visits) !== null && typeof stop.active_seconds === 'number' && stop.active_seconds >= 0 && Number.isFinite(stop.active_seconds) && count(stop.exits) !== null)) throw new Error('invalid stops');
    return data;
  }
  async function readInsights(rpc, tourID, days = 30) {
    if (!UUID.test(tourID || '') || ![7, 30, 90].includes(days)) throw new Error('invalid request');
    try { return decodeInsights(await call(rpc, 'get_walkthrough_insights', { p_tour_id: tourID, p_days: days }), tourID); }
    catch (error) {
      if (!missing(error)) throw error;
      const legacy = await call(rpc, 'get_tour_view_stats', { p_tour_id: tourID });
      if (!legacy || count(legacy.opens) === null) throw new Error('Insights unavailable');
      return { schema_version: 1, tour_id: tourID, availability: legacy.opens === 0 ? 'no_observations' : 'available', totals: { ...legacy, scope: 'recorded_history_all_revisions' }, coverage: { observed_visits: null, minimum_visits: 20, layout_available: false }, stops: [], legacy: true };
    }
  }
  function reportText(title, data) {
    const t = data.totals, v = value => count(value) === null ? 'Not available' : String(value);
    return [title || 'Walkthrough', data.legacy ? 'Recorded history · all revisions. Historical coverage unavailable.' : `Revision ${data.revision} · ${when(data.period_start, true)} to ${when(data.period_end, true)} · UTC`,
      `Recorded opens: ${v(t.opens)}`, `Explores: ${v(t.explores)}`, `Contact taps: ${count(t.call_taps) !== null && count(t.email_taps) !== null ? t.call_taps + t.email_taps : 'Not available'}`, `Share taps: ${v(t.share_taps)}`,
      'Opens include repeats. Contact taps are not confirmed enquiries. Share taps are not completed deliveries.', data.as_of ? 'Updated: ' + when(data.as_of) : 'Collection cutoff unavailable.',
      ...data.stops.map(stop => `${stop.label || stop.id}: ${stop.visits} observed visits; ${Math.round(stop.active_seconds)} active seconds; ${stop.exits} confirmed final stops.`)].join('\n');
  }
  function mountInsights({ document: doc, host, rpc, tourID, title, current = () => true, autoOpen = false }) {
    let version = 0, data = null, days = 30, busy = false, metric = 'visits';
    const summary = el(doc, 'summary', 'Insights');
    const content = el(doc, 'div', undefined, 'journey-insights');
    host.className = 'account-details tour-insights'; host.hidden = false; host.dataset.insights = tourID;
    host.replaceChildren(summary, content); host.open = autoOpen;
    async function load() {
      if (!current() || busy) return; const ticket = ++version; busy = true;
      draw('Loading Insights…');
      try { const result = await readInsights(rpc, tourID, days); if (ticket !== version || !current()) return; data = result; busy = false; draw(); }
      catch (error) { if (ticket !== version || !current()) return; busy = false; if (accessLost(error)) { data = null; draw('Insights are no longer available for this account. Sign in or refresh your access.'); } else draw(data ? 'Could not refresh. Showing the last successful read.' : 'Insights could not load. Try again.'); }
    }
    function draw(error = '') {
      const priorFocus = content.contains?.(doc.activeElement) ? doc.activeElement?.dataset?.journeyFocus : null;
      const restoreFocus = fallback => { if (!priorFocus) return; const match = [...content.querySelectorAll('button, select')].find(n => n.dataset.journeyFocus === priorFocus && !n.disabled) || fallback; match.focus({ preventScroll: true }); };
      content.replaceChildren();
      if (error) { const p = el(doc, 'p', error, busy ? 'contact-note' : 'journey-error'); p.setAttribute('role', 'status'); content.append(p); }
      if (data?.availability === 'not_shared') {
        content.append(el(doc, 'p', `Revision ${data.revision}`, 'journey-scope'), el(doc, 'p', 'Insights appear after this walkthrough is shared. Review and sharing controls are on this walkthrough.', 'journey-empty'));
        const refresh = button(doc, busy ? 'Loading…' : 'Refresh Insights', () => { void load(); }); refresh.setAttribute('aria-disabled', String(busy)); refresh.dataset.journeyFocus = 'refresh-insights'; content.append(refresh); restoreFocus(refresh);
        return;
      }
      if (data) {
        content.append(el(doc, 'p', data.legacy ? 'Recorded history · all revisions' : `Revision ${data.revision} · last ${days} days · UTC`, 'journey-scope'));
        if (!data.legacy) {
          const label = el(doc, 'label', 'Period '); const select = el(doc, 'select'); select.setAttribute('aria-label', 'Insights period'); select.dataset.journeyFocus = 'insights-period'; select.disabled = busy;
          for (const n of [7, 30, 90]) { const option = el(doc, 'option', `Last ${n} days`); option.value = String(n); option.selected = days === n; select.append(option); }
          select.addEventListener('change', () => { days = Number(select.value); data = null; void load(); }); label.append(select); content.append(label);
        }
        const labels = { not_shared: 'Insights appear after this walkthrough is shared.', disabled: 'Stop engagement is not collecting yet.', insufficient_data: 'Not enough observed visits for a stop map yet.', unavailable: 'Stop engagement is unavailable for this revision.', no_observations: 'No recorded opens yet.' };
        if (labels[data.availability]) content.append(el(doc, 'p', labels[data.availability], 'journey-empty'));
        const t = data.totals, metrics = el(doc, 'dl', undefined, 'journey-metrics');
        const contacts = count(t.call_taps) !== null && count(t.email_taps) !== null ? t.call_taps + t.email_taps : null;
        for (const [label, value] of [['Recorded opens', t.opens], ['Explores', t.explores], ['Contact taps', contacts], ['Share taps', t.share_taps]]) { const pair = el(doc, 'div'); pair.append(el(doc, 'dt', label), el(doc, 'dd', count(value) === null ? 'Unavailable' : String(value))); metrics.append(pair); }
        if (data.availability !== 'not_shared') content.append(metrics);
        content.append(el(doc, 'p', 'Repeat opens count. Contact taps are not confirmed enquiries. Share taps are not completed deliveries.', 'contact-note'));
        if (t.by_src && typeof t.by_src === 'object') {
          const sources = Object.entries(t.by_src).filter(([, value]) => count(value) !== null && value > 0);
          if (sources.length) { const list = el(doc, 'ul', undefined, 'journey-sources'); for (const [key, value] of sources) list.append(el(doc, 'li', `${({ link: 'Shared link', embed: 'Website embed', qr: 'QR code', portal: 'Listing portal', video: 'Video', unknown: 'Unknown' })[key] || 'Other'}: ${value}`)); content.append(el(doc, 'h3', 'Where opens came from'), list); }
        }
        const c = data.coverage;
        if (count(c.observed_visits) !== null) content.append(el(doc, 'p', `${c.observed_visits} observed visits · ${count(c.complete_visits) === null ? 'Completion coverage unavailable' : c.complete_visits + ' final summaries received'}`, 'contact-note'));
        content.append(el(doc, 'p', data.legacy ? 'Historical collection coverage is unavailable.' : 'Basic event history may be incomplete; historical event coverage is unknown. These are recorded observations, not unique people or physical movement. ' + (count(c.dropped_visits) !== null ? `${c.dropped_visits} known omitted visits in the separate stop-engagement stream.` : 'Collection coverage may be incomplete.'), 'contact-note'));
        if (data.stops.length && ['available', 'insufficient_data'].includes(data.availability) && count(c.observed_visits) !== null && c.observed_visits > 0) {
          content.append(el(doc, 'h3', 'Stop engagement'));
          const tabs = el(doc, 'div', undefined, 'journey-tabs');
          for (const [value, label] of [['visits', 'Stops reached'], ['active_seconds', 'Active time'], ['exits', 'Visits ending here']]) { const b = button(doc, label, () => { metric = value; draw(); }); b.setAttribute('aria-pressed', String(metric === value)); tabs.append(b); } content.append(tabs);
          const eligible = count(c.observed_visits) !== null && c.observed_visits >= Math.max(20, c.minimum_visits || 20);
          if (eligible && c.layout_available && data.stops.every(s => Number.isFinite(s.x) && s.x >= 0 && s.x <= 1 && Number.isFinite(s.y) && s.y >= 0 && s.y <= 1) && doc.createElementNS) {
            const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('journey-stop-map'); svg.setAttribute('viewBox', '0 0 360 240'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Stop engagement diagram. Equivalent values are listed below. This is not a floor plan.');
            const max = Math.max(1, ...data.stops.map(s => s[metric]));
            data.stops.forEach(s => { const circle = doc.createElementNS(svg.namespaceURI, 'circle'); const x = 30 + s.x * 300, y = 30 + s.y * 170; circle.setAttribute('cx', String(x)); circle.setAttribute('cy', String(y)); circle.setAttribute('r', String(7 + 15 * s[metric] / max)); circle.setAttribute('fill-opacity', String(.3 + .7 * s[metric] / max)); const label = doc.createElementNS(svg.namespaceURI, 'text'); label.setAttribute('x', String(x)); label.setAttribute('y', String(y + 31)); label.setAttribute('text-anchor', 'middle'); label.textContent = s.label || s.id; svg.append(circle, label); }); content.append(svg, el(doc, 'p', 'Larger, darker circles show more recorded engagement. Positions belong to this revision; this diagram is not a floor plan.', 'contact-note'));
          } else if (!eligible) content.append(el(doc, 'p', `Stop maps appear after ${Math.max(20, c.minimum_visits || 20)} observed visits. Counts remain available below.`, 'contact-note'));
          const table = el(doc, 'table', undefined, 'journey-stops'); const caption = el(doc, 'caption', metric === 'visits' ? 'Observed visits reaching each stop' : metric === 'exits' ? 'Visits with a received final summary ending here' : 'Active foreground seconds at each stop'); const tbody = el(doc, 'tbody');
          data.stops.forEach(s => { const tr = el(doc, 'tr'); const name = el(doc, 'th', s.label || s.id); name.scope = 'row'; tr.append(name, el(doc, 'td', String(Math.round(s[metric])) + (metric === 'active_seconds' ? ' s' : ''))); tbody.append(tr); }); table.append(caption, tbody); content.append(table);
        }
        if (data.as_of) content.append(el(doc, 'p', 'Updated: ' + when(data.as_of), 'tour-when'));
        const report = button(doc, 'Copy Insights summary', async () => {
          const text = reportText(title, data);
          try { await root.navigator.clipboard.writeText(text); if (current()) toast(doc, 'Insights summary copied'); }
          catch { if (current()) { const field = el(doc, 'textarea'); field.value = text; field.readOnly = true; field.setAttribute('aria-label', 'Insights summary to copy'); content.append(field); field.focus(); field.select(); } }
        }); content.append(report);
      }
      const retry = button(doc, busy ? 'Loading…' : data ? 'Refresh Insights' : 'Try again', () => { void load(); }); retry.setAttribute('aria-disabled', String(busy)); retry.dataset.journeyFocus = 'refresh-insights'; content.append(retry); restoreFocus(retry);
    }
    host.addEventListener('toggle', () => { if (host.open && !data && !busy) void load(); });
    if (autoOpen) void load(); else content.append(el(doc, 'p', 'Open Insights to load recorded counts for this walkthrough.', 'contact-note'));
    return { load, dispose() { version++; }, get data() { return data; } };
  }
  const api = { activityStore, mountActivity, toast, clearToast, decodeInsights, readInsights, mountInsights, reportText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VeyletJourney = api;
})(typeof window === 'undefined' ? globalThis : window);
