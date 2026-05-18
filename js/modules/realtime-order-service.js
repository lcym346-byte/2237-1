/* 中文備註：Firebase 即時接單服務（v2.2.0 多店分流版）。
 * 變更（相對 v2.1.25）：
 *   1. 新增 getStoreCode()：從 state.settings.dashboard.storeId 取得，未設定則拋錯
 *   2. pushOnlineOrder(order, storeCode) → 寫入 onlineOrders/{storeCode}/<orderId>
 *   3. startPOSRealtimeListener() → 監聽 onlineOrders/{storeCode}（只收自己店）
 *   4. confirmOnlineOrder / rejectOnlineOrder / watchCustomerOrder → 路徑帶 storeCode
 *   5. 菜單 (menu/...) 維持用 projectId，所有店共用
 */
import { state, persistAll } from '../core/store.js';
import { STORE_CONFIG } from '../core/store-config.js';
import { getCurrentSession } from './report-session.js';
import { escapeHtml, fmtLocalDateTime } from '../core/utils.js';
import { calculatePromotion, getPublicPromotionsConfig, importPromotionsFromCloud } from './promotion-service.js';


const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
const DEFAULT_FIREBASE_CONFIG = {
  enabled: true,
  apiKey: 'AIzaSyBOmGn6HQI0O6RU6Iu2hh44TbFoneblbyk',
  authDomain: 'webpos-1f626.firebaseapp.com',
  databaseURL: 'https://webpos-1f626-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'webpos-1f626',
  storageBucket: 'webpos-1f626.firebasestorage.app',
  messagingSenderId: '203764995518',
  appId: '1:203764995518:web:8ebdf39837c5c59c4995ef',
  measurementId: 'G-34XEG1QCHW'
};

let appInstance = null;
let dbInstance = null;
let dbApi = null;
let authApi = null;
let authInstance = null;
let googleProvider = null;
let initialized = false;
let posListenerRef = null;
let posListenerCallback = null;
let posListenerEntries = [];

// ============================================================
// 設定
// ============================================================
function ensureRealtimeConfig(){
  if(!state.settings) state.settings = {};
  const current = state.settings.realtimeOrder || {};
  state.settings.realtimeOrder = {
    enabled: typeof current.enabled === 'boolean' ? current.enabled : DEFAULT_FIREBASE_CONFIG.enabled,
    apiKey: String(current.apiKey || '').trim() || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: String(current.authDomain || '').trim() || DEFAULT_FIREBASE_CONFIG.authDomain,
    databaseURL: String(current.databaseURL || '').trim() || DEFAULT_FIREBASE_CONFIG.databaseURL,
    projectId: String(current.projectId || '').trim() || DEFAULT_FIREBASE_CONFIG.projectId,
    storageBucket: String(current.storageBucket || '').trim() || DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId: String(current.messagingSenderId || '').trim() || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
    appId: String(current.appId || '').trim() || DEFAULT_FIREBASE_CONFIG.appId,
    measurementId: String(current.measurementId || '').trim() || DEFAULT_FIREBASE_CONFIG.measurementId,
    onlineStoreTitle: current.onlineStoreTitle || '',
    onlineStoreSubtitle: current.onlineStoreSubtitle || '',
    autoPrintKitchenOnConfirm: current.autoPrintKitchenOnConfirm !== false,
    autoPrintReceiptOnConfirm: current.autoPrintReceiptOnConfirm !== false,
    incomingSoundEnabled: current.incomingSoundEnabled !== false,
    lastSyncStatus: current.lastSyncStatus || '尚未啟用',
    lastOrderAt: current.lastOrderAt || '',
    lastConfirmedAt: current.lastConfirmedAt || '',
    deviceRole: current.deviceRole || 'master'
  };
  return state.settings.realtimeOrder;
}

function updateSyncStatus(message){
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = message;
  persistAll();
  if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
}

export function getRealtimeConfig(){
  return ensureRealtimeConfig();
}

// ============================================================
// 店鋪代碼（多店分流核心）
// ============================================================
/**
 * 從 state.settings.dashboard.storeId 讀取店鋪代碼（例如 TW001、TW002）
 * 未設定則拋錯，避免誤寫到根節點
 */
