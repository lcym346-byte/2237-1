/* 中文備註：核心狀態管理 store。v20260608-b 升級。
 * 本版（相對 v20260608-a）新增：
 *   - URL 綁定時自動同步寫入 state.settings.dashboard.storeId/storeName
 *     （讓看板、即時接單、雲端備份共用同一店號）
 *   - state.settings.cloudBackup：{ lastBackupAt, lastRestoreAt, status, deviceId, enabled }
 *   - cloudBackupNow()：將完整 state 寫入 Firebase posBackup/{storeId}/state（10 秒節流）
 *   - persistAll() 觸發後 10 秒節流自動雲端上傳
 *   - 啟動時若 IndexedDB 為空且雲端有備份 → 跳 confirm 詢問是否還原
 *   - 還原 confirm 取消後 sessionStorage 記憶，不重複詢問
 *   - Firebase 連線失敗（離線、權限不足）不影響本地運作
 * 既有功能保留：
 *   - IndexedDB 主儲存 + localStorage 雙寫快取
 *   - URL 參數綁定店家（?storeId=xxx&storeName=yyy）
 *   - 顧客主檔、列印欄位、業務時間、Google Drive 備份等
 */
import { STORE_CONFIG } from './store-config.js';
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
  storeName: '我的店',
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

const DEFAULT_STORE_BINDING = {
  storeId: 'store001',
  storeName: '測試店',
  boundAt: ''
};

const DEFAULT_CLOUD_BACKUP = {
  enabled: true,
  lastBackupAt: '',
  lastRestoreAt: '',
  status: '尚未備份',
  deviceId: ''
};

const DEFAULT_IMAGE_LIBRARY = {
  baseUrl: 'https://jess0937588151-hue.github.io/2234/images/products/',
  skuMap: {},          // { 'A001': 'A001.jpg', ... }（只存檔名，URL 渲染時拼）
  importedAt: '',
  itemCount: 0
};


// ── 工具 ──
function rid(){ return Math.random().toString(36).slice(2,10); }

