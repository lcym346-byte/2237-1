/* 中文備註：核心狀態管理 store。v20260608 升級。
 * 本版新增：
 *   - IndexedDB 主儲存（資料庫 restaurantPosDB / store kvStore）
 *   - localStorage 雙寫快取（同步讀寫、保留相容）
 *   - 啟動時優先讀 IndexedDB，若無則 fallback localStorage 並自動遷移
 *   - state.settings.store：{ storeId, storeName, boundAt } 店家綁定
 *   - 啟動時讀 URL 參數 ?storeId=xxx&storeName=yyy 自動綁定
 *   - 已綁定則忽略 URL（防誤改），可呼叫 state.rebindStore() 重綁
 *   - 預設 store001 / 測試店（與看板測試店一致）
 * 既有功能保留：
 *   - state.customers：顧客主檔
 *   - state.settings.printConfig.fields：列印欄位勾選
 *   - state.settings.printConfig.openDrawer：列印後開錢箱
 *   - state.settings.lastCleanupAt：90 天訂單清理節流時戳
 *   - state.customerLookupRateLimit：顧客自助查單 30 秒節流
 *   - exportAllData / importAllData / seedDemoData
 */

const DEFAULT_CATEGORIES = ['未分類','主餐','炸物','飲料','小菜','套餐','甜點'];

const DEFAULT_MODULES = [
  { name:'甜度', options:[
    { name:'正常甜', price:0 },
    { name:'半糖', price:0 },
    { name:'微糖', price:0 },
    { name:'無糖', price:0 }
  ] },
  { name:'冰量', options:[
    { name:'正常冰', price:0 },
    { name:'少冰', price:0 },
    { name:'去冰', price:0 }
  ] },
  { name:'辣度', options:[
    { name:'不辣', price:0 },
    { name:'小辣', price:0 },
    { name:'中辣', price:0 },
    { name:'大辣', price:0 }
  ] },
  { name:'灑粉', options:[
    { name:'胡椒粉', price:0 },
    { name:'梅粉', price:5 },
    { name:'海苔粉', price:5 }
  ] }
];

const DEFAULT_PRODUCTS = [
  { name:'雞排', price:70, category:'炸物', _modNames:['辣度','灑粉'] },
  { name:'薯條', price:50, category:'炸物', _modNames:['灑粉'] },
  { name:'紅茶', price:30, category:'飲料', _modNames:['甜度','冰量'] }
];

const DEFAULT_BUSINESS_HOURS = {
  mon: [{start:'11:00', end:'21:00'}],
  tue: [{start:'11:00', end:'21:00'}],
  wed: [{start:'11:00', end:'21:00'}],
  thu: [{start:'11:00', end:'21:00'}],
  fri: [{start:'11:00', end:'21:00'}],
  sat: [{start:'11:00', end:'21:00'}],
  sun: []
};

const DEFAULT_PRINT_FIELDS = {
  receipt: {
    storeName: true, storePhone: true, storeAddress: true,
    orderNo: true, dateTime: true, orderType: true, customerInfo: true,
    items: true, itemPrice: true, itemQty: true, itemNote: true,
    subtotal: true, discount: true, total: true,
    paymentMethod: true, orderNote: true, footer: true
  },
  kitchen: {
    storeName: true, orderNo: true, dateTime: true, orderType: true,
    customerInfo: false,
    items: true, itemQty: true, itemNote: true, orderNote: true
  },
  label: {
    storeName: true, orderNo: true, dateTime: true, orderType: true,
    customerInfo: false,
    items: true, itemQty: true, itemNote: true
  }
};

const DEFAULT_PRINT_CONFIG = {
  storeName: '大王雞脆皮炸雞',
  storePhone: '',
  storeAddress: '',
  receiptFooter: '謝謝光臨',
  receiptPaperWidth: 58,
  labelPaperWidth: 60,
  labelPaperHeight: 40,
  receiptFontSize: 12,
  labelFontSize: 12,
  receiptOffsetX: 0,
  receiptOffsetY: 0,
  labelOffsetX: 0,
  labelOffsetY: 0,
  kitchenCopies: 1,
  autoPrintCheckout: false,
  autoPrintKitchen: false,
  openDrawer: true,
  fields: DEFAULT_PRINT_FIELDS
};

