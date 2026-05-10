/* 中文備註：核心狀態管理 store。
 * 本版新增：
 *   - state.customers：顧客主檔（key = 完整電話）
 *   - state.settings.printConfig.fields：列印欄位勾選（顧客單/廚房單/標籤）
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

// ── 營業時間預設（mon~sun，每天最多 4 個時段，空陣列=公休）──
const DEFAULT_BUSINESS_HOURS = {
  mon: [{start:'11:00', end:'21:00'}],
  tue: [{start:'11:00', end:'21:00'}],
  wed: [{start:'11:00', end:'21:00'}],
  thu: [{start:'11:00', end:'21:00'}],
  fri: [{start:'11:00', end:'21:00'}],
  sat: [{start:'11:00', end:'21:00'}],
  sun: []
};

// ── 列印欄位預設（顧客單／廚房單／標籤各自獨立）──
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
  openDrawer: true,           // 列印顧客單後是否自動開錢箱
  fields: DEFAULT_PRINT_FIELDS
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
  // 名稱 → id 的 fallback map（給舊資料用：modules:['辣度','灑粉']）
  const nameToId = {};
  modulesArr.forEach(m => { if (m && m.name) nameToId[m.name] = m.id; });

  return (products || []).map(p => {
    // modules 標準化：物件陣列 [{moduleId, requiredOverride}]
    let mods = [];
    if (Array.isArray(p.modules)) {
      p.modules.forEach(item => {
        if (!item) return;
        if (typeof item === 'string') {
          // 舊資料：模組名稱字串 → 找 id
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
      soldOut: p.soldOut === true,                // 新欄位：賣完
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

// ── 載入持久化 ──
const LS_KEY = 'restaurantPosState_v2';

function loadPersisted(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('loadPersisted failed:', e);
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


// ── 建立 state（先 export 空物件，再用 try/catch 填內容，避免 IIFE 在 Safari 失敗時整個 state 變 undefined） ──
export const state = buildDefaultState();

(function hydrateState(){
  let saved = null;
  try {
    saved = loadPersisted();
  } catch (e) {
    console.error('loadPersisted exception:', e);
  }
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
      // 確保 printConfig.fields 存在
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
      // 補 businessHours 預設（舊資料沒有此 key 時）
      if (!state.settings.businessHours || typeof state.settings.businessHours !== 'object') {
        state.settings.businessHours = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_HOURS));
      } else {
        ['mon','tue','wed','thu','fri','sat','sun'].forEach(function(k){
          if (!Array.isArray(state.settings.businessHours[k])) {
            state.settings.businessHours[k] = [];
          }
        });
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
    console.error('hydrateState failed, falling back to defaults:', e);
  }
  
   

})();


// ── 持久化 ──
export function persistAll(){
  try {
    // customerLookupRateLimit 不持久化（記憶體用）
    const toSave = {
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
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('persistAll failed:', e);
  }
}

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
  // settings 與 reports 保留
  persistAll();
}

// ── 匯出 / 匯入 / 重建（settings-page.js 會呼叫）──
state.exportAllData = function(){
  return {
    exportedAt: new Date().toISOString(),
    version: 'v2_1_25',
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