function normalizeModules(modules){
  return (modules || []).map(m => {
    const isMulti = m.selection === 'multi' || m.multi === true;
    // 修正：之前漏存 minSelect/maxSelect，導致 POS 重新整理後複選規則被砍回預設(1/不限)
    const minSel = isMulti ? Math.max(0, parseInt(m.minSelect, 10) || 0) : 0;
    const maxSel = isMulti
      ? (m.maxSelect == null || m.maxSelect === '' ? null : Math.max(1, parseInt(m.maxSelect, 10) || 1))
      : null;
    return {
      id: m.id || rid(),
      name: m.name || '未命名模組',
      selection: isMulti ? 'multi' : 'single',
      required: !!m.required,
      minSelect: minSel,
      maxSelect: maxSel,
      options: (m.options || []).map(o => ({
        id: o.id || rid(),
        name: o.name || '',
        price: Number(o.price || 0),
        enabled: o.enabled !== false
      }))
    };
  });
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
      sku: (p.sku || '').trim(),
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
// IndexedDB 極簡 wrapper
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

const LS_KEY = 'restaurantPosState_v2';

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
            store: JSON.parse(JSON.stringify(DEFAULT_STORE_BINDING)),
      cloudBackup: JSON.parse(JSON.stringify(DEFAULT_CLOUD_BACKUP)),  // v20260608-b 新增
      imageLibrary: JSON.parse(JSON.stringify(DEFAULT_IMAGE_LIBRARY)),  // v20260614 新增
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
      try { deepMerge(state.settings, saved.settings); }
      catch (e) { console.error('deepMerge settings failed:', e); }

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
      if (!state.settings.store || typeof state.settings.store !== 'object') {
        state.settings.store = JSON.parse(JSON.stringify(DEFAULT_STORE_BINDING));
      } else {
        if (!state.settings.store.storeId) state.settings.store.storeId = DEFAULT_STORE_BINDING.storeId;
        if (!state.settings.store.storeName) state.settings.store.storeName = DEFAULT_STORE_BINDING.storeName;
        if (typeof state.settings.store.boundAt === 'undefined') state.settings.store.boundAt = '';
      }
            // v20260608-b 新增：補 cloudBackup 預設
      if (!state.settings.cloudBackup || typeof state.settings.cloudBackup !== 'object') {
        state.settings.cloudBackup = JSON.parse(JSON.stringify(DEFAULT_CLOUD_BACKUP));
      } else {
        Object.keys(DEFAULT_CLOUD_BACKUP).forEach(k => {
          if (typeof state.settings.cloudBackup[k] === 'undefined') {
            state.settings.cloudBackup[k] = DEFAULT_CLOUD_BACKUP[k];
          }
        });
      }
      // v20260614 新增：補 imageLibrary 預設
      if (!state.settings.imageLibrary || typeof state.settings.imageLibrary !== 'object') {
        state.settings.imageLibrary = JSON.parse(JSON.stringify(DEFAULT_IMAGE_LIBRARY));
      } else {
        Object.keys(DEFAULT_IMAGE_LIBRARY).forEach(k => {
          if (typeof state.settings.imageLibrary[k] === 'undefined') {
            state.settings.imageLibrary[k] = DEFAULT_IMAGE_LIBRARY[k];
          }
        });
        if (!state.settings.imageLibrary.skuMap || typeof state.settings.imageLibrary.skuMap !== 'object') {
          state.settings.imageLibrary.skuMap = {};
        }
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

  // 套用店家綁定：優先使用 store-config.js（強制鎖定），否則退回 URL 參數
  function applyStoreBindingFromUrl(s){
    try{
      if(!s.settings) s.settings = {};
      if(!s.settings.store) s.settings.store = {};
      // 1) 來自 store-config.js（寫死，最高優先）
      const cfgId   = (STORE_CONFIG && STORE_CONFIG.storeId   || '').trim();
      const cfgName = (STORE_CONFIG && STORE_CONFIG.storeName || '').trim();
      if(cfgId)   s.settings.store.storeId   = cfgId;
      if(cfgName) s.settings.store.storeName = cfgName;
      // 2) 若 store-config 沒鎖，再讀 URL 參數
      if(!(STORE_CONFIG && STORE_CONFIG.lockFromUrl)){
        const usp = new URLSearchParams(location.search);
        const qid = (usp.get('storeId')||'').trim();
        const qname = (usp.get('storeName')||'').trim();
        if(qid   && !s.settings.store.storeId)   s.settings.store.storeId   = qid;
        if(qname && !s.settings.store.storeName) s.settings.store.storeName = qname;
      }
      console.log('[store] 店家綁定 →', s.settings.store, '(lockFromUrl=', !!(STORE_CONFIG && STORE_CONFIG.lockFromUrl), ')');
    }catch(_){}
  }


// 將 state.settings.store 同步到 state.settings.dashboard，
// 讓既有的 dashboard-publish、realtime-order-service 直接生效
function syncStoreToDashboard(){
  try {
    if (!state.settings) state.settings = {};
    const s = state.settings.store || {};
    if (!s.storeId) return;
    if (!state.settings.dashboard || typeof state.settings.dashboard !== 'object') {
      state.settings.dashboard = { enabled: true, storeId: '', storeName: '' };
    }
    state.settings.dashboard.storeId = s.storeId;
    state.settings.dashboard.storeName = s.storeName || s.storeId;
    if (typeof state.settings.dashboard.enabled !== 'boolean') {
      state.settings.dashboard.enabled = true;
    }
  } catch (e) {
    console.warn('syncStoreToDashboard failed:', e);
  }
}

// ─────────────────────────────────────────────
// 建立 state
// ─────────────────────────────────────────────
export const state = buildDefaultState();

(function hydrateState(){
  // 第一輪：同步讀 localStorage
  let saved = null;
  try { saved = loadPersistedSync(); } catch (e) { console.error('loadPersistedSync exception:', e); }
  if (saved) applyHydrate(saved);

  // 套用店家綁定（STORE_CONFIG 寫死優先）+ 同步 dashboard
  applyStoreBindingFromUrl(state);
  syncStoreToDashboard();
  try {
    const toSave = collectStateForPersist();
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch (e) {}
  

  // 第二輪：async 讀 IndexedDB
  idbGet(IDB_KEY).then(async idbData => {
    try {
            if (idbData && typeof idbData === 'object'){
        if (saved) {
          // localStorage 已成功 hydrate（最新）→ 不再用 IDB 覆蓋，避免「IDB 節流寫入延遲」造成關班後刷新回溯到舊資料
          // 反向把最新 state 寫回 IDB，讓兩邊一致
          try { idbSet(IDB_KEY, collectStateForPersist()); } catch (_) {}
          console.log('[store] localStorage 已是最新，IndexedDB 同步為當前狀態（orders=' + (state.orders||[]).length + '）');
        } else {
          // localStorage 為空（例如 iPad 釋放空間清掉了）→ 用 IDB 當還原來源
          applyHydrate(idbData);
          applyStoreBindingFromUrl(state);
          syncStoreToDashboard();
          try { window.dispatchEvent(new CustomEvent('pos-state-hydrated', { detail: { source: 'idb' } })); } catch (e) {}
          console.log('[store] IndexedDB 載入完成（localStorage 為空），orders=' + (state.orders||[]).length + ' sessions=' + ((state.reports||{}).sessions||[]).length);
        }
      } else if (saved) {
        // IndexedDB 沒資料但 localStorage 有 → 自動遷移
        const migrate = collectStateForPersist();
        idbSet(IDB_KEY, migrate).then(() => {
          console.log('[store] 已從 localStorage 自動遷移至 IndexedDB');
        });
      } else {
        // IndexedDB 與 localStorage 都空 → 嘗試從雲端還原
        await tryRestoreFromCloud();
      }

    } catch (e) {
      console.error('IndexedDB hydrate failed:', e);
    }
  });
})();

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

// ─────────────────────────────────────────────
// 雲端備份（v20260608-b 新增）
// 路徑：posBackup/{storeId}/state
// 動態 import realtime-order-service.js 的 _getRef / _dbApi，避免循環引用
// ─────────────────────────────────────────────
const CLOUD_THROTTLE_MS = 10 * 1000;  // 10 秒節流
let _cloudUploadTimer = null;
let _cloudUploading = false;

function getDeviceId(){
  try {
    let did = localStorage.getItem('pos_device_id');
    if (!did) {
      did = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
      localStorage.setItem('pos_device_id', did);
    }
    return did;
  } catch (e) {
    return 'dev_unknown';
  }
}

async function _getCloudRef(subPath){
  try {
    const mod = await import('../modules/realtime-order-service.js');
    const sid = (state.settings?.store?.storeId || state.settings?.dashboard?.storeId || '').trim();
    if (!sid) return null;
    const ref = await mod._getRef(`posBackup/${sid}/${subPath}`);
    return { ref, api: mod._dbApi() };
  } catch (e) {
    return null;
  }
}

export async function cloudBackupNow(){
  if (_cloudUploading) return;
  _cloudUploading = true;
  try {
    if (!state.settings) state.settings = {};
    if (!state.settings.cloudBackup) state.settings.cloudBackup = JSON.parse(JSON.stringify(DEFAULT_CLOUD_BACKUP));
    if (state.settings.cloudBackup.enabled === false) return;

    const ctx = await _getCloudRef('state');
    if (!ctx || !ctx.ref || !ctx.api) {
      state.settings.cloudBackup.status = '雲端尚未連線';
      return;
    }

    const snapshot = collectStateForPersist();
    const payload = {
      data: snapshot,
      meta: {
        version: 'v20260608-b',
        deviceId: getDeviceId(),
        backupAt: new Date().toISOString(),
        orderCount: (state.orders || []).length,
        sessionCount: ((state.reports || {}).sessions || []).length,
        storeId: state.settings.store?.storeId || '',
        storeName: state.settings.store?.storeName || ''
      }
    };

    await ctx.api.set(ctx.ref, payload);

    state.settings.cloudBackup.lastBackupAt = payload.meta.backupAt;
    state.settings.cloudBackup.deviceId = payload.meta.deviceId;
    state.settings.cloudBackup.status = '備份成功';
  } catch (e) {
    console.warn('[cloudBackup] 上傳失敗（不影響本地）:', e?.message || e);
    if (state.settings?.cloudBackup) {
      state.settings.cloudBackup.status = '上傳失敗：' + (e?.message || '未知錯誤');
    }
  } finally {
    _cloudUploading = false;
  }
}

// 啟動時嘗試從雲端還原（僅在本地完全空白時觸發）
async function tryRestoreFromCloud(){
  try {
    // 防止本次啟動已詢問過
    if (sessionStorage.getItem('pos_cloud_restore_asked') === '1') return;

    // 確認 storeId 已綁定
    const sid = (state.settings?.store?.storeId || '').trim();
    if (!sid) return;

    const ctx = await _getCloudRef('state');
    if (!ctx || !ctx.ref || !ctx.api) return;

    const snap = await ctx.api.get(ctx.ref);
    const val = snap && snap.val ? snap.val() : null;
    if (!val || !val.data || !val.meta) return;

    sessionStorage.setItem('pos_cloud_restore_asked', '1');

    const meta = val.meta;
    const backupAt = meta.backupAt ? new Date(meta.backupAt).toLocaleString('zh-TW') : '未知';
    const msg = `偵測到雲端有 ${sid} 的備份：\n\n` +
                `店家：${meta.storeName || sid}\n` +
                `訂單數：${meta.orderCount || 0}\n` +
                `班次數：${meta.sessionCount || 0}\n` +
                `最後備份：${backupAt}\n` +
                `來源裝置：${meta.deviceId || '未知'}\n\n` +
                `目前裝置為空白資料。要從雲端還原嗎？\n\n` +
                `（按「確定」還原，按「取消」維持空白）`;

    if (confirm(msg)) {
      applyHydrate(val.data);
      state.settings.cloudBackup = state.settings.cloudBackup || JSON.parse(JSON.stringify(DEFAULT_CLOUD_BACKUP));
      state.settings.cloudBackup.lastRestoreAt = new Date().toISOString();
      state.settings.cloudBackup.status = '已從雲端還原';
      // 寫回本地
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(collectStateForPersist()));
        await idbSet(IDB_KEY, collectStateForPersist());
      } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('pos-state-hydrated', { detail: { source: 'cloud' } })); } catch (e) {}
      console.log('[cloudBackup] 已從雲端還原 orders=' + (state.orders||[]).length);
      // 提示使用者重新整理畫面
      alert('✅ 雲端還原完成，畫面即將重新整理');
      location.reload();
    } else {
      console.log('[cloudBackup] 使用者取消雲端還原');
    }
  } catch (e) {
    console.warn('[cloudBackup] 還原檢查失敗（不影響本地）:', e?.message || e);
  }
}

