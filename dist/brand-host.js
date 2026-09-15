'use strict';

const nonCanonicalHosts = new Set(['veylet-site.vercel.app', 'www.veylet.com']);

if (nonCanonicalHosts.has(location.hostname)) {
  location.replace('https://veylet.com' + location.pathname + location.search + location.hash);
}