export function getStoreCode(){
  const code = String(
    (state.settings && state.settings.dashboard && state.settings.dashboard.storeId) ||
    STORE_CONFIG.storeCode ||
    STORE_CONFIG.storeId ||
    ''
  ).trim();
  if(!code){
    throw new Error('尚未設定店鋪代碼（storeId），請連點頁首 5 下開啟設定，輸入 TW001 等代碼');
  }
  // 防呆：Firebase key 不能含 . # $ / [ ]
  if(/[.#$\/\[\]]/.test(code)){
    throw new Error(`店鋪代碼「${code}」含有非法字元（. # $ / [ ]），請改用英數短代碼如 TW001`);
  }
  return code;
}

/**
 * 給顧客端用：可手動傳入 storeCode（從 URL 來）
 */
function validateStoreCode(code){
  const c = String(code || '').trim();
  if(!c) throw new Error('缺少店鋪代碼');
  if(/[.#$\/\[\]]/.test(c)) throw new Error(`店鋪代碼「${c}」含有非法字元`);
  return c;
}

function addStoreCodeAlias(list, code){
  var c = String(code || '').trim();
  if(!c || /[.#$\/\[\]]/.test(c)) return;
  if(list.indexOf(c) < 0) list.push(c);
}

function getPublicStoreWriteAliases(primaryCode){
  var out = [];
  addStoreCodeAlias(out, primaryCode);
  try{ addStoreCodeAlias(out, state.settings && state.settings.dashboard && state.settings.dashboard.storeId); }catch(e){}
  try{ addStoreCodeAlias(out, state.settings && state.settings.store && state.settings.store.storeId); }catch(e){}
  try{ addStoreCodeAlias(out, STORE_CONFIG && STORE_CONFIG.storeCode); }catch(e){}
  try{ addStoreCodeAlias(out, STORE_CONFIG && STORE_CONFIG.storeId); }catch(e){}
  return out;
}

function getPublicStoreReadAliases(primaryCode){
  var out = [];
  var c = validateStoreCode(primaryCode);
  addStoreCodeAlias(out, c);
  addStoreCodeAlias(out, c.toUpperCase());
  addStoreCodeAlias(out, c.toLowerCase());
  return out;
}

function detachPOSRealtimeListeners(){
  if(posListenerEntries.length){
    posListenerEntries.forEach(function(entry){
      try{ dbApi.off(entry.ref, 'value', entry.callback); }catch(e){}
    });
    posListenerEntries = [];
  }
  if(posListenerRef && posListenerCallback){
    try{ dbApi.off(posListenerRef, 'value', posListenerCallback); }catch(e){}
  }
  posListenerRef = null;
  posListenerCallback = null;
}

function getOnlineOrderStoreCode(orderId){
  var order = (state.onlineIncomingOrders || []).find(function(o){ return o && o.id === orderId; });
  var code = order && (order._storeCode || order.storeCode);
  if(code){
    try{ return validateStoreCode(code); }catch(e){}
  }
  return getStoreCode();
}

// ============================================================
// Firebase 初始化
// ============================================================
async function loadFirebaseModules(){
  if(initialized) return;
  const appMod = await import(`${FIREBASE_BASE}/firebase-app.js`);
  dbApi = await import(`${FIREBASE_BASE}/firebase-database.js`);
  authApi = await import(`${FIREBASE_BASE}/firebase-auth.js`);

  const cfg = ensureRealtimeConfig();
  if(!cfg.apiKey || !cfg.databaseURL || !cfg.projectId || !cfg.appId){
    throw new Error('請先完整設定 Firebase');
  }

  appInstance = appMod.initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain || undefined,
    databaseURL: cfg.databaseURL,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket || undefined,
    messagingSenderId: cfg.messagingSenderId || undefined,
    appId: cfg.appId,
    measurementId: cfg.measurementId || undefined
  });

  dbInstance = dbApi.getDatabase(appInstance);
  authInstance = authApi.getAuth(appInstance);
  googleProvider = new authApi.GoogleAuthProvider();
  initialized = true;
}

async function getRef(path){
  await loadFirebaseModules();
  return dbApi.ref(dbInstance, path);
}

// ── 公開給 customer-service.js / report-session.js 使用 ──
export async function _getRef(path){
  return await getRef(path);
}
export function _dbApi(){
  return dbApi;
}

// ============================================================
// 進單提示音 & 自動接單
// ============================================================
var activeAlarmInterval = null;
var activeAlarmTimeout = null;
var activeAlarmOrderId = null;
let beepAudio = null;

function ensureBeepAudio(){
  var customSound = localStorage.getItem('customAlertSound') || localStorage.getItem('pos_custom_sound');
  if(customSound){
    if(!beepAudio || beepAudio._custom !== customSound){
      beepAudio = new Audio(customSound);
      beepAudio._custom = customSound;
    }
    return beepAudio;
  }
  if(!beepAudio){
    beepAudio = new Audio('A123.mp3');
  }
  return beepAudio;
}

function playOnce(){
  var cfg = ensureRealtimeConfig();
  if(!cfg.incomingSoundEnabled) return;
  try{
    var audio = ensureBeepAudio();
    if(!audio) return;
    audio.currentTime = 0;
    var p = audio.play();
    if(p && p.catch) p.catch(function(){});
  }catch(err){
    console.error('playOnce 失敗：', err);
  }
}

function showOnlineOrderOverlay(orderId){
  const overlay = document.getElementById('onlineOrderOverlay');
  if(!overlay) return;

  const order = (state.onlineIncomingOrders || []).find(o => o.id === orderId);
  const isReservation = !!(order && order.reservationAt);
  const reservationText = isReservation ? fmtLocalDateTime(order.reservationAt) : '';

  document.getElementById('overlayOrderNo').textContent = order ? (order.orderNo || order.id) : orderId;
  document.getElementById('overlayTotal').textContent = order
    ? `$${order.total || order.subtotal || order.totalAmount || 0}`
    : '';
  const baseMeta = order
    ? `${order.createdAt ? fmtLocalDateTime(order.createdAt) : ''} · ${order.orderType || '線上點餐'}`
    : '';
  document.getElementById('overlayMeta').textContent = isReservation
    ? `${baseMeta} · 📅 預約取餐：${reservationText}`
    : baseMeta;
  document.getElementById('overlayCustomer').textContent = order
    ? `${order.customerName || '匿名'} / ${order.customerPhone || ''}`
    : '';

  const itemsEl = document.getElementById('overlayItems');
  if(order && order.items){
    itemsEl.innerHTML = order.items.map(it =>
      `<div style="padding:3px 0;">${escapeHtml(it.name || '')} x ${Number(it.qty || 0)}</div>`
    ).join('');
  } else {
    itemsEl.innerHTML = '';
  }

  document.getElementById('overlayPrepTime').value = isReservation ? 30 : 20;
  document.getElementById('overlayMessage').value = '';

  overlay.style.display = 'flex';

  const acceptBtn = document.getElementById('overlayAcceptBtn');
  acceptBtn.disabled = false;
  acceptBtn.textContent = isReservation ? '✓ 確認預約' : '確認接單';
  acceptBtn.onclick = async ()=>{
    const prepTime = parseInt(document.getElementById('overlayPrepTime').value) || 20;
    const defaultMsg = isReservation
      ? `已收到您的預約（${reservationText}），將於時段前備餐`
      : `預計 ${prepTime} 分鐘後可取餐`;
    const msg = document.getElementById('overlayMessage').value || defaultMsg;
    acceptBtn.disabled = true;
    acceptBtn.textContent = '處理中...';
    try{
      const result = await confirmOnlineOrder(orderId, prepTime, msg);
      stopAlarm();
      if(result){
        const posOrder = buildRealtimeOrderForPOS(result);
        if(!Array.isArray(state.orders)) state.orders = [];
        state.orders.unshift(posOrder);
        persistAll();

        try {
          const cust = await import('./customer-service.js');
          cust.upsertCustomerFromOrder(posOrder);
          cust.syncCustomerToFirebase(posOrder);
        } catch (e) { console.warn('顧客主檔更新失敗：', e); }

        if(!isReservation){
          try{
            const { printOrderReceipt, printKitchenCopies } = await import('./print-service.js');
            const cfg2 = ensureRealtimeConfig();
            if(cfg2.autoPrintKitchenOnConfirm) printKitchenCopies(posOrder);
            if(cfg2.autoPrintReceiptOnConfirm) printOrderReceipt(posOrder, 'customer');
          }catch(pe){ console.error('自動列印失敗：', pe); }
        }
      }
      if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
      if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
    }catch(err){
      alert('接單失敗：' + err.message);
      acceptBtn.disabled = false;
      acceptBtn.textContent = isReservation ? '✓ 確認預約' : '確認接單';
    }
  };

  const rejectBtn = document.getElementById('overlayRejectBtn');
  if(rejectBtn){
    if(isReservation){
      rejectBtn.style.display = 'none';
    } else {
      rejectBtn.style.display = '';
      rejectBtn.disabled = false;
      rejectBtn.textContent = '拒絕訂單';
      rejectBtn.onclick = async ()=>{
        if(!confirm('確定拒絕此訂單？')) return;
        rejectBtn.disabled = true;
        rejectBtn.textContent = '處理中...';
        try{
          await rejectOnlineOrder(orderId, '店家拒絕接單');
          stopAlarm();
          if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
          if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
        }catch(err){
          alert('拒絕失敗：' + err.message);
          rejectBtn.disabled = false;
          rejectBtn.textContent = '拒絕訂單';
        }
      };
    }
  }
}


function startAlarm(orderId){
  if(activeAlarmInterval){ clearInterval(activeAlarmInterval); activeAlarmInterval = null; }
  if(activeAlarmTimeout){ clearTimeout(activeAlarmTimeout); activeAlarmTimeout = null; }
  activeAlarmOrderId = orderId;

  showOnlineOrderOverlay(orderId);

  setTimeout(()=>{
    if(!activeAlarmOrderId) return;
    playOnce();
    activeAlarmInterval = setInterval(()=>{
      const overlay = document.getElementById('onlineOrderOverlay');
      if(!overlay || overlay.style.display === 'none'){
        return;
      }
      playOnce();
    }, 3000);
  }, 1000);

  activeAlarmTimeout = setTimeout(async ()=>{
    const autoOrderId = activeAlarmOrderId;
    stopAlarm();
    if(!autoOrderId) return;
    try{
      const result = await confirmOnlineOrder(autoOrderId, 20, '系統自動接單，預計準備時間 20 分鐘');
      if(result){
        const posOrder = buildRealtimeOrderForPOS(result);
        if(!Array.isArray(state.orders)) state.orders = [];
        state.orders.unshift(posOrder);
        persistAll();

        try {
          const cust = await import('./customer-service.js');
          cust.upsertCustomerFromOrder(posOrder);
          cust.syncCustomerToFirebase(posOrder);
        } catch (e) { console.warn('顧客主檔更新失敗：', e); }

        try{
          const { printOrderReceipt, printKitchenCopies } = await import('./print-service.js');
          const cfg2 = ensureRealtimeConfig();
          if(cfg2.autoPrintKitchenOnConfirm) printKitchenCopies(posOrder);
          if(cfg2.autoPrintReceiptOnConfirm) printOrderReceipt(posOrder, 'customer');
        }catch(pe){ console.error('自動接單列印失敗：', pe); }
      }
      if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
      if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
    }catch(err){ console.error('自動接單失敗：', err); }
  }, 60000);
}

function stopAlarm(){
  if(activeAlarmInterval){ clearInterval(activeAlarmInterval); activeAlarmInterval = null; }
  if(activeAlarmTimeout){ clearTimeout(activeAlarmTimeout); activeAlarmTimeout = null; }
  activeAlarmOrderId = null;
  const overlay = document.getElementById('onlineOrderOverlay');
  if(overlay) overlay.style.display = 'none';
}

function beep(){
  const cfg = ensureRealtimeConfig();
  if(!cfg.incomingSoundEnabled) return;
  playOnce();
}

// ============================================================
// 認證
// ============================================================
export async function signInPOSWithGoogle(){
  await loadFirebaseModules();
  try{ await authApi.setPersistence(authInstance, authApi.browserLocalPersistence); }catch(e){}
  if(authInstance.currentUser && authInstance.currentUser.isAnonymous){
    try{ await authApi.signOut(authInstance); }catch(e){}
  }
  const result = await authApi.signInWithPopup(authInstance, googleProvider);
  return result.user;
}

export async function signOutPOSGoogle(){
  await loadFirebaseModules();
  await authApi.signOut(authInstance);
  state.onlineIncomingOrders = [];
  updateSyncStatus('POS Google 已登出');
}

export async function signInCustomerAnonymously(){
  await loadFirebaseModules();
  try{ await authApi.setPersistence(authInstance, authApi.inMemoryPersistence); }catch(e){}
  if(authInstance.currentUser) return authInstance.currentUser;
  const result = await authApi.signInAnonymously(authInstance);
  return result.user;
}

export function getRealtimeAuthUser(){
  return (authInstance && authInstance.currentUser) || null;
}

export async function waitForAuthReady(){
  await loadFirebaseModules();
  return await new Promise(resolve => {
    const unsub = authApi.onAuthStateChanged(authInstance, user => {
      unsub();
      resolve(user || null);
    });
  });
}

export async function verifyPOSAccess(){
  await loadFirebaseModules();
  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user) throw new Error('請先使用 POS Google 登入');

  const staffRef = await getRef(`staff/${user.uid}`);
  const snapshot = await dbApi.get(staffRef);
  const staffRow = snapshot.val() || null;
  const role = String(staffRow?.role || '').trim();
  if(role !== 'staff' && role !== 'admin'){
    throw new Error(`Google 已登入，但 Firebase 沒有 POS 權限。請到 Realtime Database 手動建立：staff/${user.uid}/role = "admin"（或 staff），並加入 email 欄位。`);
  }
  return {
    uid: user.uid,
    email: user.email || staffRow?.email || '',
    role,
    canPublishMenu: role === 'admin' || staffRow?.canPublishMenu === true
  };
}

function assertCanPublishSharedMenu(access){
  if(!access || access.canPublishMenu !== true){
    throw new Error('此帳號只能讀取共用雲端菜單，不能修改主要菜單資料。請使用 admin 帳號，或在 Firebase 設定 staff/你的UID/canPublishMenu = true。');
  }
}

// ============================================================
// 訂單操作（多店分流：路徑為 onlineOrders/{storeCode}/{orderId}）
// ============================================================

/**
 * 顧客送單。storeCode 必填（由顧客端從 URL 取得）。
 */
function buildCustomerLookupSnapshot(orderId, order, statusOverride){
  const items = Array.isArray(order.items) ? order.items.slice(0, 80).map(function(it){
    return {
      productId: it.productId || '',
      name: String(it.name || '').slice(0, 80),
      qty: Math.max(1, Number(it.qty || 1)),
      selections: Array.isArray(it.selections) ? it.selections.slice(0, 20).map(function(s){
        return {
          moduleName: String(s.moduleName || '').slice(0, 40),
          optionName: String(s.optionName || '').slice(0, 40)
        };
      }) : []
    };
  }) : [];
  return {
    id: orderId,
    orderNo: order.orderNo || orderId,
    createdAt: order.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: statusOverride || order.status || 'pending_confirm',
    orderType: order.orderType || '線上點餐',
    reservationAt: order.reservationAt || '',
    prepTimeMinutes: order.prepTimeMinutes || null,
    estimatedReadyAt: order.estimatedReadyAt || null,
    replyMessage: order.replyMessage || '',
    subtotal: Number(order.subtotal || 0),
    discountAmount: Number(order.discountAmount || 0),
    total: Number(order.total || order.subtotal || 0),
    customerUid: order.customerUid || '',
    items
  };
}

async function setCustomerLookupSnapshot(storeCode, lookupKey, orderId, order, statusOverride){
  if(!lookupKey || !orderId) return;
  const ref = await getRef(`customerOrderLookup/${storeCode}/${lookupKey}/${orderId}`);
  await dbApi.set(ref, buildCustomerLookupSnapshot(orderId, order, statusOverride));
}

async function updateCustomerLookupSnapshot(storeCode, lookupKey, orderId, patch){
  if(!lookupKey || !orderId) return;
  const ref = await getRef(`customerOrderLookup/${storeCode}/${lookupKey}/${orderId}`);
  await dbApi.update(ref, Object.assign({}, patch || {}, { updatedAt: new Date().toISOString() }));
}

export async function pushOnlineOrder(order, storeCode){
  const cfg = ensureRealtimeConfig();
  if(!cfg.enabled) throw new Error('即時接單尚未啟用');
  const code = validateStoreCode(storeCode);

  const user = await signInCustomerAnonymously();
  const rootRef = await getRef(`onlineOrders/${code}`);
  const newRef = dbApi.push(rootRef);

  let customerLookupKey = '';
  try {
    const cust = await import('./customer-service.js');
    customerLookupKey = await cust.buildLookupKeyForOrder(order);
  } catch (e) {
    console.warn('buildLookupKeyForOrder failed:', e);
  }

  const createdOrder = Object.assign({}, order, {
    storeCode: code,
    customerUid: user.uid,
    customerLookupKey,
    status: 'pending_confirm',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prepTimeMinutes: null,
    estimatedReadyAt: null,
    replyMessage: ''
  });

  try{
    await dbApi.set(newRef, createdOrder);
  }catch(err){
    const msg = String((err && (err.code || err.message)) || err || '');
    if(msg.indexOf('PERMISSION_DENIED') >= 0 || msg.indexOf('permission') >= 0){
      throw new Error('Firebase 拒絕顧客送單。請確認已發布新版安全規則、已啟用 Anonymous 匿名登入，且網址 storeId 與規則路徑一致（目前：' + code + '）。');
    }
    throw err;
  }

  if(customerLookupKey){
    try{
      await setCustomerLookupSnapshot(code, customerLookupKey, newRef.key, createdOrder, 'pending_confirm');
    }catch(err){
      // 顧客查詢索引屬於輔助資料；主訂單已成功寫入 onlineOrders，不可因此讓客人誤以為送單失敗。
      console.warn('customerOrderLookup write failed; main order already created:', err);
      cfg.lastSyncStatus = '顧客訂單已送出，但查詢索引建立失敗（不影響 POS 接單）';
    }
  }

  cfg.lastOrderAt = new Date().toISOString();
  cfg.lastSyncStatus = cfg.lastSyncStatus || `顧客訂單已送出（${code}）`;
  if(cfg.lastSyncStatus.indexOf('查詢索引') < 0) cfg.lastSyncStatus = `顧客訂單已送出（${code}）`;
  persistAll();
  return newRef.key;
}

/**
 * 顧客監聽自己訂單狀態。storeCode 必填。
 */
export async function watchCustomerOrder(orderId, onChange, storeCode, onError){
  await loadFirebaseModules();
  const code = validateStoreCode(storeCode);
  const ref = await getRef(`onlineOrders/${code}/${orderId}`);
  const callback = snapshot => {
    const val = snapshot.val();
    if(val) onChange(val);
  };
  const errorCallback = error => {
    console.warn('watchCustomerOrder permission/read failed:', error);
    if(typeof onError === 'function') onError(error);
  };
  dbApi.onValue(ref, callback, errorCallback);
  return ()=> dbApi.off(ref, 'value', callback);
}

/**
 * POS 啟動監聽自己店的進單。storeCode 由本機 state.settings.dashboard.storeId 取得。
 */
export async function startPOSRealtimeListener(onRefresh){
  const cfg = ensureRealtimeConfig();
  if(!cfg.enabled) return;
  await loadFirebaseModules();

  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user){
    updateSyncStatus('POS 尚未登入 Google');
    return;
  }
  if(user.isAnonymous){
    try{ await authApi.signOut(authInstance); }catch(e){}
    updateSyncStatus('目前是顧客匿名登入狀態，請在 POS 重新按「Google 登入」後接單');
    return;
  }

  await verifyPOSAccess();

  let code;
  try{
    code = getStoreCode();
  }catch(err){
    updateSyncStatus(err.message);
    return;
  }

  detachPOSRealtimeListeners();

  let seen = new Set(JSON.parse(sessionStorage.getItem('pos_seen_online_orders') || '[]'));
  const listenerCodes = getPublicStoreWriteAliases(code);
  const listenerValues = {};

  const rebuildIncoming = function(){
    var merged = [];
    listenerCodes.forEach(function(pathCode){
      var value = listenerValues[pathCode] || {};
      Object.entries(value).forEach(function(entry){
        var id = entry[0];
        var row = entry[1] || {};
        merged.push(Object.assign({}, row, { id: id, _storeCode: pathCode }));
      });
    });
    const incoming = merged.sort((a,b)=> new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    state.onlineIncomingOrders = incoming;

    let hasNewOrder = false;
    incoming.forEach(order => {
      const seenKey = (order._storeCode || order.storeCode || code) + '/' + order.id;
      if(order.status === 'pending_confirm' && !seen.has(seenKey)){
        seen.add(seenKey);
        cfg.lastOrderAt = new Date().toISOString();
        cfg.lastSyncStatus = `收到新訂單：${order.customerName || order.orderNo || order.id}`;
        sessionStorage.setItem('pos_seen_online_orders', JSON.stringify([...seen]));
        hasNewOrder = true;
      }
    });

    const latestPending = incoming.find(o => o.status === 'pending_confirm');
    if(latestPending && (!activeAlarmOrderId || activeAlarmOrderId !== latestPending.id)){
      if(hasNewOrder || !activeAlarmInterval){
        startAlarm(latestPending.id);
      }
    }

    if(!incoming.some(order => order.status === 'pending_confirm')){
      cfg.lastSyncStatus = `即時接單監聽中（${listenerCodes.join(',')}）`;
      stopAlarm();
    }

    persistAll();
    if(typeof onRefresh === 'function') onRefresh();
    if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
  };

  for(var i = 0; i < listenerCodes.length; i++){
    let pathCode = listenerCodes[i];
    const ref = await getRef(`onlineOrders/${pathCode}`);
    const callback = snapshot => {
      listenerValues[pathCode] = snapshot.val() || {};
      rebuildIncoming();
    };
    dbApi.onValue(ref, callback, (error)=>{
      console.warn('onlineOrders listener failed:', pathCode, error);
      if(pathCode === code){
        state.onlineIncomingOrders = [];
        cfg.lastSyncStatus = error?.code === 'PERMISSION_DENIED'
          ? '沒有 Firebase staff 權限，請建立 staff/你的uid/role 與 stores/' + code + '=true'
          : `即時接單監聽失敗：${error?.message || '未知錯誤'}`;
        persistAll();
        if(typeof onRefresh === 'function') onRefresh();
        if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
      }
    });
    posListenerEntries.push({ ref: ref, callback: callback });
    if(i === 0){ posListenerRef = ref; posListenerCallback = callback; }
  }

  cfg.lastSyncStatus = `即時接單監聽中（${listenerCodes.join(',')}）`;
  persistAll();
  if(typeof onRefresh === 'function') onRefresh();
  if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
}

/**
 * POS 確認訂單。storeCode 由本機 state 取得。
 */
export async function confirmOnlineOrder(orderId, prepTimeMinutes = 0, replyMessage = ''){
  const code = getOnlineOrderStoreCode(orderId);
  const ref = await getRef(`onlineOrders/${code}/${orderId}`);
  const snapshot = await dbApi.get(ref);
  const order = snapshot.val();
  if(!order) throw new Error('找不到訂單');

  const safePrepMinutes = Math.max(0, Number(prepTimeMinutes || 0));
  const estimatedReadyAt = safePrepMinutes > 0
    ? new Date(Date.now() + safePrepMinutes * 60 * 1000).toISOString()
    : null;
  const safeReplyMessage = String(replyMessage || '').trim().slice(0, 120);

  await dbApi.update(ref, {
    status: 'confirmed',
    prepTimeMinutes: safePrepMinutes || null,
    estimatedReadyAt: estimatedReadyAt || null,
    replyMessage: safeReplyMessage || null,
    updatedAt: new Date().toISOString()
  });
  if(order.customerLookupKey){
    await updateCustomerLookupSnapshot(code, order.customerLookupKey, orderId, {
      status: 'confirmed',
      prepTimeMinutes: safePrepMinutes || null,
      estimatedReadyAt: estimatedReadyAt || null,
      replyMessage: safeReplyMessage || null
    });
  }

  const cfg = ensureRealtimeConfig();
  cfg.lastConfirmedAt = new Date().toISOString();
  cfg.lastSyncStatus = `已確認訂單：${order.customerName || order.orderNo || orderId}`;
  persistAll();
  return {
    id: orderId,
    ...order,
    status: 'confirmed',
    prepTimeMinutes: safePrepMinutes,
    estimatedReadyAt,
    replyMessage: safeReplyMessage
  };
}

/**
 * POS 拒絕訂單。
 */
export async function rejectOnlineOrder(orderId, replyMessage = ''){
  const code = getOnlineOrderStoreCode(orderId);
  const ref = await getRef(`onlineOrders/${code}/${orderId}`);
  const snapshot = await dbApi.get(ref);
  const order = snapshot.val() || {};
  const safeReplyMessage = String(replyMessage || '').trim().slice(0, 120);
  await dbApi.update(ref, {
    status: 'rejected',
    replyMessage: safeReplyMessage || '店家目前無法接單，請稍後再試。',
    updatedAt: new Date().toISOString()
  });
  if(order.customerLookupKey){
    await updateCustomerLookupSnapshot(code, order.customerLookupKey, orderId, {
      status: 'rejected',
      replyMessage: safeReplyMessage || '店家目前無法接單，請稍後再試。'
    });
  }
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = `已拒絕訂單：${orderId}`;
  persistAll();
}

function rebuildTrustedOnlineItems(remoteItems){
  const products = Array.isArray(state.products) ? state.products : [];
  const modules = Array.isArray(state.modules) ? state.modules : [];
  let warning = '';
  const trusted = [];
  (Array.isArray(remoteItems) ? remoteItems : []).slice(0, 80).forEach(function(raw){
    if(!raw) return;
    const product = products.find(function(p){ return p && p.id === raw.productId; });
    const qty = Math.max(1, Math.min(99, Number(raw.qty || 1)));
    if(!product || product.enabled === false || product.soldOut === true){
      warning = warning || '部分商品不存在、停售或售完，已由 POS 重新標記為待人工確認';
      trusted.push({
        rowId: raw.rowId || ('remote_' + Date.now()),
        productId: raw.productId || '',
        name: String(raw.name || '未知商品').slice(0, 80) + '（需確認）',
        basePrice: 0,
        extraPrice: 0,
        qty,
        note: String(raw.note || '').slice(0, 120),
        selections: []
      });
      return;
    }

    const selections = [];
    let extraPrice = 0;
    const remoteSelections = Array.isArray(raw.selections) ? raw.selections : [];
    remoteSelections.forEach(function(sel){
      const mod = modules.find(function(m){ return m && m.id === sel.moduleId; });
      if(!mod || !Array.isArray(mod.options)) return;
      const opt = mod.options.find(function(o){ return o && o.id === sel.optionId && o.enabled !== false; });
      if(!opt) return;
      const price = Number(opt.price || 0);
      extraPrice += price;
      selections.push({
        moduleId: mod.id,
        moduleName: mod.name || '',
        optionId: opt.id,
        optionName: opt.name || '',
        price
      });
    });

    const basePrice = Number(product.price || 0);
    if(Number(raw.basePrice || 0) !== basePrice || Number(raw.extraPrice || 0) !== extraPrice){
      warning = warning || '線上訂單價格已依 POS 菜單重新計算';
    }
    trusted.push({
      rowId: raw.rowId || ('remote_' + Date.now()),
      productId: product.id,
      name: product.name || raw.name || '',
      basePrice,
      extraPrice,
      qty,
      note: String(raw.note || '').slice(0, 120),
      selections
    });
  });
  return { items: trusted, warning };
}

export function buildRealtimeOrderForPOS(remote){
  const rebuilt = rebuildTrustedOnlineItems(remote.items);
  const items = rebuilt.items;
  const subtotal = items.reduce((s, x) => s + ((Number(x.basePrice || 0) + Number(x.extraPrice || 0)) * Number(x.qty || 0)), 0);
  const promo = remote.promotionCode ? calculatePromotion(items, remote.promotionCode) : null;
  const discountAmount = promo && promo.ok ? Number(promo.discount || 0) : 0;
  return {
    id: 'online_' + remote.id,
    orderNo: remote.orderNo || ('ON' + Date.now()),
    createdAt: remote.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'pending',
    paymentMethod: '待付款',
    orderType: remote.orderType || '線上點餐',
    tableNo: `${remote.customerName || ''}${remote.customerPhone ? ' / ' + remote.customerPhone : ''}`,
    customerName: remote.customerName || '',
    customerPhone: remote.customerPhone || '',
    customerNote: remote.customerNote || '',
    customerLookupKey: remote.customerLookupKey || '',
    storeCode: remote.storeCode || '',
    prepTimeMinutes: Number(remote.prepTimeMinutes || 0),
    estimatedReadyAt: remote.estimatedReadyAt || '',
    merchantReplyMessage: remote.replyMessage || '',
    pricingWarning: rebuilt.warning || '',
    promotionCode: remote.promotionCode || '',
    promotionTitle: promo && promo.ok ? promo.title : '',
    discountType: 'amount',
    discountValue: discountAmount,
    discountAmount: discountAmount,
    sessionId: getCurrentSession()?.id || null,
    subtotal,
    total: Math.max(0, subtotal - discountAmount),
    items
  };
}

// ============================================================
// 菜單同步（維持用 projectId，所有店共用）
// ============================================================
export async function syncMenuToFirebase(){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();

  if(cfg.deviceRole !== 'master'){
    throw new Error('此裝置設定為「從機」，無上傳菜單權限。請改為主機角色或改按「讀取雲端菜單」。');
  }

  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user) throw new Error('請先使用 POS Google 登入');
  const access = await verifyPOSAccess();
  assertCanPublishSharedMenu(access);

  const menuKey = cfg.projectId || 'default';
  const menuData = {
    categories: state.categories || [],
    products: (state.products || []).map(function(p){
  return {
    id: p.id,
    sku: p.sku || '',
    name: p.name,
    price: p.price,
    category: p.category,
    image: p.image || '',
    description: p.description || '',
    modules: p.modules || [],
    sortOrder: p.sortOrder || 0,
    enabled: p.enabled !== false,
    soldOut: p.soldOut === true
  };
}),

    modules: state.modules || [],
    promotions: getPublicPromotionsConfig(),
    updatedAt: new Date().toISOString()
  };

  const menuRef = await getRef('menu/' + menuKey);
  await dbApi.set(menuRef, menuData);

  try{
    const publicStoreCode = getStoreCode();
    await publishPublicOnlineStore(publicStoreCode, menuData.promotions);
  }catch(err){
    console.warn('public online store promotion sync skipped:', err);
  }

  cfg.lastSyncStatus = '菜單同步成功';
  cfg.lastSyncTime = new Date().toISOString();
  persistAll();
}

function buildPublicProductAvailability(){
  const availability = {};
  (state.products || []).forEach(function(p){
    if(!p || !p.id) return;
    availability[p.id] = {
      enabled: p.enabled !== false,
      soldOut: p.soldOut === true,
      updatedAt: new Date().toISOString()
    };
  });
  return availability;
}

async function publishPublicOnlineStore(storeCode, promotions){
  const primaryCode = validateStoreCode(storeCode);
  const aliases = getPublicStoreWriteAliases(primaryCode);
  const promoPayload = promotions || getPublicPromotionsConfig();
  const availabilityPayload = buildPublicProductAvailability();
  const updatedAt = new Date().toISOString();
  const success = [];
  const errors = [];

  for(var i = 0; i < aliases.length; i++){
    var code = aliases[i];
    try{
      const publicRef = await getRef('publicOnlineStores/' + code);
      await dbApi.update(publicRef, {
        storeId: code,
        promotions: promoPayload,
        productAvailability: availabilityPayload,
        updatedAt: updatedAt
      });
      success.push(code);
    }catch(err){
      errors.push(code + ': ' + (err && err.message ? err.message : err));
    }
  }
  if(!success.length){
    throw new Error('publicOnlineStores 發布失敗：' + errors.join('；'));
  }
  if(errors.length){
    console.warn('部分 publicOnlineStores alias 發布失敗：', errors.join('；'));
  }
  return success.join(',');
}

export async function publishOnlineStoreAvailabilityNow(storeCode){
  await loadFirebaseModules();
  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user) throw new Error('請先使用 POS Google 登入');
  await verifyPOSAccess();
  const code = await publishPublicOnlineStore(storeCode || getStoreCode(), getPublicPromotionsConfig());
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = '線上點餐商品狀態已發布（' + code + '）';
  cfg.lastSyncTime = new Date().toISOString();
  persistAll();
  return code;
}

