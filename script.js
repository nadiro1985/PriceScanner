// === CONFIG / STATE ===
const WORKER_BASE = "https://pricescanner.b48rptrywg.workers.dev";
const EBAY_API = WORKER_BASE; // search endpoint uses /?q=...

// Only eBay + Shopee now
const vendors = ["eBay","Shopee"];
let enabled     = [...vendors]; // both ON by default

let currency    = "SGD";
let sortBy      = "priceAsc";
let query       = "";
let offers      = [];          // demo/base offers (still used for other vendors in demo.json if you want)
let ebayOffers  = [];          // live eBay offers
let shopeeOffers= [];          // Shopee feed offers
let userCountry = "US";
let maxShipDays = "";
let fx          = { base:"USD", rates:{ USD:1 }, at:0 };
let watches     = JSON.parse(localStorage.getItem('ps.watches')||"[]");

// i18n
const i18n = {
  en:{Lang:"Language",Currency:"Currency",Sort:"Sort by",Sources:"Sources",Watchlist:"Watchlist",Refresh:"Refresh",MaxShip:"Max ship days"},
  ar:{Lang:"اللغة",Currency:"العملة",Sort:"ترتيب حسب",Sources:"المصادر",Watchlist:"قائمة المراقبة",Refresh:"تحديث",MaxShip:"أقصى أيام للشحن"},
  fr:{Lang:"Langue",Currency:"Devise",Sort:"Trier par",Sources:"Sources",Watchlist:"Liste de suivi",Refresh:"Actualiser",MaxShip:"Délais max"},
  es:{Lang:"Idioma",Currency:"Moneda",Sort:"Ordenar por",Sources:"Fuentes",Watchlist:"Lista",Refresh:"Actualizar",MaxShip:"Días máx envío"},
  zh:{Lang:"语言",Currency:"货币",Sort:"排序",Sources:"来源",Watchlist:"关注列表",Refresh:"刷新",MaxShip:"最⻓运输天数"}
};
let lang = localStorage.getItem('ps.lang') || 'en';
const trending = ["headphones","iphone","ssd","laptop","smartwatch","wireless earbuds","gaming mouse","4K TV","backpack"];

// helpers
function fmt(n){ try{ return new Intl.NumberFormat(currency==='SGD'?'en-SG':'en',{style:'currency',currency}).format(n) }catch(e){ return Number(n).toFixed(2) } }
const $ = sel => document.querySelector(sel);
function t(k){ return (i18n[lang] && i18n[lang][k]) || i18n.en[k] || k; }
function show(el, on){ if (el) el.style.display = on ? 'flex' : 'none'; }
async function postJSON(url, data){ const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}); return r.json(); }
(function(){ try{ const loc=(navigator.language||"en-US").split("-")[1]; if(loc) userCountry=loc.toUpperCase(); }catch{} })();

// FX
async function loadRates() {
  try {
    const cached = JSON.parse(localStorage.getItem('ps.fx')||'null');
    if (cached && (Date.now()-cached.at) < 12*60*60*1000) { fx=cached; return; }
    const r = await fetch("https://api.frankfurter.app/latest?from=USD",{cache:"no-store"});
    const d = await r.json(); const rates=d.rates||{}; rates.USD=1; fx={base:"USD",rates,at:Date.now()};
    localStorage.setItem('ps.fx', JSON.stringify(fx));
  }catch(e){ console.warn("FX load failed", e); }
}
function convertAmount(amount, fromCur){ const from=(fromCur||"USD").toUpperCase(); const to=currency.toUpperCase();
  if(from===to) return amount; const r=fx.rates||{}; const rFrom=(from===fx.base)?1:r[from]; const rTo=(to===fx.base)?1:r[to];
  if(!rFrom||!rTo) return amount; return amount*(rTo/rFrom); }
function priceInSelected(o){ return convertAmount(o.price, o.currency||"USD"); }
function estimateShipDays(vendor,country){ const fast=["eBay"]; const intl=["Shopee"];
  if(fast.includes(vendor)) return (["SG","US","GB"].includes(country))?3:7;
  if(intl.includes(vendor)) return (country==="SG")?7:14;
  return 10; }

