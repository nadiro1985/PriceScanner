// === CONFIG / STATE ===
const WORKER_BASE = "https://pricescanner.b48rptrywg.workers.dev";

// If you add ?debug=1 to your page URL, it'll be passed through to Worker calls.
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

// Platforms: keep Amazon, eBay, AliExpress (live); keep Shopee, Etsy, Alibaba as coming soon
const vendorDefs = [
  { name: "Amazon",     slug: "amazon",     supported: true,  color: "blue" },
  { name: "eBay",       slug: "ebay",       supported: true,  color: "green" },
  { name: "AliExpress", slug: "aliexpress", supported: true,  color: "red" },
  { name: "Shopee",     slug: "shopee",     supported: false, comingSoon: true, color: "red" },
  { name: "Etsy",       slug: "etsy",       supported: false, comingSoon: true, color: "green" },
  { name: "Alibaba",    slug: "alibaba",    supported: false, comingSoon: true, color: "blue" },
];

let enabled       = vendorDefs.filter(v => v.supported).map(v => v.name); // live platforms ON by default

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
  const intl = new Set(["AliExpress","Shopee","Etsy","Alibaba"]);
  if (fast.has(vendor)) return (["SG","US","GB"].includes(country))?3:7;
  if (intl.has(vendor)) return (country==="SG")?7:14;
  return 10;
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

// ---- AliExpress enrichment: fetch live detail price for top N results ----
const AE_DETAIL_ENRICH_COUNT = 0; // tweak if needed
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

// loaders
async function loadVendor(vendor){
  const def = vendorDefs.find(v => v.name === vendor); if (!def) return;
  offersByVendor[vendor] = [];

  // Skip vendors that are not yet supported
  if (!def.supported) {
    console.info(`[${vendor}] coming soon; skipping network call.`);
    return;
  }

  const term=(query||"").trim(); if(!enabled.includes(vendor)||!WORKER_BASE||!term) return;
  try{
    const url = new URL(`${WORKER_BASE}/search/${def.slug}`);
    url.searchParams.set("q", term);
    if (DEBUG) url.searchParams.set("debug","1");
    const r=await fetch(url.toString(),{mode:"cors",cache:"no-store"});
    const d=await r.json().catch(()=>({results:[]}));
    if(!r.ok){ console.warn(`${vendor} search error`, r.status, d); return; }
    if (d.error) console.warn(`${vendor} search error:`, d.error);
    if (d.note)  console.info(`${vendor} search note:`, d.note);

    let arr=(Array.isArray(d.results)?d.results:[]).map(o=>({
      ...o,
      currency:o.currency||"USD",
      shipDays:estimateShipDays(vendor,userCountry),
      vendor
    }));

    // Optional: get fresher AliExpress prices via /ae/price
    if (vendor === "AliExpress" && arr.length) {
      arr = await enrichAliDetails(arr);
    }

    offersByVendor[vendor] = arr;
    console.log(`[${vendor}] loaded:`, arr.length, 'items for', term);
    if (!arr.length) console.info(`${vendor}: 0 results for query:`, term);
  }catch(e){ console.warn(`${vendor} search fetch failed:`,e); }
}

function currentResults(){
  let base = [];
  for (const v of vendorDefs.map(v=>v.name)) {
    if (enabled.includes(v)) base = base.concat(offersByVendor[v]||[]);
  }
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
  modal.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && modal.style.display==='flex') closeModal(); });

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

