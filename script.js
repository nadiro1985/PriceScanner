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
let query       = "";             // current category query
let userCountry = "US";
let maxShipDays = "";
let fx          = { base:"USD", rates:{ USD:1 }, at:0 };
let lang        = localStorage.getItem('ps.lang') || 'en';
let theme       = localStorage.getItem('ps.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

let minPriceVal = null, maxPriceVal = null;

// local keyword filter (client-side only)
let localFilterText = "";

// results store
const offersByVendor = Object.fromEntries(vendorDefs.map(v => [v.name, []]));

// helpers
const $ = sel => document.querySelector(sel);

// === i18n (Translations) ===
const I18N = {
  en: {
    "cash.title": "Earn 2–10% cashback",
    "cash.subtitle": "on eligible purchases via PriceScanner.",
    "cash.learn": "Learn more",
    "cash.howTitle": "How cashback will work",
    "cash.li1": "Register for a free account and get your profile.",
    "cash.li2": "Shop through PriceScanner links. Cashback typically ranges between <b>2–10%</b>.",
    "cash.li3": "Cashback is awarded after delivery is confirmed and no return is made.",
    "cash.li4": "Redeem as cash or apply it to your next payment.",
    "cash.note": "Sign up and payout options will be added here later.",

    "auth.signin": "Sign in",
    "lbl.lang": "Language",
    "lbl.currency": "Currency",

    "hero.tagline": "Deal Fast. Best Price.",
    "hero.sub": "Home security devices.",

    "cat.outdoor": "Outdoor Cameras",
    "cat.indoor": "Indoor Cameras",
    "cat.doorbell": "Video Doorbells",
    "cat.lock": "Smart Locks",
    "cat.alarm": "Alarm & Sensors",
    "cat.accessories": "Accessories",

    "search.placeholder": "search with keywords",
    "hint.selectCategory": "Select a category first.",
    "hint.filteringInside": "Filtering inside: {q}",

    "budget.min": "Min",
    "budget.max": "Max",
    "budget.apply": "Apply",

    "sort.label": "Sort by",
    "sort.priceAsc": "Price: Low to High",
    "sort.priceDesc": "Price: High to Low",
    "sort.rating": "Rating",

    "ship.label": "Max ship days",
    "ship.any": "Any",
    "ship.3": "≤ 3",
    "ship.7": "≤ 7",
    "ship.14": "≤ 14",
    "ship.21": "≤ 21",

    "more": "More results",

    "footer.admin": "Admin",
    "footer.privacy": "Privacy",
    "footer.terms": "Terms",
    "footer.aff": "Affiliate Disclosure",
    "footer.force": "Force update",

    "card.shippingFallback": "Shipping calculated at checkout",
    "card.viewDeal": "View Deal",
    "card.watch": "Watch",

    "toast.selectCategory": "Select a category first.",
    "toast.noMore": "No more results."
  },

  ar: {
    "cash.title": "اكسب كاش باك ٢–١٠٪",
    "cash.subtitle": "على المشتريات المؤهلة عبر PriceScanner.",
    "cash.learn": "اعرف المزيد",
    "cash.howTitle": "كيف سيعمل الكاش باك",
    "cash.li1": "سجّل حسابًا مجانيًا واحصل على ملفك الشخصي.",
    "cash.li2": "تسوّق عبر روابط PriceScanner. عادةً يتراوح الكاش باك بين <b>٢–١٠٪</b>.",
    "cash.li3": "يُمنح الكاش باك بعد تأكيد الاستلام وعدم وجود إرجاع.",
    "cash.li4": "اسحب المبلغ نقدًا أو استخدمه في دفعتك القادمة.",
    "cash.note": "سيتم إضافة خيارات التسجيل والسحب لاحقًا.",

    "auth.signin": "تسجيل الدخول",
    "lbl.lang": "اللغة",
    "lbl.currency": "العملة",

    "hero.tagline": "أسرع صفقة. أفضل سعر.",
    "hero.sub": "أجهزة أمن المنزل.",

    "cat.outdoor": "كاميرات خارجية",
    "cat.indoor": "كاميرات داخلية",
    "cat.doorbell": "جرس باب بالفيديو",
    "cat.lock": "أقفال ذكية",
    "cat.alarm": "إنذار وحساسات",
    "cat.accessories": "ملحقات",

    "search.placeholder": "ابحث بالكلمات",
    "hint.selectCategory": "اختر فئة أولاً.",
    "hint.filteringInside": "تصفية داخل: {q}",

    "budget.min": "الحد الأدنى",
    "budget.max": "الحد الأعلى",
    "budget.apply": "تطبيق",

    "sort.label": "الترتيب حسب",
    "sort.priceAsc": "السعر: من الأقل للأعلى",
    "sort.priceDesc": "السعر: من الأعلى للأقل",
    "sort.rating": "التقييم",

    "ship.label": "أقصى مدة شحن",
    "ship.any": "أي",
    "ship.3": "≤ ٣",
    "ship.7": "≤ ٧",
    "ship.14": "≤ ١٤",
    "ship.21": "≤ ٢١",

    "more": "المزيد من النتائج",

    "footer.admin": "لوحة الإدارة",
    "footer.privacy": "الخصوصية",
    "footer.terms": "الشروط",
    "footer.aff": "إفصاح الأفلييت",
    "footer.force": "تحديث إجباري",

    "card.shippingFallback": "يتم احتساب الشحن عند الدفع",
    "card.viewDeal": "عرض الصفقة",
    "card.watch": "متابعة",

    "toast.selectCategory": "اختر فئة أولاً.",
    "toast.noMore": "لا توجد نتائج إضافية."
  },

  fr: {
    "cash.title": "Gagnez 2–10 % de cashback",
    "cash.subtitle": "sur les achats éligibles via PriceScanner.",
    "cash.learn": "En savoir plus",
    "cash.howTitle": "Comment le cashback fonctionnera",
    "cash.li1": "Créez un compte gratuit et obtenez votre profil.",
    "cash.li2": "Achetez via les liens PriceScanner. Le cashback varie généralement entre <b>2–10 %</b>.",
    "cash.li3": "Le cashback est accordé après confirmation de la livraison et sans retour.",
    "cash.li4": "Retirez en espèces ou appliquez au prochain paiement.",
    "cash.note": "L’inscription et les options de paiement seront ajoutées plus tard.",

    "auth.signin": "Se connecter",
    "lbl.lang": "Langue",
    "lbl.currency": "Devise",

    "hero.tagline": "Offres rapides. Meilleur prix.",
    "hero.sub": "Appareils de sécurité domestique.",

    "cat.outdoor": "Caméras extérieures",
    "cat.indoor": "Caméras intérieures",
    "cat.doorbell": "Sonnettes vidéo",
    "cat.lock": "Serrures intelligentes",
    "cat.alarm": "Alarme & capteurs",
    "cat.accessories": "Accessoires",

    "search.placeholder": "rechercher par mots-clés",
    "hint.selectCategory": "Sélectionnez une catégorie d’abord.",
    "hint.filteringInside": "Filtrage dans : {q}",

    "budget.min": "Min",
    "budget.max": "Max",
    "budget.apply": "Appliquer",

    "sort.label": "Trier par",
    "sort.priceAsc": "Prix : du moins cher au plus cher",
    "sort.priceDesc": "Prix : du plus cher au moins cher",
    "sort.rating": "Note",

    "ship.label": "Jours de livraison max",
    "ship.any": "Tous",
    "ship.3": "≤ 3",
    "ship.7": "≤ 7",
    "ship.14": "≤ 14",
    "ship.21": "≤ 21",

    "more": "Plus de résultats",

    "footer.admin": "Admin",
    "footer.privacy": "Confidentialité",
    "footer.terms": "Conditions",
    "footer.aff": "Divulgation d’affiliation",
    "footer.force": "Forcer la mise à jour",

    "card.shippingFallback": "Frais de livraison calculés à la caisse",
    "card.viewDeal": "Voir l’offre",
    "card.watch": "Suivre",

    "toast.selectCategory": "Sélectionnez une catégorie d’abord.",
    "toast.noMore": "Plus de résultats."
  },

  es: {
    "cash.title": "Gana 2–10% de cashback",
    "cash.subtitle": "en compras elegibles vía PriceScanner.",
    "cash.learn": "Más información",
    "cash.howTitle": "Cómo funcionará el cashback",
    "cash.li1": "Regístrate gratis y obtén tu perfil.",
    "cash.li2": "Compra a través de enlaces de PriceScanner. El cashback suele ser entre <b>2–10%</b>.",
    "cash.li3": "El cashback se otorga tras confirmar la entrega y sin devoluciones.",
    "cash.li4": "Retira en efectivo o aplícalo a tu próximo pago.",
    "cash.note": "El registro y las opciones de cobro se agregarán más adelante.",

    "auth.signin": "Iniciar sesión",
    "lbl.lang": "Idioma",
    "lbl.currency": "Moneda",

    "hero.tagline": "Ofertas rápidas. Mejor precio.",
    "hero.sub": "Dispositivos de seguridad para el hogar.",

    "cat.outdoor": "Cámaras exteriores",
    "cat.indoor": "Cámaras interiores",
    "cat.doorbell": "Timbres con vídeo",
    "cat.lock": "Cerraduras inteligentes",
    "cat.alarm": "Alarma y sensores",
    "cat.accessories": "Accesorios",

    "search.placeholder": "buscar con palabras clave",
    "hint.selectCategory": "Selecciona una categoría primero.",
    "hint.filteringInside": "Filtrando en: {q}",

    "budget.min": "Mín",
    "budget.max": "Máx",
    "budget.apply": "Aplicar",

    "sort.label": "Ordenar por",
    "sort.priceAsc": "Precio: de menor a mayor",
    "sort.priceDesc": "Precio: de mayor a menor",
    "sort.rating": "Valoración",

    "ship.label": "Máx. días de envío",
    "ship.any": "Cualquiera",
    "ship.3": "≤ 3",
    "ship.7": "≤ 7",
    "ship.14": "≤ 14",
    "ship.21": "≤ 21",

    "more": "Más resultados",

    "footer.admin": "Admin",
    "footer.privacy": "Privacidad",
    "footer.terms": "Términos",
    "footer.aff": "Divulgación de afiliados",
    "footer.force": "Forzar actualización",

    "card.shippingFallback": "El envío se calcula al pagar",
    "card.viewDeal": "Ver oferta",
    "card.watch": "Seguir",

    "toast.selectCategory": "Selecciona una categoría primero.",
    "toast.noMore": "No hay más resultados."
  },

  zh: {
    "cash.title": "返现 2–10%",
    "cash.subtitle": "通过 PriceScanner 购买符合条件的商品可返现。",
    "cash.learn": "了解更多",
    "cash.howTitle": "返现如何运作",
    "cash.li1": "注册免费账号并创建个人资料。",
    "cash.li2": "通过 PriceScanner 链接购物。返现通常在 <b>2–10%</b> 之间。",
    "cash.li3": "确认收货且无退货后发放返现。",
    "cash.li4": "可提现吗或用于下次付款。",
    "cash.note": "注册与提现方式会在后续加入。",

    "auth.signin": "登录",
    "lbl.lang": "语言",
    "lbl.currency": "货币",

    "hero.tagline": "快速捡漏。最佳价格。",
    "hero.sub": "家庭安防设备。",

    "cat.outdoor": "室外摄像头",
    "cat.indoor": "室内摄像头",
    "cat.doorbell": "可视门铃",
    "cat.lock": "智能门锁",
    "cat.alarm": "报警与传感器",
    "cat.accessories": "配件",

    "search.placeholder": "输入关键词搜索",
    "hint.selectCategory": "请先选择分类。",
    "hint.filteringInside": "在以下分类内筛选：{q}",

    "budget.min": "最低",
    "budget.max": "最高",
    "budget.apply": "应用",

    "sort.label": "排序",
    "sort.priceAsc": "价格：从低到高",
    "sort.priceDesc": "价格：从高到低",
    "sort.rating": "评分",

    "ship.label": "最长配送天数",
    "ship.any": "不限",
    "ship.3": "≤ 3",
    "ship.7": "≤ 7",
    "ship.14": "≤ 14",
    "ship.21": "≤ 21",

    "more": "更多结果",

    "footer.admin": "管理",
    "footer.privacy": "隐私",
    "footer.terms": "条款",
    "footer.aff": "联盟披露",
    "footer.force": "强制更新",

    "card.shippingFallback": "运费在结算时计算",
    "card.viewDeal": "查看优惠",
    "card.watch": "关注",

    "toast.selectCategory": "请先选择分类。",
    "toast.noMore": "没有更多结果了。"
  }
};

function t(key, vars = {}) {
  const table = I18N[lang] || I18N.en;
  let s = table[key] ?? I18N.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';

  // text content translations (keep HTML if translation contains <b> etc.)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    // Allow simple HTML in translation strings (used in cashback bullet #2)
    if (val.includes('<')) el.innerHTML = val;
    else el.textContent = val;
  });

  // placeholder translations
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', t(key));
  });
}