// ─────────────────────────────────────────────
// 持久化：localStorage + IndexedDB + 雲端（10 秒節流）
// ─────────────────────────────────────────────
let _persistIdbTimer = null;
export function persistAll(){
  try {
        const toSave = collectStateForPersist();
    try { localStorage.setItem(LS_KEY, JSON.stringify(toSave)); }
    catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        console.warn('[store] localStorage 配額已滿，僅寫入 IndexedDB');
        try { localStorage.removeItem(LS_KEY); } catch (_) {}
      } else {
        console.warn('localStorage write failed:', e);
      }
    }

       // 立即寫入 IndexedDB（不再 500ms 節流）
    // 原本的 500ms 節流會造成「關班後 500ms 內刷新 → IDB 還沒寫到 → 第二輪 hydrate 用舊 IDB 蓋掉 localStorage 的新狀態」
    // 改成立即寫入，避免關班/結帳等關鍵操作的資料遺失視窗
    if (_persistIdbTimer) { clearTimeout(_persistIdbTimer); _persistIdbTimer = null; }
    try { idbSet(IDB_KEY, toSave); } catch (e) { console.warn('[store] IndexedDB 寫入失敗（已有 localStorage 兜底）:', e); }

    // 雲端備份（10 秒節流，合併期間多次寫入）
    if (state.settings?.cloudBackup?.enabled !== false) {
      if (_cloudUploadTimer) clearTimeout(_cloudUploadTimer);
      _cloudUploadTimer = setTimeout(() => {
        _cloudUploadTimer = null;
        cloudBackupNow();
      }, CLOUD_THROTTLE_MS);
    }
  } catch (e) {
    console.error('persistAll failed:', e);
  }
}