// ── 預設店家設定 ──
const DEFAULT_STORE_BINDING = {
  storeId: 'store001',
  storeName: '測試店',
  boundAt: ''
};

// ── 工具：normalize ──
function rid(){ return Math.random().toString(36).slice(2,10); }

function normalizeModules(modules){
  return (modules || []).map(m => ({
    id: m.id || rid(),
    name: m.name || '未命名模組',
    selection: m.selection === 'multi' ? 'multi' : 'single',
    required: !!m.required,
    options: (m.options || []).map(o => ({
      id: o.id || rid(),
      name: o.name || '',
      price: Number(o.price || 0),
      enabled: o.enabled !== false
    }))
  }));
}

function normalizeProducts(products, modulesRef){
  const modulesArr = Array.isArray(modulesRef) ? modulesRef : [];
  const nameToId = {};
  modulesArr.forEach(m => { if (m && m.name) nameToId[m.name] = m.id; });

  return (products || []).map(p => {
    let mods = [];
    if (Array.isArray(p.modules)) {
      p.modules.forEach(item => {
        if (!item) return;
        if (typeof item === 'string') {
          const mid = nameToId[item];
          if (mid) mods.push({ moduleId: mid, requiredOverride: null });
        } else if (typeof item === 'object') {
          if (item.moduleId) {
            mods.push({
              moduleId: item.moduleId,
              requiredOverride: typeof item.requiredOverride === 'boolean' ? item.requiredOverride : null
            });
          } else if (item.name) {
            const mid = nameToId[item.name];
            if (mid) mods.push({ moduleId: mid, requiredOverride: null });
          }
        }
      });
    }
    return {
      id: p.id || rid(),
      name: p.name || '',
      price: Number(p.price || 0),
      category: p.category || '未分類',
      image: p.image || '',
      enabled: p.enabled !== false,
      soldOut: p.soldOut === true,
      sortOrder: Number(p.sortOrder || 0),
      modules: mods
    };
  });
}

function deepMerge(target, source){
  if (!source || typeof source !== 'object') return target;
  Object.keys(source).forEach(k => {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  });
  return target;
}

// ─────────────────────────────────────────────
// IndexedDB 極簡 wrapper（v20260608 新增）
// 資料庫名稱：restaurantPosDB；唯一 store：kvStore（key-value）
// 不依賴外部套件，原生 IndexedDB API
// ─────────────────────────────────────────────
const IDB_NAME = 'restaurantPosDB';
const IDB_STORE = 'kvStore';
const IDB_KEY = 'posState';
let _idbPromise = null;

function idbOpen(){
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return _idbPromise;
}

async function idbGet(key){
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('idbGet failed:', e);
    return null;
  }
}

async function idbSet(key, value){
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('idbSet failed:', e);
    return false;
  }
}

// ── 同步快取（持有最近一次的 IndexedDB 內容字串副本），開機後由 hydrate 填入 ──
let _idbCacheRaw = null;

// ── localStorage 鍵 ──
const LS_KEY = 'restaurantPosState_v2';

// ── 同步讀（給 hydrateState 用，先 localStorage，再期待後續 async hydrate 補 IndexedDB）──
function loadPersistedSync(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('loadPersistedSync failed:', e);
    return null;
  }
}