export async function publishOnlineStorePromotionsNow(storeCode){
  await loadFirebaseModules();
  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user) throw new Error('請先使用 POS Google 登入');
  await verifyPOSAccess();
  const code = await publishPublicOnlineStore(storeCode || getStoreCode(), getPublicPromotionsConfig());
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = '線上點餐廣告已發布（' + code + '）';
  cfg.lastSyncTime = new Date().toISOString();
  persistAll();
  return code;
}

async function fetchPublicOnlineStorePromotions(storeCode){
  if(!storeCode) return null;
  try{
    const aliases = getPublicStoreReadAliases(storeCode);
    for(var i = 0; i < aliases.length; i++){
      var code = aliases[i];
      const publicRef = await getRef('publicOnlineStores/' + code);
      const publicSnap = await dbApi.get(publicRef);
      const publicData = publicSnap.val();
      if(publicData){
        lastPublicOnlineStoreData = publicData;
        applyPublicOnlineStore(publicData);
        return publicData.promotions || null;
      }
    }
  }catch(err){
    console.warn('fetch public online promotions failed:', err);
  }
  return null;
}

function clearOnlinePromotionsForPublicStore(){
  importPromotionsFromCloud({
    enabled: false,
    heroTitle: '',
    heroSubtitle: '',
    heroBadge: '',
    theme: 'orange',
    banners: [],
    coupons: [],
    updatedAt: new Date().toISOString()
  });
}


