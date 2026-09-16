import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3/+esm';

export async function playZipBlob(zipBlob, iframe) {
  const zip = await JSZip.loadAsync(zipBlob);
  const file = zip.file('tour.html') || zip.file('index.html');
  if (!file) throw new Error('missing-tour');
  const html = await file.async('blob');
  const url = URL.createObjectURL(html);
  iframe.src = url;
  iframe.hidden = false;
  return url;
}

export function fail(titleEl, bodyEl, statusEl, title, body) {
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  if (statusEl) statusEl.textContent = '';
}
