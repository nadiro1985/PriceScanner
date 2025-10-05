// === CONFIG / STATE ===
const WORKER_BASE = "https://pricescanner.b48rptrywg.workers.dev";
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

// Neutral placeholder if an image fails to load
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop stop-color="#f3f4f6" offset="0"/><stop stop-color="#e5e7eb" offset="1"/>
     </linearGradient></defs>
     <rect width="600" height="450" fill="url(#g)"/>
     <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
           fill="#94a3b8" font-family="Arial" font-size="20">No image</text>
   </svg>`
);

// Live: Amazon, eBay, AliExpress
const vendorDefs = [
  { name: "Amazon",     slug: "amazon",     supported: true,  color: "blue"  },
  { name: "eBay",       slug: "ebay",       supported: true,  color: "green" },
  { name: "AliExpress", slug: "aliexpress", supported: true,  color: "red"   },
  // not shown in filter (to avoid "coming soon" copy)
  { name: "Shopee",  slug: "shopee",  supported: false },
  { name: "Etsy",    slug: "etsy",    supported: false },
  { name: "Alibaba", slug: "alibaba", supported: false },
];

let enabled   = vendorDefs.filter(v => v.supported).map(v => v.name);
let pagesByVendor = Object.fromEntries(enabled.map(n => [n, 1])); // pagination

let currency    = "SGD";
let sortBy      = "priceAsc";
let query       = "";
let userCountry = "US";
let maxShipDays = "";
let fx          = { base:"USD", rates:{ USD:1 }, at:0 };
let watches     = JSON.parse(localStorage.getItem('ps.watches')||"[]");
let lang        = localStorage.getItem('ps.lang') || 'en';
let theme       = localStorage.getItem('ps.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let lastFocusedEl = null;

const offersByVendor = Object.fromEntries(vendorDefs.map(v => [v.name, []]));

// i18n
const i18n = {
  en:{Lang:"Language",Currency:"Currency",Sort:"Sort by",Sources:"Sources",Watchlist:"Watchlist",Refresh:"Refresh",MaxShip:"Max ship days"},
  ar:{Lang:"اللغة",Currency:"العملة",Sort:"ترتيب حسب",Sources:"المصادر",Watchlist:"قائمة المراقبة",Refresh:"تحديث",MaxShip:"أقصى أيام للشحن"},
  fr:{Langue:"Langue",Currency:"Devise",Sort:"Trier par",Sources:"Sources",Watchlist:"Liste de suivi",Refresh:"Actualiser",MaxShip:"Délais max"},
  es:{Lang:"Idioma",Currency:"Moneda",Sort:"Ordenar por",Sources:"Fuentes",Watchlist:"Lista",Refresh:"Actualizar",MaxShip:"Días máx envío"},
  zh:{Lang:"语言",Currency:"货币",Sort:"排序",Sources:"来源",Watchlist:"关注列表",Refresh:"刷新",MaxShip:"最⻓运输天数"}
};
const trending = ["headphones","iphone","ssd","laptop","smartwatch","wireless earbuds","gaming mouse","4K TV","backpack"];

// helpers
function fmt(n){ try{ return new Intl.NumberFormat(currency==='SGD'?'en-SG':(lang==='ar'?'ar':'en'),{style:'currency',currency}).format(n) }catch(e){ return Number(n).toFixed(2) } }
const $ = sel => document.querySelector(sel);
function t(k){ return (i18n[lang] && i18n[lang][k]) || i18n.en[k] || k; }
function show(el, on){ if (el) el.style.display = on ? 'flex' : 'none'; }
async function postJSON(url, data){ const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}); return r.json(); }
(function(){ try{ const loc=(navigator.language||"en-US").split("-")[1]; if(loc) userCountry=loc.toUpperCase(); }catch{} })();

// Theme
function applyTheme(mode){
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem('ps.theme', mode);
  const btn = $('#themeToggle');
  if (btn) btn.textContent = (mode==='dark'?'☀️':'🌙');
}
applyTheme(theme);

// FX
async function loadRates() {
  try {
    const cached = JSON.parse(localStorage.getItem('ps.fx')||'null');
    if (cached && (Date.now()-cached.at) < 12*60*60*1000) { fx=cached; return; }
    const r = await fetch("https://api.frankfurter.app/latest?from=USD",{cache:"no-store"});
    const d = await r.json(); const rates=d.rates||{}; rates.USD=1; fx={base:"USD",rates,at:Date.now()};
    localStorage.setItem('ps.fx', JSON.stringify(fx));
  }catch(e){
    const cached = JSON.parse(localStorage.getItem('ps.fx')||'null');
    if (cached && (Date.now()-cached.at) < 72*60*60*1000) { fx=cached; }
  }
}
function convertAmount(amount, fromCur){ const from=(fromCur||"USD").toUpperCase(); const to=currency.toUpperCase();
  if(from===to) return amount; const r=fx.rates||{}; const rFrom=(from===fx.base)?1:r[from]; const rTo=(to===fx.base)?1:r[to];
  if(!rFrom||!rTo) return amount; return amount*(rTo/rFrom); }
function priceInSelected(o){ return convertAmount(o.price, o.currency||"USD"); }
function estimateShipDays(vendor,country){
  const fast = new Set(["eBay","Amazon"]);
  const intl = new Set(["AliExpress"]);
  if (fast.has(vendor)) return (["SG","US","GB"].includes(country))?3:7;
  if (intl.has(vendor)) return (country==="SG")?7:14;
  return 10;
}

// Budget helpers
function getBudget(){
  const mn = parseFloat($('#minPrice')?.value || '');
  const mx = parseFloat($('#maxPrice')?.value || '');
  return { min: Number.isFinite(mn) ? mn : null, max: Number.isFinite(mx) ? mx : null };
}

// build /out wrapper URL for clicks
function outUrl(item){
  const r = localStorage.getItem('ps.ref') || '';
  const params = new URLSearchParams({
    vendor: item.vendor || '',
    u: item.url || '',
    id: item.id || '',
    t: query || '',
    r
  });
  return `${WORKER_BASE}/out?${params.toString()}`;
}

// ---- AliExpress enrichment (optional) ----
const AE_DETAIL_ENRICH_COUNT = 0;
async function enrichAliDetails(items){
  const tasks = items.slice(0, AE_DETAIL_ENRICH_COUNT).map(async (it) => {
    if (!it || !it.id) return it;
    try {
      const url = new URL(`${WORKER_BASE}/ae/price`);
      url.searchParams.set("product_id", String(it.id));
      if (DEBUG) url.searchParams.set("debug","1");
      const r = await fetch(url.toString(), { mode: "cors", cache: "no-store" });
      if (!r.ok) return it;
      const d = await r.json().catch(()=>null);
      const fresh = d && d.ok && d.data ? d.data : null;
      if (fresh && typeof fresh.price === "number" && fresh.price > 0) {
        return { ...it, price: fresh.price, currency: fresh.currency || it.currency || "USD", url: fresh.url || it.url };
      }
      return it;
    } catch { return it; }
  });
  const enriched = await Promise.all(tasks);
  const map = new Map(enriched.map(e => [String(e.id), e]));
  return items.map(o => map.get(String(o.id)) || o);
}

// loaders (now with paging)
async function loadVendor(vendor, page = 1, append = false){
  const def = vendorDefs.find(v => v.name === vendor); if (!def) return 0;
  if (!def.supported) return 0;
  const term=(query||"").trim(); if(!enabled.includes(vendor)||!WORKER_BASE||!term) return 0;

  try{
    const url = new URL(`${WORKER_BASE}/search/${def.slug}`);
    url.searchParams.set("q", term);
    url.searchParams.set("page", String(page));  // Worker supports this
    if (DEBUG) url.searchParams.set("debug","1");
    const r=await fetch(url.toString(),{mode:"cors",cache:"no-store"});
    const d=await r.json().catch(()=>({results:[]}));
    if(!r.ok){ console.warn(`${vendor} search error`, r.status, d); return 0; }
    if (d.error) console.warn(`${vendor} search error:`, d.error);
    if (d.note)  console.info(`${vendor} search note:`, d.note);

    let arr=(Array.isArray(d.results)?d.results:[]).map(o=>({
      ...o,
      currency:o.currency||"USD",
      shipDays:estimateShipDays(vendor,userCountry),
      vendor
    }));

    if (vendor === "AliExpress" && arr.length) arr = await enrichAliDetails(arr);

    if (append) {
      const prev = offersByVendor[vendor] || [];
      // de-dup by id or (title+vendor)
      const seen = new Set(prev.map(x => x.id || ((x.title||'')+'|'+x.vendor).toLowerCase()));
      const more = arr.filter(x => { const k=(x.id||((x.title||'')+'|'+x.vendor)).toString().toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
      offersByVendor[vendor] = prev.concat(more);
    } else {
      offersByVendor[vendor] = arr;
    }
    console.log(`[${vendor}] page ${page} loaded:`, arr.length, 'items for', term);
    return arr.length;
  }catch(e){ console.warn(`${vendor} search fetch failed:`,e); return 0; }
}

function currentResults(){
  let base = [];
  for (const v of vendorDefs.filter(v=>v.supported).map(v=>v.name)) {
    if (enabled.includes(v)) base = base.concat(offersByVendor[v]||[]);
  }
  // Budget
  const {min,max} = getBudget();
  if (min!=null) base = base.filter(o => priceInSelected(o) >= min);
  if (max!=null) base = base.filter(o => priceInSelected(o) <= max);

  if (maxShipDays) base = base.filter(o => (o.shipDays||estimateShipDays(o.vendor,userCountry)) <= Number(maxShipDays));
  if (sortBy==='priceAsc')  base.sort((a,b)=> priceInSelected(a) - priceInSelected(b));
  if (sortBy==='priceDesc') base.sort((a,b)=> priceInSelected(b) - priceInSelected(a));
  if (sortBy==='rating')    base.sort((a,b)=> (b.rating||4.2) - (a.rating||4.2));

  const m=new Map();
  for(const o of base){ const k=((o.title||'')+'|'+o.vendor).toLowerCase(); const v=m.get(k);
    if(!v || priceInSelected(o) < priceInSelected(v)) m.set(k,o); }
  return Array.from(m.values());
}

function renderLabels(){
  const setTxt = (id, key) => { const el=document.getElementById(id); if (el) el.textContent=t(key); };
  setTxt('lblLang','Lang'); setTxt('lblCurrency','Currency'); setTxt('lblSort','Sort');
  setTxt('lblSources','Sources'); setTxt('lblWatchlist','Watchlist'); setTxt('lblShip','MaxShip');
  document.documentElement.dir = (lang==='ar') ? 'rtl' : 'ltr';
}

function vendorColorStyle(name){
  const v = vendorDefs.find(x=>x.name===name);
  if(!v) return '';
  if (v.color==='blue') return 'var(--brand-blue)';
  if (v.color==='red')  return 'var(--brand-red)';
  if (v.color==='green')return 'var(--brand-green)';
  return 'var(--accent-1)';
}

// ---- Sources dropdown ----
function buildSourceMenu(){
  const menu = $('#sourceMenu'); if (!menu) return;
  const supported = vendorDefs.filter(v=>v.supported).map(v=>v.name).sort((a,b)=>a.localeCompare(b));
  let html = `<label class="check"><input type="checkbox" id="srcAll"> <span>All</span></label><div class="divider"></div>`;
  for (const name of supported){
    const id = 'src_' + name.toLowerCase().replace(/\s+/g,'_');
    html += `<label class="check"><input type="checkbox" id="${id}" data-name="${name}"> <span>${name}</span></label>`;
  }
  menu.innerHTML = html;

  const btn = $('#sourceBtn');
  function updateBtn(){
    if (enabled.length===supported.length || enabled.length===0) btn.textContent='All sources';
    else btn.textContent = `${enabled.length} selected`;
  }
  $('#srcAll').checked = enabled.length===supported.length;
  for (const name of supported){
    const id = '#src_' + name.toLowerCase().replace(/\s+/g,'_');
    const cb = $(id);
    cb.checked = enabled.includes(name);
    cb.onchange = ()=>{
      if(cb.checked) enabled = Array.from(new Set([...enabled, name]));
      else enabled = enabled.filter(n=>n!==name);
      $('#srcAll').checked = enabled.length===supported.length;
      updateBtn(); render();
    };
  }
  $('#srcAll').onchange = (e)=>{
    enabled = e.target.checked ? supported.slice() : [];
    for (const name of supported){ const cb = $('#src_' + name.toLowerCase().replace(/\s+/g,'_')); if(cb) cb.checked = e.target.checked; }
    updateBtn(); render();
  };
  updateBtn();
}
function toggleSourceMenu(show){
  const m = $('#sourceMenu'); const b = $('#sourceBtn');
  if (!m || !b) return;
  if (show==null) show = m.hidden;
  m.hidden = !show; b.setAttribute('aria-expanded', String(show));
}
document.addEventListener('click', (e)=>{
  const m=$('#sourceMenu'); const b=$('#sourceBtn');
  if(!m || !b) return;
  if (b.contains(e.target)) { toggleSourceMenu(); return; }
  if (!m.contains(e.target)) { m.hidden = true; b.setAttribute('aria-expanded','false'); }
});

// signup modal
function initSignupUI(){
  const modal=$('#signupModal'), openBtn=$('#openSignup'), closeBtn=$('#suClose'),
        step1=$('#signupStep1'), step2=$('#signupStep2'), msg=$('#signupMsg'),
        emailEl=$('#suEmail'), codeEl=$('#suCode'), sendBtn=$('#suSend'), verifyBtn=$('#suVerify');

  function trapTab(e){
    if(e.key!=='Tab') return;
    const f = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = f[0], last = f[f.length-1];
    if (e.shiftKey && document.activeElement === first){ last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last){ first.focus(); e.preventDefault(); }
  }
  function openModal(){
    if(!modal) return;
    lastFocusedEl = document.activeElement;
    if(msg) msg.textContent='';
    if(step1) step1.style.display='block';
    if(step2) step2.style.display='none';
    show(modal,true);
    emailEl?.focus();
    document.addEventListener('keydown', trapTab);
  }
  function closeModal(){
    show(modal,false);
    document.removeEventListener('keydown', trapTab);
    lastFocusedEl?.focus();
  }

  if(!openBtn||!modal) return;
  openBtn.onclick=openModal;
  if(closeBtn) closeBtn.onclick=closeModal;
  modal?.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && modal?.style.display==='flex') closeModal(); });

  if(sendBtn) sendBtn.onclick=async()=>{
    const email=(emailEl?.value||'').trim().toLowerCase();
    if(!email||!email.includes('@')){ if(msg) msg.textContent='Enter a valid email.'; return; }
    try{
      const out=await postJSON(`${WORKER_BASE}/signup`,{email});
      if(out.ok){
        if(msg) msg.textContent=out.emailed?'Code sent to your email.':`Dev code: ${out.devCode}`;
        if(step1) step1.style.display='none'; if(step2) step2.style.display='block';
        $('#suCode')?.focus();
      } else { if(msg) msg.textContent=out.error||'Could not send code.'; }
    }catch{ if(msg) msg.textContent='Network error.'; }
  };

  if(verifyBtn) verifyBtn.onclick=async()=>{
    const email=(emailEl?.value||'').trim().toLowerCase(); const code=(codeEl?.value||'').trim();
    if(!code){ if(msg) msg.textContent='Enter the 6-digit code.'; return; }
    try{
      const out=await postJSON(`${WORKER_BASE}/verify`,{email,code});
      if(out.ok){
        localStorage.setItem('ps.email',email);
        if(msg) msg.textContent='Verified! Enable email alerts in your watchlist.';
        setTimeout(()=>{ closeModal(); },1200);
      } else { if(msg) msg.textContent='Invalid code.'; }
    }catch{ if(msg) msg.textContent='Network error.'; }
  };
}

// save watchlist to server
async function pushWatchlistToServer(){
  const email=localStorage.getItem('ps.email')||''; if(!email) return;
  const payload={ email, watches: watches.filter(w=>w.emailOpt&&typeof w.discountPct==='number').map(w=>({ title:w.title, vendors:w.vendors, discountPct:w.discountPct })) };
  if(!payload.watches.length) return;
  try{ await fetch(`${WORKER_BASE}/watchlist`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}); }catch{}
}

// ----- RENDER -----
function render(){
  renderLabels();

  // Results grid
  const data = currentResults();
  const grid = $('#grid'); grid.innerHTML='';
  data.forEach(item=>{
    const p = priceInSelected(item);
    const shipDays = item.shipDays || estimateShipDays(item.vendor, userCountry);

    const card = document.createElement('div');
    card.className='card card-hover';
    card.innerHTML = `
      <div class="media">
        <img loading="lazy" src="${item.image||PLACEHOLDER_IMG}" alt="${item.title} product image"/>
      </div>
      <div class="cardBody">
        <h3 class="title clamp-2">${item.title}</h3>
        <div class="price">${fmt(p)}</div>

        <div class="metaRow">
          <span class="badge vendor" data-vendor="${item.vendor}">${item.vendor}</span>
          <span class="badge">⭐ ${Number(item.rating||4.2).toFixed(1)}</span>
          <span class="badge">🚚 ~${shipDays}d</span>
        </div>

        <div class="shipMeta">
          ${item.shipping && item.shipping !== '—' ? item.shipping : 'Shipping calculated at checkout'}
          ${item.shipTime && item.shipTime !== '—' ? ' • ' + item.shipTime : ''}
        </div>

        <div class="actions">
          <a class="btn btn-primary" href="${outUrl(item)}" target="_blank" rel="sponsored nofollow noopener">View Deal</a>
          <button class="btn watchBtn">Watch</button>
        </div>
      </div>`;
    const img = card.querySelector('img');
    img.onerror = ()=>{ img.src = PLACEHOLDER_IMG; img.onerror=null; };
    card.querySelector('.watchBtn').onclick = ()=> addWatch(item);
    grid.appendChild(card);
  });
}

// watchlist helpers
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

/* ============ Search by Photo & Chat Assistant ============ */
let mobilenetModel = null;
function loadScript(src){ return new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src=src; s.async=true; s.onload=resolve; s.onerror=reject; document.head.appendChild(s); });}
async function ensureMobileNet(){
  if (mobilenetModel) return mobilenetModel;
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0');
  mobilenetModel = await mobilenet.load();
  return mobilenetModel;
}
async function searchByPhoto(file){
  if (!file) return;
  try {
    const model = await ensureMobileNet();
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    await new Promise(res => { img.onload = res; img.onerror = res; });
    const preds = await model.classify(img);
    const labels = (preds||[]).slice(0,3).map(p=>p.className);
    const qText = labels.join(' ');
    const input=$('#search'); if (input){ input.value = qText; }
    query = qText; localStorage.setItem('ps.lastQuery',query);
    pagesByVendor = Object.fromEntries(vendorDefs.filter(v=>v.supported).map(v=>[v.name,1]));
    const tasks = vendorDefs.filter(v=>v.supported).map(v => loadVendor(v.name, 1, false));
    await Promise.all(tasks);
    render();
    URL.revokeObjectURL(img.src);
  } catch(e){
    console.warn('Photo search error:', e);
    toast('Photo search failed. Try a clearer image.');
  }
}

// Chat assistant → update main results
function openChat(){ $('#chatPanel').hidden=false; $('#chatInput')?.focus(); }
function closeChat(){ $('#chatPanel').hidden=true; }
function addChatMsg(role, html){
  const box = $('#chatMessages');
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg ' + (role==='user'?'me':'bot');
  wrap.innerHTML = html;
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}
function parseIntent(text){
  const msg = String(text||'').toLowerCase();
  const vendors = vendorDefs.filter(v=>v.supported).map(v=>v.name.toLowerCase());
  const requested = vendors.filter(v => msg.includes(v));
  const useVendors = (requested.length ? requested : vendors).map(v=>v.toLowerCase());
  let min=null, max=null;
  const m1 = msg.match(/\$?\s*(\d+)\s*[-to]\s*\$?\s*(\d+)/); if(m1){ min=+m1[1]; max=+m1[2]; }
  const m2 = msg.match(/(?:under|below|less than)\s*\$?\s*(\d+)/); if(m2){ max=+m2[1]; }
  const m3 = msg.match(/(?:over|above|more than)\s*\$?\s*(\d+)/); if(m3){ min=+m3[1]; }
  const m4 = msg.match(/(?:around|about)\s*\$?\s*(\d+)/); if(m4){ const n=+m4[1]; min=Math.floor(n*0.8); max=Math.ceil(n*1.2); }
  let cleaned = msg.replace(/\$?\d+(\s*[-to]\s*\$?\d+)?/g,'')
                   .replace(/\b(under|below|less than|over|above|more than|around|about)\b/g,'');
  vendorDefs.forEach(v=> cleaned = cleaned.replace(new RegExp(v.name,'ig'),''));
  cleaned = cleaned.replace(/\s+/g,' ').trim();
  return { query: cleaned || msg, vendors: useVendors, min, max };
}
async function assistantRespond(userText){
  const intent = parseIntent(userText);
  addChatMsg('bot', `<div class="bot-text">Looking for <b>${intent.query}</b>${intent.min||intent.max?` with your budget${intent.min?` ≥ ${fmt(intent.min)}`:''}${intent.max?` ≤ ${fmt(intent.max)}`:''}…`:''}</div>`);

  // apply intent → main UI
  enabled = vendorDefs.filter(v=>v.supported && intent.vendors.includes(v.name.toLowerCase())).map(v=>v.name);
  if (!enabled.length) enabled = vendorDefs.filter(v=>v.supported).map(v=>v.name);
  $('#search').value = intent.query;
  query = intent.query; localStorage.setItem('ps.lastQuery', query);

  if (intent.min!=null) $('#minPrice').value = intent.min;
  if (intent.max!=null) $('#maxPrice').value = intent.max;

  // reset paging and load
  pagesByVendor = Object.fromEntries(enabled.map(v=>[v,1]));
  const tasks = enabled.map(v => loadVendor(v, 1, false));
  await Promise.all(tasks);
  render();
  addChatMsg('bot', `<div class="bot-text">Updated results are shown below.</div>`);
}

// personalization
function captureReferral(){ const p=new URLSearchParams(location.search); const r=p.get('ref'); if(r) localStorage.setItem('ps.ref',r); }
function defaultQuery(){ const urlQ = new URLSearchParams(location.search).get('q') || ''; if (urlQ) return urlQ; const last=localStorage.getItem('ps.lastQuery'); return last||trending[Math.floor(Math.random()*trending.length)]; }

// BOOT
let debounce;
window.addEventListener('DOMContentLoaded', async ()=>{
  $('#themeToggle')?.addEventListener('click', ()=> applyTheme( (localStorage.getItem('ps.theme')==='dark') ? 'light' : 'dark' ));

  buildSourceMenu();
  $('#sourceBtn')?.addEventListener('click', ()=> toggleSourceMenu());

  const selLang=$('#lang'); if(selLang){ selLang.value=lang; selLang.onchange=()=>{ lang=selLang.value; localStorage.setItem('ps.lang',lang); render(); } }
  $('#currency').onchange=(e)=>{ currency=e.target.value; render(); }
  $('#sort').onchange=(e)=>{ sortBy=e.target.value; render(); }
  $('#shipMax').onchange=(e)=>{ maxShipDays=e.target.value; render(); }
  $('#minPrice').oninput = ()=> render();
  $('#maxPrice').oninput = ()=> render();

  $('#search').oninput=(e)=>{ query=e.target.value; localStorage.setItem('ps.lastQuery',query);
    clearTimeout(debounce); debounce=setTimeout(async()=>{
      pagesByVendor = Object.fromEntries(enabled.map(v=>[v,1]));
      const tasks = enabled.map(v => loadVendor(v, 1, false));
      await Promise.all(tasks);
      render();
    },250); };
  $('#searchBtn').onclick=()=>{ const input=$('#search'); if(input){ input.dispatchEvent(new Event('input',{bubbles:true})); } }

  // Photo search
  $('#photoBtn').onclick = ()=> $('#photoInput').click();
  $('#photoInput').onchange = ()=> { const f=$('#photoInput').files?.[0]; if (f) searchByPhoto(f); };

  // Chat assistant
  $('#chatFab').onclick = openChat;
  $('#chatClose').onclick = closeChat;
  $('#chatForm').onsubmit = async (e)=>{
    e.preventDefault();
    const txt = $('#chatInput').value.trim();
    if(!txt) return;
    addChatMsg('user', `<div class="me-text">${txt}</div>`);
    $('#chatInput').value='';
    await assistantRespond(txt);
  };

  // More results
  $('#moreBtn').onclick = async ()=>{
    const tasks = enabled.map(v => {
      pagesByVendor[v] = (pagesByVendor[v]||1) + 1;
      return loadVendor(v, pagesByVendor[v], true);
    });
    await Promise.all(tasks);
    render();
  };

  $('#refreshBtn').onclick=refreshWatches;

  initSignupUI(); captureReferral(); await loadRates();

  const startTerm=defaultQuery(); query=startTerm; const se=$('#search'); if(se) se.value=startTerm;

  const tasks = enabled.map(v => loadVendor(v, 1, false));
  await Promise.all(tasks);
  render();
});
