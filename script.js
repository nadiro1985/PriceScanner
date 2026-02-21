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

// === VENDORS ===
// We do NOT show store selection in UI, but we still search live vendors.
const vendorDefs = [
  { name: "AliExpress", slug: "aliexpress", live: true,  color: "red"   },
  { name: "Amazon",     slug: "amazon",     live: true,  color: "blue"  },
  { name: "eBay",       slug: "ebay",       live: true,  color: "green" },

  { name: "Alibaba",    slug: "alibaba",    live: false, color: "blue"  },
  { name: "Best Buy",   slug: "bestbuy",    live: false, color: "blue"  },
  { name: "Etsy",       slug: "etsy",       live: false, color: "green" },
  { name: "Lazada",     slug: "lazada",     live: false, color: "red"   },
  { name: "Newegg",     slug: "newegg",     live: false, color: "blue"  },
  { name: "Rakuten",    slug: "rakuten",    live: false, color: "blue"  },
  { name: "Shopee",     slug: "shopee",     live: false, color: "red"   },
  { name: "Target",     slug: "target",     live: false, color: "blue"  },
  { name: "Walmart",    slug: "walmart",    live: false, color: "blue"  }
].sort((a,b)=>a.name.localeCompare(b.name));

// Always use LIVE vendors only
const LIVE_VENDORS = vendorDefs.filter(v => v.live).map(v => v.name);
let enabled = [...LIVE_VENDORS];

// paging
const vendorPages  = Object.fromEntries(vendorDefs.map(v => [v.name, 1]));
const vendorLimits = { "AliExpress": 40, "eBay": 50, "Amazon": 20 };

