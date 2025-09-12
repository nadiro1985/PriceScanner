// === CONFIG / STATE ===
const vendors = ["Amazon","eBay","Walmart","AliExpress","Etsy","Rakuten","Shopee","Lazada","Temu","MercadoLibre","BestBuy","Target","Taobao","Alibaba","Wayfair"];
let enabled = [...vendors];
let currency = "SGD";
let sortBy = "priceAsc";
let query = "";
let offers = [];          // demo/base offers
let ebayOffers = [];      // live eBay offers (from Vercel API)
let userCountry = "US";   // simple default
let maxShipDays = "";     // shipping filter
let fx = { base: "USD", rates: { USD: 1 }, at: 0 };
let watches = JSON.parse(localStorage.getItem('ps.watches')||"[]");

// Five-language UI labels (short)
const i18n = {
  en:{Lang:"Language",Currency:"Currency",Sort:"Sort by",Sources:"Sources",Watchlist:"Watchlist",Refresh:"Refresh",MaxShip:"Max ship days"},
  ar:{Lang:"اللغة",Currency:"العملة",Sort:"ترتيب حسب",Sources:"المصادر",Watchlist:"قائمة المراقبة",Refresh:"تحديث",MaxShip:"أقصى أيام للشحن"},
  fr:{Lang:"Langue",Currency:"Devise",Sort:"Trier par",Sources:"Sources",Watchlist:"Liste de suivi",Refresh:"Actualiser",MaxShip:"Délais max"},
  es:{Lang:"Idioma",Currency:"Moneda",Sort:"Ordenar por",Sources:"Fuentes",Watchlist:"Lista",Refresh:"Actualizar",MaxShip:"Días máx envío"},
  zh:{Lang:"语言",Currency:"货币",Sort:"排序",Sources:"来源",Watchlist:"关注列表",Refresh:"刷新",MaxShip:"最⻓运输天数"}
};
let lang = localStorage.getItem('ps.lang') || 'en';

// >>> Set this to your Vercel API URL <<<
const EBAY_API = "https://pricescanner.b48rptrywg.workers.dev"; // change if your project URL differs
console.log("Using EBAY_API =", EBAY_API);

// Trending terms (used when no history)
const trending = ["headphones","iphone","ssd","laptop","smartwatch","wireless earbuds","gaming mouse","4K TV","backpack"];

// === HELPERS ===
function fmt(n){ try{ return new Intl.NumberFormat(currency==='SGD'?'en-SG':'en',{style:'currency',currency}).format(n) }catch(e){ return Number(n).toFixed(2)} }
const $ = sel => document.querySelector(sel);
function t(k){ return (i18n[lang] && i18n[lang][k]) || i18n.en[k] || k; }

// Guess country from browser locale (fallback only)
(function(){ try{
  const loc = (navigator.language || "en-US").split("-")[1];
  if (loc) userCountry = loc.toUpperCase();
}catch{}})();

// FX: fetch ECB USD table (cache ~12h)
async function loadRates() {
  try {
    const cached = JSON.parse(localStorage.getItem('ps.fx')||'null');
    const twelveH = 12 * 60 * 60 * 1000;
    if (cached && (Date.now() - cached.at) < twelveH) { fx = cached; return; }
    const r = await fetch("https://api.frankfurter.app/latest?from=USD", { cache:"no-store" });
    const d = await r.json();
    const rates = d.rates || {}; rates.USD = 1;
    fx = { base:"USD", rates, at:Date.now() };
    localStorage.setItem('ps.fx', JSON.stringify(fx));
  } catch(e) { console.warn("FX load failed", e); }
}
function convertAmount(amount, fromCur){
  const from = (fromCur || "USD").toUpperCase();
  const to   = currency.toUpperCase();
  if (from===to) return amount;
  const r = fx.rates || {};
  const rFrom = (from===fx.base)?1:r[from]; const rTo = (to===fx.base)?1:r[to];
  if (!rFrom || !rTo) return amount;
  return amount * (rTo / rFrom);
}
function priceInSelected(o){ return convertAmount(o.price, o.currency||"USD"); }

// shipping-days estimator (simple)
function estimateShipDays(vendor, country){
  const fast = ["Amazon","eBay","Walmart","BestBuy","Target"];
  const intl = ["Shopee","Lazada","AliExpress","Temu","Taobao","Alibaba","MercadoLibre","Rakuten"];
  if (fast.includes(vendor)) return (country==="SG"||country==="US"||country==="GB") ? 3 : 7;
  if (intl.includes(vendor)) return (country==="SG") ? 7 : 14;
  return 10;
}

