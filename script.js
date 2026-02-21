// === CONFIG / STATE ===
const WORKER_BASE = "https://pricescanner.b48rptrywg.workers.dev";
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
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

const vendorDefs = [
  { name: "AliExpress", slug: "aliexpress", live: true },
  { name: "Amazon", slug: "amazon", live: true },
  { name: "eBay", slug: "ebay", live: true }
];

const LIVE_VENDORS = vendorDefs.map(v => v.name);
let enabled = [...LIVE_VENDORS];

// paging
const vendorPages  = Object.fromEntries(vendorDefs.map(v => [v.name, 1]));
const vendorLimits = { "AliExpress": 40, "eBay": 50, "Amazon": 20 };

// UI state
let currency    = "SGD";
let sortBy      = "priceAsc";
let query       = "";             // current category query (only set by category click)
let userCountry = "US";
let maxShipDays = "";
let fx          = { base:"USD", rates:{ USD:1 }, at:0 };
let lang        = localStorage.getItem('ps.lang') || 'en';
let theme       = localStorage.getItem('ps.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

let minPriceVal = null, maxPriceVal = null;

// NEW: local keyword filter (client-side only)
let localFilterText = "";

// results store
const offersByVendor = Object.fromEntries(vendorDefs.map(v => [v.name, []]));

// helpers
const $ = sel => document.querySelector(sel);

function fmt(n){
  try{
    return new Intl.NumberFormat(currency==='SGD'?'en-SG':(lang==='ar'?'ar':'en'),{style:'currency',currency}).format(n);
  }catch(e){
    return Number(n).toFixed(2);
  }
}

function toast(m){
  const t=$('#toast');
  if(!t) return;
  t.textContent=m;
  t.style.display='block';
  setTimeout(()=>t.style.display='none',2600);
}

(function(){
  try{
    const loc=(navigator.language||"en-US").split("-")[1];
    if(loc) userCountry=loc.toUpperCase();
  }catch{}
})();

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

function convertAmount(amount, fromCur){
  const from=(fromCur||"USD").toUpperCase();
  const to=currency.toUpperCase();
  if(from===to) return amount;
  const r=fx.rates||{};
  const rFrom=(from===fx.base)?1:r[from];
  const rTo=(to===fx.base)?1:r[to];
  if(!rFrom||!rTo) return amount;
  return amount*(rTo/rFrom);
}
function priceInSelected(o){ return convertAmount(o.price, o.currency||"USD"); }

function estimateShipDays(vendor,country){
  const fast = new Set(["eBay","Amazon"]);
  const intl = new Set(["AliExpress"]);
  if (fast.has(vendor)) return (["SG","US","GB"].includes(country))?3:7;
  if (intl.has(vendor)) return (country==="SG")?7:14;
  return 10;
}

// out wrapper for clicks
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

// Strict result filtering (keep only home-security-ish items)
const HARD_BLOCK = [
  "iphone","ipad","smartphone","phone","laptop","macbook","gpu","graphics",
  "headphones","earbuds","ps5","xbox","nintendo","dash cam","dashcam"
];
function normalizeText(s){
  return String(s||'').toLowerCase().replace(/[^\w\s-]/g,' ').replace(/\s+/g,' ').trim();
}
function hasAny(text, list){ return list.some(w => text.includes(w)); }

const HOME_KEYWORDS = [
  "security","cctv","camera","ip camera","wifi camera","wireless camera","doorbell","video doorbell",
  "smart lock","lock","deadbolt","alarm","sensor","motion sensor","door sensor","window sensor",
  "intercom","smoke detector","co detector","carbon monoxide","baby monitor","nvr","dvr","poe"
];
function isHomeSecurityResult(item){
  const title = normalizeText(item?.title || "");
  if(!title) return false;
  if (hasAny(title, HARD_BLOCK)) return false;
  if (title.includes("dashcam") || title.includes("dash cam")) return false;
  // must include at least one keyword
  return HOME_KEYWORDS.some(k => title.includes(k));
}

// loaders
async function loadVendor(vendor, {append=false, page=1}={}){
  const def = vendorDefs.find(v => v.name === vendor); if (!def) return;
  const term=(query||"").trim();
  if(!enabled.includes(vendor) || !WORKER_BASE || !term) return;

  try{
    const limit = vendorLimits[vendor] || 40;
    const url = new URL(`${WORKER_BASE}/search/${def.slug}`);
    url.searchParams.set("q", term);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (DEBUG) url.searchParams.set("debug","1");

    const r=await fetch(url.toString(),{mode:"cors",cache:"no-store"});
    const d=await r.json().catch(()=>({results:[]}));
    if(!r.ok){ console.warn(`${vendor} search HTTP ${r.status}`, d); return; }

    let arr=(Array.isArray(d.results)?d.results:[]).map(o=>({
      ...o,
      image: (o.image && /^https?:/i.test(o.image)) ? o.image : PLACEHOLDER_IMG,
      currency:o.currency||"USD",
      shipDays:estimateShipDays(vendor,userCountry),
      vendor
    }));

    // strict filter
    arr = arr.filter(isHomeSecurityResult);

    if (append) offersByVendor[vendor] = (offersByVendor[vendor]||[]).concat(arr);
    else offersByVendor[vendor] = arr;

  }catch(e){ console.warn(`${vendor} search fetch failed:`,e); }
}

async function loadAll({append=false}={}){
  const live = vendorDefs.filter(v=>v.live && enabled.includes(v.name)).map(v=>v.name);
  const tasks = live.map(v => loadVendor(v, {append, page: vendorPages[v]}));
  await Promise.all(tasks);
}

function currentResults(){
  let base = [];
  for (const v of LIVE_VENDORS) base = base.concat(offersByVendor[v]||[]);

  // local keyword filter (NO network)
  if (localFilterText.trim()) {
    const needle = normalizeText(localFilterText);
    base = base.filter(o => normalizeText(o.title || "").includes(needle));
  }

  // budget filter
  if (minPriceVal != null || maxPriceVal != null) {
    base = base.filter(o=>{
      const p = priceInSelected(o);
      if (minPriceVal != null && p < minPriceVal) return false;
      if (maxPriceVal != null && p > maxPriceVal) return false;
      return true;
    });
  }

  // ship days
  if (maxShipDays) base = base.filter(o => (o.shipDays||estimateShipDays(o.vendor,userCountry)) <= Number(maxShipDays));

  // sort
  if (sortBy==='priceAsc')  base.sort((a,b)=> priceInSelected(a) - priceInSelected(b));
  if (sortBy==='priceDesc') base.sort((a,b)=> priceInSelected(b) - priceInSelected(a));
  if (sortBy==='rating')    base.sort((a,b)=> (b.rating||4.2) - (a.rating||4.2));

  // de-dup by title|vendor; keep better price
  const m=new Map();
  for(const o of base){
    const k=((o.title||'')+'|'+o.vendor).toLowerCase();
    const v=m.get(k);
    if(!v || priceInSelected(o) < priceInSelected(v)) m.set(k,o);
  }
  return Array.from(m.values());
}

// render
function render(){
  const data = currentResults();
  const grid = $('#grid'); if(!grid) return;
  grid.innerHTML='';

  data.forEach(item=>{
    const p = priceInSelected(item);
    const shipDays = item.shipDays || estimateShipDays(item.vendor, userCountry);

    const card = document.createElement('div');
    card.className='card card-hover';
    card.innerHTML = `
      <div class="media">
        <img loading="lazy" src="${item.image || PLACEHOLDER_IMG}" alt="${item.title} product image" onerror="this.src='${PLACEHOLDER_IMG}'"/>
      </div>
      <div class="cardBody">
        <h3 class="title clamp-2" style="color:#146EB4;font-weight:800">${item.title}</h3>
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
          <button class="btn watchBtn" type="button">Watch</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });

  const moreBtn = $('#moreBtn');
  if (moreBtn) {
    // show More only after a category search exists
    const hasCategory = query.trim().length > 0;
    moreBtn.style.display = hasCategory ? 'inline-flex' : 'none';
    moreBtn.disabled = hasCategory ? (data.length === 0) : true;
    moreBtn.style.opacity = moreBtn.disabled ? '.6' : '1';
    moreBtn.style.pointerEvents = moreBtn.disabled ? 'none' : 'auto';
  }

  // update hint
  const hint = $('#localFilterHint');
  if (hint) {
    hint.textContent = query.trim() ? `Filtering inside: ${query}` : 'Select a category first.';
  }
}

// category search
async function runCategorySearch(catQuery){
  const inputQ = String(catQuery||"").trim();
  if (!inputQ) return;

  query = inputQ;
  localStorage.setItem('ps.lastQuery', query);

  // reset paging + results
  Object.keys(vendorPages).forEach(k=> vendorPages[k]=1);
  LIVE_VENDORS.forEach(v=> offersByVendor[v] = []);

  // clear local filter field when category changes (you can remove this if you prefer)
  localFilterText = "";
  const lf = $('#localFilter');
  if (lf) lf.value = "";

  await loadAll({append:false});
  render();
}

// BOOT
window.addEventListener('DOMContentLoaded', async ()=>{
  // theme toggle
  $('#themeToggle')?.addEventListener('click', ()=> applyTheme( (localStorage.getItem('ps.theme')==='dark') ? 'light' : 'dark' ));

  // language/currency/sort/ship
  const selLang=$('#lang');
  if(selLang){ selLang.value=lang; selLang.onchange=()=>{ lang=selLang.value; localStorage.setItem('ps.lang',lang); render(); }; }

  $('#currency')?.addEventListener('change',(e)=>{ currency=e.target.value; render(); });
  $('#sort')?.addEventListener('change',(e)=>{ sortBy=e.target.value; render(); });
  $('#shipMax')?.addEventListener('change',(e)=>{ maxShipDays=e.target.value; render(); });

  // budget filter
  $('#applyBudget')?.addEventListener('click', ()=>{
    const minV = $('#minPrice')?.value.trim() || '';
    const maxV = $('#maxPrice')?.value.trim() || '';
    minPriceVal = minV==='' ? null : Math.max(0, Number(minV));
    maxPriceVal = maxV==='' ? null : Math.max(0, Number(maxV));
    render();
  });

  // local keyword filter (NO network)
  $('#localFilter')?.addEventListener('input', (e)=>{
    localFilterText = e.target.value || '';
    render();
  });

  // category buttons (ONLY place that triggers store search)
  document.querySelectorAll('.catBtn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const q = btn.getAttribute('data-q') || '';
      await runCategorySearch(q);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // More results (paged fetch for same category)
  $('#moreBtn')?.addEventListener('click', async ()=>{
    if (!query.trim()) { toast('Select a category first.'); return; }

    vendorDefs.filter(v=>v.live).forEach(v => vendorPages[v.name] = (vendorPages[v.name]||1) + 1);

    const before = currentResults().length;
    await loadAll({append:true});
    const after = currentResults().length;
    render();

    if (after === before) {
      toast('No more results.');
      const mb = $('#moreBtn');
      mb.disabled = true;
      mb.style.opacity = '.6';
      mb.style.pointerEvents = 'none';
    }
  });

  // cashback + signup kept outside script (in index.html), just load FX here
  await loadRates();

 // Start with first category by default
const defaultCategory = "outdoor security camera";   // 👈 first category
await runCategorySearch(defaultCategory);
});
// Highlight first category button
const firstBtn = document.querySelector('.catBtn[data-q="outdoor security camera"]');
if (firstBtn) firstBtn.classList.add('active');