function buildDefaultState(){
  const modules = normalizeModules(DEFAULT_MODULES);
  const nameToId = {};
  modules.forEach(m => { nameToId[m.name] = m.id; });
  const productsRaw = DEFAULT_PRODUCTS.map(p => ({
    ...p,
    modules: (p._modNames||[]).map(n => nameToId[n]).filter(Boolean).map(mid => ({moduleId: mid, requiredOverride: null}))
  }));
  const products = normalizeProducts(productsRaw, modules);
  return {
    categories: [...DEFAULT_CATEGORIES],
    modules,
    products,
    pendingProducts: [],
    cart: [],
    orders: [],
    onlineIncomingOrders: [],
    customers: {},
    customerLookupRateLimit: {},
    editingOrderId: null,
    viewReportOrders: null,
    editModules: [],
    settings: {
      printConfig: JSON.parse(JSON.stringify(DEFAULT_PRINT_CONFIG)),
      discountType: 'amount',
      selectedCategory: '全部',
      showProductImages: true,
      lastCleanupAt: '',
      store: JSON.parse(JSON.stringify(DEFAULT_STORE_BINDING)),  // v20260608 新增
      realtimeOrder: {
        enabled: true,
        deviceRole: 'master',
        apiKey: '', authDomain: '', databaseURL: '',
        projectId: '', storageBucket: '',
        messagingSenderId: '', appId: '', measurementId: '',
        onlineStoreTitle: '',
        onlineStoreSubtitle: '',
        autoPrintKitchenOnConfirm: true,
        autoPrintReceiptOnConfirm: true,
        incomingSoundEnabled: true,
        lastSyncStatus: '尚未啟用',
        lastOrderAt: '',
        lastConfirmedAt: ''
      },
      googleDriveBackup: {
        clientId: '',
        folderId: '',
        autoBackupEnabled: false,
        autoBackupMinutes: 60,
        lastBackupAt: '',
        lastRestoreAt: '',
        lastBackupStatus: '尚未備份',
        lastRestoreStatus: '尚未還原'
      },
      businessHours: JSON.parse(JSON.stringify(DEFAULT_BUSINESS_HOURS))
    },
    reports: {
      currentSession: null,
      sessions: [],
      savedSnapshots: []
    }
  };
}

// ── 套用 hydrate 資料到 state（共用給 sync / async 兩條路徑）──
function applyHydrate(saved){
  if (!saved) return;
  try {
    if (Array.isArray(saved.categories)) {
      state.categories = saved.categories.includes('未分類') ? saved.categories : ['未分類', ...saved.categories];
    }
    if (Array.isArray(saved.modules)) state.modules = normalizeModules(saved.modules);
    if (Array.isArray(saved.products)) state.products = normalizeProducts(saved.products, state.modules);
    if (Array.isArray(saved.pendingProducts)) state.pendingProducts = saved.pendingProducts;
    if (Array.isArray(saved.cart)) state.cart = saved.cart;
    if (Array.isArray(saved.orders)) state.orders = saved.orders;
    if (saved.customers && typeof saved.customers === 'object') state.customers = saved.customers;

    if (saved.settings && typeof saved.settings === 'object') {
      try {
        deepMerge(state.settings, saved.settings);
      } catch (e) {
        console.error('deepMerge settings failed, keeping defaults:', e);
      }
      if (!state.settings.printConfig) state.settings.printConfig = {};
      if (!state.settings.printConfig.fields) {
        state.settings.printConfig.fields = JSON.parse(JSON.stringify(DEFAULT_PRINT_FIELDS));
      } else {
        ['receipt','kitchen','label'].forEach(kind => {
          if (!state.settings.printConfig.fields[kind]) {
            state.settings.printConfig.fields[kind] = JSON.parse(JSON.stringify(DEFAULT_PRINT_FIELDS[kind]));
          } else {
            Object.keys(DEFAULT_PRINT_FIELDS[kind]).forEach(f => {
              if (typeof state.settings.printConfig.fields[kind][f] === 'undefined') {
                state.settings.printConfig.fields[kind][f] = DEFAULT_PRINT_FIELDS[kind][f];
              }
            });
          }
        });
      }
      if (typeof state.settings.printConfig.openDrawer === 'undefined') {
        state.settings.printConfig.openDrawer = true;
      }
      if (!state.settings.businessHours || typeof state.settings.businessHours !== 'object') {
        state.settings.businessHours = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_HOURS));
      } else {
        ['mon','tue','wed','thu','fri','sat','sun'].forEach(function(k){
          if (!Array.isArray(state.settings.businessHours[k])) {
            state.settings.businessHours[k] = [];
          }
        });
      }
      // v20260608：補 store 預設
      if (!state.settings.store || typeof state.settings.store !== 'object') {
        state.settings.store = JSON.parse(JSON.stringify(DEFAULT_STORE_BINDING));
      } else {
        if (!state.settings.store.storeId) state.settings.store.storeId = DEFAULT_STORE_BINDING.storeId;
        if (!state.settings.store.storeName) state.settings.store.storeName = DEFAULT_STORE_BINDING.storeName;
        if (typeof state.settings.store.boundAt === 'undefined') state.settings.store.boundAt = '';
      }
    }

    if (saved.reports && typeof saved.reports === 'object') {
      state.reports = {
        currentSession: saved.reports.currentSession || null,
        sessions: Array.isArray(saved.reports.sessions) ? saved.reports.sessions : [],
        savedSnapshots: Array.isArray(saved.reports.savedSnapshots) ? saved.reports.savedSnapshots : []
      };
    }
  } catch (e) {
    console.error('applyHydrate failed:', e);
  }
}