// === DATA LOADERS ===
async function loadDemo(){
  try{
    const r = await fetch('demo.json', { cache: "no-store" });
    if (!r.ok) throw new Error('demo.json not found');
    offers = (await r.json()).map(o=>({ ...o, currency: o.currency || "USD", shipDays: o.shipDays || estimateShipDays(o.vendor, userCountry) }));
  }catch(e){
    console.error('Failed to load demo.json:', e);
    offers = [
      { id:'Fallback-1', title:'Sample Headphones', image:'https://images.unsplash.com/photo-1518441315835-06e9d3e8de1c?q=80&w=1200&auto=format&fit=crop',
        price:59.99, currency:"USD", shipping:'Free', shipTime:'3–7 days', rating:4.4, vendor:'Amazon', url:'#', shipDays:estimateShipDays('Amazon', userCountry) }
    ];
  }
}

async function loadEbay(q){
  ebayOffers = [];
  const term = (q||"").trim();
  if (!enabled.includes("eBay") || !EBAY_API || !term) return;
  try{
    const join = EBAY_API.includes("?") ? "&" : "?";
    const r = await fetch(EBAY_API + join + "q=" + encodeURIComponent(term), { mode:"cors", cache:"no-store" });
    if (!r.ok) { console.warn("eBay API error", r.status); return; }
    const d = await r.json();
    ebayOffers = (Array.isArray(d.results)? d.results : []).map(o=>({ ...o, currency:o.currency||"USD", shipDays: estimateShipDays("eBay", userCountry) }));
  }catch(e){ console.warn("eBay API fetch failed:", e); }
}

// merge & filter
function currentResults(){
  let base = offers.filter(o => enabled.includes(o.vendor));
  if (enabled.includes("eBay")) { base = base.filter(o=>o.vendor!=="eBay").concat(ebayOffers); }
  if (query) base = base.filter(o => o.title.toLowerCase().includes(query.toLowerCase()));
  if (maxShipDays) base = base.filter(o => (o.shipDays||estimateShipDays(o.vendor,userCountry)) <= Number(maxShipDays));
  if (sortBy==='priceAsc')  base.sort((a,b)=> priceInSelected(a) - priceInSelected(b));
  if (sortBy==='priceDesc') base.sort((a,b)=> priceInSelected(b) - priceInSelected(a));
  if (sortBy==='rating')    base.sort((a,b)=> b.rating - a.rating);
  // dedupe by title+vendor lowest converted price
  const m = new Map(); for (const o of base){ const k=(o.title+'|'+o.vendor).toLowerCase(); const v=m.get(k); if(!v || priceInSelected(o) < priceInSelected(v)) m.set(k,o); }
  return Array.from(m.values());
}

// personalization
function captureReferral(){
  const params = new URLSearchParams(location.search);
  const r = params.get('ref'); if (r) localStorage.setItem('ps.ref', r);
}
function defaultQuery(){
  const last = localStorage.getItem('ps.lastQuery');
  if (last) return last;
  return trending[Math.floor(Math.random()*trending.length)];
}

// labels / RTL
function renderLabels(){
  $('#lblLang').textContent     = t('Lang');
  $('#lblCurrency').textContent = t('Currency');
  $('#lblSort').textContent     = t('Sort');
  $('#lblSources').textContent  = t('Sources') + " (click to include/exclude):";
  $('#lblWatchlist').textContent= t('Watchlist');
  $('#refreshBtn').textContent  = t('Refresh');
  $('#lblShip').textContent     = t('MaxShip');
  document.documentElement.dir = (lang==='ar') ? 'rtl' : 'ltr';
}