// data loaders
async function loadDemo(){
  try{
    const r=await fetch('demo.json',{cache:"no-store"});
    if(r.ok){
      const raw=await r.json();
      // keep only any eBay/Shopee items in demo (optional)
      offers=raw.filter(x=>["eBay","Shopee"].includes(x.vendor))
                .map(o=>({...o,currency:o.currency||"USD",shipDays:o.shipDays||estimateShipDays(o.vendor,userCountry)}));
    } else { offers=[]; }
  }catch{ offers=[]; }
}
async function loadEbay(q){
  ebayOffers=[]; const term=(q||"").trim(); if(!enabled.includes("eBay")||!EBAY_API||!term) return;
  try{ const join=EBAY_API.includes("?")?"&":"?"; const r=await fetch(EBAY_API+join+"q="+encodeURIComponent(term),{mode:"cors",cache:"no-store"});
    if(!r.ok){ console.warn("eBay API error",r.status); return; } const d=await r.json();
    ebayOffers=(Array.isArray(d.results)?d.results:[]).map(o=>({...o,currency:o.currency||"USD",shipDays:estimateShipDays("eBay",userCountry)}));
  }catch(e){ console.warn("eBay API fetch failed:",e); }
}
async function loadShopee(q){
  shopeeOffers=[]; const term=(q||"").trim(); if(!enabled.includes("Shopee")||!WORKER_BASE||!term) return;
  try{ const r=await fetch(`${WORKER_BASE}/feed/shopee?q=`+encodeURIComponent(term),{mode:"cors",cache:"no-store"});
    if(!r.ok){ console.warn("Shopee feed error",r.status); return; } const d=await r.json();
    shopeeOffers=(Array.isArray(d.results)?d.results:[]).map(o=>({...o,currency:o.currency||"USD",shipDays:estimateShipDays("Shopee",userCountry)}));
  }catch(e){ console.warn("Shopee feed fetch failed:",e); }
}

// merge & filter
function currentResults(){
  let base = []; // we’ll rely on live eBay + Shopee; you can concat offers (demo) if you want
  if (enabled.includes("eBay"))    base = base.concat(ebayOffers);
  if (enabled.includes("Shopee"))  base = base.concat(shopeeOffers);

  if (query) base = base.filter(o => (o.title||"").toLowerCase().includes(query.toLowerCase()));
  if (maxShipDays) base = base.filter(o => (o.shipDays||estimateShipDays(o.vendor,userCountry)) <= Number(maxShipDays));
  if (sortBy==='priceAsc')  base.sort((a,b)=> priceInSelected(a) - priceInSelected(b));
  if (sortBy==='priceDesc') base.sort((a,b)=> priceInSelected(b) - priceInSelected(a));
  if (sortBy==='rating')    base.sort((a,b)=> (b.rating||4.2) - (a.rating||4.2));

  // dedupe (title+vendor) at lowest price
  const m=new Map();
  for(const o of base){ const k=((o.title||'')+'|'+o.vendor).toLowerCase(); const v=m.get(k);
    if(!v || priceInSelected(o) < priceInSelected(v)) m.set(k,o); }
  return Array.from(m.values());
}

// labels / RTL (defensive)
function renderLabels(){
  const setTxt = (id, key) => { const el=document.getElementById(id); if (el) el.textContent=t(key); };
  setTxt('lblLang','Lang'); setTxt('lblCurrency','Currency'); setTxt('lblSort','Sort');
  setTxt('lblSources','Sources'); setTxt('lblWatchlist','Watchlist'); setTxt('lblShip','MaxShip');
  const rb=document.getElementById('refreshBtn'); if (rb) rb.textContent=t('Refresh');
  document.documentElement.dir = (lang==='ar') ? 'rtl' : 'ltr';
}

