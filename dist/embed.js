'use strict';(()=>{
const O='https://veylet.com',T=/^[A-Za-z0-9_-]{16,256}$/,P=/^\/(handoff|embed)\/?$/,L='Explore this property in 3D',D='#10231d',W='#f4f1e9',d=typeof document!=='undefined'&&document;
let m=false,a=null;
const on=(t,e,f)=>t?.addEventListener?.(e,f);
const el=(t,at,st,tx)=>{const n=d.createElement(t);for(const k in at)n.setAttribute(k,at[k]);if(st)Object.assign(n.style,st);if(tx)n.textContent=tx;return n;};
const add=(p,...c)=>(p.append?p.append(...c):c.forEach(x=>p.appendChild(x)));
const find=t=>{if(!t)return null;if(t.closest)return t.closest('a');for(let n=t;n;n=n.parentNode||n.parentElement)if(n.tagName?.toUpperCase()==='A')return n;return null;};
const parse=l=>{
const g=k=>l?.getAttribute?.(k);
const r=g('href')||l?.href||'';if(!r)return null;
let u;try{u=new URL(r,typeof location!=='undefined'&&location?.href?location.href:undefined);}catch{return null;}
if(u.origin!==O||!P.test(u.pathname))return null;
if(u.pathname[1]!=='e'&&!(l.dataset&&'veyletModal'in l.dataset)&&!l.hasAttribute?.('data-veylet-modal'))return null;
const k=u.searchParams.get('t');if(!k||!T.test(k))return null;
return{t:k,th:(l.dataset?.veyletTheme||g('data-veylet-theme')||u.searchParams.get('theme'))==='paper'?'paper':''};
};
function close(){
if(!a)return;const s=a;a=null;
s.d.removeEventListener?.('keydown',s.k);
s.o.remove?s.o.remove():s.o.parentNode?.removeChild(s.o);
if(s.b.style)s.b.style.overflow=s.ov;
s.f?.focus?.();
}
function open(tok,opts={}){
if(!d||!tok||!T.test(String(tok)))return;
if(a)close();
const b=d.body||d.documentElement;if(!b)return;
const ov=b.style?.overflow||'',f=opts.trigger||d.activeElement||null;
if(b.style)b.style.overflow='hidden';
const pp=(opts.theme||opts.th)==='paper';
const o=el('div',{role:'dialog','aria-modal':'true','aria-label':L},{position:'fixed',inset:'0',zIndex:'2147483000',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'16px',background:'rgba(16, 35, 29, 0.88)',backdropFilter:'blur(8px)'});
o.style.setProperty?.('-webkit-backdrop-filter','blur(8px)');
const box=el('div',0,{width:'100%',maxWidth:'1200px',height:'min(88vh,760px)',display:'flex',flexDirection:'column',gap:'10px'});
const btn=el('button',{type:'button','aria-label':'Close walkthrough'},{alignSelf:'flex-end',minHeight:'44px',padding:'0 18px',borderRadius:'99px',border:'1px solid rgba(244,241,233,.35)',background:D,color:W,font:'500 14px system-ui',cursor:'pointer'},'Close');
on(btn,'click',close);
const src=O+'/embed?t='+encodeURIComponent(tok)+(pp?'&theme=paper':'');
const fr=el('iframe',{src,title:L,allow:'fullscreen; xr-spatial-tracking',allowfullscreen:'',referrerpolicy:'strict-origin'},{width:'100%',flex:'1',minHeight:'320px',border:'0',borderRadius:'10px',background:pp?W:D});
if(fr.src!==src)fr.src=src;
add(box,btn,fr);add(o,box);add(b,o);
const k=e=>{if(e&&(e.key==='Escape'||e.key==='Esc')){e.preventDefault?.();close();}};
on(o,'click',e=>{if(e.target===o||e.target===box)close();});
on(d,'keydown',k);
a={d,b,o,ov,f,k};
btn.focus?.();
}
const onClick=e=>{
if(!e||e.defaultPrevented||(e.button|0)||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
const l=find(e.target),p=parse(l);if(!p)return;
e.preventDefault();open(p.t,{trigger:l,theme:p.th});
};
function mount(){if(m||!d)return;m=true;on(d,'click',onClick);}
if(typeof window!=='undefined')window.VeyletEmbed={mount,open,close};
if(d)d.readyState==='loading'?on(d,'DOMContentLoaded',mount):mount();
})();
