#!/usr/bin/env python3
"""Loopback-only QA: dist plus exact fixture routes. No workspace listing."""
import argparse
import gzip
import hashlib
import io
import json
import re
import zipfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8904)
parser.add_argument('--package', type=Path)
# A streamed (version 2) package folder, copied out of private storage first.
# Only manifest.json and the files its manifest lists are served, at /__qa/v2/.
parser.add_argument('--package-v2', type=Path)
parser.add_argument('--gzip', action='store_true', help='compress JS, CSS and JSON the way the CDN does')
args = parser.parse_args()

V2_FILES = {}
if args.package_v2:
    root = args.package_v2.resolve()
    manifest = json.loads((root / 'manifest.json').read_text())
    V2_FILES['manifest.json'] = root / 'manifest.json'
    for entry in manifest.get('files', []):
        path = entry['path']
        target = (root / path).resolve()
        if '..' in path.split('/') or root not in target.parents or target.is_symlink() or not target.is_file():
            raise SystemExit('Refusing unsafe package path: ' + path)
        V2_FILES[path] = target
TYPES = {'.json': 'application/json', '.webp': 'image/webp', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8'}
_gzipped = {}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / 'dist'), **kw)

    def send_file(self, file, cache='no-store'):
        data = file.read_bytes()
        mime = TYPES.get(file.suffix, 'application/octet-stream')
        compress = args.gzip and file.suffix in ('.js', '.css', '.json', '.html', '.svg') and 'gzip' in self.headers.get('Accept-Encoding', '')
        if compress:
            key = (str(file), len(data), file.stat().st_mtime_ns)
            if key not in _gzipped: _gzipped[key] = gzip.compress(data, 6)
            data = _gzipped[key]
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', cache)
        if compress: self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlsplit(self.path).path
        fixture = None
        if path.startswith('/__qa/v2/'):
            target = V2_FILES.get(path[len('/__qa/v2/'):])
            if target is None:
                self.send_error(404)
                return
            self.send_file(target, 'public, max-age=3600')
            return
        if args.gzip and not path.startswith('/__qa/'):
            local = (ROOT / 'dist' / path.lstrip('/')).resolve()
            if (ROOT / 'dist') in local.parents and local.is_file() and local.suffix in ('.js', '.css', '.json', '.svg'):
                self.send_file(local, 'public, max-age=31536000, immutable' if urlsplit(self.path).query.startswith('v=') else 'no-cache')
                return
        if path == '/__qa/': fixture = ROOT / 'tests/player-browser-check.html'
        elif path == '/__qa/package.zip': fixture = args.package
        elif path == '/__qa/package-no-graphics.zip' and args.package and args.package.is_file():
            # Disposable derivative for the browser's no-GPU recovery check.
            # Never changes the original ZIP or its photographs.
            buffer = io.BytesIO()
            block = b'''<script>(function(){const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl|webgpu/i.test(kind)?null:get.call(this,kind,...args)};try{Object.defineProperty(navigator,'gpu',{value:undefined})}catch(e){}})();</script>'''
            with zipfile.ZipFile(args.package) as source, zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as target:
                for name in source.namelist():
                    data = source.read(name)
                    target.writestr(name, block + data if name == 'tour.html' else data)
            data = buffer.getvalue()
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        elif path == '/__qa/guide-sharing.js':
            # The exact public sharing module, retargeted at this loopback
            # origin so the guide's own "Test it here" embed reaches the
            # fixture route. Nothing else changes, so a preview that drifts
            # from the handed-over snippet still fails here.
            text = (ROOT / 'dist/tour-sharing.js').read_text()
            swaps = [("const origin = 'https://veylet.com';", "const origin = 'http://127.0.0.1:%d';" % args.port),
                     ("origin + '/embed?t='", "origin + '/__qa/embed/?t='"),
                     ("origin + '/handoff?t='", "origin + '/__qa/handoff/?t='")]
            for old, new in swaps:
                if text.count(old) != 1:
                    self.send_error(500, 'Fixture sharing interception failed')
                    return
                text = text.replace(old, new)
            data = text.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        elif path == '/__qa/website-guide/':
            markup = (ROOT / 'dist/website-guide/index.html').read_text()
            markup, replaced = re.subn(r'<script src="/tour-sharing\.js(?:\?[^\"]*)?" defer></script>',
                                       '<script src="/__qa/guide-sharing.js" defer></script>', markup)
            if replaced != 1:
                self.send_error(500, 'Fixture guide interception failed')
                return
            markup = markup.replace('<body', '<body data-qa-fixture="true"', 1)
            data = markup.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        elif path == '/__qa/account-fixture.js': fixture = ROOT / 'tests/account-browser-fixture.js'
        elif path == '/__qa/review-account.js': fixture = ROOT / 'dist/account.js'
        elif path == '/__qa/cache-account.js':
            # Exact former public script, never a capture/account secret. Retain
            # the old URL fresh for four hours while the new URL selects new bytes.
            query = parse_qs(urlsplit(self.path).query)
            current = (ROOT / 'dist/account.js').read_bytes()
            version = hashlib.sha256(current).hexdigest()[:16]
            legacy = ROOT / '.qa-review/release-20260921/candidate-87599035340b/dist/account.js'
            if not query and legacy.is_file(): data = legacy.read_bytes()
            elif query == {'v': [version]}: data = current
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'public, max-age=14400, must-revalidate')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        elif path in ('/__qa/account/', '/__qa/studio/', '/__qa/play/', '/__qa/embed/', '/__qa/handoff/', '/__qa/cache-upgrade/'):
            route = 'account' if path == '/__qa/cache-upgrade/' else path.split('/')[2]
            markup = (ROOT / 'dist' / route / 'index.html').read_text()
            markup, replaced = re.subn(r'<script src="/supabase-public\.js(?:\?[^\"]*)?"></script>', '<script src="/__qa/account-fixture.js"></script>', markup)
            if replaced != 1:
                self.send_error(500, 'Fixture configuration interception failed')
                return
            markup = re.sub(r'<script src="/vendor/supabase-js-2\.116\.0\.min\.js(?:\?[^\"]*)?"></script>', '', markup)
            if path == '/__qa/account/':
                markup, replaced = re.subn(r'src="/account\.js(?:\?[^\"]*)?"', 'src="/__qa/review-account.js"', markup)
                if replaced != 1:
                    self.send_error(500, 'Fixture review script interception failed')
                    return
            markup = markup.replace('href="/account"', 'href="/__qa/account/"')
            if path == '/__qa/cache-upgrade/':
                phase = parse_qs(urlsplit(self.path).query).get('phase', ['legacy'])[0]
                def cache_script(match):
                    url = '/__qa/cache-account.js' if phase == 'legacy' else match[1].replace('/account.js', '/__qa/cache-account.js')
                    return 'src="' + url + '"'
                markup = re.sub(r'src="(/account\.js(?:\?[^\"]*)?)"', cache_script, markup)
            markup = markup.replace('<body', '<body data-qa-fixture="true"', 1)
            data = markup.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if fixture and fixture.is_file():
            data = fixture.read_bytes()
            if path == '/__qa/review-account.js':
                # Keep generated private-preview links inside the isolated mock
                # route, including opening a link in a separate browser tab.
                if data.count(b"'/play/?id='") != 1:
                    self.send_error(500, 'Fixture preview routing failed')
                    return
                data = data.replace(b"'/play/?id='", b"'/__qa/play/?id='")
            self.send_response(200)
            mime = 'application/zip' if path.endswith('.zip') else 'text/javascript' if path.endswith('.js') else 'text/html; charset=utf-8'
            self.send_header('Content-Type', mime)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif path.startswith('/__qa/'):
            self.send_error(404)
        else:
            super().do_GET()

    def list_directory(self, path):
        self.send_error(404)
        return None

ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
