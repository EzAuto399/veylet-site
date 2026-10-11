// Effective public Vercel headers verified for the 26d5eda release. Keep the
// exceptional framing/robots/cache rules explicit; do not add an SPA fallback.
export const headerNames = [
  'content-type', 'cache-control', 'content-security-policy',
  'x-content-type-options', 'x-frame-options', 'referrer-policy',
  'permissions-policy', 'x-dns-prefetch-control', 'x-robots-tag',
];
export const revalidate = 'public, max-age=0, must-revalidate';
const cacheAssets = 'public, max-age=14400, must-revalidate';
const types = {
  html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', xml: 'application/xml',
  jpg: 'image/jpeg', webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml',
  woff2: 'font/woff2', mp4: 'video/mp4', glb: 'model/gltf-binary',
  bin: 'application/octet-stream',
};
export const redirects = { '/apply': '/offer', '/pricing': '/offer', '/prices': '/offer' };

export function routeFor(file) {
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return '/' + file.slice(0, -11);
  return '/' + (file.endsWith('.html') ? file.slice(0, -5) : file);
}

export function headersFor(file) {
  const route = routeFor(file);
  const aasa = file === '.well-known/apple-app-site-association';
  const extension = file.split('.').at(-1);
  const type = aasa ? 'application/json' : types[extension];
  if (!type) throw new Error('Unreviewed public MIME type: ' + extension);
  const cache = aasa ? 'public, max-age=3600' :
    route === '/studio' ? 'private, no-store' :
    ['html', 'json', 'xml', 'glb'].includes(extension) || (extension === 'txt' && file !== 'robots.txt') ? revalidate : cacheAssets;
  const headers = Object.fromEntries(headerNames.map(name => [name, null]));
  Object.assign(headers, { 'content-type': type, 'cache-control': cache });
  if (!/^\/(?:embed|tour$)/.test(route) || route === '/embed' || route === '/tour') {
    Object.assign(headers, {
      'x-content-type-options': 'nosniff',
      'referrer-policy': route === '/tour' ? 'no-referrer' : 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'x-dns-prefetch-control': 'off',
    });
  }
  if (!/^\/(?:embed|tour$)/.test(route)) headers['x-frame-options'] = 'DENY';
  if (route === '/embed' || route === '/tour') headers['content-security-policy'] = 'frame-ancestors *';
  if (route === '/studio' || route === '/tour' || route.startsWith('/app/')) headers['x-robots-tag'] = 'noindex, nofollow';
  return headers;
}
