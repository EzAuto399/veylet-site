'use strict';
// Anonymous credential shape guard only. Supabase remains the signature/authority verifier.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dist=path.join(__dirname,'../dist');
const read=name=>fs.readFileSync(path.join(dist,name),'utf8');
const jwt=role=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.synthetic';
const PUB='sb_publishable_synthetic_example',ANON=jwt('anon');
const BAD=[jwt('service_role'),jwt('authenticated'),jwt(null),'sb_secret_synthetic','not-a-key',PUB+'\nheader','',null];
function load(file,helper=true){
 const window={VEYLET_WAITLIST_MANUAL:true,VEYLET_REPORT_MANUAL:true,VEYLET_UNSUBSCRIBE_MANUAL:true};
 const context={window,document:undefined,setTimeout,clearTimeout,URLSearchParams,URL,atob:s=>Buffer.from(s,'base64').toString('binary')};
 if(helper&&fs.existsSync(path.join(dist,'public-rpc.js')))vm.runInNewContext(read('public-rpc.js'),context);
 vm.runInNewContext(read(file),context);return window;
}
const callers=[
 ['waitlist',key=>load('waitlist/waitlist.js').VeyletWaitlist,async(api,key,fetch)=>api.join(fetch,{url:'https://fixture.invalid',anonKey:key},{p_email:'synthetic@example.invalid'}),'joined'],
 ['report',key=>load('report/report.js').VeyletReport,async(api,key,fetch)=>api.send(fetch,{url:'https://fixture.invalid',anonKey:key},{p_token:'synthetic-token-canary'}),'received'],
 ['unsubscribe',key=>load('unsubscribe.js').VeyletUnsubscribe,async(api,key,fetch)=>api.ask(fetch,{url:'https://fixture.invalid',anonKey:key},'a'.repeat(64),'unsubscribe_mail'),'unsubscribed'],
];
for(const [name,make,invoke,state]of callers){
 test(name+' sends only the proper anonymous headers and keeps its response contract',async()=>{
  for(const key of [PUB,ANON]){const sent=[];const fetch=async(url,init)=>{sent.push(init);return{ok:true,status:200,json:async()=>({state})}};
   assert.equal(await invoke(make(key),key,fetch),state);assert.equal(sent.length,1);assert.equal(sent[0].headers.apikey,key);
   assert.equal(sent[0].headers.Authorization,key===ANON?'Bearer '+key:undefined);}
 });
 test(name+' refuses privileged or malformed configuration before any body leaves',async()=>{
  for(const key of BAD){let calls=0;await invoke(make(key),key,async()=>{calls++;throw Error('must not send')});assert.equal(calls,0,String(key));}
 });
}
test('contact and view calls share the guard, including explicit owner telemetry',async()=>{
 for(const key of [PUB,ANON,...BAD]){const page=load('client-page.js').VeyletClientPage,sent=[];
  const fetch=async(url,init)=>{sent.push(init);return{ok:true,status:200,json:async()=>[]}};
  const client=page.restClient({url:'https://fixture.invalid',anonKey:key},fetch);
  if(client)await client.rpc('get_share_contact',{p_token:'synthetic-token-canary'});
  page.viewBeacon({config:{url:'https://fixture.invalid',anonKey:key},token:'synthetic-token-canary',src:'owner',fetch}).send('first_frame');
  if(BAD.includes(key)){assert.equal(sent.length,0,String(key));continue;}
  assert.equal(sent.length,2);for(const init of sent){assert.equal(init.headers.apikey,key);assert.equal(init.headers.Authorization,key===ANON?'Bearer '+key:undefined);}
  assert.equal(JSON.parse(sent[1].body).p_src,'owner');
 }
});
test('a missing helper fails closed in every direct caller',async()=>{
 for(const [file,member,invoke]of [['waitlist/waitlist.js','VeyletWaitlist',a=>a.join],['report/report.js','VeyletReport',a=>a.send],['unsubscribe.js','VeyletUnsubscribe',a=>a.ask]]){
  let calls=0;const api=load(file,false)[member];await invoke(api)(async()=>{calls++;throw Error('must not send')},{url:'https://fixture.invalid',anonKey:PUB},{});assert.equal(calls,0,file);
 }
 const api=load('client-page.js',false).VeyletClientPage;assert.equal(api.restClient({url:'https://fixture.invalid',anonKey:PUB},()=>{}),null);
 assert.equal(api.viewBeacon({config:{url:'https://fixture.invalid',anonKey:PUB},token:'synthetic-token-canary',fetch:()=>{throw Error('must not send')}}).send('open'),false);
});
test('every dependent page loads the byte-pinned helper before its caller',()=>{
 const hash=require('node:crypto').createHash('sha256').update(read('public-rpc.js')).digest('hex').slice(0,16);
 for(const [page,caller]of [['waitlist/index.html','/waitlist/waitlist.js'],['report/index.html','/report/report.js'],['unsubscribe/index.html','/unsubscribe.js'],['handoff/index.html','/client-page.js'],['embed/index.html','/client-page.js'],['tour/index.html','/client-page.js']]){
  const html=read(page),helper=html.indexOf('/public-rpc.js?v='+hash);assert.ok(helper>=0&&helper<html.indexOf(caller),page);
 }
});
