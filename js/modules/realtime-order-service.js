/* 中文備註：Firebase 即時接單服務（v2.1.25）。
 * 變更：
 *   1. 自動列印旗標改讀 autoPrintKitchenOnConfirm / autoPrintReceiptOnConfirm
 *   2. pushOnlineOrder 自動加 customerLookupKey（SHA-256 hash 供自助查單）
 *   3. 確認接單後寫入顧客主檔（customer-service.upsertCustomerFromOrder + sync）
 *   4. 公開 _getRef / _dbApi 供 customer-service 使用
 */
import { state, persistAll } from '../core/store.js';
import { getCurrentSession } from './report-session.js';
import { fmtLocalDateTime } from '../core/utils.js';


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
    autoPrintKitchenOnConfirm: current.autoPrintKitchenOnConfirm !== false,    // 預設 true
    autoPrintReceiptOnConfirm: current.autoPrintReceiptOnConfirm !== false,    // 預設 true
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

// ── 公開給 customer-service.js 使用 ──
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
      `<div style="padding:3px 0;">${it.name} x ${it.qty}</div>`
    ).join('');
  } else {
    itemsEl.innerHTML = '';
  }

  document.getElementById('overlayPrepTime').value = isReservation ? 30 : 20;
  document.getElementById('overlayMessage').value = '';

  overlay.style.display = 'flex';

  // 接受按鈕
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

        // 預約單接單時不立即列印（等 30 分鐘前再印）
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

  // 拒絕按鈕（預約單隱藏）
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
  if(activeAlarmInterval){
    activeAlarmOrderId = orderId;
    return;
  }
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

  // 60 秒自動接單
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
    role
  };
}

// ============================================================
// 訂單操作
// ============================================================

/**
 * 顧客送單。會自動加上 customerLookupKey（SHA-256 hash），供顧客自助查詢。
 */
export async function pushOnlineOrder(order){
  const cfg = ensureRealtimeConfig();
  if(!cfg.enabled) throw new Error('即時接單尚未啟用');
  const user = await signInCustomerAnonymously();
  const rootRef = await getRef('onlineOrders');
  const newRef = dbApi.push(rootRef);

  // 算 customerLookupKey（讓顧客之後能自助查單）
  let customerLookupKey = '';
  try {
    const cust = await import('./customer-service.js');
    customerLookupKey = await cust.buildLookupKeyForOrder(order);
  } catch (e) {
    console.warn('buildLookupKeyForOrder failed:', e);
  }

  await dbApi.set(newRef, Object.assign({}, order, {
    customerUid: user.uid,
    customerLookupKey,                   // ← 新增欄位
    status: 'pending_confirm',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prepTimeMinutes: null,
    estimatedReadyAt: null,
    replyMessage: ''
  }));

  cfg.lastOrderAt = new Date().toISOString();
  cfg.lastSyncStatus = '顧客訂單已送出';
  persistAll();
  return newRef.key;
}

export async function watchCustomerOrder(orderId, onChange){
  await loadFirebaseModules();
  const ref = await getRef(`onlineOrders/${orderId}`);
  const callback = snapshot => {
    const val = snapshot.val();
    if(val) onChange(val);
  };
  dbApi.onValue(ref, callback);
  return ()=> dbApi.off(ref, 'value', callback);
}