// signup modal (unchanged)
function initSignupUI(){
  const modal=$('#signupModal'), openBtn=$('#openSignup'), closeBtn=$('#suClose'),
        step1=$('#signupStep1'), step2=$('#signupStep2'), msg=$('#signupMsg'),
        emailEl=$('#suEmail'), codeEl=$('#suCode'), sendBtn=$('#suSend'), verifyBtn=$('#suVerify');
  if(!openBtn||!modal) return;
  openBtn.onclick=()=>{ if(msg) msg.textContent=''; if(step1) step1.style.display='block'; if(step2) step2.style.display='none'; show(modal,true); };
  if(closeBtn) closeBtn.onclick=()=> show(modal,false);
  if(sendBtn) sendBtn.onclick=async()=>{ const email=(emailEl?.value||'').trim().toLowerCase();
    if(!email||!email.includes('@')){ if(msg) msg.textContent='Enter a valid email.'; return; }
    try{ const out=await postJSON(`${WORKER_BASE}/signup`,{email});
      if(out.ok){ if(msg) msg.textContent=out.emailed?'Code sent to your email.':`Dev code: ${out.devCode}`; if(step1) step1.style.display='none'; if(step2) step2.style.display='block'; }
      else { if(msg) msg.textContent=out.error||'Could not send code.'; }
    }catch{ if(msg) msg.textContent='Network error.'; }
  };
  if(verifyBtn) verifyBtn.onclick=async()=>{ const email=(emailEl?.value||'').trim().toLowerCase(); const code=(codeEl?.value||'').trim();
    if(!code){ if(msg) msg.textContent='Enter the 6-digit code.'; return; }
    try{ const out=await postJSON(`${WORKER_BASE}/verify`,{email,code});
      if(out.ok){ localStorage.setItem('ps.email',email); if(msg) msg.textContent='Verified! Enable email alerts in your watchlist.'; setTimeout(()=>show(modal,false),1200); }
      else { if(msg) msg.textContent=out.error||'Invalid code.'; }
    }catch{ if(msg) msg.textContent='Network error.'; }
  };
}

// save watchlist to server (discount-only)
async function pushWatchlistToServer(){
  const email=localStorage.getItem('ps.email')||''; if(!email) return;
  const payload={ email, watches: watches.filter(w=>w.emailOpt&&typeof w.discountPct==='number').map(w=>({ title:w.title, vendors:w.vendors, discountPct:w.discountPct })) };
  if(!payload.watches.length) return;
  try{ await fetch(`${WORKER_BASE}/watchlist`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}); }catch{}
}

// render items + watchlist
function render(){
  renderLabels();

  const srcWrap = $('#sources'); srcWrap.innerHTML='';
  vendors.forEach(v=>{ const on=enabled.includes(v);
    const b=document.createElement('button'); b.className='badge'; b.style.background=on?'#ecfdf5':'#fff7ed';
    b.textContent=(on?'✔ ':'✖ ')+v; b.onclick=()=>{ enabled=on?enabled.filter(x=>x!==v):[...enabled,v]; render(); }; srcWrap.appendChild(b); });

  const data = currentResults();
  const grid = $('#grid'); grid.innerHTML='';
  data.forEach(item=>{
    const p = priceInSelected(item);
    const ship = item.shipDays || estimateShipDays(item.vendor, userCountry);
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `
      <div style="position:relative;width:100%;padding-top:56%">
        <img src="${item.image}" alt="${item.title}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>
      </div>
      <div style="padding:16px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <h3 style="font-size:16px;font-weight:700;line-height:1.2;margin:0">${item.title}</h3>
        </div>
        <div style="display:flex;gap:8px;font-size:13px;margin-top:6px">
          <span class="badge">${item.vendor}</span>
          <span class="badge">⭐ ${item.rating||4.2}</span>
          <span class="badge">🚚 ~${ship}d</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <div style="font-size:22px;font-weight:800">${fmt(p)}</div>
          <div style="font-size:12px;color:#6b7280;text-align:right"><div>${item.shipping||'—'}</div><div>${item.shipTime||'—'}</div></div>
        </div>
        <div class="row" style="margin-top:10px">
          <a class="btn btn-primary" href="${item.url}" target="_blank" rel="noreferrer">View Deal</a>
          <button class="btn watchBtn">Watch</button>
        </div>
      </div>`;
    card.querySelector('.watchBtn').onclick = ()=> addWatch(item);
    grid.appendChild(card);
  });

  const list = $('#watchlist'); list.innerHTML = watches.length ? '' : '<div style="font-size:14px;color:#6b7280">No watched items yet.</div>';
  watches.forEach(w=>{
    const row=document.createElement('div'); row.className='card'; row.style.border='1px solid rgba(0,0,0,.08)';
    row.innerHTML = `
      <div style="padding:12px">
        <div style="font-weight:700">${w.title}</div>
        <div style="font-size:12px;color:#6b7280">Baseline: ${w.baseline??'—'} • Last: ${w.last??'—'} • ${w.triggered?'Triggered':'Waiting'}</div>
        <div class="row" style="margin-top:8px;align-items:center">
          <input type="number" class="input discount" placeholder="Discount % from baseline" value="${w.discountPct??''}"/>
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="emailOpt"${w.emailOpt?' checked':''}/> email alerts</label>
          <button class="btn remove">Remove</button>
        </div>
      </div>`;
    row.querySelector('.discount').oninput = async (e)=>{ w.discountPct=Number(e.target.value); saveWatches(); await pushWatchlistToServer(); };
    row.querySelector('.emailOpt').onchange = async (e)=>{ w.emailOpt=e.target.checked; saveWatches(); await pushWatchlistToServer(); };
    row.querySelector('.remove').onclick = ()=>{ watches=watches.filter(x=>x!==w); saveWatches(); render(); };
    list.appendChild(row);
  });
}