export async function fetchMenuFromFirebase(storeCode){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const menuKey = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + menuKey);
  const snapshot = await dbApi.get(menuRef);
  const data = snapshot.val();
  if(!data) throw new Error('雲端尚無菜單資料，請先在 POS 同步菜單到雲端');
  if(data.products && Array.isArray(data.products)){
    state.products = data.products;
  }
  if(data.modules && Array.isArray(data.modules)){
    state.modules = data.modules;
  }
  if(data.categories && Array.isArray(data.categories)){
    state.categories = data.categories;
  }
  if(data.promotions && typeof data.promotions === 'object'){
    // 先套用共用菜單廣告當保底，避免 publicOnlineStores 尚未建立時手機整塊廣告消失。
    importPromotionsFromCloud(data.promotions);
  }
  lastPublicOnlineStoreData = null;
  const storePromotions = await fetchPublicOnlineStorePromotions(storeCode);
  if(storePromotions){
    data.promotions = storePromotions;
  }else if(storeCode && lastPublicOnlineStoreData){
    // 只有確定 publicOnlineStores/{storeCode} 存在、但該店刻意沒有 promotions 時，才清空廣告。
    clearOnlinePromotionsForPublicStore();
  }
  return data;
}

export async function fetchAndMergeMenuFromFirebase(){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const menuKey = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + menuKey);
  const snapshot = await dbApi.get(menuRef);
  const data = snapshot.val();
  if(!data) throw new Error('雲端尚無菜單資料，請先在主機按「上傳菜單」');

  let cloudCount = 0;
  let localKeptCount = 0;

  if(Array.isArray(data.categories)){
    const localCats = state.categories || [];
    const merged = [...data.categories];
    localCats.forEach(c => { if(!merged.includes(c)) merged.push(c); });
    if(!merged.includes('未分類')) merged.unshift('未分類');
    state.categories = merged;
  }

  if(Array.isArray(data.modules)){
    const localMods = state.modules || [];
    const merged = [];
    const usedIds = new Set();
    data.modules.forEach(m => { if(m && m.id){ merged.push(m); usedIds.add(m.id); }});
    localMods.forEach(m => { if(m && m.id && !usedIds.has(m.id)){ merged.push(m); localKeptCount++; }});
    state.modules = merged;
  }

  if(Array.isArray(data.products)){
    const localProds = state.products || [];
    const localMap = {};
    localProds.forEach(p => { if(p && p.id) localMap[p.id] = p; });
    const merged = [];
    const usedIds = new Set();
    data.products.forEach(cp => {
      if(!cp || !cp.id) return;
      const lp = localMap[cp.id];
      const enabled = lp ? (lp.enabled !== false) : (cp.enabled !== false);
      const soldOut = lp ? (lp.soldOut === true) : (cp.soldOut === true);
      merged.push({
        id: cp.id,
        sku: cp.sku || '', 
        name: cp.name || '',
        price: Number(cp.price || 0),
        category: cp.category || '未分類',
        image: cp.image || '',
        description: cp.description || '',
        modules: Array.isArray(cp.modules) ? cp.modules : [],
        sortOrder: Number(cp.sortOrder || 0),
        enabled,
        soldOut
      });
      usedIds.add(cp.id);
      cloudCount++;
    });
    localProds.forEach(p => { if(p && p.id && !usedIds.has(p.id)){ merged.push(p); localKeptCount++; }});
    state.products = merged;
  }

  if(data.promotions && typeof data.promotions === 'object'){
    importPromotionsFromCloud(data.promotions);
  }

  cfg.lastSyncStatus = `讀取成功：雲端 ${cloudCount} / 本地獨有保留 ${localKeptCount}`;
  cfg.lastSyncTime = new Date().toISOString();
  persistAll();
  return { cloudCount, localKeptCount };
}

