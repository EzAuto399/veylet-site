import policy from './routing-policy.json' with { type: 'json' };

const productionOrigins = new Set(['https://veylet.com', 'https://www.veylet.com']);
const previewOrigins = new Set([
  'https://veylet-site-preview.yda31416.workers.dev',
  'http://127.0.0.1:8896', 'http://localhost:8896',
]);

const previewRobots = 'noindex, nofollow';
const revalidate = 'public, max-age=0, must-revalidate';
const previewCsp = "script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' blob:; form-action 'none'; object-src 'none'";

function restrictPreview(headers, preview) {
  if (!preview) return;
  const original = headers.get('Content-Security-Policy');
  headers.set('Content-Security-Policy', original ? original + '; ' + previewCsp : previewCsp);
  headers.set('X-Robots-Tag', previewRobots);
}

function canonical(path) {
  if (path !== '/' && path.endsWith('/')) return path.replace(/\/+$/, '') || '/';
  if (path.endsWith('/index.html')) return path.slice(0, -11) || '/';
  if (path.endsWith('.html')) return path.slice(0, -5) || '/';
  return path;
}

function redirect(location, requestUrl, preview) {
  // Concatenate the trusted origin before parsing: protocol-relative paths must
  // stay paths on this website rather than become another authority.
  const target = new URL(requestUrl.origin + location);
  if (target.origin !== requestUrl.origin) throw new TypeError('Invalid redirect target');
  const headers = new Headers({
    'Location': target.href,
    'Content-Type': 'text/plain',
    'Cache-Control': revalidate,
  });
  restrictPreview(headers, preview);
  return new Response('Redirecting...\n', { status: 308, headers });
}

function notFoundHeaders(path) {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': revalidate });
  // Preserve the deployed Vercel global rule, including its embed-prefix exception.
  if (!/^\/(?:embed|tour$)/.test(path)) {
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    headers.set('X-DNS-Prefetch-Control', 'off');
  }
  return headers;
}

function singleRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) return false;
  return { start, end };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Only an explicit production deployment on an approved production origin
    // is indexable. Missing/unknown modes fail closed to restricted preview.
    const production = env.CF_DEPLOYMENT_ENV === 'production' && productionOrigins.has(url.origin);
    const preview = !production;
    if (preview && !previewOrigins.has(url.origin)) {
      const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
      restrictPreview(headers, true);
      return new Response(request.method === 'HEAD' ? null : 'Unapproved preview origin', { status: 403, headers });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const headers = new Headers({ 'Allow': 'GET, HEAD', 'Cache-Control': 'no-store' });
      restrictPreview(headers, preview);
      return new Response('Method not allowed', { status: 405, headers });
    }
    const clean = canonical(url.pathname);
    if (clean !== url.pathname) return redirect(clean + url.search, url, preview);
    if (policy.redirects[clean]) return redirect(policy.redirects[clean] + url.search, url, preview);

    const asset = policy.routes[clean];
    const previewRobotsFile = preview && clean === '/robots.txt';
    const target = asset ? asset.file : '404.html';
    const internal = new URL(request.url);
    internal.pathname = '/' + target;
    internal.search = '';
    const assetRequest = new Request(internal, request);
    assetRequest.headers.delete('Accept-Encoding');
    if (!asset || previewRobotsFile) {
      // A fallback404 or generated preview robots must have a complete body,
      // even when client validators/ranges would turn the underlying asset304/206.
      for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) assetRequest.headers.delete(name);
    }
    let response;
    try {
      response = await env.ASSETS.fetch(assetRequest);
      if (asset && ![200, 206, 304, 416].includes(response.status)) throw new Error('Asset unavailable');
      if (!asset && response.status !== 200) throw new Error('Fallback unavailable');
    } catch {
      const headers = new Headers({
        'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Robots-Tag': previewRobots, 'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      restrictPreview(headers, preview);
      return new Response(request.method === 'HEAD' ? null : 'Website temporarily unavailable', { status: 503, headers });
    }
    const headers = new Headers(response.headers);
    const desired = asset ? policy.profiles[asset.profile] : Object.fromEntries(notFoundHeaders(clean));
    for (const name of policy.headerNames) {
      const value = desired[name];
      if (value == null) headers.delete(name); else headers.set(name, value);
    }
    if (asset && /\.(js|css)$/.test(clean) && url.searchParams.has('v')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    restrictPreview(headers, preview);
    if (previewRobotsFile) {
      for (const name of ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'Content-Encoding']) headers.delete(name);
    }
    let body = previewRobotsFile ? 'User-agent: *\nDisallow: /\n' : response.body;
    let status = previewRobotsFile ? 200 : asset ? response.status : 404;
    let statusText = previewRobotsFile ? 'OK' : asset ? response.statusText : 'Not Found';
    // Older local ASSETS bindings ignore Range. Retain native206 when supported,
    // otherwise provide a bounded single-range response from the frozen public asset.
    const ifRange = request.headers.get('If-Range');
    if (asset && !previewRobotsFile && request.method === 'GET' && response.status === 200 && (!ifRange || ifRange === headers.get('ETag'))) {
      const range = singleRange(request.headers.get('Range'), asset.bytes);
      if (range === false) {
        body = null; status = 416; statusText = 'Range Not Satisfiable';
        headers.set('Content-Range', 'bytes */' + asset.bytes);
        headers.set('Content-Length', '0');
      } else if (range) {
        const bytes = await response.arrayBuffer();
        body = bytes.slice(range.start, range.end + 1); status = 206; statusText = 'Partial Content';
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${asset.bytes}`);
        headers.set('Content-Length', String(range.end - range.start + 1));
        headers.set('Accept-Ranges', 'bytes');
        headers.delete('Content-Encoding');
      }
    }
    return new Response(request.method === 'HEAD' ? null : body, {
      status,
      statusText,
      headers,
    });
  },
};
