// === CONFIG / STATE ===
const WORKER_BASE = "https://pricescanner.b48rptrywg.workers.dev";

// 10 vendors (display name + slug used by Worker: /search/<slug> or /feed/<slug>)
const vendorDefs = [
  { name: "Amazon",    slug: "amazon" },
  { name: "eBay",      slug: "ebay" },
  { name: "AliExpress",slug: "aliexpress" },
  { name: "Shopee",    slug: "shopee" },
  { name: "Lazada",    slug: "lazada" },
  { name: "Temu",      slug: "temu" },
  { name: "Walmart",   slug: "walmart" },
  { name: "Etsy",      slug: "etsy" },
  { name: "Best Buy",  slug: "bestbuy" },
  { name: "Target",    slug: "target" },
];
let enabled       = vendorDefs.map(v => v.name); // all ON by default

let currency    = "SGD";
let sortBy      = "priceAsc";
let query       = "";
let userCountry = "US";
let maxShipDays = "";
let fx          = { base:"USD", rates:{ USD:1 }, at:0 };
let watches     = JSON.parse(localStorage.getItem('ps.watches')||"[]");
let lang        = localStorage.getItem('ps.lang') || 'en';
let groupMode   = true;
let lastFocusedEl = null;

const offersByVendor = Object.fromEntries(vendorDefs.map(v => [v.name, []]));

// i18n
const i18n = {
  en:{Lang:"Language",Currency:"Currency",Sort:"Sort by",Sources:"Sources",Watchlist:"Watchlist",Refresh:"Refresh",MaxShip:"Max ship days"},
  ar:{Lang:"اللغة",Currency:"العملة",Sort:"ترتيب حسب",Sources:"المصادر",Watchlist:"قائمة المراقبة",Refresh:"تحديث",MaxShip:"أقصى أيام للشحن"},
  fr:{Lang:"Langue",Currency:"Devise",Sort:"Trier par",Sources:"Sources",Watchlist:"Liste de suivi",Refresh:"Actualiser",MaxShip:"Délais max"},
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
  const fast = new Set(["eBay","Amazon","Best Buy","Target","Walmart","Lazada"]);
  const intl = new Set(["Shopee","AliExpress","Temu","Etsy"]);
  if (fast.has(vendor)) return (["SG","US","GB"].includes(country))?3:7;
  if (intl.has(vendor)) return (country==="SG")?7:14;
  return 10;
}

// /out wrapper URL for clicks (keeps affiliate-ready)
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

// loaders (unified)
async function loadVendor(vendor){
  const def = vendorDefs.find(v => v.name === vendor); if (!def) return;
  offersByVendor[vendor] = [];
  const term=(query||"").trim(); if(!enabled.includes(vendor)||!WORKER_BASE||!term) return;
  try{
    const r=await fetch(`${WORKER_BASE}/search/${def.slug}?q=`+encodeURIComponent(term),{mode:"cors",cache:"no-store"});
    const d=await r.json().catch(()=>({results:[]}));
    if(!r.ok){ console.warn(`${vendor} search error`, r.status, d); return; }
    if (d.error) console.warn(`${vendor} search note:`, d.error);
    if (d.note)  console.info(`${vendor} search note:`, d.note);
    const arr=(Array.isArray(d.results)?d.results:[]).map(o=>({...o,currency:o.currency||"USD",shipDays:estimateShipDays(vendor,userCountry),vendor}));
    offersByVendor[vendor] = arr;
    if (!arr.length) console.info(`${vendor}: 0 results for query:`, term);
  }catch(e){ console.warn(`${vendor} search fetch failed:`,e); }
}

// merge & filter
function currentResults(){
  let base = [];
  for (const v of vendorDefs.map(v=>v.name)) {
    if (enabled.includes(v)) base = base.concat(offersByVendor[v]||[]);
  }
  if (query) base = base.filter(o => (o.title||"").toLowerCase().includes(query.toLowerCase()));
  if (maxShipDays) base = base.filter(o => (o.shipDays||estimateShipDays(o.vendor,userCountry)) <= Number(maxShipDays));
  if (sortBy==='priceAsc')  base.sort((a,b)=> priceInSelected(a) - priceInSelected(b));
  if (sortBy==='priceDesc') base.sort((a,b)=> priceInSelected(b) - priceInSelected(a));
  if (sortBy==='rating')    base.sort((a,b)=> (b.rating||4.2) - (a.rating||4.2));

  // dedupe exact (title+vendor) at lowest price
  const m=new Map();
  for(const o of base){ const k=((o.title||'')+'|'+o.vendor).toLowerCase(); const v=m.get(k);
    if(!v || priceInSelected(o) < priceInSelected(v)) m.set(k,o); }
  return Array.from(m.values());
}

// ----------------- GROUPING / "mirror same item" -----------------
const STOP = new Set(["new","original","genuine","case","cover","pack","set","edition","model","series","compatible","official","store","seller","shop","best","buy","sale","deal","free","shipping","with","for","and","or","the","a","an","of","by","from"]);