// UI state
let currency    = "SGD";
let sortBy      = "priceAsc";
let query       = "";
let userCountry = "US";
let maxShipDays = "";
let fx          = { base:"USD", rates:{ USD:1 }, at:0 };
let watches     = JSON.parse(localStorage.getItem('ps.watches')||"[]");
let lang        = localStorage.getItem('ps.lang') || 'en';
let theme       = localStorage.getItem('ps.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
// Budget filter
let minPriceVal = null, maxPriceVal = null;

const offersByVendor = Object.fromEntries(vendorDefs.map(v => [v.name, []]));

// i18n (short)
const i18n = { en:{Lang:"Language",Currency:"Currency",Sort:"Sort by",Watchlist:"Watchlist",Refresh:"Refresh",MaxShip:"Max ship days"} };

// Focused trending (home security)
const trending = [
  "outdoor security camera",
  "indoor security camera",
  "video doorbell",
  "smart lock",
  "home alarm system",
  "motion sensor",
  "door sensor",
  "intercom system",
  "smoke detector smart"
];

// helpers
function fmt(n){
  try{
    return new Intl.NumberFormat(currency==='SGD'?'en-SG':(lang==='ar'?'ar':'en'),{style:'currency',currency}).format(n);
  }catch(e){
    return Number(n).toFixed(2);
  }
}
const $ = sel => document.querySelector(sel);
function t(k){ return (i18n[lang] && i18n[lang][k]) || i18n.en[k] || k; }
async function postJSON(url, data){
  const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  return r.json();
}
(function(){
  try{
    const loc=(navigator.language||"en-US").split("-")[1];
    if(loc) userCountry=loc.toUpperCase();
  }catch{}
})();

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

// Toast
function toast(m){
  const t=$('#toast');
  if(!t) return;
  t.textContent=m;
  t.style.display='block';
  setTimeout(()=>t.style.display='none',2600);
}

/* =========================
   HOME SECURITY QUERY + RESULT GUARDS
   ========================= */

const HOME_SECURITY_BRANDS = [
  "ring","arlo","eufy","reolink","wyze","blink","nest","google nest",
  "ezviz","imou","hikvision","dahua","tp-link","tplink","tapo","aqara","xiaomi",
  "yale","schlage","august","kwikset","ultraloq","tuya"
];

// allow keywords (search intent)
const HOME_SECURITY_KEYWORDS = [
  // security cameras & systems
  "security","home security","surveillance","cctv","ip camera","wifi camera","wireless camera",
  "security camera","outdoor camera","indoor camera","floodlight camera","ptz",
  "nvr","dvr","camera system","nvr kit","dvr kit","poe","night vision","motion detection",
  "2k","4k","local storage","sd card","base station","no subscription",

  // doorbells
  "doorbell","video doorbell",

  // locks
  "smart lock","lock","deadbolt","keypad lock","fingerprint lock",

  // alarms + sensors
  "alarm","home alarm","alarm system","siren",
  "motion sensor","door sensor","window sensor","contact sensor","glass break",

  // allowed “home security adjacent”
  "baby monitor","intercom","intercom system",
  "smoke detector","co detector","carbon monoxide","smoke alarm","co alarm"
];

// strong blocks
const HARD_BLOCK = [
  // consumer electronics & unrelated
  "iphone","ipad","smartphone","phone","samsung","xiaomi phone",
  "laptop","macbook","gpu","graphics card","headphones","earbuds",
  "playstation","ps5","xbox","nintendo","tablet","smartwatch","camera lens","tripod",

  // explicitly excluded category
  "dash cam","dashcam"
];

function normalizeText(s){
  return String(s||'')
    .toLowerCase()
    .replace(/[^\w\s-]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function hasAny(text, list){
  for (const w of list){
    if (text.includes(w)) return true;
  }
  return false;
}

// detect model/reference-like queries (letters+numbers)
function looksLikeModelCode(txt){
  return /[a-z]/i.test(txt) && /\d/.test(txt) && txt.length >= 3 && txt.length <= 32;
}

function isHomeSecurityQuery(q){
  const txt = normalizeText(q);
  if (!txt) return false;

  if (hasAny(txt, HARD_BLOCK)) return false;

  if (hasAny(txt, HOME_SECURITY_BRANDS)) return true;
  if (hasAny(txt, HOME_SECURITY_KEYWORDS)) return true;

  if (looksLikeModelCode(txt)) return true;

  if (/(camera|doorbell|lock|alarm|sensor|cctv|nvr|dvr|intercom|smoke|co|baby monitor)/i.test(txt)) return true;

  return false;
}

function normalizeHomeSecurityQuery(q){
  const txt = normalizeText(q);
  if (!txt) return txt;

  if (hasAny(txt, HOME_SECURITY_BRANDS) && !/(camera|doorbell|lock|alarm|sensor|cctv|nvr|dvr|intercom|smoke|co|baby monitor)/i.test(txt)) {
    return `${txt} security camera`;
  }

  if (looksLikeModelCode(txt) && !/(camera|doorbell|lock|alarm|sensor|cctv|nvr|dvr|intercom|smoke|co|baby monitor)/i.test(txt) && !hasAny(txt, HOME_SECURITY_BRANDS)) {
    return `${txt} security camera`;
  }

  if (txt.includes("video doorbell")) return txt;
  if (txt.includes("doorbell")) return `${txt} video doorbell security`;
  if (txt.includes("smart lock")) return txt;
  if (txt.includes("lock")) return `${txt} smart lock`;
  if (txt.includes("alarm")) return `${txt} home alarm system`;
  if (txt.includes("sensor")) return `${txt} security sensor`;
  if (txt.includes("camera") && !txt.includes("security")) return `${txt} security`;

  return txt;
}

function isHomeSecurityResult(item){
  const title = normalizeText(item?.title || "");
  if (!title) return false;

  if (hasAny(title, HARD_BLOCK)) return false;
  if (title.includes("dashcam") || title.includes("dash cam")) return false;

  if (hasAny(title, HOME_SECURITY_KEYWORDS)) return true;

  if (hasAny(title, HOME_SECURITY_BRANDS)) {
    if (/(camera|kit|nvr|dvr|doorbell|lock|alarm|sensor|intercom|smoke|co|carbon monoxide|baby monitor)/i.test(title)) return true;
    return true;
  }

  if (/(cctv|nvr|dvr|poe|floodlight camera|security camera|video doorbell|smart lock|alarm system|motion sensor|door sensor|window sensor|intercom|smoke detector|co detector|baby monitor)/i.test(title)) {
    return true;
  }

  return false;
}

/* =========================
   DATA LOADERS
   ========================= */

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

async function loadVendor(vendor, {append=false, page=1}={}){
  const def = vendorDefs.find(v => v.name === vendor); if (!def) return;
  const term=(query||"").trim();
  if(!enabled.includes(vendor)||!WORKER_BASE||!term) return;

  if (!def.live) return;

  try{
    const limit = vendorLimits[vendor] || 40;
    const url = new URL(`${WORKER_BASE}/search/${def.slug}`);
    url.searchParams.set("q", term);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (DEBUG) url.searchParams.set("debug","1");
    const r=await fetch(url.toString(),{mode:"cors",cache:"no-store"});
    const d=await r.json().catch(()=>({results:[], note:"JSON parse error"}));
    if(!r.ok){ console.warn(`${vendor} search HTTP ${r.status}`, d); return; }
    if (d.note) console.info(`${vendor} note: ${d.note}`);

    let arr=(Array.isArray(d.results)?d.results:[]).map(o=>({
      ...o,
      image: (o.image && /^https?:/i.test(o.image)) ? o.image : PLACEHOLDER_IMG,
      currency:o.currency||"USD",
      shipDays:estimateShipDays(vendor,userCountry),
      vendor
    }));

    if (vendor === "AliExpress" && arr.length) arr = await enrichAliDetails(arr);

    arr = arr.filter(isHomeSecurityResult);

    if (append) offersByVendor[vendor] = (offersByVendor[vendor]||[]).concat(arr);
    else offersByVendor[vendor] = arr;

    console.log(`[${vendor}] page ${page} loaded:`, arr.length, 'items for', term);
  }catch(e){ console.warn(`${vendor} search fetch failed:`,e); }
}

async function loadAll({append=false}={}){
  const live = vendorDefs.filter(v=>v.live && enabled.includes(v.name)).map(v=>v.name);
  const tasks = live.map(v => loadVendor(v, {append, page: vendorPages[v]}));
  await Promise.all(tasks);
}

function currentResults(){
  let base = [];
  for (const v of LIVE_VENDORS) {
    base = base.concat(offersByVendor[v]||[]);
  }

  if (minPriceVal != null || maxPriceVal != null) {
    base = base.filter(o=>{
      const p = priceInSelected(o);
      if (minPriceVal != null && p < minPriceVal) return false;
      if (maxPriceVal != null && p > maxPriceVal) return false;
      return true;
    });
  }

  if (maxShipDays) base = base.filter(o => (o.shipDays||estimateShipDays(o.vendor,userCountry)) <= Number(maxShipDays));

  if (sortBy==='priceAsc')  base.sort((a,b)=> priceInSelected(a) - priceInSelected(b));
  if (sortBy==='priceDesc') base.sort((a,b)=> priceInSelected(b) - priceInSelected(a));
  if (sortBy==='rating')    base.sort((a,b)=> (b.rating||4.2) - (a.rating||4.2));

  const m=new Map();
  for(const o of base){
    const k=((o.title||'')+'|'+o.vendor).toLowerCase();
    const v=m.get(k);
    if(!v || priceInSelected(o) < priceInSelected(v)) m.set(k,o);
  }
  return Array.from(m.values());
}

function renderLabels(){
  const setTxt = (id, key) => { const el=document.getElementById(id); if (el) el.textContent=t(key); };
  setTxt('lblLang','Lang');
  setTxt('lblCurrency','Currency');
  setTxt('lblSort','Sort');
  setTxt('lblWatchlist','Watchlist');
  setTxt('lblShip','MaxShip');
  document.documentElement.dir = (lang==='ar') ? 'rtl' : 'ltr';
}

// ----- RENDER -----
function render(){
  renderLabels();

  const data = currentResults();
  const grid = $('#grid');
  if (!grid) return;
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
    card.querySelector('.watchBtn').onclick = ()=> {/* reserved for watchlist later */};
    grid.appendChild(card);
  });

  const moreBtn = $('#moreBtn');
  if (moreBtn) {
    if (query.trim().length > 0) {
      moreBtn.style.display = 'inline-flex';
      moreBtn.disabled = data.length === 0;
      moreBtn.style.opacity = moreBtn.disabled ? '.6' : '1';
      moreBtn.style.pointerEvents = moreBtn.disabled ? 'none' : 'auto';
    } else {
      moreBtn.style.display = 'none';
    }
  }
}

/* ============ Photo Search & Chat Assistant ============ */
let mobilenetModel = null;
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src; s.async=true;
    s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
}
async function ensureMobileNet(){
  if (mobilenetModel) return mobilenetModel;
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0');
  // eslint-disable-next-line no-undef
  mobilenetModel = await mobilenet.load();
  return mobilenetModel;
}

