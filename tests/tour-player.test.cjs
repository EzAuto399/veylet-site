const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../dist/tour-player.js'), 'utf8');
function load(options = {}) {
  const calls = [];
  const handlers = new Map();
  const window = {
    VEYLET_SUPABASE: {url:'https://example.invalid',anonKey:'public-test-key'},
    supabase: {createClient(...args) {calls.push(args);return {};}},
    addEventListener(name, fn) { handlers.set(name, fn); },
    removeEventListener(name) { handlers.delete(name); },
    emit(name, event) { handlers.get(name)?.(event); },
  };
  const visibility = new Set();
  const document = {
    hidden: Boolean(options.hidden),
    addEventListener(name, fn) { if (name === 'visibilitychange') visibility.add(fn); },
    removeEventListener(name, fn) { if (name === 'visibilitychange') visibility.delete(fn); },
    setHidden(value) { this.hidden = value; for (const fn of [...visibility]) fn(); },
    getElementById() { return null; }, querySelector() { return null; },
    querySelectorAll(selector) {
      return selector === '[data-tour-dead-end]' ? (options.deadEnds || []) : [];
    },
  };
  const context = {window, document, performance, setTimeout, clearTimeout, AbortController,
    navigator: {onLine:true}, ...options.clock?.context};
  vm.runInNewContext(source, context);
  return {player:window.VeyletPlayer,window,calls,document,visibility};
}