// render items + watchlist
function render(){
  renderLabels();

  // Sources badges
  const srcWrap = $('#sources'); srcWrap.innerHTML='';
  vendorDefs.forEach(v=>{
    const on=enabled.includes(v.name);
    const b=document.createElement('button');
    b.className='badge';
    b.style.borderColor = vendorColorStyle(v.name);
    b.style.background = on ? 'var(--badge-on)' : 'var(--badge-off)';
    b.style.opacity = v.supported ? '1' : '.6';
    b.title = v.supported ? (on ? 'Click to disable' : 'Click to enable') : 'Coming soon';
    b.textContent=(on?'✔ ':'✖ ')+v.name + (v.supported ? '' : ' (soon)');
    if (v.supported) {
      b.onclick=()=>{ enabled=on?enabled.filter(x=>x!==v.name):[...enabled,v.name]; render(); };
    } else {
      b.disabled = true;
      b.style.cursor = 'not-allowed';
    }
    srcWrap.appendChild(b);
  });

  // Results grid
  const data = currentResults();
  const grid = $('#grid'); grid.innerHTML='';
  data.forEach(item=>{
    const p = priceInSelected(item);
    const ship = item.shipDays || estimateShipDays(item.vendor, userCountry);
    const card = document.createElement('div'); card.className='card card-hover';

    card.innerHTML = `
      <div class="media">
        <img loading="lazy" width="600" height="338" src="${item.image}" alt="${item.title} product image"/>
      </div>
      <div class="cardBody">
        <div class="titleRow">
          <h3 class="title">${item.title}</h3>
        </div>
        <div class="metaRow">
          <span class="badge vendor" data-vendor="${item.vendor}">${item.vendor}</span>
          <span class="badge">⭐ ${item.rating||4.2}</span>
          <span class="badge">🚚 ~${ship}d</span>
        </div>
        <div class="priceRow">
          <div class="price">${fmt(p)}</div>
          <div class="shipMeta"><div>${item.shipping||'—'}</div><div>${item.shipTime||'—'}</div></div>
        </div>
        <div class="row actions">
          <a class="btn btn-primary" href="${outUrl(item)}" target="_blank" rel="sponsored nofollow noopener">View Deal</a>
          <button class="btn watchBtn">Watch</button>
        </div>
      </div>`;
    card.querySelector('.watchBtn').onclick = ()=> addWatch(item);
    grid.appendChild(card);
  });

  // Watchlist
  const list = $('#watchlist'); list.innerHTML = watches.length ? '' : '<div class="muted">No watched items yet.</div>';
  watches.forEach(w=>{
    const row=document.createElement('div'); row.className='card thinBorder';
    row.innerHTML = `
      <div class="pad-sm">
        <div class="wlTitle">${w.title}</div>
        <div class="wlMeta">Baseline: ${w.baseline??'—'} • Last: ${w.last??'—'} • ${w.triggered?'Triggered':'Waiting'}</div>
        <div class="row gap wrap">
          <input type="number" class="input discount" placeholder="Discount % from baseline" value="${w.discountPct??''}"/>
          <label class="inline"><input type="checkbox" class="emailOpt"${w.emailOpt?' checked':''}/> email alerts</label>
          <button class="btn resetBase">Reset baseline</button>
          <button class="btn remove">Remove</button>
        </div>
      </div>`;
    row.querySelector('.discount').oninput = async (e)=>{ w.discountPct=Number(e.target.value); saveWatches(); await pushWatchlistToServer(); };
    row.querySelector('.emailOpt').onchange = async (e)=>{ w.emailOpt=e.target.checked; saveWatches(); await pushWatchlistToServer(); };
    row.querySelector('.resetBase').onclick = ()=>{ delete w.baseline; saveWatches(); render(); };
    row.querySelector('.remove').onclick = ()=>{ watches=watches.filter(x=>x!==w); saveWatches(); render(); };
    list.appendChild(row);
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

// --- Search by Photo (on-demand TF.js + MobileNet) ---
let mobilenetModel = null;
function loadScript(src){ return new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src=src; s.async=true; s.onload=resolve; s.onerror=reject; document.head.appendChild(s); });}
async function ensureMobileNet(){
  if (mobilenetModel) return mobilenetModel;
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0');
  // global "mobilenet" is provided by the model script
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
    const tasks = vendorDefs.filter(v=>v.supported).map(v => loadVendor(v.name));
    await Promise.all(tasks);
    render();
    URL.revokeObjectURL(img.src);
  } catch(e){
    console.warn('Photo search error:', e);
    toast('Photo search failed. Try a clearer image.');
  }
}

// --- Chat Assistant ---
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

  // Vendors requested
  const vendors = vendorDefs.map(v=>v.name.toLowerCase());
  const requested = vendors.filter(v => msg.includes(v.toLowerCase()));
  const useVendors = requested.length ? requested : vendorDefs.filter(v=>v.supported).map(v=>v.name.toLowerCase());

  // Price range
  let min=null, max=null;
  const m1 = msg.match(/\$?\s*(\d+)\s*[-to]\s*\$?\s*(\d+)/); if(m1){ min=+m1[1]; max=+m1[2]; }
  const m2 = msg.match(/under|below|less than\s*\$?\s*(\d+)/); if(m2){ max=+msg.match(/(\d+)/)[1]; }
  const m3 = msg.match(/over|above|more than\s*\$?\s*(\d+)/); if(m3){ min=+msg.match(/(\d+)/)[1]; }
  const m4 = msg.match(/around|about\s*\$?\s*(\d+)/); if(m4){ const n=+msg.match(/(\d+)/)[1]; min=Math.floor(n*0.8); max=Math.ceil(n*1.2); }

  // Clean keywords (remove vendor names and price words)
  let cleaned = msg.replace(/\$?\d+(\s*[-to]\s*\$?\d+)?/g,'')
                   .replace(/\b(under|below|less than|over|above|more than|around|about)\b/g,'');
  vendorDefs.forEach(v=> cleaned = cleaned.replace(new RegExp(v.name,'ig'),''));
  cleaned = cleaned.replace(/\s+/g,' ').trim();
  return { query: cleaned || msg, vendors: useVendors, min, max };
}