// ─────────────────────────────────────────────
// 重綁店家 / 預設資料 / 匯出匯入
// ─────────────────────────────────────────────
  state.rebindStore = function(opts){
    try{
      if(!state.settings.store) state.settings.store = {};
      // 1) 來自 store-config.js（寫死，最高優先）
      const cfgId   = (STORE_CONFIG && STORE_CONFIG.storeId   || '').trim();
      const cfgName = (STORE_CONFIG && STORE_CONFIG.storeName || '').trim();
      if(cfgId)   state.settings.store.storeId   = cfgId;
      if(cfgName) state.settings.store.storeName = cfgName;
      // 2) 若呼叫時有明確傳入，仍允許覆蓋（提供測試彈性）
      if(opts && opts.storeId)   state.settings.store.storeId   = String(opts.storeId).trim();
      if(opts && opts.storeName) state.settings.store.storeName = String(opts.storeName).trim();
      // 3) 若 store-config 未鎖，再從 URL 補
      if(!(STORE_CONFIG && STORE_CONFIG.lockFromUrl) && !(opts && (opts.storeId||opts.storeName))){
        const usp = new URLSearchParams(location.search);
        const qid = (usp.get('storeId')||'').trim();
        const qname = (usp.get('storeName')||'').trim();
        if(qid   && !state.settings.store.storeId)   state.settings.store.storeId   = qid;
        if(qname && !state.settings.store.storeName) state.settings.store.storeName = qname;
      }
      syncStoreToDashboard(state);
      persistAll();
      console.log('[store] 已重新綁定店家 →', state.settings.store);
      return state.settings.store;
    }catch(e){ console.warn('[store] rebindStore 失敗', e); }
  };


// 手動觸發雲端備份 / 還原（供設定頁未來呼叫）
state.cloudBackupNow = cloudBackupNow;
state.tryRestoreFromCloud = tryRestoreFromCloud;

export function seedDefaults(){
  const def = buildDefaultState();
  state.categories = def.categories;
  state.modules = def.modules;
  state.products = def.products;
  state.pendingProducts = [];
  state.cart = [];
  state.orders = [];
  state.customers = {};
  persistAll();
}

state.exportAllData = function(){
  return {
    exportedAt: new Date().toISOString(),
    version: 'v20260608-b',
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