let menuWatchUnsub = null;
let publicOnlineStoreWatchUnsub = null;
let menuPollTimer = null;
let lastPublicOnlineStoreData = null;
export async function startMenuAutoWatch(onUpdate, storeCode){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const menuKey = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + menuKey);
  const publicCode = storeCode ? validateStoreCode(storeCode) : '';
  lastPublicOnlineStoreData = null;
  const publicCodes = publicCode ? getPublicStoreReadAliases(publicCode) : [];
  const publicRefs = [];
  for(var prIdx = 0; prIdx < publicCodes.length; prIdx++){
    publicRefs.push({ code: publicCodes[prIdx], ref: await getRef('publicOnlineStores/' + publicCodes[prIdx]) });
  }

  if(menuWatchUnsub){ try{ menuWatchUnsub(); }catch(e){} menuWatchUnsub = null; }
  if(publicOnlineStoreWatchUnsub){ try{ publicOnlineStoreWatchUnsub(); }catch(e){} publicOnlineStoreWatchUnsub = null; }
  if(menuPollTimer){ clearInterval(menuPollTimer); menuPollTimer = null; }

  const handler = (snapshot) => {
    const data = snapshot.val();
    if(!data) return;
    try {
      applyCloudMenu(data, { skipPromotions: !!publicCode, forceCloudProducts: true });
      if(lastPublicOnlineStoreData) applyPublicOnlineStore(lastPublicOnlineStoreData);
      if(typeof onUpdate === 'function') onUpdate();
    } catch(e){ console.warn('menu watch handler failed:', e); }
  };
  dbApi.onValue(menuRef, handler);
  menuWatchUnsub = ()=> dbApi.off(menuRef, 'value', handler);

  if(publicRefs.length){
    const publicWatchEntries = [];
    publicRefs.forEach(function(entry){
      const publicHandler = (snapshot) => {
        const data = snapshot.val();
        if(!data) return;
        try{
          lastPublicOnlineStoreData = data;
          if(applyPublicOnlineStore(data) && typeof onUpdate === 'function') onUpdate();
        }catch(e){ console.warn('public online store watch failed:', entry.code, e); }
      };
      dbApi.onValue(entry.ref, publicHandler, function(err){ console.warn('public online store watch permission failed:', entry.code, err); });
      publicWatchEntries.push({ ref: entry.ref, handler: publicHandler });
    });
    publicOnlineStoreWatchUnsub = function(){
      publicWatchEntries.forEach(function(entry){
        try{ dbApi.off(entry.ref, 'value', entry.handler); }catch(e){}
      });
    };
  }

  menuPollTimer = setInterval(async ()=>{
    try{
      const snap = await dbApi.get(menuRef);
      const data = snap.val();
      if(data){ applyCloudMenu(data, { skipPromotions: !!publicCode, forceCloudProducts: true }); if(lastPublicOnlineStoreData) applyPublicOnlineStore(lastPublicOnlineStoreData); if(typeof onUpdate === 'function') onUpdate(); }
      if(publicCode){
        await fetchPublicOnlineStorePromotions(publicCode);
        if(lastPublicOnlineStoreData) applyPublicOnlineStore(lastPublicOnlineStoreData);
        if(typeof onUpdate === 'function') onUpdate();
      }
    }catch(e){ /* 靜默 */ }
  }, 30000);
}