function localeForLang() {
  if (lang === 'ar') return 'ar';
  if (lang === 'fr') return 'fr-FR';
  if (lang === 'es') return 'es-ES';
  if (lang === 'zh') return 'zh-CN';
  return (currency === 'SGD') ? 'en-SG' : 'en';
}

function fmt(n){
  try{
    return new Intl.NumberFormat(localeForLang(), { style:'currency', currency }).format(n);
  }catch(e){
    return Number(n).toFixed(2);
  }
}

function toast(m){
  const tEl = $('#toast');
  if(!tEl) return;
  tEl.textContent=m;
  tEl.style.display='block';
  setTimeout(()=>tEl.style.display='none',2600);
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
    const d = await r.json();
    const rates=d.rates||{};
    rates.USD=1;
    fx={base:"USD",rates,at:Date.now()};
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
  return HOME_KEYWORDS.some(k => title.includes(k));
}

// loaders
async function loadVendor(vendor, {append=false, page=1}={}){
  const def = vendorDefs.find(v => v.name === vendor);
  if (!def) return;

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

  // de-dup
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
  const grid = $('#grid');
  if(!grid) return;
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
          ${item.shipping && item.shipping !== '—' ? item.shipping : t('card.shippingFallback')}
          ${item.shipTime && item.shipTime !== '—' ? ' • ' + item.shipTime : ''}
        </div>

        <div class="actions">
          <a class="btn btn-primary" href="${outUrl(item)}" target="_blank" rel="sponsored nofollow noopener">${t('card.viewDeal')}</a>
          <button class="btn watchBtn" type="button">${t('card.watch')}</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });

  // More results button
  const moreBtn = $('#moreBtn');
  if (moreBtn) {
    const hasCategory = query.trim().length > 0;
    moreBtn.style.display = hasCategory ? 'inline-flex' : 'none';
    moreBtn.disabled = hasCategory ? (data.length === 0) : true;
    moreBtn.style.opacity = moreBtn.disabled ? '.6' : '1';
    moreBtn.style.pointerEvents = moreBtn.disabled ? 'none' : 'auto';
  }
}