export async function startPOSRealtimeListener(onRefresh){
  const cfg = ensureRealtimeConfig();
  if(!cfg.enabled) return;
  await loadFirebaseModules();

  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user){
    updateSyncStatus('POS 尚未登入 Google');
    return;
  }

  await verifyPOSAccess();
  const ref = await getRef('onlineOrders');
  if(posListenerRef && posListenerCallback){
    dbApi.off(posListenerRef, 'value', posListenerCallback);
  }

  let seen = new Set(JSON.parse(sessionStorage.getItem('pos_seen_online_orders') || '[]'));

  posListenerRef = ref;
  posListenerCallback = snapshot => {
    const value = snapshot.val() || {};
    const incoming = Object.entries(value)
      .map(([id, row]) => ({ id, ...row }))
      .sort((a,b)=> new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    state.onlineIncomingOrders = incoming;

    let hasNewOrder = false;
    incoming.forEach(order => {
      if(order.status === 'pending_confirm' && !seen.has(order.id)){
        seen.add(order.id);
        cfg.lastOrderAt = new Date().toISOString();
        cfg.lastSyncStatus = `收到新訂單：${order.customerName || order.orderNo || order.id}`;
        sessionStorage.setItem('pos_seen_online_orders', JSON.stringify([...seen]));
        hasNewOrder = true;
      }
    });

    if(hasNewOrder && !activeAlarmInterval){
      const latestPending = incoming.find(o => o.status === 'pending_confirm');
      if(latestPending) startAlarm(latestPending.id);
    }

    if(!incoming.some(order => order.status === 'pending_confirm')){
      cfg.lastSyncStatus = '即時接單監聽中';
      stopAlarm();
    }

    persistAll();
    if(typeof onRefresh === 'function') onRefresh();
    if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
  };

  dbApi.onValue(ref, posListenerCallback, (error)=>{
    state.onlineIncomingOrders = [];
    cfg.lastSyncStatus = error?.code === 'PERMISSION_DENIED'
      ? '沒有 Firebase staff 權限，請建立 staff/你的uid/role'
      : `即時接單監聽失敗：${error?.message || '未知錯誤'}`;
    persistAll();
    if(typeof onRefresh === 'function') onRefresh();
    if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
  });

  cfg.lastSyncStatus = '即時接單監聽中';
  persistAll();
  if(typeof onRefresh === 'function') onRefresh();
  if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
}

export async function confirmOnlineOrder(orderId, prepTimeMinutes = 0, replyMessage = ''){
  const ref = await getRef(`onlineOrders/${orderId}`);
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

export async function rejectOnlineOrder(orderId, replyMessage = ''){
  const ref = await getRef(`onlineOrders/${orderId}`);
  const safeReplyMessage = String(replyMessage || '').trim().slice(0, 120);
  await dbApi.update(ref, {
    status: 'rejected',
    replyMessage: safeReplyMessage || '店家目前無法接單，請稍後再試。',
    updatedAt: new Date().toISOString()
  });
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = `已拒絕訂單：${orderId}`;
  persistAll();
}

export function buildRealtimeOrderForPOS(remote){
  const items = Array.isArray(remote.items) ? remote.items : [];
  const subtotal = items.reduce((s, x) => s + ((Number(x.basePrice || 0) + Number(x.extraPrice || 0)) * Number(x.qty || 0)), 0);
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
    prepTimeMinutes: Number(remote.prepTimeMinutes || 0),
    estimatedReadyAt: remote.estimatedReadyAt || '',
    merchantReplyMessage: remote.replyMessage || '',
    discountType: 'amount',
    discountValue: 0,
    discountAmount: 0,
    sessionId: getCurrentSession()?.id || null,
    subtotal,
    total: subtotal,
    items
  };
}

// ============================================================
// 菜單同步
// ============================================================
export async function syncMenuToFirebase(){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();

  // 角色檢查：只有 master 可上傳
  if(cfg.deviceRole !== 'master'){
    throw new Error('此裝置設定為「從機」，無上傳菜單權限。請改為主機角色或改按「讀取雲端菜單」。');
  }

  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user) throw new Error('請先使用 POS Google 登入');
  await verifyPOSAccess();

  const storeId = cfg.projectId || 'default';
  const menuData = {
    categories: state.categories || [],
    products: (state.products || []).map(function(p){
  return {
    id: p.id,
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
    updatedAt: new Date().toISOString()
  };

  const menuRef = await getRef('menu/' + storeId);
  await dbApi.set(menuRef, menuData);
  cfg.lastSyncStatus = '菜單同步成功';
  cfg.lastSyncTime = new Date().toISOString();
  persistAll();
}


export async function fetchMenuFromFirebase(){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const storeId = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + storeId);
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
  return data;
}
/**
 * 讀取雲端菜單並 merge 到本地：
 * - 分類：聯集（雲端優先順序，本地獨有附在後面）
 * - 模組：用 id 比對；雲端有的覆蓋本地，本地獨有保留
 * - 商品：用 id 比對；雲端有的覆蓋本地（但本地的 enabled / soldOut 優先保留），本地獨有保留
 */
export async function fetchAndMergeMenuFromFirebase(){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const storeId = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + storeId);
  const snapshot = await dbApi.get(menuRef);
  const data = snapshot.val();
  if(!data) throw new Error('雲端尚無菜單資料，請先在主機按「上傳菜單」');

  let cloudCount = 0;
  let localKeptCount = 0;

  // 分類：聯集
  if(Array.isArray(data.categories)){
    const localCats = state.categories || [];
    const merged = [...data.categories];
    localCats.forEach(c => { if(!merged.includes(c)) merged.push(c); });
    if(!merged.includes('未分類')) merged.unshift('未分類');
    state.categories = merged;
  }

  // 模組：雲端覆蓋同 id，本地獨有保留
  if(Array.isArray(data.modules)){
    const cloudMap = {};
    data.modules.forEach(m => { if(m && m.id) cloudMap[m.id] = m; });
    const localMods = state.modules || [];
    const merged = [];
    const usedIds = new Set();
    data.modules.forEach(m => { if(m && m.id){ merged.push(m); usedIds.add(m.id); }});
    localMods.forEach(m => { if(m && m.id && !usedIds.has(m.id)){ merged.push(m); localKeptCount++; }});
    state.modules = merged;
  }

  // 商品：雲端覆蓋同 id（但 enabled / soldOut 用本地優先），本地獨有保留
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

  cfg.lastSyncStatus = `讀取成功：雲端 ${cloudCount} / 本地獨有保留 ${localKeptCount}`;
  cfg.lastSyncTime = new Date().toISOString();
  persistAll();
  return { cloudCount, localKeptCount };
}

