/* 中文備註：Google Sheets 自動同步模組 v20260608
 * 功能：
 *   - 每 15 分鐘自動將本機訂單與班次推送到 Google Apps Script Web App
 *   - 訂單完成或班次結束時，10 秒節流後也會推送一次
 *   - 已同步的 orderNo / sessionId 會記錄在 state.settings.sheetsSync.syncedOrderNos / syncedSessionIds，避免重複送
 *   - 失敗會記錄 lastError，下次自動重試
 *   - 全域 API：window.sheetsSyncNow / window.sheetsSyncStatus / window.sheetsSyncReset
 */
import { state, persistAll } from '../core/store.js';
import { STORE_CONFIG } from '../core/store-config.js';

// ========= 設定 =========
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxbQTMq2BZOvdIexY3pz_DERQGe44aR_OLIf-xZbt8MHHDjEI-WHe5408A9qXvTonlC/exec';
const INTERVAL_MS     = 15 * 60 * 1000;  // 每 15 分鐘自動同步
const THROTTLE_MS     = 10 * 1000;       // 訂單/班次變動 10 秒節流
const MAX_BATCH       = 200;             // 單次最多送 200 筆，避免 payload 過大

// ========= 內部狀態 =========
let _throttleTimer = null;
let _intervalTimer = null;
let _syncing       = false;

// ========= 初始化設定區 =========
function ensureSyncConfig(){
  if(!state.settings) state.settings = {};
  if(!state.settings.sheetsSync){
    state.settings.sheetsSync = {
      enabled: true,
      apiUrl: APPS_SCRIPT_URL,
      intervalMs: INTERVAL_MS,
      lastSyncAt: '',
      lastError: '',
      status: '尚未同步',
      syncedOrderNos: [],
      syncedSessionIds: []
    };
  }
  // 若舊版設定存在但 apiUrl 為空，補上預設
  if(!state.settings.sheetsSync.apiUrl){
    state.settings.sheetsSync.apiUrl = APPS_SCRIPT_URL;
  }
  if(!Array.isArray(state.settings.sheetsSync.syncedOrderNos)){
    state.settings.sheetsSync.syncedOrderNos = [];
  }
  if(!Array.isArray(state.settings.sheetsSync.syncedSessionIds)){
    state.settings.sheetsSync.syncedSessionIds = [];
  }
}

// ========= 取得 storeId / storeName =========
function getStoreInfo(){
  const s = (state.settings && state.settings.store) || {};
  const d = (state.settings && state.settings.dashboard) || {};
  const cfgId   = (STORE_CONFIG && STORE_CONFIG.storeId   || '').trim();
  const cfgName = (STORE_CONFIG && STORE_CONFIG.storeName || '').trim();
  return {
    storeId:   cfgId   || s.storeId   || d.storeId   || 'store001',
    storeName: cfgName || s.storeName || d.storeName || '測試店'
  };
}


// ========= 序列化訂單 =========
function serializeOrder(o){
  return {
    orderNo:         o.orderNo || '',
    createdAt:       o.createdAt || '',
    completedAt:     o.updatedAt || o.completedAt || '',
    orderType:       o.orderType || '',
    tableNo:         o.tableNo || '',
    status:          o.status || '',
    paymentMethod:   o.paymentMethod || '',
    subtotal:        Number(o.subtotal || 0),
    discount:        Number(o.discountAmount || 0),
    total:           Number(o.total || 0),
    itemCount:       Array.isArray(o.items) ? o.items.length : 0,
    items:           (o.items || []).map(it => ({
      name:  it.name || '',
      qty:   Number(it.qty || 1),
      price: Number((it.basePrice || 0) + (it.extraPrice || 0))
    })),
    customerName:    o.customerName || '',
    customerPhone:   o.customerPhone || '',
    note:            o.note || '',
    staffId:         o.staffId || '',
    sessionId:       o.sessionId || ''
  };
}