function clock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return {timers, context: {
    performance: {now:()=>now},
    setTimeout(fn, ms) { const id=++sequence; timers.set(id,{fn,at:now+ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, advance(ms) {
    const end=now+ms;
    for (;;) {
      const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if (!next) break;
      now=next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now=end;
  }};
}

async function timedPackage(options={}) {
  const time=clock(), harness=load({...options,clock:time});
  harness.window.JSZip={loadAsync:async()=>({file:()=>({async:async()=>'<meta name="veylet-viewer-contract" content="1">'})})};
  const frame={hidden:true,contentWindow:{},setAttribute(){},removeAttribute(key){delete this[key];},addEventListener(){},removeEventListener(){}};
  const pending=harness.player.playPackage({size:1},frame,{signal:options.signal});
  await new Promise(resolve=>setImmediate(resolve));
  const status=value=>harness.window.emit('message',{source:frame.contentWindow,data:{type:'veylet-viewer-status',version:1,status:value}});
  return {...harness,time,frame,pending,status};
}
test('public playback does not inherit the signed-in account', () => {
  const {player,calls}=load();
  player.clientFor({persistSession:false,autoRefreshToken:false});
  assert.equal(calls[0][2].auth.persistSession,false);
  assert.equal(calls[0][2].auth.autoRefreshToken,false);
});
test('versioned packages wait for their own renderer receipt, not iframe document load', async () => {
  const {player,window}=load();
  window.JSZip={loadAsync:async()=>({file:()=>({async:async()=>'<meta name="veylet-viewer-contract" content="1"><p>viewer</p>'})})};
  let loaded, completed=false;
  const frame={hidden:true,contentWindow:{},setAttribute(){},removeAttribute(){},addEventListener(name,fn){loaded=fn;},removeEventListener(){}};
  const pending=player.playPackage({size:1},frame).then(result=>{completed=true;return result;});
  await new Promise(resolve=>setImmediate(resolve));loaded();
  assert.equal(frame.hidden,false); // A sized visible canvas is necessary for rendering.
  assert.equal(completed,false);
  window.emit('message',{source:{},data:{type:'veylet-viewer-status',version:1,status:'ready'}});
  window.emit('message',{source:frame.contentWindow,data:{type:'veylet-viewer-status',version:2,status:'ready'}});
  assert.equal(completed,false);
  window.emit('message',{source:frame.contentWindow,data:{type:'veylet-viewer-status',version:1,status:'ready'}});
  assert.equal((await pending).readiness,'viewer-ready');
});
test('a renderer failure retains the package fallback and never counts as render success', async () => {
  const {player,window}=load();
  window.JSZip={loadAsync:async()=>({file:()=>({async:async()=>'<meta content="1" name="veylet-viewer-contract"><p>fallback photograph</p>'})})};
  const frame={hidden:true,contentWindow:{},setAttribute(){},removeAttribute(){},addEventListener(){},removeEventListener(){}};
  const pending=player.playPackage({size:1},frame);
  await new Promise(resolve=>setImmediate(resolve));
  window.emit('message',{source:frame.contentWindow,data:{type:'veylet-viewer-status',version:1,status:'failed'}});
  assert.equal((await pending).readiness,'viewer-failed'); assert.equal(frame.hidden,false);
});
test('a definitive miss withdraws links to the same dead token, a transient one keeps them', () => {
  const dead = [{ hidden: false }];
  const { player } = load({ deadEnds: dead });
  player.showFailure({ title: {}, body: {}, status: {} }, { body: 'service did not answer', retry: true });
  assert.equal(dead[0].hidden, false); // worth a second try on another page
  player.showFailure({ title: {}, body: {}, status: {} }, { body: 'revoked', retry: false });
  assert.equal(dead[0].hidden, true);
});

test('a surface is told once when the viewer takes over the viewport', async () => {
  const { player, window } = load();
  window.JSZip = { loadAsync: async () => ({ file: () => ({ async: async () => '<meta name="veylet-viewer-contract" content="1">' }) }) };
  let visible = 0, loaded;
  const frame = { hidden: true, contentWindow: {}, setAttribute() {}, removeAttribute() {},
    addEventListener(name, fn) { loaded = fn; }, removeEventListener() {} };
  const pending = player.playPackage({ size: 1 }, frame, { onVisible: () => { visible++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(visible, 0); // nothing on screen yet: the surface keeps its full notice
  loaded();
  assert.equal(visible, 1);
  assert.equal(frame.hidden, false);
  window.emit('message', { source: frame.contentWindow, data: { type: 'veylet-viewer-status', version: 1, status: 'ready' } });
  await pending;
  assert.equal(visible, 1); // the later readiness receipt must not fire it again
});

test('a failing surface hint cannot break playback', async () => {
  const { player, window } = load();
  window.JSZip = { loadAsync: async () => ({ file: () => ({ async: async () => '<html>viewer</html>' }) }) };
  let loaded;
  const frame = { hidden: true, setAttribute() {}, removeAttribute() {}, addEventListener(name, fn) { loaded = fn; }, removeEventListener() {} };
  const pending = player.playPackage({ size: 1 }, frame, { onVisible: () => { throw new Error('surface'); } });
  await new Promise(resolve => setImmediate(resolve));
  loaded();
  assert.equal((await pending).readiness, 'document-loaded');
  assert.equal(frame.hidden, false);
});

test('owner playback can use the existing session', () => {
  const {player,calls}=load();
  player.clientFor({persistSession:true,autoRefreshToken:true});
  assert.equal(calls[0][2].auth.persistSession,true);
});
test('missing tour.html and oversized packages fail before iframe playback', async () => {
  const {player,window}=load();
  window.JSZip={loadAsync:async()=>({file:()=>null})};
  await assert.rejects(player.playPackage({size:1},{}),/missing-tour/);
  await assert.rejects(player.playPackage({size:50_000_001},{}),/package-too-large/);
});
test('executable viewer receives opaque sandbox and private preferences', async () => {
  const {player,window}=load();
  window.JSZip={loadAsync:async()=>({file:()=>({async:async()=>'<html><head></head><body>viewer</body></html>'})})};
  const attributes={};let loaded;
  const frame={hidden:true,setAttribute(k,v){attributes[k]=v;},removeAttribute(){},
    addEventListener(name,fn){loaded=fn;},removeEventListener(){}};
  const pending=player.playPackage({size:1},frame);
  await new Promise(resolve=>setImmediate(resolve));
  loaded();await pending;
  assert.equal(attributes.sandbox,'allow-scripts allow-pointer-lock');
  assert.equal(attributes.allow,'fullscreen *');
  assert.equal(attributes.allowfullscreen,'');
  assert.equal(attributes.referrerpolicy,'no-referrer');
  assert.match(frame.srcdoc,/connect-src data: blob:/);
  assert.match(frame.srcdoc,/new Map\(\)/);
  assert.equal(frame.hidden,false);
});
test('oversized expanded viewer is rejected before decompression', async () => {
  const {player,window}=load(); let inflated=false;
  window.JSZip={loadAsync:async()=>({file:()=>({_data:{uncompressedSize:90*1024*1024},async:async()=>{inflated=true;return 'large';}})})};
  await assert.rejects(player.playPackage({size:100},{}),/expanded-package-too-large/);
  assert.equal(inflated,false);
});
test('a timed-out playback cannot populate an iframe after ZIP parsing finishes', async () => {
  const {player,window}=load(); let finish;
  window.JSZip={loadAsync:()=>new Promise(resolve=>{finish=resolve;})};
  const frame={hidden:true}; const controller=new AbortController();
  const pending=player.playPackage({size:100},frame,{signal:controller.signal});
  controller.abort();finish({file:()=>({async:async()=>'<html>late</html>'})});
  await assert.rejects(pending,/playback-cancelled/);
  assert.equal(frame.srcdoc,undefined); assert.equal(frame.hidden,true);
});

test('hidden startup keeps its full visible-time allowance and accepts a real frame', async () => {
  const x=await timedPackage({hidden:true});
  x.time.advance(120000);
  assert.ok(x.frame.srcdoc); assert.equal(x.time.timers.size,0);
  x.document.setHidden(false); x.time.advance(44999);
  x.status('ready'); assert.equal((await x.pending).readiness,'viewer-ready');
  assert.equal(x.visibility.size,0); assert.equal(x.time.timers.size,0);
});

test('background changes preserve the remaining deadline and cannot revive an expired frame', async () => {
  const x=await timedPackage();
  const rejected=assert.rejects(x.pending,/viewer-not-ready/);
  const stale=[...x.time.timers.values()][0].fn;
  x.time.advance(10000); x.document.setHidden(true); x.time.advance(120000);
  stale(); assert.ok(x.frame.srcdoc);
  x.document.setHidden(false); x.time.advance(9000);
  x.document.setHidden(true); x.time.advance(100000);
  x.document.setHidden(false); x.time.advance(25999); assert.ok(x.frame.srcdoc);
  x.time.advance(1); await rejected;
  assert.equal(x.frame.srcdoc,undefined); assert.equal(x.visibility.size,0);
  x.status('ready'); assert.equal(x.frame.hidden,true);
});

test('a hidden renderer failure immediately retains its photograph recovery', async () => {
  const x=await timedPackage({hidden:true});
  x.status('failed'); assert.equal((await x.pending).readiness,'viewer-failed');
  assert.equal(x.frame.hidden,false); assert.ok(x.frame.srcdoc);
  assert.equal(x.visibility.size,0);
});

test('cancellation while hidden removes the document and visibility listener', async () => {
  const controller=new AbortController();
  const x=await timedPackage({hidden:true,signal:controller.signal});
  const rejected=assert.rejects(x.pending,/playback-cancelled/);
  controller.abort(); await rejected;
  assert.equal(x.frame.srcdoc,undefined); assert.equal(x.visibility.size,0);
  x.document.setHidden(false); assert.equal(x.time.timers.size,0);
});

test('the outer preparation deadline also pauses when hidden and cancels late ZIP completion', async () => {
  const time=clock(),x=load({clock:time}); let finishZip;
  x.window.JSZip={loadAsync:()=>new Promise(resolve=>{finishZip=resolve;})};
  x.window.supabase.createClient=()=>({storage:{from:()=>({download:async()=>({data:{size:1}})})}});
  const frame={hidden:true}; const els={title:{},body:{},status:{},frame};
  const pending=x.player.boot({els,resolve:async()=>({storagePath:'fictional/tour.zip'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finishZip,'function');
  time.advance(10000); x.document.setHidden(true); time.advance(120000);
  assert.equal(els.status.textContent,'Preparing the 3D view…');
  x.document.setHidden(false); time.advance(55000); await pending;
  assert.match(els.body.textContent,/did not start in time/);
  finishZip({file:()=>({async:async()=>'<html>late</html>'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(frame.srcdoc,undefined); assert.equal(frame.hidden,true);
  assert.equal(x.visibility.size,0); assert.equal(time.timers.size,0);
});
