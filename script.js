// --- SOURCES / STATE ---
const vendors = ["Amazon","eBay","Walmart","AliExpress","Etsy","Rakuten","Shopee","Lazada","Temu","MercadoLibre","BestBuy","Target","Newegg","HomeDepot","Wayfair"];
let enabled = [...vendors];
let currency = "SGD";
let sortBy = "priceAsc";
let query = "";
let offers = [];          // demo/base offers
let ebayOffers = [];      // live eBay offers
let fx = { base: "USD", rates: { USD: 1 }, at: 0 };   // FX cache
let watches = JSON.parse(localStorage.getItem('ps.watches')||"[]");
let config = JSON.parse(localStorage.getItem('site.config')||"{ }");
const defaults = { name: "PriceScanner", tagline: "Find the best price, fast", primary:"#4f46e5", secondary:"#7c3aed", logoUrl:"logo.svg" };
config = {...defaults, ...config};
document.documentElement.style.setProperty('--brand1', config.primary);
document.documentElement.style.setProperty('--brand2', config.secondary);

// Set your Worker URL
const EBAY_WORKER = "https://pricescanner.b48rptrywg.workers.dev";
console.log("Using EBAY_WORKER =", EBAY_WORKER);

// --- UTILS ---
function fmt(n){ try{ return new Intl.NumberFormat(currency==='SGD'?'en-SG':'en', {style:'currency',currency}).format(n) }catch(e){ return Number(n).toFixed(2)} }
const $ = sel => document.querySelector(sel);

// --- FX: fetch daily ECB rates (via frankfurter.app), cache ~12h ---
async function loadRates() {
  try {
    const cached = JSON.parse(localStorage.getItem('ps.fx')||'null');
    const twelveH = 12 * 60 * 60 * 1000;
    if (cached && (Date.now() - cached.at) < twelveH) {
      fx = cached; return;
    }
    // Base USD gives us a table USD -> others
    const r = await fetch("https://api.frankfurter.app/latest?from=USD", { cache: "no-store" });
    const d = await r.json();
    const rates = d.rates || {};
    rates.USD = 1;
    fx = { base: "USD", rates, at: Date.now() };
    localStorage.setItem('ps.fx', JSON.stringify(fx));
  } catch(e) {
    console.warn("FX load failed, using last cached or USD-only.", e);
  }
}

// Convert amount from 'fromCur' to selected 'currency' using fx table
function convertAmount(amount, fromCur) {
  const from = (fromCur || "USD").toUpperCase();
  const to = currency.toUpperCase();
  if (from === to) return amount;
  const r = fx.rates || {};
  const rFrom = (from === fx.base) ? 1 : r[from];
  const rTo   = (to   === fx.base) ? 1 : r[to];
  if (!rFrom || !rTo) return amount; // fallback if missing
  // amount_in_to = amount * (rTo / rFrom)
  return amount * (rTo / rFrom);
}

// unified accessor for “display price in selected currency”
function priceInSelected(offer) {
  const baseCurrency = offer.currency || "USD";
  return convertAmount(offer.price, baseCurrency);
}

function dedupeByTitleVendor(list){
  const m = new Map();
  for (const o of list){
    const k = (o.title + '|' + o.vendor).toLowerCase();
    const v = m.get(k);
    if (!v || priceInSelected(o) < priceInSelected(v)) m.set(k, o);
  }
  return Array.from(m.values());
}

// --- DATA LOADERS ---
async function loadDemo(){
  const res = await fetch('demo.json');
  offers = await res.json();
  // assume demo prices are USD unless stated
  offers = offers.map(o => ({ ...o, currency: o.currency || "USD" }));
}

async function loadEbay(q){
  ebayOffers = [];
  const term = (q||"").trim();
  if (!enabled.includes("eBay") || !EBAY_WORKER || !term) return;
  try{
    const r = await fetch(EBAY_WORKER + "?q=" + encodeURIComponent(term), { mode: "cors" });
    if (!r.ok) { console.warn("eBay worker error", r.status); return; }
    const d = await r.json();
    // ensure currency present
    ebayOffers = (Array.isArray(d.results) ? d.results : []).map(o => ({ ...o, currency: o.currency || "USD" }));
  }catch(e){
    console.warn("eBay worker fetch failed:", e);
  }
}

// Merge demo + live eBay (if enabled), filter/sort by converted price
function currentResults(){
  let base = offers.filter(o => enabled.includes(o.vendor));
  if (enabled.includes("eBay")) {
    base = base.filter(o => o.vendor !== "eBay");
    base = base.concat(ebayOffers);
  }
  if (query) base = base.filter(o => o.title.toLowerCase().includes(query.toLowerCase()));
  if (sortBy==='priceAsc') base.sort((a,b)=>priceInSelected(a)-priceInSelected(b));
  if (sortBy==='priceDesc') base.sort((a,b)=>priceInSelected(b)-priceInSelected(a));
  if (sortBy==='rating') base.sort((a,b)=>b.rating-a.rating);
  return dedupeByTitleVendor(base);
}

