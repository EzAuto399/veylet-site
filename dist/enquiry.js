'use strict';
/*
 * /request: the walkthrough enquiry form. Since 30 September 2026 the answers go to rpc/submit_enquiry on
 * the hosted database (the product repository's enquiry migration) with the public key and the form answers
 * only: no third-party script, no cookie, no Referer, no form service. The database stores the enquiry,
 * emails the studio a copy and the person a confirmation (Resend), and answers received with its own
 * reference (VY- and 24 hex characters), invalid with the field it refused, or busy. The page shows that
 * reference only after the database has received the enquiry; it never makes one up.
 * The honeypot (_honey) is sent as p_honey and the server decides: it answers a success and stores nothing.
 * A page without its database configuration, a missing function or a failed call saves nothing, and the
 * page says so and gives support@veylet.com.
 * /thanks: older links (/thanks?route=managed&ref=VY-…) still show a well-formed reference as context.
 */
(() => {
  // A reference helps reconcile correspondence. It is not an account identifier or capability, and
  // contains no contact information.
  const referencePattern = /^VY-[a-f0-9]{24}$/;
  const SUPPORT = 'support@veylet.com';
  const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  const SPACES = ['Home', 'Clinic', 'Hospitality', 'Venue', 'Showroom', 'Interior or installation', 'Other'];
  const ENQUIRY_AS = ['A property agency or team', 'A homeowner or occupier', 'A business or venue', 'Something else'];
  // The named parameters of rpc/submit_enquiry this form sends (its optional p_description is not asked).
  const PARAMS = ['p_name_and_business', 'p_email', 'p_space_category', 'p_location', 'p_audience', 'p_capture_route',
    'p_device_model', 'p_timing', 'p_size_and_rooms', 'p_enquiry_as', 'p_agency_fit', 'p_honey'];
  const LIMITS = { name_and_business: 200, email: 254, location: 80, audience: 1500, timing: 300, size_and_rooms: 300,
    agency_fit: 600, device_model: 120 };
  const MULTILINE = ['audience', 'agency_fit'];
  const NOT_SAVED = 'We couldn’t send your enquiry just now, so nothing was saved. Try again in a minute, or email ' + SUPPORT + '.';
  const COPY = {
    sending: 'Sending…',
    busy: 'We’re receiving a lot of enquiries right now, so nothing was saved. Try again in a minute, or email ' + SUPPORT + '.',
    error: NOT_SAVED,
    missing: NOT_SAVED,
    invalidAny: 'One answer wasn’t accepted, so nothing was saved. Check your answers and send again.',
    receivedTitle: 'Received.',
    inbox: 'Check your inbox for a confirmation.',
  };
  // The questions as the page asks them, in page order, for "which answer was not accepted".
  const QUESTIONS = {
    capture_route: 'How would you like to capture it?', device_model: 'Phone or tablet model',
    name_and_business: 'Your name / business', email: 'Email', space_category: 'What sort of space?',
    location: 'General area', audience: 'What should your viewers be able to explore?',
    timing: 'When do you need it?', size_and_rooms: 'Approximate size and rooms or areas',
    enquiry_as: 'I am enquiring as', agency_fit: 'For agencies',
  };
  const routes = { managed: 'Walkthrough enquiry' };

  function clean(name, value) {
    const raw = String(value == null ? '' : value);
    return MULTILINE.includes(name) ? raw.trim() : raw.replace(/\s+/g, ' ').trim();
  }
  const orNull = value => (value ? value : null);

  /** The answers as rpc/submit_enquiry takes them, from a FormData-like reader. Empty optional answers are null. */
  function answersFrom(data) {
    const get = name => clean(name, data.get(name));
    // Older links to the former visit route now lead to capture advice.
    const capture = get('capture_route');
    return {
      p_name_and_business: get('name_and_business'),
      p_email: get('email'),
      p_space_category: get('space_category'),
      p_location: get('location'),
      p_audience: get('audience'),
      p_capture_route: capture === 'self' ? 'self' : 'unsure',
      p_device_model: orNull(get('device_model')),
      p_timing: orNull(get('timing')),
      p_size_and_rooms: orNull(get('size_and_rooms')),
      p_enquiry_as: orNull(get('enquiry_as')),
      p_agency_fit: orNull(get('agency_fit')),
      p_honey: orNull(String(data.get('_honey') || '').trim()),
    };
  }

  /** The first answer the server would refuse (its field name without p_), or ''. The page's own checks run first. */
  function problem(answers) {
    const within = (name, min) => {
      const value = answers['p_' + name] || '';
      return value.length >= min && value.length <= LIMITS[name];
    };
    if (!within('name_and_business', 1)) return 'name_and_business';
    if (!within('email', 1) || !EMAIL.test(answers.p_email)) return 'email';
    if (!SPACES.includes(answers.p_space_category)) return 'space_category';
    if (!within('location', 1) || /[\r\n]/.test(answers.p_location)) return 'location';
    if (!within('audience', 1)) return 'audience';
    if (!['self', 'unsure'].includes(answers.p_capture_route)) return 'capture_route';
    for (const name of ['device_model', 'timing', 'size_and_rooms', 'agency_fit']) if (!within(name, 0)) return name;
    if (answers.p_enquiry_as !== null && !ENQUIRY_AS.includes(answers.p_enquiry_as)) return 'enquiry_as';
    return '';
  }

  /** One POST to rpc/submit_enquiry: { state: received, reference } | { state: invalid, field } | busy | missing | error. */
  async function submit(fetchImpl, config, answers) {
    try {
      const response = await fetchImpl(config.url + '/rest/v1/rpc/submit_enquiry', {
        method: 'POST',
        headers: { apikey: config.anonKey, Authorization: 'Bearer ' + config.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      if (response.status === 404 || (body && body.code === 'PGRST202')) return { state: 'missing' };
      if (!response.ok || !body || typeof body !== 'object') return { state: 'error' };
      if (body.state === 'received') {
        return typeof body.reference === 'string' && referencePattern.test(body.reference)
          ? { state: 'received', reference: body.reference } : { state: 'error' };
      }
      if (body.state === 'invalid') return { state: 'invalid', field: typeof body.field === 'string' ? body.field : '' };
      if (body.state === 'busy') return { state: 'busy' };
      return { state: 'error' };
    } catch {
      return { state: 'error' };
    }
  }

  // Only fixed outcome codes from this submission may leave the form; never answers or raw errors. The
  // measurement runtime has no accepted-enquiry event, so a received enquiry is not reported.
  function measure(win, state, answers) {
    const codes = { busy: 'busy', invalid: 'validation', missing: 'unavailable', error: 'network' };
    if (!Object.hasOwn(codes, state) || (answers && answers.p_honey)) return;
    try {
      if (win.VeyletAnalytics && typeof win.VeyletAnalytics.track === 'function') {
        win.VeyletAnalytics.track('form_error', { form_id: 'request', error_code: codes[state] });
      }
    } catch { /* optional measurement never interrupts sending or recovery */ }
  }

  /** Writes a sentence that names the support address, with the address as a mail link. */
  function sayWithMail(doc, el, sentence) {
    const at = sentence.indexOf(SUPPORT);
    const link = doc.createElement('a');
    link.setAttribute('href', 'mailto:' + SUPPORT + '?subject=' + encodeURIComponent('Veylet walkthrough enquiry'));
    link.textContent = SUPPORT;
    el.textContent = sentence.slice(0, at);
    el.append(link, sentence.slice(at + SUPPORT.length));
  }

  /** The control for a field name the server returned; an unknown name means the first question. */
  function controlFor(form, field) {
    const name = Object.hasOwn(QUESTIONS, field) ? field : Object.keys(QUESTIONS)[0];
    if (name === 'capture_route') {
      const choices = [...(form.querySelectorAll?.('[name="capture_route"]') || [])];
      return choices.find(choice => choice.checked) || choices[0] || null;
    }
    return form.querySelector('[name="' + name + '"]');
  }

  function wire(win, form) {
    const doc = win.document;
    const route = form.dataset.enquiryRoute;
    const captureLabels = { self: 'I will capture it', unsure: 'Help me choose' };
    const choices = [...(form.querySelectorAll?.('[name="capture_route"]') || [])];
    const deviceField = doc.getElementById('request-device-field');
    const device = form.querySelector('[name="device_model"]');
    const status = doc.getElementById('request-status');
    const done = doc.getElementById('request-done');
    const button = form.querySelector('button[type="submit"]');
    const buttonMarkup = button ? button.innerHTML : undefined;
    let reference = '';
    let busy = false;

    // A fixed, allowlisted choice may preselect a route; URL text never becomes copy.
    const intents = new URLSearchParams(win.location.search || '').getAll('capture');
    if (choices.length && intents.length === 1) {
      const intent = intents[0] === 'visit' ? 'unsure' : intents[0];
      if (Object.hasOwn(captureLabels, intent)) choices.forEach(choice => { choice.checked = choice.value === intent; });
    }
    const captureChoice = () => choices.find(choice => choice.checked)?.value;
    const updateCaptureRoute = () => {
      if (captureChoice() === 'visit') choices.forEach(choice => { choice.checked = choice.value === 'unsure'; });
      if (deviceField && choices.length) deviceField.hidden = false;
      if (device && choices.length) device.disabled = false;
    };
    form.addEventListener('change', updateCaptureRoute);
    updateCaptureRoute();

    function sending(on) {
      if (!button) return;
      button.disabled = on;
      if (on) button.textContent = COPY.sending;
      else if (typeof buttonMarkup === 'string') button.innerHTML = buttonMarkup;
    }

    function show(result) {
      const state = result.state;
      sending(state === 'sending');
      if (!status) return state;
      if (state === 'sending') { status.textContent = COPY.sending; return state; }
      if (state === 'received') {
        reference = result.reference;
        status.textContent = '';
        form.hidden = true;
        if (done) {
          done.hidden = false;
          const said = doc.getElementById('request-done-reference');
          if (said) {
            const code = doc.createElement('strong');
            code.textContent = reference;
            said.textContent = 'Your reference is ';
            said.append(code, '.');
          }
          doc.getElementById('request-done-title')?.focus?.();
        }
        return state;
      }
      if (state === 'invalid') {
        const known = Object.hasOwn(QUESTIONS, result.field);
        status.textContent = known
          ? 'Your answer to “' + QUESTIONS[result.field] + '” wasn’t accepted, so nothing was saved. Check it and send again.'
          : COPY.invalidAny;
        const control = controlFor(form, result.field);
        const section = control?.closest ? control.closest('details') : null;
        if (section) section.open = true;
        control?.focus?.();
        return state;
      }
      sayWithMail(doc, status, COPY[state] || NOT_SAVED);
      // The button was disabled while sending, which drops keyboard focus; give it back.
      button?.focus?.();
      return state;
    }

    // The draft kept against a refresh is no longer needed once the database has the enquiry.
    function forgetDraft() {
      const drop = () => { try { win.localStorage?.removeItem('veylet-draft-' + route); } catch { /* blocked store */ } };
      drop();
      // A save queued by the last keystroke may land just after; remove it again.
      win.setTimeout?.(drop, 1000);
    }

    async function send() {
      const answers = answersFrom(new win.FormData(form));
      const refused = problem(answers);
      if (refused) { measure(win, 'invalid', answers); return show({ state: 'invalid', field: refused }); }
      const config = win.VEYLET_SUPABASE;
      // A page without its database configuration sends nothing: the enquiry is not saved.
      if (!(config && config.url && config.anonKey)) return show({ state: 'missing' });
      show({ state: 'sending' });
      const result = await submit(win.fetch.bind(win), config, answers);
      measure(win, result.state, answers);
      if (result.state === 'received') forgetDraft();
      return show(result);
    }

    // Registered after the page's own checks (capture phase), so it runs only when they passed; the
    // default submission is always stopped, so answers never leave in a URL or to another host.
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      try { await send(); } finally { busy = false; }
    }, true);

    const section = doc.getElementById('enquiry-copy');
    const copyButton = doc.getElementById('enquiry-copy-button');
    const output = doc.getElementById('enquiry-copy-text');
    const copyStatus = doc.getElementById('enquiry-copy-status');
    if (!section || !copyButton || !output || !copyStatus) return;
    section.hidden = false;
    const labels = {
      name_and_business: 'Name / business', email: 'Email', space_category: 'Space type',
      location: 'General area', audience: 'Viewer purpose', timing: 'Timing',
      size_and_rooms: 'Size / rooms', enquiry_as: 'Enquiring as', agency_fit: 'Agency details',
      device_model: 'Exact device model',
    };
    copyButton.addEventListener('click', async () => {
      if (copyButton.disabled) return;
      const data = new win.FormData(form);
      const lines = reference
        ? [routes[route], 'Reference: ' + reference, 'Received by Veylet.', '']
        : [routes[route], 'Copy only — not sent yet.', ''];
      const selectedCapture = captureChoice();
      if (Object.hasOwn(captureLabels, selectedCapture || '')) lines.push('Capture route: ' + captureLabels[selectedCapture]);
      for (const [name, label] of Object.entries(labels)) {
        const value = String(data.get(name) || '').trim();
        if (value) lines.push(label + ': ' + value);
      }
      output.value = lines.join('\n');
      output.hidden = false;
      copyButton.disabled = true;
      try {
        await win.navigator.clipboard.writeText(output.value);
        copyStatus.textContent = 'Copied. Keep this for your records or paste it into an email. Copying does not send it.';
      } catch {
        output.focus(); output.select();
        copyStatus.textContent = 'Select and copy the text below. Copying does not send it.';
      } finally { copyButton.disabled = false; }
    });
  }

  const api = { PARAMS, COPY, SUPPORT, answersFrom, problem, submit };
  window.VeyletEnquiry = api;

  const form = document.querySelector('form[data-enquiry-route]');
  if (form && Object.hasOwn(routes, form.dataset.enquiryRoute)) wire(window, form);

  const referenceRow = document.getElementById('enquiry-reference');
  if (referenceRow) {
    const query = new URLSearchParams(location.search);
    const references = query.getAll('ref');
    const routeValues = query.getAll('route');
    // Do not reflect arbitrary query text, duplicate values or unknown routes.
    if (references.length !== 1 || !referencePattern.test(references[0]) || routeValues.length !== 1 || !Object.hasOwn(routes, routeValues[0])) return;
    referenceRow.textContent = 'Your reference: ' + references[0] + '. Keep it for any follow-up; it does not confirm delivery.';
    referenceRow.hidden = false;
    const nextStep = document.getElementById('enquiry-route-next');
    const captures = query.getAll('capture');
    const nextSteps = {
      self: 'Your next step is a device check and one practice capture. Keep the original capture on your phone. Send from the app: it uploads in the background. Check your account for rendering status.',
      visit: 'Studio visits are not currently available. Ask us about a self-capture practice route or help checking your device.',
      unsure: 'Your next step is a device check. Tell us your iPhone or iPad model if you find it (a Pro model with LiDAR); you do not need to buy equipment now.',
    };
    if (nextStep && routeValues[0] === 'managed' && captures.length === 1 && Object.hasOwn(nextSteps, captures[0])) {
      nextStep.textContent = nextSteps[captures[0]];
      nextStep.hidden = false;
    }
    const followup = document.getElementById('enquiry-followup');
    if (followup) followup.href = 'mailto:support@veylet.com?subject=' + encodeURIComponent('Veylet enquiry follow-up · ' + references[0]);
  }
})();