async function searchWorker(slug, q){
  const url = new URL(`${WORKER_BASE}/search/${slug}`);
  url.searchParams.set("q", q);
  if (DEBUG) url.searchParams.set("debug","1");
  const r = await fetch(url.toString(), { mode:"cors", cache:"no-store" });
  if (!r.ok) return [];
  const d = await r.json().catch(()=>({results:[]}));
  return Array.isArray(d.results) ? d.results : [];
}

function withinRange(item, min, max){
  const p = priceInSelected(item);
  if (min!=null && p < min) return false;
  if (max!=null && p > max) return false;
  return true;
}

function resultCard(item){
  const p = fmt(priceInSelected(item));
  return `
    <div class="chat-card">
      <img src="${item.image}" alt="${item.title}" />
      <div class="cc-body">
        <div class="cc-title">${item.title}</div>
        <div class="cc-meta"><span class="badge vendor" data-vendor="${item.vendor}">${item.vendor}</span> <b>${p}</b></div>
        <a class="btn btn-mini" href="${outUrl(item)}" target="_blank" rel="sponsored nofollow noopener">View</a>
      </div>
    </div>`;
}

async function assistantRespond(userText){
  const intent = parseIntent(userText);
  addChatMsg('bot', `<div class="bot-text">Let me look for <b>${intent.query}</b>${intent.min||intent.max?` in your price range${intent.min?` ≥ ${fmt(intent.min)}`:''}${intent.max?` ≤ ${fmt(intent.max)}`:''}:`:'...'}</div>`);

  // Only search supported vendors
  const live = vendorDefs.filter(v=>v.supported && intent.vendors.includes(v.name.toLowerCase()));
  const queries = live.map(v => searchWorker(v.slug, intent.query));
  const resultsByVendor = await Promise.all(queries);

  let pool = [];
  resultsByVendor.forEach((arr, i) => {
    const vendorName = live[i].name;
    (arr||[]).forEach(o => pool.push({ ...o, vendor: vendorName }));
  });

  if (intent.min!=null || intent.max!=null){
    pool = pool.filter(o => withinRange(o, intent.min, intent.max));
  }

  // Sort: prefer price then rating
  pool.sort((a,b) => priceInSelected(a) - priceInSelected(b) || (b.rating||0)-(a.rating||0));

  if (!pool.length){
    addChatMsg('bot', `<div class="bot-text">I couldn’t find great matches. Try adding brand/model keywords or widening your price range.</div>`);
    return;
  }

  const top = pool.slice(0,3).map(resultCard).join('');
  addChatMsg('bot', `<div class="bot-cards">${top}</div>`);
}

// personalization
function captureReferral(){ const p=new URLSearchParams(location.search); const r=p.get('ref'); if(r) localStorage.setItem('ps.ref',r); }
function defaultQuery(){ const urlQ = new URLSearchParams(location.search).get('q') || ''; if (urlQ) return urlQ; const last=localStorage.getItem('ps.lastQuery'); return last||trending[Math.floor(Math.random()*trending.length)]; }

// BOOT
let debounce;
window.addEventListener('DOMContentLoaded', async ()=>{
  // Theme toggle
  $('#themeToggle')?.addEventListener('click', ()=> applyTheme( (localStorage.getItem('ps.theme')==='dark') ? 'light' : 'dark' ));

  // Language / UI controls
  const selLang=$('#lang'); if(selLang){ selLang.value=lang; selLang.onchange=()=>{ lang=selLang.value; localStorage.setItem('ps.lang',lang); render(); } }
  $('#currency').onchange=(e)=>{ currency=e.target.value; render(); }
  $('#sort').onchange=(e)=>{ sortBy=e.target.value; render(); }
  $('#shipMax').onchange=(e)=>{ maxShipDays=e.target.value; render(); }

  // Search box
  $('#search').oninput=(e)=>{ query=e.target.value; localStorage.setItem('ps.lastQuery',query);
    clearTimeout(debounce); debounce=setTimeout(async()=>{
      const tasks = vendorDefs.filter(v=>v.supported).map(v => loadVendor(v.name));
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

  $('#refreshBtn').onclick=refreshWatches;

  initSignupUI(); captureReferral(); await loadRates();

  const startTerm=defaultQuery(); query=startTerm; const se=$('#search'); if(se) se.value=startTerm;

  const tasks = vendorDefs.filter(v=>v.supported).map(v => loadVendor(v.name));
  await Promise.all(tasks);
  render();
});