// set active category UI
function setActiveCategory(btn){
  document.querySelectorAll('.catBtn.active').forEach(b=> b.classList.remove('active'));
  if (btn) btn.classList.add('active');
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

  // clear local filter on category change
  localFilterText = "";
  const lf = $('#localFilter');
  if (lf) lf.value = "";

  await loadAll({append:false});
  render();
}

// BOOT
window.addEventListener('DOMContentLoaded', async ()=>{
  // apply language immediately on load
  applyLanguage();

  // theme toggle
  $('#themeToggle')?.addEventListener('click', ()=> applyTheme( (localStorage.getItem('ps.theme')==='dark') ? 'light' : 'dark' ));

  // language/currency/sort/ship
  const selLang=$('#lang');
  if(selLang){
    selLang.value=lang;
    selLang.onchange=()=>{
      lang=selLang.value;
      localStorage.setItem('ps.lang',lang);
      applyLanguage();
      render();
    };
  }
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

  // category buttons
  document.querySelectorAll('.catBtn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      setActiveCategory(btn);
      const q = btn.getAttribute('data-q') || '';
      await runCategorySearch(q);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // More results
  $('#moreBtn')?.addEventListener('click', async ()=>{
    if (!query.trim()) { toast(t('toast.selectCategory')); return; }

    vendorDefs.filter(v=>v.live).forEach(v => vendorPages[v.name] = (vendorPages[v.name]||1) + 1);

    const before = currentResults().length;
    await loadAll({append:true});
    const after = currentResults().length;
    render();

    if (after === before) {
      toast(t('toast.noMore'));
      const mb = $('#moreBtn');
      mb.disabled = true;
      mb.style.opacity = '.6';
      mb.style.pointerEvents = 'none';
    }
  });

  // FX
  await loadRates();  // ✅ Landing page override (SEO pages set window.PS_LANDING_QUERY)
  const landingQ = (window.PS_LANDING_QUERY || "").trim();

  if (landingQ) {
    await runCategorySearch(landingQ);
  } else {
    // Default category on homepage load
    const defaultCategory = "outdoor security camera";
    const firstBtn = document.querySelector(`.catBtn[data-q="${defaultCategory}"]`);
    setActiveCategory(firstBtn);
    await runCategorySearch(defaultCategory);
  }
});
