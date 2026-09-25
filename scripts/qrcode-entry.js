// Veylet QR bundle: node-qrcode 1.5.4 core (MIT, Ryan Day) with dijkstrajs 1.0.3 (MIT).
// Built locally with esbuild from the published npm packages; no network at runtime:
//   esbuild scripts/qrcode-entry.js --bundle --minify --format=iife --platform=browser
const QRCode = require('qrcode/lib/core/qrcode');
const QUIET = 4; // modules of white border a scanner needs

function matrix(text, level) {
  const code = QRCode.create(String(text), { errorCorrectionLevel: level || 'M' });
  return {
    size: code.modules.size, modules: Uint8Array.from(code.modules.data), version: code.version, errorCorrectionLevel: level || 'M',
    segments: code.segments.map(segment => ({ mode: segment.mode.id, data: typeof segment.data === 'string' ? segment.data : Array.from(segment.data) })),
  };
}

const escape = value => String(value).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]);

// An SVG string: one path of dark modules on white, with the quiet zone.
function svg(text, options = {}) {
  const code = matrix(text, options.level);
  const size = code.size + QUIET * 2;
  let d = '';
  for (let row = 0; row < code.size; row++) {
    let start = -1;
    for (let col = 0; col <= code.size; col++) {
      const dark = col < code.size && code.modules[row * code.size + col] === 1;
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) { d += 'M' + (start + QUIET) + ' ' + (row + QUIET) + 'h' + (col - start) + 'v1h-' + (col - start) + 'z'; start = -1; }
    }
  }
  const label = escape(options.label || 'QR code for ' + text);
  const ink = /^#[0-9a-f]{6}$/i.test(options.color || '') ? options.color : '#10231d';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="' + label + '">'
    + '<rect width="' + size + '" height="' + size + '" fill="#ffffff"/><path fill="' + ink + '" d="' + d + '"/></svg>';
}

window.VeyletQR = Object.freeze({ version: '1.5.4', quietZone: QUIET, matrix, svg });