function normTitle(t){
  return (t||"")
    .toLowerCase()
    .replace(/[\u2122®©]/g,"")              // ™ ® ©
    .replace(/[\[\]\(\)\{\}]/g," ")         // brackets → space
    .replace(/[^a-z0-9\s\-+]/g,"")          // keep alnum, space, -, +
    .replace(/\s+/g," ")
    .trim();
}
function sigFromTitle(t){
  const s = normTitle(t);
  let tokens = s.split(" ")
    .map(x=>x.replace(/(\d+)\s*tb/,"$1tb").replace(/(\d+)\s*gb/,"$1gb"))
    .map(x=>x.replace(/[^a-z0-9+\-]/g,""))
    .filter(Boolean)
    .filter(x=>!STOP.has(x));
  // prefer first few meaningful tokens + numbers
  const words = tokens.filter(x=>/[a-z]/.test(x));
  const nums  = tokens.filter(x=>/\d/.test(x));
  const top = [...new Set([...words.slice(0,5), ...nums.slice(0,3)])].sort();
  return top.join("_");
}
function productSignature(o){
  // if the feed/API ever provides identifiers, use them here:
  const known = (o.upc||o.ean||o.isbn||"").replace(/\D/g,"");
  if (known) return "gtin:"+known;
  const model = (o.model||o.mpn||"").toLowerCase().replace(/\s+/g,"");
  if (model) return "model:"+model;
  return "title:"+sigFromTitle(o.title||o.id||"");
}
function clusterByProduct(items){
  const map = new Map();
  for(const it of items){
    const sig = productSignature(it);
    if(!map.has(sig)) map.set(sig, []);
    map.get(sig).push(it);
  }
  // sort offers in each group by price asc
  const groups = [];
  for(const [sig, arr] of map.entries()){
    const sorted = arr.slice().sort((a,b)=> priceInSelected(a)-priceInSelected(b));
    groups.push({ sig, offers: sorted });
  }
  // put multi-vendor groups first
  groups.sort((a,b)=> (b.offers.length - a.offers.length) || (priceInSelected(a.offers[0]) - priceInSelected(b.offers[0])));
  return groups;
}
function chooseGroupTitle(g){
  // pick the shortest descriptive title
  const sorted = g.offers.slice().sort((a,b)=> (a.title||"").length - (b.title||"").length);
  return (sorted[0]?.title) || (g.offers[0]?.title) || "Product";
}