// ── 解析 URL 參數綁定店家（v20260608 新增）──
function applyStoreBindingFromUrl(){
  try {
    const params = new URLSearchParams(location.search);
    const urlStoreId = (params.get('storeId') || '').trim();
    const urlStoreName = (params.get('storeName') || '').trim();
    if (!urlStoreId) return false;

    const cur = state.settings.store || {};
    // 若 IndexedDB / localStorage 已有綁定（boundAt 非空且 storeId 已設），忽略 URL（防誤改）
    if (cur.boundAt && cur.storeId && cur.storeId !== DEFAULT_STORE_BINDING.storeId) {
      console.log('[store] 已綁定 store=' + cur.storeId + '，URL 參數忽略');
      return false;
    }
    state.settings.store = {
      storeId: urlStoreId,
      storeName: urlStoreName || urlStoreId,
      boundAt: new Date().toISOString()
    };
    console.log('[store] 由 URL 綁定店家 →', state.settings.store);
    return true;
  } catch (e) {
    console.error('applyStoreBindingFromUrl failed:', e);
    return false;
  }
}

// ── 建立 state（先 export 空物件，再用 try/catch 填內容）──
export const state = buildDefaultState();

(function hydrateState(){
  // 第一輪：同步讀 localStorage（避免畫面 flash 預設資料）
  let saved = null;
  try { saved = loadPersistedSync(); } catch (e) { console.error('loadPersistedSync exception:', e); }
  if (saved) applyHydrate(saved);

  // 第一次套用 URL 綁定（若 localStorage 沒綁定）
  const boundByUrlSync = applyStoreBindingFromUrl();
  if (boundByUrlSync) {
    // 立即寫回 localStorage（IndexedDB 由 async 路徑寫）
    try {
      const toSave = collectStateForPersist();
      localStorage.setItem(LS_KEY, JSON.stringify(toSave));
    } catch (e) {}
  }

  // 第二輪：async 讀 IndexedDB，若資料較新則覆寫
  idbGet(IDB_KEY).then(idbData => {
    try {
      _idbCacheRaw = idbData || null;
      if (idbData && typeof idbData === 'object') {
        // IndexedDB 有資料 → 套用（覆蓋 localStorage 結果）
        applyHydrate(idbData);
        // 重新套用 URL 綁定（若 IDB 也無有效綁定）
        applyStoreBindingFromUrl();
        // 通知 UI 重新渲染（若有掛載）
        try { window.dispatchEvent(new CustomEvent('pos-state-hydrated', { detail: { source: 'idb' } })); } catch (e) {}
        console.log('[store] IndexedDB 載入完成，orders=' + (state.orders||[]).length + ' sessions=' + ((state.reports||{}).sessions||[]).length);
      } else if (saved) {
        // IndexedDB 沒資料但 localStorage 有 → 自動遷移到 IndexedDB
        const migrate = collectStateForPersist();
        idbSet(IDB_KEY, migrate).then(() => {
          console.log('[store] 已從 localStorage 自動遷移至 IndexedDB');
        });
      }
    } catch (e) {
      console.error('IndexedDB hydrate failed:', e);
    }
  });
})();

