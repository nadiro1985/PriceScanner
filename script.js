
const vendors = ["Amazon","eBay","Walmart","AliExpress","Etsy","Rakuten","Shopee","Lazada","Temu","MercadoLibre","BestBuy","Target","Newegg","HomeDepot","Wayfair"];
let enabled = [...vendors];
let currency = "SGD";
let sortBy = "priceAsc";
let query = "";
let offers = [];
let watches = JSON.parse(localStorage.getItem('ps.watches')||"[]");
let config = JSON.parse(localStorage.getItem('site.config')||"{}");
const defaults = { name: "PriceScanner", tagline: "Find the best price, fast", primary:"#4f46e5", secondary:"#7c3aed", logoUrl:"logo.svg" };
config = {...defaults, ...config};
document.documentElement.style.setProperty('--brand1', config.primary);
document.documentElement.style.setProperty('--brand2', config.secondary);

function fmt(n){ try{ return new Intl.NumberFormat(currency==='SGD'?'en-SG':'en', {style:'currency',currency}).format(n) }catch(e){ return Number(n).toFixed(2)} }
const $ = sel => document.querySelector(sel);

async function loadData(){
  const res = await fetch('demo.json'); 
  offers = await res.json();
  render();
}

function render(){
  $('#brandLogo').src = config.logoUrl || 'logo.svg';
  $('#brandName').textContent = config.name;
  $('#tagline').textContent = config.tagline;

  const srcWrap = $('#sources'); srcWrap.innerHTML = '';
  vendors.forEach(v=>{
    const on = enabled.includes(v);
    const b = document.createElement('button'); b.className='badge'; b.style.background = on?'#ecfdf5':'#fff7ed';
    b.textContent = (on?'✔ ':'✖ ')+v;
    b.onclick = ()=>{ enabled = on ? enabled.filter(x=>x!==v) : [...enabled, v]; render() };
    srcWrap.appendChild(b);
  });

  let res = offers.filter(o => enabled.includes(o.vendor));
  if (query) res = res.filter(o => o.title.toLowerCase().includes(query.toLowerCase()));
  if (sortBy==='priceAsc') res.sort((a,b)=>a.price-b.price);
  if (sortBy==='priceDesc') res.sort((a,b)=>b.price-a.price);
  if (sortBy==='rating') res.sort((a,b)=>b.rating-a.rating);

  const grid = $('#grid'); grid.innerHTML='';
  res.forEach(item=>{
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
          <div style="font-size:22px;font-weight:800">${fmt(item.price)}</div>
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

function saveWatches(){ localStorage.setItem('ps.watches', JSON.stringify(watches)) }

function addWatch(item){
  const id = (item.title + '|' + enabled.sort().join(',')).toLowerCase();
  if (watches.find(w=>w.id===id)) { toast('Already in watchlist'); return }
  watches = [{ id, title:item.title, vendors:[...enabled], targetPrice:Math.max(0,item.price-1) }, ...watches];
  saveWatches(); toast('Added to watchlist'); render();
}

async function refreshWatches(){
  const res = await fetch('demo.json').then(r=>r.json());
  let changed=false, msg;
  watches = watches.map(w=>{
    const pool = res.filter(o=> w.vendors.includes(o.vendor) && o.title.includes(w.title.split(' Sample')[0]))
    if (!pool.length) return w;
    const best = pool.reduce((a,b)=> a.price<=b.price?a:b);
    const baseline = w.baseline ?? best.price;
    const discount = baseline>0 ? ((baseline-best.price)/baseline)*100 : 0;
    const priceTrig = typeof w.targetPrice==='number' && best.price <= w.targetPrice;
    const discTrig  = typeof w.discountPct==='number' && discount >= (w.discountPct||0);
    const trig = priceTrig || discTrig;
    if (trig && !w.triggered) msg = `${w.title} @ ${best.vendor} → ${fmt(best.price)}`;
    if (trig!==!!w.triggered || w.last!==best.price || w.lastVendor!==best.vendor || w.baseline!==baseline) changed=true;
    return {...w, baseline, last:best.price, lastVendor:best.vendor, triggered:trig};
  });
  if (changed) saveWatches();
  if (msg) toast(msg);
  render();
}

function toast(m){ const t = $('#toast'); t.textContent=m; t.style.display='block'; setTimeout(()=>t.style.display='none', 3500) }

window.addEventListener('DOMContentLoaded', ()=>{
  $('#search').oninput = (e)=>{ query = e.target.value; render() }
  $('#currency').onchange = (e)=>{ currency = e.target.value; render() }
  $('#sort').onchange = (e)=>{ sortBy = e.target.value; render() }
  $('#refreshBtn').onclick = refreshWatches;
  loadData();
});