function mapPhotoLabelsToHomeSecurity(labels){
  const txt = labels.join(' ').toLowerCase();

  if (/(camera|webcam|camcorder|lens|projector|tripod)/i.test(txt)) return "security camera";
  if (/(doorknob|door|lock|padlock|key)/i.test(txt)) return "smart lock";
  if (/(siren|alarm|smoke alarm|bell|buzzer)/i.test(txt)) return "home alarm system";
  if (/(monitor|screen|television|tv)/i.test(txt)) return "indoor security camera";

  return "home security device";
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

    const qText = mapPhotoLabelsToHomeSecurity(labels);

    const input=$('#search'); if (input){ input.value = qText; }
    await runSearch(qText);

    URL.revokeObjectURL(img.src);
  } catch(e){
    console.warn('Photo search error:', e);
    toast('Photo search failed. Try a clearer image.');
  }
}
// Expose for index.html photo chooser hook
window.startPhotoSearch = searchByPhoto;

// Chat assistant (open/close + reflect results to main grid)
function openChat(){ const p=$('#chatPanel'); if(!p) return; p.classList.add('open'); $('#chatInput')?.focus(); }
function closeChat(){ const p=$('#chatPanel'); if(!p) return; p.classList.remove('open'); }

function addChatMsg(role, html){
  const box = $('#chatMessages');
  if (!box) return;
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg ' + (role==='user'?'me':'bot');
  wrap.innerHTML = html;
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

function parseIntent(text){
  const msg = String(text||'').toLowerCase();
  let min=null, max=null;
  const m1 = msg.match(/\$?\s*(\d+)\s*[-to]\s*\$?\s*(\d+)/); if(m1){ min=+m1[1]; max=+m1[2]; }
  const m2 = msg.match(/(?:under|below|less than)\s*\$?\s*(\d+)/); if(m2){ max=+m2[1]; }
  const m3 = msg.match(/(?:over|above|more than)\s*\$?\s*(\d+)/); if(m3){ min=+m3[1]; }
  const m4 = msg.match(/(?:around|about)\s*\$?\s*(\d+)/); if(m4){ const n=+m4[1]; min=Math.floor(n*0.8); max=Math.ceil(n*1.2); }

  let cleaned = msg.replace(/\$?\d+(\s*[-to]\s*\$?\d+)?/g,'')
                   .replace(/\b(under|below|less than|over|above|more than|around|about)\b/g,'')
                   .replace(/\s+/g,' ').trim();

  return { query: cleaned || msg, min, max };
}

function inferCategory(text){
  const s = normalizeText(text);
  if (!s) return null;

  if (/(doorbell|ring doorbell|video doorbell)/i.test(s)) return "doorbell";
  if (/(smart lock|deadbolt|keypad lock|fingerprint lock|door lock)/i.test(s)) return "lock";
  if (/(alarm system|home alarm|siren|motion sensor|door sensor|window sensor|contact sensor|sensor)/i.test(s)) return "alarm";
  if (/(mount|bracket|sd card|micro sd|adapter|power cable|solar panel|accessor)/i.test(s)) return "accessories";
  if (/(intercom|smoke detector|carbon monoxide|co detector|baby monitor)/i.test(s)) return "other";
  if (/(camera|cctv|nvr|dvr|poe|floodlight)/i.test(s)) return "camera";

  // brand/model code: default to camera (most common)
  if (hasAny(s, HOME_SECURITY_BRANDS) || looksLikeModelCode(s)) return "camera";

  return null;
}

function categoryToQueryPrefix(cat){
  switch(cat){
    case "camera": return "security camera";
    case "doorbell": return "video doorbell";
    case "lock": return "smart lock";
    case "alarm": return "home alarm system";
    case "accessories": return "security camera accessories";
    case "other": return "home security";
    default: return "home security";
  }
}

function quickButtons(title, buttons){
  const btns = buttons.map(b => `<button class="btn btn-mini btn-primary ps-quick" type="button" data-quick="${b.value}">${b.label}</button>`).join(' ');
  return `<div class="bot-text"><b>${title}</b></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${btns}</div>`;
}

// Assistant state machine
const assistantState = {
  stage: "idle",           // idle | need_category | need_budget
  category: null,          // camera|doorbell|lock|alarm|accessories|other
  pendingQuery: "",        // user query text
  min: null,
  max: null
};

async function searchWorker(slug, q, page=1, limit=40){
  const url = new URL(`${WORKER_BASE}/search/${slug}`);
  url.searchParams.set("q", q);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
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
      <img src="${item.image || PLACEHOLDER_IMG}" alt="${item.title}" onerror="this.src='${PLACEHOLDER_IMG}'"/>
      <div class="cc-body">
        <div class="cc-title">${item.title}</div>
        <div class="cc-meta"><span class="badge vendor" data-vendor="${item.vendor}">${item.vendor}</span> <b>${p}</b></div>
        <a class="btn btn-mini btn-primary" href="${outUrl(item)}" target="_blank" rel="sponsored nofollow noopener">View</a>
      </div>
    </div>`;
}

async function assistantFinalizeAndSearch(){
  const cat = assistantState.category || "camera";
  const prefix = categoryToQueryPrefix(cat);

  // Build a safe query: category prefix + user query
  const raw = `${prefix} ${assistantState.pendingQuery}`.trim();
  const safeQ = normalizeHomeSecurityQuery(raw);

  // Apply budget into page filters too (optional but nice)
  if (assistantState.min != null || assistantState.max != null) {
    minPriceVal = assistantState.min;
    maxPriceVal = assistantState.max;
    const minEl = $('#minPrice'); const maxEl = $('#maxPrice');
    if (minEl) minEl.value = (minPriceVal ?? "") === null ? "" : String(minPriceVal ?? "");
    if (maxEl) maxEl.value = (maxPriceVal ?? "") === null ? "" : String(maxPriceVal ?? "");
  }

  addChatMsg('bot', `<div class="bot-text">Searching for <b>${safeQ}</b>${assistantState.min||assistantState.max?` with your budget${assistantState.min?` ≥ ${fmt(assistantState.min)}`:''}${assistantState.max?` ≤ ${fmt(assistantState.max)}`:''}.`:'.'}</div>`);

  // 1) show top in chat
  const live = vendorDefs.filter(v=>v.live);
  const queries = live.map(v => searchWorker(v.slug, safeQ, 1, vendorLimits[v.name] || 40));
  const resultsByVendor = await Promise.all(queries);

  let pool = [];
  resultsByVendor.forEach((arr, i) => {
    const vendorName = live[i].name;
    (arr||[]).forEach(o => pool.push({ ...o, vendor: vendorName }));
  });

  pool = pool.filter(isHomeSecurityResult);
  if (assistantState.min!=null || assistantState.max!=null){
    pool = pool.filter(o => withinRange(o, assistantState.min, assistantState.max));
  }

  pool.sort((a,b) => priceInSelected(a) - priceInSelected(b) || (b.rating||0)-(a.rating||0));
  const top = pool.slice(0,3).map(resultCard).join('');

  if (!pool.length){
    addChatMsg('bot', `<div class="bot-text">No great matches yet. Try adding a brand/model, or increase budget.</div>`);
  } else {
    addChatMsg('bot', `<div class="chat-cards">${top}</div>`);
  }

  // 2) reflect to main page grid
  const input=$('#search'); if (input){ input.value = safeQ; }
  await runSearch(safeQ);

  // reset state
  assistantState.stage = "idle";
  assistantState.category = null;
  assistantState.pendingQuery = "";
  assistantState.min = null;
  assistantState.max = null;
}

async function assistantRespond(userText){
  const intent = parseIntent(userText);
  const rawText = String(userText||"").trim();

  // quick command: "no budget"
  const isNoBudget = /^(no budget|any budget|no limit|anything)$/i.test(rawText);

  // Stage handling
  if (assistantState.stage === "need_category") {
    const cat = inferCategory(rawText);
    if (!cat) {
      addChatMsg('bot', quickButtons("Choose a category:", [
        {label:"📷 Cameras", value:"camera"},
        {label:"🚪 Doorbells", value:"doorbell"},
        {label:"🔒 Smart Locks", value:"lock"},
        {label:"🚨 Alarm & Sensors", value:"alarm"},
        {label:"🧰 Accessories", value:"accessories"},
        {label:"➕ Other", value:"other"},
      ]));
      return;
    }
    assistantState.category = cat;
    assistantState.stage = "need_budget";
    addChatMsg('bot', quickButtons("Any budget in mind? (optional)", [
      {label:"No budget", value:"no budget"},
      {label:"Under 100", value:"under 100"},
      {label:"Under 200", value:"under 200"},
      {label:"Under 300", value:"under 300"},
      {label:"500+", value:"over 500"},
    ]));
    return;
  }

  if (assistantState.stage === "need_budget") {
    if (isNoBudget) {
      assistantState.min = null;
      assistantState.max = null;
      await assistantFinalizeAndSearch();
      return;
    }
    // parse budget from the text itself using parseIntent
    if (intent.min != null || intent.max != null) {
      assistantState.min = intent.min;
      assistantState.max = intent.max;
      await assistantFinalizeAndSearch();
      return;
    }
    // if user answered with something else, allow "no budget" fallback
    addChatMsg('bot', `<div class="bot-text">If you don’t have a budget, tap <b>No budget</b>. Or type like: <b>under 200</b> / <b>100-300</b>.</div>`);
    return;
  }

  // Stage idle: validate niche
  if (!isHomeSecurityQuery(intent.query)) {
    addChatMsg('bot', `<div class="bot-text">I can help with <b>home security devices</b> only (cameras, doorbells, smart locks, alarms, sensors, baby monitors, intercom, smoke/CO). Try: <b>“Reolink outdoor camera under 200”</b>.</div>`);
    return;
  }

  // Determine category; if missing, ask
  const cat = inferCategory(intent.query);
  assistantState.pendingQuery = intent.query;
  assistantState.min = intent.min;
  assistantState.max = intent.max;

  if (!cat) {
    assistantState.stage = "need_category";
    addChatMsg('bot', quickButtons("What are you looking for?", [
      {label:"📷 Cameras", value:"camera"},
      {label:"🚪 Doorbells", value:"doorbell"},
      {label:"🔒 Smart Locks", value:"lock"},
      {label:"🚨 Alarm & Sensors", value:"alarm"},
      {label:"🧰 Accessories", value:"accessories"},
      {label:"➕ Other", value:"other"},
    ]));
    return;
  }

  assistantState.category = cat;

  // If budget already provided, search now. Otherwise ask once.
  if (assistantState.min != null || assistantState.max != null) {
    await assistantFinalizeAndSearch();
    return;
  }

  assistantState.stage = "need_budget";
  addChatMsg('bot', quickButtons("Any budget in mind? (optional)", [
    {label:"No budget", value:"no budget"},
    {label:"Under 100", value:"under 100"},
    {label:"Under 200", value:"under 200"},
    {label:"Under 300", value:"under 300"},
    {label:"500+", value:"over 500"},
  ]));
}

/* =========================
   CASHBACK + SIGNUP
   ========================= */

function initCashbackLite(){
  const bar = $('#cashBar'); const info=$('#cashInfo');
  $('#cashLearn')?.addEventListener('click', ()=>{ info?.classList.toggle('open'); });
  $('#cashClose')?.addEventListener('click', ()=>{ if(bar) bar.style.display='none'; info?.classList.remove('open'); });
}

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
    if(msg) msg.textContent='';
    if(step1) step1.style.display='block';
    if(step2) step2.style.display='none';
    modal.style.display='flex';
    emailEl?.focus();
    document.addEventListener('keydown', trapTab);
  }
  function closeModal(){
    modal.style.display='none';
    document.removeEventListener('keydown', trapTab);
  }

  if(!openBtn||!modal) return;
  openBtn.onclick=openModal;
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && modal.style.display==='flex') closeModal(); });

  sendBtn?.addEventListener('click', async ()=>{
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
  });

  verifyBtn?.addEventListener('click', async ()=>{
    const email=(emailEl?.value||'').trim().toLowerCase(); const code=(codeEl?.value||'').trim();
    if(!code){ if(msg) msg.textContent='Enter the 6-digit code.'; return; }
    try{
      const out=await postJSON(`${WORKER_BASE}/verify`,{email,code});
      if(out.ok){
        localStorage.setItem('ps.email',email);
        if(msg) msg.textContent='Verified! Watchlist email alerts will be available.';
        setTimeout(()=>{ modal.style.display='none'; },1200);
      } else { if(msg) msg.textContent='Invalid code.'; }
    }catch{ if(msg) msg.textContent='Network error.'; }
  });
}

/* =========================
   SEARCH ORCHESTRATION
   ========================= */

async function runSearch(rawQ){
  const inputQ = String(rawQ||"").trim();
  if (!inputQ) return;

  if (!isHomeSecurityQuery(inputQ)) {
    toast('This site searches Home Security devices only.');
    return;
  }

  const safeQ = normalizeHomeSecurityQuery(inputQ);

  query = safeQ;
  localStorage.setItem('ps.lastQuery', query);

  enabled = [...LIVE_VENDORS];

  Object.keys(vendorPages).forEach(k=> vendorPages[k]=1);
  await loadAll({append:false});
  render();
}

// BOOT
let debounce;
window.addEventListener('DOMContentLoaded', async ()=>{
  $('#themeToggle')?.addEventListener('click', ()=> applyTheme( (localStorage.getItem('ps.theme')==='dark') ? 'light' : 'dark' ));

  const selLang=$('#lang');
  if(selLang){
    selLang.value=lang;
    selLang.onchange=()=>{ lang=selLang.value; localStorage.setItem('ps.lang',lang); render(); };
  }
  $('#currency')?.addEventListener('change',(e)=>{ currency=e.target.value; render(); });
  $('#sort')?.addEventListener('change',(e)=>{ sortBy=e.target.value; render(); });
  $('#shipMax')?.addEventListener('change',(e)=>{ maxShipDays=e.target.value; render(); });

  $('#applyBudget')?.addEventListener('click', ()=>{
    const minV = $('#minPrice')?.value.trim() || '';
    const maxV = $('#maxPrice')?.value.trim() || '';
    minPriceVal = minV==='' ? null : Math.max(0, Number(minV));
    maxPriceVal = maxV==='' ? null : Math.max(0, Number(maxV));
    render();
  });

  // Hidden search input still drives category dropdown -> search
  $('#search')?.addEventListener('input',(e)=>{
    const raw = e.target.value || '';
    clearTimeout(debounce);
    debounce=setTimeout(async()=>{
      await runSearch(raw);
    },250);
  });

  // Photo search: index.html handles chooser, but we also keep compatibility
  $('#photoBtn')?.addEventListener('click', ()=> $('#photoInput')?.click());
  $('#photoInput')?.addEventListener('change', ()=> { const f=$('#photoInput')?.files?.[0]; if (f) searchByPhoto(f); });

  // Chat assistant open/close
  $('#chatFab')?.addEventListener('click', ()=>{ openChat(); });
  $('#chatClose')?.addEventListener('click', (e)=>{ e.preventDefault(); closeChat(); });
  $('#chatBg')?.addEventListener('click', ()=> closeChat());
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeChat(); }});

  // Quick buttons inside chat (event delegation)
  $('#chatMessages')?.addEventListener('click', async (e)=>{
    const btn = e.target.closest && e.target.closest('.ps-quick');
    if(!btn) return;
    const val = btn.getAttribute('data-quick') || '';
    addChatMsg('user', `<div class="me-text">${val}</div>`);
    await assistantRespond(val);
  });

  $('#chatForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const txt = $('#chatInput')?.value.trim();
    if(!txt) return;
    addChatMsg('user', `<div class="me-text">${txt}</div>`);
    $('#chatInput').value='';
    await assistantRespond(txt);
  });

  // More results
  $('#moreBtn')?.addEventListener('click', async ()=>{
    vendorDefs.filter(v=>v.live && enabled.includes(v.name)).forEach(v => vendorPages[v.name] = (vendorPages[v.name]||1) + 1);

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

  initCashbackLite();
  initSignupUI();

  await loadRates();

  // Boot search: keep lightweight default, or leave blank if you prefer
  const startTerm = (new URLSearchParams(location.search).get('q'))
    || (localStorage.getItem('ps.lastQuery'))
    || 'outdoor security camera';

  const se=$('#search');
  if(se) se.value=startTerm;

  await runSearch(startTerm);
});