// watchlist helpers (discount-only)
function saveWatches(){ localStorage.setItem('ps.watches', JSON.stringify(watches)) }
function addWatch(item){
  const id=(item.title+'|'+enabled.sort().join(',')).toLowerCase();
  if (watches.find(w=>w.id===id)) { toast('Already in watchlist'); return; }
  watches=[{ id, title:item.title, vendors:[...enabled], discountPct:15, emailOpt:false }, ...watches];
  saveWatches(); toast('Added to watchlist'); render();
}
async function refreshWatches(){
  const data=currentResults(); let changed=false, msg;
  watches=watches.map(w=>{
    const pool=data.filter(o=>w.vendors.includes(o.vendor)&&o.title.toLowerCase().includes(w.title.toLowerCase().split(' sample')[0]));
    if(!pool.length) return w;
    const best=pool.reduce((a,b)=> priceInSelected(a)<=priceInSelected(b)?a:b);
    const baseline=w.baseline??priceInSelected(best);
    const discount=baseline>0?((baseline-priceInSelected(best))/baseline)*100:0;
    const trig=(typeof w.discountPct==='number') && (discount>=(w.discountPct||0));
    if(trig && !w.triggered) msg=`${w.title} @ ${best.vendor} → ${fmt(priceInSelected(best))}`;
    if(trig!==!!w.triggered || w.last!==priceInSelected(best)||w.lastVendor!==best.vendor||w.baseline!==baseline) changed=true;
    return {...w, baseline, last:priceInSelected(best), lastVendor:best.vendor, triggered:trig};
  });
  if(changed) saveWatches(); if(msg) toast(msg); render();
}
function toast(m){ const t=$('#toast'); if(!t) return; t.textContent=m; t.style.display='block'; setTimeout(()=>t.style.display='none',3500); }

// personalization
function captureReferral(){ const p=new URLSearchParams(location.search); const r=p.get('ref'); if(r) localStorage.setItem('ps.ref',r); }
function defaultQuery(){ const last=localStorage.getItem('ps.lastQuery'); return last||trending[Math.floor(Math.random()*trending.length)]; }

// BOOT
let debounce;
window.addEventListener('DOMContentLoaded', async ()=>{
  const selLang=$('#lang'); if(selLang){ selLang.value=lang; selLang.onchange=()=>{ lang=selLang.value; localStorage.setItem('ps.lang',lang); render(); } }
  $('#currency').onchange=(e)=>{ currency=e.target.value; render(); }
  $('#sort').onchange=(e)=>{ sortBy=e.target.value; render(); }
  $('#shipMax').onchange=(e)=>{ maxShipDays=e.target.value; render(); }

  $('#search').oninput=(e)=>{ query=e.target.value; localStorage.setItem('ps.lastQuery',query);
    clearTimeout(debounce); debounce=setTimeout(async()=>{ await Promise.all([loadEbay(query),loadShopee(query)]); render(); },250); };
  $('#searchBtn').onclick=()=>{ const input=$('#search'); if(input){ input.dispatchEvent(new Event('input',{bubbles:true})); } }
  $('#refreshBtn').onclick=refreshWatches;

  initSignupUI(); captureReferral(); await loadRates();

  const startTerm=defaultQuery(); query=startTerm; const se=$('#search'); if(se) se.value=startTerm;

  await loadDemo(); // optional demo; can remove if you want only live
  await Promise.all([loadEbay(query),loadShopee(query)]);
  render();
});
