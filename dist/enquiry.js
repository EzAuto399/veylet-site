'use strict';
(() => {
  // A reference helps reconcile correspondence. It is not an inbox receipt,
  // account identifier or capability, and contains no contact information.
  const referencePattern = /^VY-[a-f0-9]{24}$/;
  const routes = { managed: 'Walkthrough enquiry', partner: 'Capture partner enquiry' };
  const form = document.querySelector('form[data-enquiry-route]');
  if (form) {
    const route = form.dataset.enquiryRoute;
    if (!routes[route]) return;
    const reference = window.crypto?.randomUUID ? 'VY-' + window.crypto.randomUUID().replaceAll('-', '').slice(0, 24) : '';
    const input = form.querySelector('[name="enquiry_ref"]');
    const next = form.querySelector('[name="_next"]');
    const captureLabels = { self: 'I will capture it', unsure: 'Help me choose' };
    const choices = route === 'managed' ? [...(form.querySelectorAll?.('[name="capture_route"]') || [])] : [];
    const deviceField = document.getElementById('request-device-field');
    const device = form.querySelector('[name="device_model"]');
    // A fixed, allowlisted choice may preselect a route; URL text never becomes copy.
    const intents = new URLSearchParams(location.search || '').getAll('capture');
    if (choices.length && intents.length === 1) {
      // Older links to the former visit route now lead to capture advice.
      const intent = intents[0] === 'visit' ? 'unsure' : intents[0];
      if (Object.hasOwn(captureLabels, intent)) choices.forEach(choice => { choice.checked = choice.value === intent; });
    }
    const captureChoice = () => choices.find(choice => choice.checked)?.value;
    const updateCaptureRoute = () => {
      if (captureChoice() === 'visit') choices.forEach(choice => { choice.checked = choice.value === 'unsure'; });
      const selected = captureChoice();
      if (deviceField && choices.length) deviceField.hidden = false;
      if (device && choices.length) device.disabled = false;
      if (next && referencePattern.test(input?.value || '')) {
        const context = Object.hasOwn(captureLabels, selected || '') ? '&capture=' + selected : '';
        next.value = 'https://veylet.com/thanks?route=' + route + '&ref=' + input.value + context;
      }
    };
    form.addEventListener?.('change', updateCaptureRoute);
    if (reference && referencePattern.test(reference) && input && next) {
      input.value = reference;
      next.value = 'https://veylet.com/thanks?route=' + route + '&ref=' + reference;
    }
    updateCaptureRoute();
    const section = document.getElementById('enquiry-copy');
    const button = document.getElementById('enquiry-copy-button');
    const output = document.getElementById('enquiry-copy-text');
    const status = document.getElementById('enquiry-copy-status');
    if (!section || !button || !output || !status) return;
    section.hidden = false;
    const labels = {
      name_and_business: 'Name / business', email: 'Email', space_category: 'Space type',
      location: 'Suburb / region', audience: 'Viewer purpose', timing: 'Timing',
      size_and_rooms: 'Size / rooms', enquiry_as: 'Enquiring as', agency_fit: 'Agency details',
      service_area: 'Service area', device_model: 'Exact device model', experience: 'Experience',
      portfolio: 'Portfolio', os_version: 'Operating system', equipment: 'Other equipment',
      availability: 'Availability', assessment_understood: 'Assessment acknowledged',
    };
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const data = new FormData(form);
      const lines = [routes[route], ...(input?.value ? ['Reference: ' + input.value] : []), 'Copy only — delivery has not been confirmed.', ''];
      const selectedCapture = captureChoice();
      if (Object.hasOwn(captureLabels, selectedCapture || '')) lines.push('Capture route: ' + captureLabels[selectedCapture]);
      for (const [name, label] of Object.entries(labels)) {
        const value = String(data.get(name) || '').trim();
        if (value) lines.push(label + ': ' + value);
      }
      output.value = lines.join('\n');
      output.hidden = false;
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(output.value);
        status.textContent = 'Copied. Keep this for your records or paste it into an email. Copying does not send it. If you already submitted, mention that in your follow-up.';
      } catch {
        output.focus(); output.select();
        status.textContent = 'Select and copy the text below. Copying does not send it. If you already submitted, mention that in your follow-up.';
      } finally { button.disabled = false; }
    });
  }
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
      self: 'Your next step is a device check and one practice capture. Keep the original capture on your phone. Send from the app: it uploads in the background and is usually ready in 1–2 hours.',
      visit: 'Studio visits are not currently available. Ask us about a self-capture practice route or help checking your device.',
      unsure: 'Your next step is a device check. Tell us your iPhone or iPad model if you find it (a Pro model with LiDAR); you do not need to buy equipment now.',
    };
    if (nextStep && routeValues[0] === 'managed' && captures.length === 1 && Object.hasOwn(nextSteps, captures[0])) {
      nextStep.textContent = nextSteps[captures[0]];
      nextStep.hidden = false;
    }
    const followup = document.getElementById('enquiry-followup');
    if (followup) followup.href = 'mailto:yoda@yodalai.xyz?subject=' + encodeURIComponent('Veylet enquiry follow-up · ' + references[0]);
  }
})();