// ── 收集 state 供持久化 ──
function collectStateForPersist(){
  return {
    categories: state.categories,
    modules: state.modules,
    products: state.products,
    pendingProducts: state.pendingProducts,
    cart: state.cart,
    orders: state.orders,
    customers: state.customers,
    settings: state.settings,
    reports: state.reports
  };
}

// ── 持久化：同時寫 localStorage + IndexedDB ──
let _persistIdbTimer = null;
export function persistAll(){
  try {
    const toSave = collectStateForPersist();
    // 同步寫 localStorage（保留相容性與啟動加速）
    try { localStorage.setItem(LS_KEY, JSON.stringify(toSave)); } catch (e) {
      console.warn('localStorage write failed (可能容量超限):', e);
    }
    // 節流寫 IndexedDB（500 ms 內合併多次寫入）
    if (_persistIdbTimer) clearTimeout(_persistIdbTimer);
    _persistIdbTimer = setTimeout(() => {
      idbSet(IDB_KEY, toSave);
      _persistIdbTimer = null;
    }, 500);
  } catch (e) {
    console.error('persistAll failed:', e);
  }
}

// ── 重新綁定店家（清除目前綁定，下次 reload 時可由 URL 重綁）──
state.rebindStore = function(newStoreId, newStoreName){
  if (newStoreId) {
    state.settings.store = {
      storeId: String(newStoreId).trim(),
      storeName: String(newStoreName || newStoreId).trim(),
      boundAt: new Date().toISOString()
    };
    persistAll();
    console.log('[store] 重新綁定為', state.settings.store);
    return true;
  }
  // 不傳參數：清除綁定，下次帶 URL 參數開啟即可重綁
  state.settings.store = JSON.parse(JSON.stringify(DEFAULT_STORE_BINDING));
  persistAll();
  console.log('[store] 已清除店家綁定，下次帶 ?storeId=xxx 開啟即可重綁');
  return true;
};

// ── seedDefaults：重建預設資料 ──
export function seedDefaults(){
  const def = buildDefaultState();
  state.categories = def.categories;
  state.modules = def.modules;
  state.products = def.products;
  state.pendingProducts = [];
  state.cart = [];
  state.orders = [];
  state.customers = {};
  // settings 與 reports 保留（含 store 綁定）
  persistAll();
}

// ── 匯出 / 匯入 / 重建 ──
state.exportAllData = function(){
  return {
    exportedAt: new Date().toISOString(),
    version: 'v20260608',
    categories: state.categories,
    modules: state.modules,
    products: state.products,
    pendingProducts: state.pendingProducts,
    orders: state.orders,
    customers: state.customers,
    settings: state.settings,
    reports: state.reports
  };
};

state.importAllData = function(data){
  if (!data || typeof data !== 'object') throw new Error('資料格式錯誤');
  if (Array.isArray(data.categories)) state.categories = data.categories.includes('未分類') ? data.categories : ['未分類', ...data.categories];
  if (Array.isArray(data.modules)) state.modules = normalizeModules(data.modules);
  if (Array.isArray(data.products)) state.products = normalizeProducts(data.products, state.modules);
  if (Array.isArray(data.pendingProducts)) state.pendingProducts = data.pendingProducts;
  if (Array.isArray(data.orders)) state.orders = data.orders;
  if (data.customers && typeof data.customers === 'object') state.customers = data.customers;
  if (data.settings && typeof data.settings === 'object') deepMerge(state.settings, data.settings);
  if (data.reports && typeof data.reports === 'object') state.reports = data.reports;
  persistAll();
};

state.seedDemoData = function(){
  seedDefaults();
};