// ========= 序列化班次 =========
function serializeSession(s){
  const stats = s.stats || {};
  const byPay = stats.byPayment || {};
  return {
    sessionId:    s.id || '',
    staffId:      s.staffId || '',
    startedAt:    s.startedAt || '',
    endedAt:      s.endedAt || '',
    openingCash:  Number(s.openingCash || 0),
    closingCash:  Number(s.closingCash || 0),
    totalSales:   Number(stats.salesTotal || 0),
    orderCount:   Number(stats.orderCount || 0),
    cashSales:    Number(stats.cashSales || byPay['現金'] || 0),
    cardSales:    Number(byPay['刷卡'] || 0),
    lineSales:    Number(byPay['Line Pay'] || byPay['LinePay'] || 0),
    otherSales:   Number(byPay['其他'] || 0),
    note:         s.note || ''
  };
}

// ========= 找出尚未同步的訂單 / 班次 =========
function collectPending(){
  ensureSyncConfig();
  const cfg = state.settings.sheetsSync;
  const syncedOrders   = new Set(cfg.syncedOrderNos);
  const syncedSessions = new Set(cfg.syncedSessionIds);

  // 訂單：只送已完成（status 不是 pending、也不是 void）
  const pendingOrders = (state.orders || [])
    .filter(o => {
      const st = String(o.status || '').toLowerCase();
      if(st === 'pending' || st === '') return false; // 待付款先不送
      if(!o.orderNo) return false;
      return !syncedOrders.has(o.orderNo);
    })
    .slice(0, MAX_BATCH);

  // 班次：只送已結束（endedAt 有值）
  const sessions   = ((state.reports && state.reports.sessions) || [])
    .filter(s => s.id && s.endedAt && !syncedSessions.has(s.id))
    .slice(0, MAX_BATCH);

  return { pendingOrders, sessions };
}

// ========= 實際送出（核心）=========
async function syncNow(reason){
  ensureSyncConfig();
  const cfg = state.settings.sheetsSync;
  if(!cfg.enabled){
    return { ok: false, skipped: '已停用' };
  }
  if(_syncing){
    return { ok: false, skipped: '同步中' };
  }

  const { pendingOrders, sessions } = collectPending();
  if(pendingOrders.length === 0 && sessions.length === 0){
    cfg.status = '無新資料';
    return { ok: true, skipped: '無新資料' };
  }

  _syncing = true;
  cfg.status = '同步中…';

  const { storeId, storeName } = getStoreInfo();
  const payload = {
    storeId,
    storeName,
    orders:   pendingOrders.map(serializeOrder),
    sessions: sessions.map(serializeSession),
    voided:   [],  // 預留，未來如需單獨送作廢可在此補
    reason:   reason || 'auto',
    sentAt:   new Date().toISOString()
  };

  try{
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      // Apps Script 的 doPost 需要 text/plain 才能避開 CORS preflight；
      // 後端用 e.postData.contents 解析 JSON 完全相容。
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let data = null;
    try{ data = JSON.parse(text); }catch(_){}

    if(!res.ok || !data || data.ok !== true){
      throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 200));
    }

    // 成功 → 記錄已同步的 key
    pendingOrders.forEach(o => {
      if(o.orderNo && !cfg.syncedOrderNos.includes(o.orderNo)){
        cfg.syncedOrderNos.push(o.orderNo);
      }
    });
    sessions.forEach(s => {
      if(s.id && !cfg.syncedSessionIds.includes(s.id)){
        cfg.syncedSessionIds.push(s.id);
      }
    });

    // 控制陣列大小，避免無限增長（保留最近 2000 筆）
    if(cfg.syncedOrderNos.length > 2000){
      cfg.syncedOrderNos = cfg.syncedOrderNos.slice(-2000);
    }
    if(cfg.syncedSessionIds.length > 500){
      cfg.syncedSessionIds = cfg.syncedSessionIds.slice(-500);
    }

    cfg.lastSyncAt = new Date().toISOString();
    cfg.lastError = '';
    cfg.status = `同步成功（訂單 ${pendingOrders.length}、班次 ${sessions.length}）`;
    console.log('[sheets-sync]', cfg.status, data.result || data);

    // 觸發一次 persist（會經包裝 wrapper，但內部有旗標避免遞迴）
    safePersist();

    return { ok: true, result: data.result };
  }catch(err){
    cfg.lastError = String(err && err.message || err);
    cfg.status = '同步失敗：' + cfg.lastError;
    console.warn('[sheets-sync] 同步失敗', err);
    return { ok: false, error: cfg.lastError };
  }finally{
    _syncing = false;
  }
}

