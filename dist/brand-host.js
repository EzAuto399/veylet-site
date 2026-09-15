'use strict';
if (location.hostname === 'veylet-site.vercel.app') {
  location.replace('https://veylet.com' + location.pathname + location.search + location.hash);
}