function applyProductAvailability(availability){
  if(!availability || typeof availability !== 'object' || !Array.isArray(state.products)) return false;
  var changed = false;
  state.products.forEach(function(p){
    if(!p || !p.id || !availability[p.id]) return;
    var row = availability[p.id];
    var enabled = row.enabled !== false;
    var soldOut = row.soldOut === true;
    if(p.enabled !== enabled){ p.enabled = enabled; changed = true; }
    if(p.soldOut !== soldOut){ p.soldOut = soldOut; changed = true; }
  });
  return changed;
}

function applyPublicOnlineStore(data){
  var changed = false;
  if(data && data.promotions && typeof data.promotions === 'object' && Array.isArray(data.promotions.banners)){
    importPromotionsFromCloud(data.promotions);
    changed = true;
  }
  if(data && applyProductAvailability(data.productAvailability)){
    changed = true;
  }
  if(changed) persistAll();
  return changed;
}

function applyCloudMenu(data, options){
  const opts = options || {};
  if(!opts.skipPromotions && data.promotions && typeof data.promotions === 'object'){
    importPromotionsFromCloud(data.promotions);
  }
  if(Array.isArray(data.categories)){
    if(opts.forceCloudProducts){
      state.categories = data.categories.slice();
    }else{
      const localCats = state.categories || [];
      const merged = [...data.categories];
      localCats.forEach(c => { if(!merged.includes(c)) merged.push(c); });
      if(!merged.includes('未分類')) merged.unshift('未分類');
      state.categories = merged;
    }
  }
  if(Array.isArray(data.modules)){
    if(opts.forceCloudProducts){
      state.modules = data.modules;
    }else{
      const localMods = state.modules || [];
      const merged = [];
      const usedIds = new Set();
      data.modules.forEach(m => { if(m && m.id){ merged.push(m); usedIds.add(m.id); }});
      localMods.forEach(m => { if(m && m.id && !usedIds.has(m.id)) merged.push(m); });
      state.modules = merged;
    }
  }
  if(Array.isArray(data.products)){
    if(opts.forceCloudProducts){
      state.products = data.products.map(cp => ({
        id: cp.id, sku: cp.sku || '', name: cp.name || '', price: Number(cp.price || 0),
        category: cp.category || '未分類', image: cp.image || '',
        description: cp.description || '',
        modules: Array.isArray(cp.modules) ? cp.modules : [],
        sortOrder: Number(cp.sortOrder || 0),
        enabled: cp.enabled !== false,
        soldOut: cp.soldOut === true
      })).filter(p => !!p.id);
    }else{
      const localProds = state.products || [];
      const localMap = {};
      localProds.forEach(p => { if(p && p.id) localMap[p.id] = p; });
      const merged = [];
      const usedIds = new Set();
      data.products.forEach(cp => {
        if(!cp || !cp.id) return;
        const lp = localMap[cp.id];
        const enabled = lp ? (lp.enabled !== false) : (cp.enabled !== false);
        const soldOut = lp ? (lp.soldOut === true) : (cp.soldOut === true);
        merged.push({
          id: cp.id, sku: cp.sku || '', name: cp.name || '', price: Number(cp.price || 0),
          category: cp.category || '未分類', image: cp.image || '',
          description: cp.description || '',
          modules: Array.isArray(cp.modules) ? cp.modules : [],
          sortOrder: Number(cp.sortOrder || 0), enabled, soldOut
        });
        usedIds.add(cp.id);
      });
      localProds.forEach(p => { if(p && p.id && !usedIds.has(p.id)) merged.push(p); });
      state.products = merged;
    }
  }
  persistAll();
}