// ========= 節流觸發 =========
function scheduleSync(reason){
  if(_throttleTimer) return; // 已在排隊
  _throttleTimer = setTimeout(() => {
    _throttleTimer = null;
    syncNow(reason).catch(()=>{});
  }, THROTTLE_MS);
}

// ========= 包裝 persistAll，攔截「訂單/班次新增」事件 =========
// 注意：persistAll 是 named export，我們無法改它本身的引用，
// 改用「監測 state 變化」的策略：每次本模組自己的 syncNow 結束後會呼叫 safePersist，
// 平時則靠 polling state.orders.length / state.reports.sessions.length 來偵測新資料。
let _lastOrderCount   = -1;
let _lastSessionCount = -1;
let _persisting       = false;

function safePersist(){
  if(_persisting) return;
  _persisting = true;
  try{ persistAll(); }catch(_){}
  _persisting = false;
}

function watchChanges(){
  try{
    const orderCount   = (state.orders || []).length;
    const sessionCount = ((state.reports && state.reports.sessions) || []).length;
    if(_lastOrderCount < 0){
      _lastOrderCount = orderCount;
      _lastSessionCount = sessionCount;
      return;
    }
    if(orderCount > _lastOrderCount){
      _lastOrderCount = orderCount;
      scheduleSync('order-added');
    }
    if(sessionCount > _lastSessionCount){
      _lastSessionCount = sessionCount;
      scheduleSync('session-ended');
    }
  }catch(_){}
}

// ========= 啟動 =========
function start(){
  ensureSyncConfig();
  const { storeId } = getStoreInfo();
  console.log('[sheets-sync] 啟動，store =', storeId, 'apiUrl =', state.settings.sheetsSync.apiUrl);

  // 每 2 秒偵測一次本機狀態變化（極輕量）
  setInterval(watchChanges, 2000);

  // 每 15 分鐘強制全量檢查同步一次
  if(_intervalTimer) clearInterval(_intervalTimer);
  _intervalTimer = setInterval(() => syncNow('interval').catch(()=>{}), INTERVAL_MS);

  // 啟動後 30 秒做一次初次同步（讓 store / firebase 都初始化完）
  setTimeout(() => syncNow('startup').catch(()=>{}), 30 * 1000);
}

// ========= 全域 API（供 Console 測試 / 設定頁呼叫）=========
window.sheetsSyncNow = function(){
  return syncNow('manual');
};
window.sheetsSyncStatus = function(){
  ensureSyncConfig();
  return {
    enabled:    state.settings.sheetsSync.enabled,
    apiUrl:     state.settings.sheetsSync.apiUrl,
    lastSyncAt: state.settings.sheetsSync.lastSyncAt,
    lastError:  state.settings.sheetsSync.lastError,
    status:     state.settings.sheetsSync.status,
    syncedOrders:   state.settings.sheetsSync.syncedOrderNos.length,
    syncedSessions: state.settings.sheetsSync.syncedSessionIds.length
  };
};
window.sheetsSyncReset = function(){
  ensureSyncConfig();
  state.settings.sheetsSync.syncedOrderNos = [];
  state.settings.sheetsSync.syncedSessionIds = [];
  state.settings.sheetsSync.status = '已重置，下次將全量重送';
  safePersist();
  return state.settings.sheetsSync;
};

// 啟動（等 store 初始化完）
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => setTimeout(start, 500));
}else{
  setTimeout(start, 500);
}

export { syncNow };