// render UI
function render(){
  renderLabels();

  const srcWrap = $('#sources'); srcWrap.innerHTML = '';
  vendors.forEach(v=>{
    const on = enabled.includes(v);
    const b = document.createElement('button'); b.className='badge'; b.style.background = on?'#ecfdf5':'#fff7ed';
    b.textContent = (on?'✔ ':'✖ ')+v;
    b.onclick = ()=>{ enabled = on ? enabled.filter(x=>x!==v) : [...enabled, v]; render(); };
    srcWrap.appendChild(b);
  });

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
          <span class="badge">⭐ ${item.rating}</span>
          <span class="badge">🚚 ~${ship}d</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <div style="font-size:22px;font-weight:800">${fmt(p)}</div>
          <div style="font-size:12px;color:#6b7280;text-align:right"><div>${item.shipping}</div><div>${item.shipTime}</div></div>
        </div>
        <div class="row" style="margin-top:10px">
          <a class="btn btn-primary" href="${item.url}" target="_blank" rel="noreferrer">View Deal</a>
          <button class="btn watchBtn">Watch</button>
        </div>
      </div>`;
    card.querySelector('.watchBtn').onclick = ()=> addWatch(item);
    grid.appendChild(card);
  });

  // watchlist
  const list = $('#watchlist'); list.innerHTML = watches.length ? '' : '<div style="font-size:14px;color:#6b7280">No watched items yet.</div>';
  watches.forEach(w=>{
    const row = document.createElement('div'); row.className='card'; row.style.border='1px solid rgba(0,0,0,.08)';
    row.innerHTML = `
      <div style="padding:12px">
        <div style="font-weight:700">${w.title}</div>
        <div style="font-size:12px;color:#6b7280">Baseline: ${w.baseline??'—'} • Last: ${w.last??'—'} • ${w.triggered?'Triggered':'Waiting'}</div>
        <div class="row" style="margin-top:8px;align-items:center">
          <input type="number" class="input target" placeholder="Target price (${currency})" value="${w.targetPrice??''}"/>
          <input type="number" class="input discount" placeholder="Discount % from baseline" value="${w.discountPct??''}"/>
          <button class="btn remove">Remove</button>
        </div>
      </div>`;
    row.querySelector('.target').oninput = (e)=>{ w.targetPrice = Number(e.target.value); saveWatches(); }
    row.querySelector('.discount').oninput = (e)=>{ w.discountPct = Number(e.target.value); saveWatches(); }
    row.querySelector('.remove').onclick = ()=>{ watches = watches.filter(x=>x!==w); saveWatches(); render(); }
    list.appendChild(row);
  });
}

// watchlist helpers
function saveWatches(){ localStorage.setItem('ps.watches', JSON.stringify(watches)) }
function addWatch(item){
  const id = (item.title + '|' + enabled.sort().join(',')).toLowerCase();
  if (watches.find(w=>w.id===id)) { toast('Already in watchlist'); return }
  watches = [{ id, title:item.title, vendors:[...enabled], targetPrice:Math.max(0, priceInSelected(item)-1) }, ...watches];
  saveWatches(); toast('Added to watchlist'); render();
}
async function refreshWatches(){
  const data = currentResults();
  let changed=false, msg;
  watches = watches.map(w=>{
    const pool = data.filter(o => w.vendors.includes(o.vendor) && o.title.toLowerCase().includes(w.title.toLowerCase().split(' sample')[0]));
    if (!pool.length) return w;
    const best = pool.reduce((a,b)=> priceInSelected(a) <= priceInSelected(b) ? a : b);
    const baseline = w.baseline ?? priceInSelected(best);
    const discount = baseline>0 ? ((baseline-priceInSelected(best))/baseline)*100 : 0;
    const priceTrig = typeof w.targetPrice==='number' && priceInSelected(best) <= w.targetPrice;
    const discTrig  = typeof w.discountPct==='number' && discount >= (w.discountPct||0);
    const trig = priceTrig || discTrig;
    if (trig && !w.triggered) msg = `${w.title} @ ${best.vendor} → ${fmt(priceInSelected(best))}`;
    if (trig!==!!w.triggered || w.last!==priceInSelected(best) || w.lastVendor!==best.vendor || w.baseline!==baseline) changed=true;
    return {...w, baseline, last:priceInSelected(best), lastVendor:best.vendor, triggered:trig};
  });
  if (changed) saveWatches();
  if (msg) toast(msg);
  render();
}
function toast(m){ const t = $('#toast'); t.textContent=m; t.style.display='block'; setTimeout(()=>t.style.display='none', 3500) }

// personalization
function captureReferral(){
  const params = new URLSearchParams(location.search);
  const r = params.get('ref'); if (r) localStorage.setItem('ps.ref', r);
}
function defaultQuery(){
  const last = localStorage.getItem('ps.lastQuery');
  if (last) return last;
  return trending[Math.floor(Math.random()*trending.length)];
}

// BOOT
let debounce;
window.addEventListener('DOMContentLoaded', async ()=>{
  // language
  const selLang = $('#lang'); if (selLang){ selLang.value = lang; selLang.onchange = ()=>{ lang = selLang.value; localStorage.setItem('ps.lang', lang); render(); } }
  // currency/sort/ship filters
  $('#currency').onchange = (e)=>{ currency = e.target.value; render(); }
  $('#sort').onchange     = (e)=>{ sortBy   = e.target.value; render(); }
  $('#shipMax').onchange  = (e)=>{ maxShipDays = e.target.value; render(); }
  // search
  $('#search').oninput = (e)=>{
    query = e.target.value; localStorage.setItem('ps.lastQuery', query);
    clearTimeout(debounce); debounce=setTimeout(async()=>{ await loadEbay(query); render(); }, 250);
  };
  $('#searchBtn').onclick = ()=>{ const input=$('#search'); if(input){ input.dispatchEvent(new Event('input',{bubbles:true})); } }
  // watchlist
  $('#refreshBtn').onclick = refreshWatches;

  captureReferral();
  await loadRates();

  // default query
  const startTerm = defaultQuery();
  query = startTerm; const se = $('#search'); if (se) se.value = startTerm;

  // load data
  await loadDemo();
  await loadEbay(query);
  render();
});