export function stopMenuAutoWatch(){
  if(menuWatchUnsub){ try{ menuWatchUnsub(); }catch(e){} menuWatchUnsub = null; }
  if(publicOnlineStoreWatchUnsub){ try{ publicOnlineStoreWatchUnsub(); }catch(e){} publicOnlineStoreWatchUnsub = null; }
  if(menuPollTimer){ clearInterval(menuPollTimer); menuPollTimer = null; }
}

export async function watchMenuFromFirebase(callback){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const menuKey = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + menuKey);
  dbApi.onValue(menuRef, (snapshot) => {
    const data = snapshot.val();
    if(!data) return;
    if(Array.isArray(data.products)) state.products = data.products;
    if(Array.isArray(data.modules))  state.modules  = data.modules;
    if(Array.isArray(data.categories)) state.categories = data.categories;
    if(data.promotions && typeof data.promotions === 'object') importPromotionsFromCloud(data.promotions);
    if(callback) callback(data);
  });
}

// ============================================================
// 預約 30 分鐘前提醒
// ============================================================
let reservationReminderInterval = null;

function showReservationReminderOverlay(order){
  const overlay = document.getElementById('reservationReminderOverlay');
  if(!overlay) return;

  document.getElementById('reminderOrderNo').textContent = order.orderNo || order.id;
  document.getElementById('reminderTotal').textContent = `$${order.total || order.subtotal || 0}`;
  const resvText = order.reservationAt ? fmtLocalDateTime(order.reservationAt) : '';
  document.getElementById('reminderMeta').textContent =
    `📅 預約取餐：${resvText} · ${order.orderType || ''}`;
  document.getElementById('reminderCustomer').textContent =
    `${order.customerName || ''} / ${order.customerPhone || ''}`;
  const itemsEl = document.getElementById('reminderItems');
  if(Array.isArray(order.items)){
    itemsEl.innerHTML = order.items.map(it =>
      `<div style="padding:3px 0;">${escapeHtml(it.name || '')} x ${Number(it.qty || 0)}</div>`
    ).join('');
  } else {
    itemsEl.innerHTML = '';
  }

  overlay.style.display = 'flex';
  try{ playOnce(); }catch(e){}

  const startBtn = document.getElementById('reminderStartBtn');
  const laterBtn = document.getElementById('reminderLaterBtn');

  startBtn.onclick = async ()=>{
    startBtn.disabled = true;
    startBtn.textContent = '處理中...';
    try{
      const { printOrderReceipt, printKitchenCopies } = await import('./print-service.js');
      try{ printKitchenCopies(order); }catch(e){ console.error('列印廚房單失敗：', e); }
      try{ printOrderReceipt(order, 'customer'); }catch(e){ console.error('列印顧客單失敗：', e); }
      order.reservationReminded = true;
      persistAll();
      overlay.style.display = 'none';
      if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
    }catch(err){
      alert('列印失敗：' + err.message);
    }finally{
      startBtn.disabled = false;
      startBtn.textContent = '🔔 開始備餐並列印廚房單';
    }
  };

  laterBtn.onclick = ()=>{
    order.reservationReminded = true;
    persistAll();
    overlay.style.display = 'none';
  };
}

function checkReservationReminders(){
  if(!Array.isArray(state.orders)) return;
  const now = Date.now();
  const overlay = document.getElementById('reservationReminderOverlay');
  if(overlay && overlay.style.display === 'flex') return;

  for(const o of state.orders){
    if(!o || !o.reservationAt) continue;
    if(o.reservationReminded === true) continue;
    if(o.status === 'completed' || o.status === 'rejected' || o.status === 'cancelled') continue;
    const resvMs = new Date(o.reservationAt).getTime();
    if(isNaN(resvMs)) continue;
    const diff = resvMs - now;
    if(diff > 0 && diff <= 30 * 60 * 1000){
      showReservationReminderOverlay(o);
      break;
    }
  }
}

export function startReservationReminderLoop(){
  if(reservationReminderInterval) return;
  try{ checkReservationReminders(); }catch(e){ console.error(e); }
  reservationReminderInterval = setInterval(()=>{
    try{ checkReservationReminders(); }catch(e){ console.error('reservation reminder check failed:', e); }
  }, 60000);
}

export function stopReservationReminderLoop(){
  if(reservationReminderInterval){
    clearInterval(reservationReminderInterval);
    reservationReminderInterval = null;
  }
}