/**
 * 從機/顧客頁啟動：訂閱雲端菜單變更 + 30 秒 fallback polling
 */
let menuWatchUnsub = null;
let menuPollTimer = null;
export async function startMenuAutoWatch(onUpdate){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const storeId = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + storeId);

  // 取消舊監聽
  if(menuWatchUnsub){ try{ menuWatchUnsub(); }catch(e){} menuWatchUnsub = null; }
  if(menuPollTimer){ clearInterval(menuPollTimer); menuPollTimer = null; }

  const handler = (snapshot) => {
    const data = snapshot.val();
    if(!data) return;
    try {
      // 從機：用 merge 規則（保留本地獨有 + enabled/soldOut 本地優先）
      applyCloudMenu(data);
      if(typeof onUpdate === 'function') onUpdate();
    } catch(e){ console.warn('menu watch handler failed:', e); }
  };
  dbApi.onValue(menuRef, handler);
  menuWatchUnsub = ()=> dbApi.off(menuRef, 'value', handler);

  // 30 秒 fallback
  menuPollTimer = setInterval(async ()=>{
    try{
      const snap = await dbApi.get(menuRef);
      const data = snap.val();
      if(data){ applyCloudMenu(data); if(typeof onUpdate === 'function') onUpdate(); }
    }catch(e){ /* 靜默 */ }
  }, 30000);
}

function applyCloudMenu(data){
  // 與 fetchAndMergeMenuFromFirebase 同邏輯但不更新 lastSyncStatus
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
    localMods.forEach(m => { if(m && m.id && !usedIds.has(m.id)) merged.push(m); });
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
  id: cp.id, name: cp.name || '', price: Number(cp.price || 0),
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
  persistAll();
}

export function stopMenuAutoWatch(){
  if(menuWatchUnsub){ try{ menuWatchUnsub(); }catch(e){} menuWatchUnsub = null; }
  if(menuPollTimer){ clearInterval(menuPollTimer); menuPollTimer = null; }
}

export async function watchMenuFromFirebase(callback){
  await loadFirebaseModules();
  const cfg = ensureRealtimeConfig();
  const storeId = cfg.projectId || 'default';
  const menuRef = await getRef('menu/' + storeId);
  dbApi.onValue(menuRef, (snapshot) => {
    const data = snapshot.val();
    if(!data) return;
    if(Array.isArray(data.products)) state.products = data.products;
    if(Array.isArray(data.modules))  state.modules  = data.modules;
    if(Array.isArray(data.categories)) state.categories = data.categories;
    if(callback) callback(data);
  });
}

// ============================================================
// 06.15/5-B 預約 30 分鐘前提醒
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
      `<div style="padding:3px 0;">${it.name} x ${it.qty}</div>`
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
  // 每次只彈一張（避免多張重疊）；若已有 overlay 顯示中就跳過
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
  // 啟動立即跑一次，之後每 60 秒檢查
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