// ----------------- RENDER -----------------
function render(){
  renderLabels();

  // sources toggles
  const srcWrap = $('#sources'); srcWrap.innerHTML='';
  vendorDefs.forEach(v=>{ const on=enabled.includes(v.name);
    const b=document.createElement('button'); b.className='badge'; b.style.background=on?'#ecfdf5':'#fff7ed';
    b.textContent=(on?'✔ ':'✖ ')+v.name; b.onclick=()=>{ enabled=on?enabled.filter(x=>x!==v.name):[...enabled,v.name]; render(); }; srcWrap.appendChild(b); });

  const data = currentResults();
  const grid = $('#grid'); grid.innerHTML='';

  if (groupMode) {
    const groups = clusterByProduct(data);
    groups.forEach(g=>{
      const best = g.offers[0];
      const p = priceInSelected(best);
      const ship = best.shipDays || estimateShipDays(best.vendor, userCountry);
      const title = chooseGroupTitle(g);
      const card = document.createElement('div'); card.className='card';
      const topVendors = g.offers.slice(0,6);
      const moreCount = g.offers.length - topVendors.length;

      card.innerHTML = `
        <div style="padding:16px">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <h3 style="font-size:16px;font-weight:700;line-height:1.2;margin:0">${title}</h3>
          </div>
          <div style="display:flex;gap:8px;font-size:13px;margin-top:6px">
            <span class="badge">🛍️ ${g.offers.length} store${g.offers.length>1?'s':''}</span>
            <span class="badge">🚚 ~${ship}d (best)</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
            <div style="font-size:22px;font-weight:800">${fmt(p)}</div>
            <div style="font-size:12px;color:#6b7280;text-align:right"><div>${best.shipping||'—'}</div><div>${best.shipTime||'—'}</div></div>
          </div>
          <div class="vendorPills">
            ${topVendors.map(o=>`<a class="pill" href="${outUrl(o)}" target="_blank" rel="sponsored nofollow noopener">${o.vendor} • ${fmt(priceInSelected(o))}</a>`).join("")}
            ${moreCount>0 ? `<span class="pill">+${moreCount} more</span>` : ""}
          </div>
          <div class="row" style="margin-top:10px">
            <a class="btn btn-primary" href="${outUrl(best)}" target="_blank" rel="sponsored nofollow noopener">View Best Deal</a>
            <button class="btn watchBtn">Watch</button>
          </div>
        </div>`;
      card.querySelector('.watchBtn').onclick = ()=> addGroupWatch(g, title);
      grid.appendChild(card);
    });
  } else {
    // flat cards (original view)
    data.forEach(item=>{
      const p = priceInSelected(item);
      const ship = item.shipDays || estimateShipDays(item.vendor, userCountry);
      const card = document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div style="position:relative;width:100%;padding-top:56%">
          <img loading="lazy" width="600" height="338" src="${item.image}" alt="${item.title}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>
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
            <a class="btn btn-primary" href="${outUrl(item)}" target="_blank" rel="sponsored nofollow noopener">View Deal</a>
            <button class="btn watchBtn">Watch</button>
          </div>
        </div>`;
      card.querySelector('.watchBtn').onclick = ()=> addWatch(item);
      grid.appendChild(card);
    });
  }

  // watchlist
  const list = $('#watchlist'); list.innerHTML = watches.length ? '' : '<div style="font-size:14px;color:#6b7280">No watched items yet.</div>';
  watches.forEach(w=>{
    const row=document.createElement('div'); row.className='card'; row.style.border='1px solid rgba(0,0,0,.08)';
    row.innerHTML = `
      <div style="padding:12px">
        <div style="font-weight:700">${w.title}</div>
        <div style="font-size:12px;color:#6b7280">Baseline: ${w.baseline??'—'} • Last: ${w.last??'—'} • ${w.triggered?'Triggered':'Waiting'}</div>
        <div class="row" style="margin-top:8px;align-items:center;gap:8px;flex-wrap:wrap">
          <input type="number" class="input discount" placeholder="Discount % from baseline" value="${w.discountPct??''}"/>
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="emailOpt"${w.emailOpt?' checked':''}/> email alerts</label>
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

function renderLabels(){
  const setTxt = (id, key) => { const el=document.getElementById(id); if (el) el.textContent=t(key); };
  setTxt('lblLang','Lang'); setTxt('lblCurrency','Currency'); setTxt('lblSort','Sort');
  setTxt('lblSources','Sources'); setTxt('lblWatchlist','Watchlist'); setTxt('lblShip','MaxShip');
  const rb=document.getElementById('refreshBtn'); if (rb) rb.textContent=t('Refresh');
  document.documentElement.dir = (lang==='ar') ? 'rtl' : 'ltr';
}

// watchlist helpers
function saveWatches(){ localStorage.setItem('ps.watches', JSON.stringify(watches)) }
function addWatch(item){
  const id=(item.title+'|'+enabled.sort().join(',')).toLowerCase();
  if (watches.find(w=>w.id===id)) { toast('Already in watchlist'); return; }
  watches=[{ id, title:item.title, vendors:[item.vendor], discountPct:15, emailOpt:false }, ...watches];
  saveWatches(); toast('Added to watchlist'); render();
}
function addGroupWatch(group, title){
  const id=('group:'+group.sig+'|'+enabled.sort().join(',')).toLowerCase();
  if (watches.find(w=>w.id===id)) { toast('Already in watchlist'); return; }
  const vendors = Array.from(new Set(group.offers.map(o=>o.vendor)));
  watches=[{ id, title, vendors, discountPct:15, emailOpt:false }, ...watches];
  saveWatches(); toast('Added group to watchlist'); render();
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
function defaultQuery(){ const urlQ = new URLSearchParams(location.search).get('q') || ''; if (urlQ) return urlQ; const last=localStorage.getItem('ps.lastQuery'); return last||trending[Math.floor(Math.random()*trending.length)]; }

// signup modal (same as before)
function initSignupUI(){
  const modal=$('#signupModal'), openBtn=$('#openSignup'), closeBtn=$('#suClose'),
        step1=$('#signupStep1'), step2=$('#signupStep2'), msg=$('#signupMsg'),
        emailEl=$('#suEmail'), codeEl=$('#suCode'), sendBtn=$('#suSend'), verifyBtn=$('#suVerify');

  function trapTab(e){
    if(e.key!=='Tab') return;
    const f = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])']);
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

// BOOT
let debounce;
window.addEventListener('DOMContentLoaded', async ()=>{
  const selLang=$('#lang'); if(selLang){ selLang.value=lang; selLang.onchange=()=>{ lang=selLang.value; localStorage.setItem('ps.lang',lang); render(); } }
  $('#currency').onchange=(e)=>{ currency=e.target.value; render(); }
  $('#sort').onchange=(e)=>{ sortBy=e.target.value; render(); }
  $('#shipMax').onchange=(e)=>{ maxShipDays=e.target.value; render(); }
  const gt=$('#groupToggle'); if(gt){ groupMode=gt.checked; gt.onchange=(e)=>{ groupMode=e.target.checked; render(); }; }

  $('#search').oninput=(e)=>{ query=e.target.value; localStorage.setItem('ps.lastQuery',query);
    clearTimeout(debounce); debounce=setTimeout(async()=>{
      const tasks = vendorDefs.map(v => loadVendor(v.name));
      await Promise.all(tasks);
      render();
    },250); };
  $('#searchBtn').onclick=()=>{ const input=$('#search'); if(input){ input.dispatchEvent(new Event('input',{bubbles:true})); } }
  $('#refreshBtn').onclick=refreshWatches;

  initSignupUI(); captureReferral(); await loadRates();

  const startTerm=defaultQuery(); query=startTerm; const se=$('#search'); if(se) se.value=startTerm;

  const tasks = vendorDefs.map(v => loadVendor(v.name));
  await Promise.all(tasks);
  render();
});