// --- RENDER ---
function render(){
  // brand
  $('#brandLogo').src = config.logoUrl || 'logo.svg';
  $('#brandName').textContent = config.name;
  $('#tagline').textContent = config.tagline;

  // source toggles
  const srcWrap = $('#sources'); srcWrap.innerHTML = '';
  vendors.forEach(v=>{
    const on = enabled.includes(v);
    const b = document.createElement('button'); b.className='badge'; b.style.background = on?'#ecfdf5':'#fff7ed';
    b.textContent = (on?'✔ ':'✖ ')+v;
    b.onclick = ()=>{ enabled = on ? enabled.filter(x=>x!==v) : [...enabled, v]; render() };
    srcWrap.appendChild(b);
  });

  // results
  const res = currentResults();
  const grid = $('#grid'); grid.innerHTML='';
  res.forEach(item=>{
    const displayPrice = priceInSelected(item);
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
          <span class="badge">${item.vendor}</span><span class="badge">⭐ ${item.rating}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <div style="font-size:22px;font-weight:800">${fmt(displayPrice)}</div>
          <div style="font-size:12px;color:#6b7280;text-align:right"><div>${item.shipping}</div><div>${item.shipTime}</div></div>
        </div>
        <div class="row" style="margin-top:10px">
          <a class="btn btn-primary" href="${item.url}" target="_blank" rel="noreferrer">View Deal</a>
          <button class="btn watchBtn">Watch</button>
        </div>
      </div>
    `;
    card.querySelector('.watchBtn').onclick = ()=> addWatch(item);
    grid.appendChild(card);
  });

  // watchlist
  const list = $('#watchlist'); list.innerHTML='';
  if (watches.length===0){ list.innerHTML = '<div style="font-size:14px;color:#6b7280">No watched items yet.</div>'; }
  watches.forEach(w=>{
    const row = document.createElement('div'); row.className='card'; row.style.border='1px solid rgba(0,0,0,.08)';
    row.innerHTML = `
      <div style="padding:12px">
        <div style="font-weight:700">${w.title}</div>
        <div style="font-size:12px;color:#6b7280">Baseline: ${w.baseline??'—'} • Last: ${w.last??'—'} • ${w.triggered?'Triggered':'Waiting'}</div>
        <div class="row" style="margin-top:8px;align-items:center">
          <input type="number" class="input target" placeholder="Target price (SGD)" value="${w.targetPrice??''}"/>
          <input type="number" class="input discount" placeholder="Discount % from baseline" value="${w.discountPct??''}"/>
          <button class="btn remove">Remove</button>
        </div>
      </div>
    `;
    row.querySelector('.target').oninput = (e)=>{ w.targetPrice = Number(e.target.value); saveWatches() }
    row.querySelector('.discount').oninput = (e)=>{ w.discountPct = Number(e.target.value); saveWatches() }
    row.querySelector('.remove').onclick = ()=>{ watches = watches.filter(x=>x!==w); saveWatches(); render() }
    list.appendChild(row);
  });
}

// --- WATCHLIST HELPERS ---
function saveWatches(){ localStorage.setItem('ps.watches', JSON.stringify(watches)) }
function addWatch(item){
  const id = (item.title + '|' + enabled.sort().join(',')).toLowerCase();
  if (watches.find(w=>w.id===id)) { toast('Already in watchlist'); return }
  watches = [{ id, title:item.title, vendors:[...enabled], targetPrice:Math.max(0, priceInSelected(item)-1) }, ...watches];
  saveWatches(); toast('Added to watchlist'); render();
}

async function refreshWatches(){
  const res = currentResults();
  let changed=false, msg;
  watches = watches.map(w=>{
    const pool = res.filter(o =>
      w.vendors.includes(o.vendor) &&
      o.title.toLowerCase().includes(w.title.toLowerCase().split(' sample')[0])
    );
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

// --- BOOT ---
let debounce;
window.addEventListener('DOMContentLoaded', async ()=>{
  $('#search').oninput = (e)=>{
    query = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(async ()=>{ await loadEbay(query); render(); }, 250);
  };
  $('#currency').onchange = (e)=>{ currency = e.target.value; render() }
  $('#sort').onchange = (e)=>{ sortBy = e.target.value; render() }
  $('#refreshBtn').onclick = refreshWatches;

  await loadRates();   // <<< load ECB FX table
  await loadDemo();
  await loadEbay(query);
  render();
});
