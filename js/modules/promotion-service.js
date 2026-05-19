/* 中文備註：商用促銷 / 廣告模板服務（Sunmi T2 Android 7.1.1 相容）。
 * 設計目標：
 *   1. POS 主機可在設定頁套用促銷模板，並隨菜單同步到 Firebase。
 *   2. 線上點餐頁只顯示啟用且在有效期間內的廣告橫幅 / 優惠碼。
 *   3. 折扣計算集中在此檔，POS 接單時仍會重新計價，避免信任顧客端金額。
 */
import { state, persistAll } from '../core/store.js';

function nowMs(){ return Date.now(); }
function toMs(v){
  if(!v) return 0;
  var t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}
function cleanText(v, max){ return String(v || '').trim().slice(0, max || 120); }
function cleanCode(v){ return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24); }
function asMoney(v){ return Math.max(0, Math.round(Number(v || 0))); }
function uid(prefix){ return (prefix || 'promo') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

const TEMPLATE_MAP = {
  lunch: {
    name: '午餐尖峰模板（快速出餐）',
    heroTitle: '今日午餐快速點',
    heroSubtitle: '熱門餐點、外帶自取，送單後等待店家確認。',
    heroBadge: '午餐限定',
    theme: 'orange',
    campaignType: 'limited_time',
    coupon: { code: 'LUNCH20', type: 'amount', value: 20, minSpend: 150, title: '滿 150 折 20' }
  },
  holiday: {
    name: '節慶活動模板（期間限定）',
    heroTitle: '節慶限定供應',
    heroSubtitle: '精選套餐與人氣品項限時供應，數量有限售完為止。',
    heroBadge: '限時活動',
    theme: 'red',
    campaignType: 'seasonal',
    coupon: { code: 'HAPPY10', type: 'percent', value: 10, minSpend: 300, title: '滿 300 享 9 折' }
  },
  family: {
    name: '家庭套餐模板（組合推薦）',
    heroTitle: '多人分享套餐推薦',
    heroSubtitle: '家庭聚餐、公司訂餐可先線上送單，現場快速取餐。',
    heroBadge: '套餐推薦',
    theme: 'green',
    campaignType: 'bundle',
    coupon: { code: 'FAMILY50', type: 'amount', value: 50, minSpend: 500, title: '滿 500 折 50' }
  },
  delivery: {
    name: '外帶外送模板（預點免等）',
    heroTitle: '外帶自取免等待',
    heroSubtitle: '先線上點餐，店家確認備餐時間後再出發。',
    heroBadge: '線上預點',
    theme: 'blue',
    campaignType: 'convenience',
    coupon: { code: 'TAKE30', type: 'amount', value: 30, minSpend: 250, title: '滿 250 折 30' }
  },
  new_item: {
    name: '新品上市模板（不一定折扣）',
    heroTitle: '新品上市，歡迎嚐鮮',
    heroSubtitle: '本週主打新品已開放線上預點，現點現做、售完為止。',
    heroBadge: '新品推薦',
    theme: 'orange',
    campaignType: 'new_product',
    coupon: null
  },
  loyalty: {
    name: '會員集點模板（回訪獎勵）',
    heroTitle: '會員集點活動進行中',
    heroSubtitle: '點餐時備註會員電話，集點、兌換與回訪禮由門市確認。',
    heroBadge: '會員專屬',
    theme: 'green',
    campaignType: 'loyalty',
    coupon: null
  },
  gift: {
    name: '贈品活動模板（買餐送小禮）',
    heroTitle: '限定贈品活動',
    heroSubtitle: '指定餐點或套餐可享店家準備的小贈品，數量有限送完為止。',
    heroBadge: '贈品活動',
    theme: 'red',
    campaignType: 'gift_with_purchase',
    coupon: null
  },
  preorder: {
    name: '預購預約模板（尖峰分流）',
    heroTitle: '尖峰時段先預約',
    heroSubtitle: '先線上送單並填寫取餐時間，店家確認後再前往取餐。',
    heroBadge: '預約點餐',
    theme: 'blue',
    campaignType: 'preorder',
    coupon: null
  },
  social: {
    name: '社群互動模板（打卡分享）',
    heroTitle: '打卡分享活動',
    heroSubtitle: '到店出示分享或評論畫面，可依現場活動規則領取小禮。',
    heroBadge: '社群活動',
    theme: 'orange',
    campaignType: 'social',
    coupon: null
  }
};

const DEFAULT_PROMOTIONS = {
  enabled: true,
  activeTemplate: 'lunch',
  heroTitle: TEMPLATE_MAP.lunch.heroTitle,
  heroSubtitle: TEMPLATE_MAP.lunch.heroSubtitle,
  heroBadge: TEMPLATE_MAP.lunch.heroBadge,
  theme: TEMPLATE_MAP.lunch.theme,
  campaignType: TEMPLATE_MAP.lunch.campaignType,
  banners: [
    {
      id: 'banner_lunch_default',
      enabled: true,
      title: TEMPLATE_MAP.lunch.heroTitle,
      subtitle: TEMPLATE_MAP.lunch.heroSubtitle,
      badge: TEMPLATE_MAP.lunch.heroBadge,
      theme: TEMPLATE_MAP.lunch.theme,
      campaignType: TEMPLATE_MAP.lunch.campaignType,
      sortOrder: 1,
      startsAt: '',
      endsAt: ''
    }
  ],
  coupons: [
    {
      id: 'coupon_lunch20_default',
      enabled: true,
      code: TEMPLATE_MAP.lunch.coupon.code,
      title: TEMPLATE_MAP.lunch.coupon.title,
      type: TEMPLATE_MAP.lunch.coupon.type,
      value: TEMPLATE_MAP.lunch.coupon.value,
      minSpend: TEMPLATE_MAP.lunch.coupon.minSpend,
      startsAt: '',
      endsAt: ''
    }
  ],
  updatedAt: ''
};

export function getPromotionTemplates(){
  return Object.keys(TEMPLATE_MAP).map(function(key){ return { key: key, name: TEMPLATE_MAP[key].name }; });
}

function cloneDefault(){ return JSON.parse(JSON.stringify(DEFAULT_PROMOTIONS)); }
function hasOwn(obj, key){ return !!(obj && Object.prototype.hasOwnProperty.call(obj, key)); }
function cleanOptionalText(obj, key, fallback, max){
  if(hasOwn(obj, key)) return cleanText(obj[key], max);
  return cleanText(fallback, max);
}

export function ensurePromotionsConfig(){
  if(!state.settings) state.settings = {};
  if(!state.settings.promotions || typeof state.settings.promotions !== 'object'){
    state.settings.promotions = cloneDefault();
  }
  var cfg = state.settings.promotions;
  if(typeof cfg.enabled !== 'boolean') cfg.enabled = true;
  if(!Array.isArray(cfg.banners)) cfg.banners = cloneDefault().banners;
  if(!Array.isArray(cfg.coupons)) cfg.coupons = cloneDefault().coupons;
  cfg.heroTitle = hasOwn(cfg, 'heroTitle') ? cleanText(cfg.heroTitle, 80) : DEFAULT_PROMOTIONS.heroTitle;
  cfg.heroSubtitle = hasOwn(cfg, 'heroSubtitle') ? cleanText(cfg.heroSubtitle, 160) : DEFAULT_PROMOTIONS.heroSubtitle;
  cfg.heroBadge = cleanText(cfg.heroBadge || DEFAULT_PROMOTIONS.heroBadge, 24);
  cfg.theme = cleanText(cfg.theme || DEFAULT_PROMOTIONS.theme, 20);
  cfg.campaignType = cleanText(cfg.campaignType || DEFAULT_PROMOTIONS.campaignType || '', 32);
  return cfg;
}

export function normalizePromotionsConfig(input){
  var base = cloneDefault();
  var src = input && typeof input === 'object' ? input : base;
  var out = {
    enabled: src.enabled !== false,
    activeTemplate: cleanText(src.activeTemplate || base.activeTemplate, 32),
    heroTitle: cleanOptionalText(src, 'heroTitle', base.heroTitle, 80),
    heroSubtitle: cleanOptionalText(src, 'heroSubtitle', base.heroSubtitle, 160),
    heroBadge: cleanText(src.heroBadge || base.heroBadge, 24),
    theme: cleanText(src.theme || base.theme, 20),
    campaignType: cleanText(src.campaignType || base.campaignType || '', 32),
    banners: [],
    coupons: [],
    updatedAt: cleanText(src.updatedAt || '', 40)
  };
  (Array.isArray(src.banners) ? src.banners : []).slice(0, 8).forEach(function(b, i){
    if(!b) return;
    out.banners.push({
      id: cleanText(b.id || uid('banner'), 48),
      enabled: b.enabled !== false,
      title: cleanOptionalText(b, 'title', out.heroTitle, 80),
      subtitle: cleanOptionalText(b, 'subtitle', out.heroSubtitle, 160),
      badge: cleanText(b.badge || out.heroBadge, 24),
      theme: cleanText(b.theme || out.theme, 20),
      campaignType: cleanText(b.campaignType || out.campaignType || '', 32),
      sortOrder: Number(b.sortOrder || (i + 1)),
      startsAt: cleanText(b.startsAt || '', 40),
      endsAt: cleanText(b.endsAt || '', 40)
    });
  });
  (Array.isArray(src.coupons) ? src.coupons : []).slice(0, 12).forEach(function(c){
    if(!c) return;
    var type = String(c.type || 'amount');
    if(['amount','percent'].indexOf(type) < 0) type = 'amount';
    var code = cleanCode(c.code);
    if(!code) return;
    out.coupons.push({
      id: cleanText(c.id || uid('coupon'), 48),
      enabled: c.enabled !== false,
      code: code,
      title: cleanText(c.title || code, 80),
      type: type,
      value: asMoney(c.value),
      minSpend: asMoney(c.minSpend),
      startsAt: cleanText(c.startsAt || '', 40),
      endsAt: cleanText(c.endsAt || '', 40)
    });
  });
  if(!out.banners.length && !hasOwn(src, 'banners')) out.banners = base.banners;
  return out;
}

export function setPromotionsConfig(input, shouldPersist){
  if(!state.settings) state.settings = {};
  var cfg = normalizePromotionsConfig(input);
  cfg.updatedAt = new Date().toISOString();
  state.settings.promotions = cfg;
  if(shouldPersist !== false) persistAll();
  return cfg;
}

export function applyPromotionTemplate(templateKey){
  var t = TEMPLATE_MAP[templateKey] || TEMPLATE_MAP.lunch;
  var cfg = ensurePromotionsConfig();
  cfg.activeTemplate = templateKey || 'lunch';
  cfg.enabled = true;
  cfg.heroTitle = t.heroTitle;
  cfg.heroSubtitle = t.heroSubtitle;
  cfg.heroBadge = t.heroBadge;
  cfg.theme = t.theme;
  cfg.campaignType = t.campaignType || '';
  cfg.banners = [{
    id: 'banner_' + (templateKey || 'lunch'),
    enabled: true,
    title: t.heroTitle,
    subtitle: t.heroSubtitle,
    badge: t.heroBadge,
    theme: t.theme,
    campaignType: t.campaignType || '',
    sortOrder: 1,
    startsAt: '',
    endsAt: ''
  }];
  cfg.coupons = t.coupon ? [{
    id: 'coupon_' + t.coupon.code.toLowerCase(),
    enabled: true,
    code: t.coupon.code,
    title: t.coupon.title,
    type: t.coupon.type,
    value: t.coupon.value,
    minSpend: t.coupon.minSpend,
    startsAt: '',
    endsAt: ''
  }] : [];
  return setPromotionsConfig(cfg, true);
}

function isActiveWindow(row){
  if(!row || row.enabled === false) return false;
  var n = nowMs();
  var s = toMs(row.startsAt);
  var e = toMs(row.endsAt);
  if(s && n < s) return false;
  if(e && n > e) return false;
  return true;
}

export function getPublicPromotionsConfig(){
  var cfg = ensurePromotionsConfig();
  if(!cfg.enabled){
    return { enabled: false, banners: [], coupons: [], updatedAt: cfg.updatedAt || '' };
  }
  return {
    enabled: true,
    heroTitle: cfg.heroTitle,
    heroSubtitle: cfg.heroSubtitle,
    heroBadge: cfg.heroBadge,
    theme: cfg.theme,
    campaignType: cfg.campaignType || '',
    banners: cfg.banners.filter(isActiveWindow).sort(function(a,b){ return Number(a.sortOrder || 0) - Number(b.sortOrder || 0); }),
    coupons: cfg.coupons.filter(isActiveWindow).map(function(c){
      return { code: c.code, title: c.title, type: c.type, value: c.value, minSpend: c.minSpend };
    }),
    updatedAt: cfg.updatedAt || ''
  };
}

export function importPromotionsFromCloud(data){
  if(!data || typeof data !== 'object') return;
  state.settings = state.settings || {};
  state.settings.promotions = normalizePromotionsConfig(data);
}

export function cartSubtotal(cart){
  return (Array.isArray(cart) ? cart : []).reduce(function(sum, item){
    return sum + (Number(item.basePrice || 0) + Number(item.extraPrice || 0)) * Math.max(1, Number(item.qty || 1));
  }, 0);
}

export function findCoupon(code){
  var cfg = ensurePromotionsConfig();
  if(!cfg.enabled) return null;
  var target = cleanCode(code);
  if(!target) return null;
  var list = cfg.coupons || [];
  for(var i = 0; i < list.length; i++){
    var c = list[i];
    if(c && c.enabled !== false && cleanCode(c.code) === target && isActiveWindow(c)) return c;
  }
  return null;
}

export function calculatePromotion(cart, code){
  var subtotal = cartSubtotal(cart);
  var coupon = findCoupon(code);
  if(!coupon){
    return { ok: false, code: cleanCode(code), title: '', subtotal: subtotal, discount: 0, total: subtotal, message: code ? '優惠碼不存在或未啟用' : '' };
  }
  if(subtotal < Number(coupon.minSpend || 0)){
    return { ok: false, code: coupon.code, title: coupon.title, subtotal: subtotal, discount: 0, total: subtotal, message: '未達最低消費 ' + Number(coupon.minSpend || 0) };
  }
  var discount = 0;
  if(coupon.type === 'percent'){
    discount = Math.floor(subtotal * Math.min(100, Number(coupon.value || 0)) / 100);
  }else{
    discount = Number(coupon.value || 0);
  }
  discount = Math.max(0, Math.min(subtotal, Math.round(discount)));
  return { ok: true, code: coupon.code, title: coupon.title, type: coupon.type, value: Number(coupon.value || 0), subtotal: subtotal, discount: discount, total: subtotal - discount, message: '已套用：' + coupon.title };
}

export function buildPromotionSummaryForDashboard(){
  var cfg = ensurePromotionsConfig();
  var pub = getPublicPromotionsConfig();
  return {
    enabled: cfg.enabled !== false,
    activeTemplate: cfg.activeTemplate || '',
    bannerCount: pub.banners.length,
    couponCount: pub.coupons.length,
    campaignType: cfg.campaignType || '',
    coupons: pub.coupons.map(function(c){ return { code: c.code, title: c.title, minSpend: c.minSpend }; }),
    updatedAt: cfg.updatedAt || ''
  };
}

// ====================================================================
// 雲端同步（給多裝置共用）
// 寫到 publicOnlineStores/{storeCode}/promotions，線上點餐頁可不登入讀取
// ====================================================================

const FIREBASE_BASE_PROMO = 'https://www.gstatic.com/firebasejs/10.12.2';
let _promoCloudApp = null;
let _promoCloudDb = null;
let _promoCloudInit = false;

async function _initPromoCloud(){
  if(_promoCloudInit) return _promoCloudDb;
  try{
    const cfg = (state.settings && state.settings.realtimeOrder) || {};
    if(!cfg.apiKey || !cfg.databaseURL || !cfg.projectId || !cfg.appId){
      console.warn('[promotion-cloud] Firebase 設定不完整，略過雲端同步');
      return null;
    }
    const appMod = await import(`${FIREBASE_BASE_PROMO}/firebase-app.js`);
    const dbMod = await import(`${FIREBASE_BASE_PROMO}/firebase-database.js`);
    // 共用既有 app（避免重複 init）
    let app;
    try{
      app = appMod.getApp();
    }catch(e){
      app = appMod.initializeApp({
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain || undefined,
        databaseURL: cfg.databaseURL,
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket || undefined,
        messagingSenderId: cfg.messagingSenderId || undefined,
        appId: cfg.appId
      });
    }
    _promoCloudApp = app;
    _promoCloudDb = dbMod.getDatabase(app);
    _promoCloudDb.__api = dbMod;
    _promoCloudInit = true;
    return _promoCloudDb;
  }catch(err){
    console.warn('[promotion-cloud] 初始化失敗：', err);
    return null;
  }
}

function _resolveStoreCode(){
  // 優先用 dashboard.storeId（POS 端），再 fallback URL ?storeId=（顧客端）
  var code = String(state.settings && state.settings.dashboard && state.settings.dashboard.storeId || '').trim();
  if(!code){
    try{
      const params = new URLSearchParams(window.location.search);
      code = String(params.get('storeId') || params.get('storeCode') || '').trim();
    }catch(e){}
  }
  if(/[.#$\/\[\]]/.test(code)) return '';
  return code;
}

/**
 * POS 端：把目前促銷設定推到 publicOnlineStores/{storeCode}/promotions
 * 設定頁按「儲存」時呼叫。
 */
export async function pushPromotionsToCloud(){
  const code = _resolveStoreCode();
  if(!code){
    console.warn('[promotion-cloud] 無 storeCode，略過 push');
    return { ok: false, reason: 'no-store-code' };
  }
  const db = await _initPromoCloud();
  if(!db) return { ok: false, reason: 'no-firebase' };
  try{
    const cfg = getPublicPromotionsConfig();
    const payload = {
      enabled: !!cfg.enabled,
      heroTitle: cfg.heroTitle || '',
      heroSubtitle: cfg.heroSubtitle || '',
      heroBadge: cfg.heroBadge || '',
      theme: cfg.theme || 'orange',
      campaignType: cfg.campaignType || '',
      banners: Array.isArray(cfg.banners) ? cfg.banners : [],
      coupons: Array.isArray(cfg.coupons) ? cfg.coupons : [],
      updatedAt: new Date().toISOString()
    };
    const api = db.__api;
    const refPath = `publicOnlineStores/${code}/promotions`;
    await api.set(api.ref(db, refPath), payload);
    console.log('[promotion-cloud] ✅ 已推送至', refPath);
    return { ok: true, path: refPath };
  }catch(err){
    console.warn('[promotion-cloud] push 失敗：', err);
    return { ok: false, reason: String(err && err.message || err) };
  }
}

/**
 * 顧客端：從雲端讀取本店促銷設定並寫入 state.settings.promotions
 * 不會 persistAll（避免污染顧客本機 IndexedDB）
 */
export async function pullPromotionsFromCloud(storeCode){
  const code = String(storeCode || _resolveStoreCode() || '').trim();
  if(!code) return { ok: false, reason: 'no-store-code' };
  const db = await _initPromoCloud();
  if(!db) return { ok: false, reason: 'no-firebase' };
  try{
    const api = db.__api;
    const snap = await api.get(api.ref(db, `publicOnlineStores/${code}/promotions`));
    if(!snap.exists()) return { ok: false, reason: 'no-data' };
    const data = snap.val();
    if(!state.settings) state.settings = {};
    state.settings.promotions = normalizePromotionsConfig(data);
    console.log('[promotion-cloud] ✅ 已從雲端載入促銷設定');
    return { ok: true, data: data };
  }catch(err){
    console.warn('[promotion-cloud] pull 失敗：', err);
    return { ok: false, reason: String(err && err.message || err) };
  }
}

// 暴露給瀏覽器 console 方便手動測試
if(typeof window !== 'undefined'){
  window.__pushPromotions = pushPromotionsToCloud;
  window.__pullPromotions = pullPromotionsFromCloud;
}
