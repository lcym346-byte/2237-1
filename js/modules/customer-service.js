/* 中文備註：顧客資料服務模組（v2.1.25 新增）。
 * 功能：
 *   1. 訂單寫入時更新顧客主檔（累計次數、消費、訂單關聯）
 *   2. 同步顧客資料到 Firebase（/customers, /customerOrders）
 *   3. POS 端查詢（依末四碼、依完整電話）
 *   4. 顧客自助查單（hash 比對 + 30 秒節流）
 *   5. 90 天訂單清理（保留顧客主檔，只刪訂單明細）
 * 注意：所有 Firebase 操作都會 try/catch，斷網時不影響本機寫入。
 */

import { state, persistAll } from '../core/store.js';

// ============================================================
// 工具函式
// ============================================================

/**
 * 取得電話末四碼
 */
export function getPhoneLast4(phone){
  const p = String(phone || '').replace(/\D/g, '');
  if (p.length < 4) return '';
  return p.slice(-4);
}

/**
 * 顧客電話遮罩（列印用）
 * 規則：長度 < 4 整段隱藏；否則前面全部 *，只留末四碼
 */
export function maskCustomerPhone(phone){
  const p = String(phone || '');
  const digits = p.replace(/\D/g, '');
  if (digits.length < 4) return '';
  const last4 = digits.slice(-4);
  const maskCount = Math.max(4, digits.length - 4);
  return '*'.repeat(maskCount) + last4;
}

/**
 * SHA-256 hash（用於自助查單比對）
 * 顧客提供「完整電話 + 姓名」 → 算 hash → 與雲端的 customerLookupKey 比對
 */
export async function hashLookupKey(fullPhone, name){
  const normPhone = String(fullPhone || '').replace(/\D/g, '');
  const normName = String(name || '').trim();
  const raw = `${normPhone}|${normName}`;
  if (!window.crypto || !window.crypto.subtle) {
    // fallback：簡單 hash（不安全，但讓功能可用）
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
    return 'fb' + Math.abs(h).toString(16);
  }
  const buf = new TextEncoder().encode(raw);
  const digest = await window.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ============================================================
// 本機顧客主檔管理
// ============================================================

/**
 * 訂單成立後 / 確認後，更新顧客主檔
 * @param {Object} order - 訂單物件（須含 customerName, customerPhone, total, id）
 * @returns {Object|null} 更新後的顧客資料（含 orderCount）
 */
export function upsertCustomerFromOrder(order){
  if (!order) return null;
  const phone = String(order.customerPhone || '').replace(/\D/g, '');
  const name = String(order.customerName || '').trim();
  if (!phone || !name) return null;     // 沒電話或姓名不建檔

  if (!state.customers || typeof state.customers !== 'object') state.customers = {};

  const key = phone;       // 內部 key = 完整電話（你選 O 方案）
  const now = new Date().toISOString();
  const total = Number(order.total || 0);
  const orderId = String(order.id || order.orderNo || '');

  let c = state.customers[key];
  if (!c) {
    c = {
      fullPhone: phone,
      phoneLast4: phone.slice(-4),
      name,
      orderCount: 0,
      firstOrderAt: now,
      lastOrderAt: now,
      totalSpent: 0,
      orderIds: []
    };
    state.customers[key] = c;
  }

  // 同名同電話：更新姓名（採最新一筆）
  c.name = name;
  c.phoneLast4 = phone.slice(-4);
  c.lastOrderAt = now;
  c.totalSpent = Number(c.totalSpent || 0) + total;

  // 防重複計算：同 orderId 不重複加
  if (orderId && !c.orderIds.includes(orderId)) {
    c.orderIds.push(orderId);
    c.orderCount = (c.orderCount || 0) + 1;
  }

  persistAll();
  return c;
}

/**
 * 取得「這是第 N 次訂購」（POS 訂單卡顯示用）
 */
export function getOrderCountForOrder(order){
  if (!order) return 0;
  const phone = String(order.customerPhone || '').replace(/\D/g, '');
  if (!phone) return 0;
  const c = state.customers && state.customers[phone];
  if (!c) return 0;
  // 如果 order.id 已在 orderIds 內，就回傳當時的次數
  // 簡化：直接回傳目前累計
  return Number(c.orderCount || 0);
}

/**
 * POS 端：依電話末四碼搜尋顧客（回傳訂單清單）
 * 用於訂單查詢頁的「電話末四碼」搜尋欄
 */
export function searchOrdersByPhoneLast4(last4){
  const target = String(last4 || '').replace(/\D/g, '').slice(-4);
  if (!target || target.length !== 4) return [];

  return (state.orders || []).filter(o => {
    const phone = String(o.customerPhone || '').replace(/\D/g, '');
    return phone.slice(-4) === target;
  });
}

/**
 * POS 端：列出所有顧客（依消費總額排序）
 */
export function listAllCustomers(){
  if (!state.customers) return [];
  return Object.values(state.customers).sort((a,b) => Number(b.totalSpent || 0) - Number(a.totalSpent || 0));
}

// ============================================================
// Firebase 同步（即時備份顧客資料）
// ============================================================

/**
 * 寫入 Firebase /customers/{fullPhone} 與 /customerOrders/{fullPhone}/{orderId}
 * 也會在訂單上寫 customerLookupKey（讓顧客自助查詢）
 * 失敗時不丟錯，只 console.warn（離線狀態本機仍然寫入成功）
 */
export async function syncCustomerToFirebase(order){
  if (!order) return;
  const phone = String(order.customerPhone || '').replace(/\D/g, '');
  const name = String(order.customerName || '').trim();
  if (!phone || !name) return;

  try {
    const rt = await import('./realtime-order-service.js');
    const cfg = rt.getRealtimeConfig();
    if (!cfg.enabled) return;

    // 必須已登入（POS Google 登入）才寫雲端
    const user = rt.getRealtimeAuthUser && rt.getRealtimeAuthUser();
    if (!user) {
      // 不丟錯：只是這次跳過雲端同步，下次有人登入再補
      return;
    }

    const customer = state.customers[phone];
    if (!customer) return;

    // 寫 /customers/{phone}
    const customerRef = await rt._getRef(`customers/${phone}`);
    await rt._dbApi().set(customerRef, {
      fullPhone: customer.fullPhone,
      phoneLast4: customer.phoneLast4,
      name: customer.name,
      orderCount: customer.orderCount,
      firstOrderAt: customer.firstOrderAt,
      lastOrderAt: customer.lastOrderAt,
      totalSpent: customer.totalSpent,
      updatedAt: new Date().toISOString()
    });

    // 寫 /customerOrders/{phone}/{orderId}（訂單摘要副本）
    const orderId = String(order.id || order.orderNo || '');
    if (orderId) {
      const orderRef = await rt._getRef(`customerOrders/${phone}/${orderId}`);
      await rt._dbApi().set(orderRef, {
        orderNo: order.orderNo || orderId,
        createdAt: order.createdAt || new Date().toISOString(),
        status: order.status || 'pending',
        orderType: order.orderType || '',
        total: Number(order.total || 0),
        items: (order.items || []).map(it => ({
          name: it.name || '',
          qty: Number(it.qty || 0),
          basePrice: Number(it.basePrice || 0),
          extraPrice: Number(it.extraPrice || 0)
        }))
      });
    }
  } catch (err) {
    console.warn('syncCustomerToFirebase failed (網路/權限問題，本機仍已寫入):', err.message);
  }
}

/**
 * 寫入訂單時，順便在訂單上加 customerLookupKey（hash），供顧客自助查詢
 * 在 realtime-order-service.pushOnlineOrder 內會呼叫
 */
export async function buildLookupKeyForOrder(order){
  if (!order || !order.customerPhone || !order.customerName) return '';
  return await hashLookupKey(order.customerPhone, order.customerName);
}

// ============================================================
// 顧客自助查單（線上點餐頁用）
// ============================================================

const LOOKUP_COOLDOWN_MS = 30 * 1000;   // 30 秒節流

/**
 * 檢查節流：是否允許這次查詢
 * @returns {Object} { allowed: boolean, remainSec: number }
 */
export function checkLookupRateLimit(){
  const now = Date.now();
  const last = (state.customerLookupRateLimit && state.customerLookupRateLimit.lastAt) || 0;
  const diff = now - last;
  if (diff < LOOKUP_COOLDOWN_MS) {
    return {
      allowed: false,
      remainSec: Math.ceil((LOOKUP_COOLDOWN_MS - diff) / 1000)
    };
  }
  return { allowed: true, remainSec: 0 };
}

/**
 * 記錄查詢時戳
 */
function markLookupTime(){
  if (!state.customerLookupRateLimit) state.customerLookupRateLimit = {};
  state.customerLookupRateLimit.lastAt = Date.now();
  // 注意：此欄位不會持久化（store.persistAll 不寫此 key）
  // 但這就夠了：30 秒節流只需要記憶體生命週期
}

/**
 * 顧客自助查單：用「完整電話 + 完整姓名」查詢自己訂單
 * 流程：
 *   1. 檢查 30 秒節流
 *   2. 算 hash
 *   3. 從 Firebase /onlineOrders 用 customerLookupKey 過濾
 *   4. 回傳該顧客所有訂單（含狀態）
 */
export async function lookupOrdersByCustomer(fullPhone, name, storeCode){
  // 節流檢查
  const check = checkLookupRateLimit();
  if (!check.allowed) {
    throw new Error(`查詢過於頻繁，請 ${check.remainSec} 秒後再試`);
  }

  const normPhone = String(fullPhone || '').replace(/\D/g, '');
  const normName = String(name || '').trim();
  if (!normPhone || !normName) throw new Error('請輸入完整姓名與電話');

  // 多店分流：顧客端必須帶 storeCode 才能命中 /onlineOrders/{storeCode}
  const code = String(storeCode || '').trim();
  if (!code) throw new Error('缺少店家代碼，請從店家提供的 QR code 重新進入查詢');
  if (/[.#$\/\[\]]/.test(code)) throw new Error('店家代碼含非法字元');

  markLookupTime();

  const lookupKey = await hashLookupKey(normPhone, normName);

  try {
    const rt = await import('./realtime-order-service.js');
    const cfg = rt.getRealtimeConfig();
    if (!cfg.enabled) throw new Error('店家未啟用線上查單');

    // 顧客需先匿名登入（customerOrderLookup 規則允許 auth != null 讀）
    await rt.signInCustomerAnonymously();

    // 改讀反查表 customerOrderLookup/{storeCode}/{lookupKey}
    // 顧客匿名只能讀自己 lookupKey 底下這批，無法讀整店 onlineOrders（符合 Firebase 規則）
    const ref = await rt._getRef(`customerOrderLookup/${code}/${lookupKey}`);
    const snapshot = await rt._dbApi().get(ref);

    const all = snapshot.val() || {};

    const matched = Object.entries(all)
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return matched;


  } catch (err) {
    if (err.code === 'PERMISSION_DENIED') {

      throw new Error('無權限查詢，請確認姓名與電話是否正確');
    }
    throw err;
  }
}

// ============================================================
// 90 天訂單清理（搭 reports-page 的「結束」按鈕呼叫）
// ============================================================

const CLEANUP_DAYS = 90;
const CLEANUP_THROTTLE_DAYS = 7;     // 距上次清理 ≥ 7 天才執行

/**
 * 檢查是否該執行清理
 */
export function shouldRunCleanup(){
  const last = state.settings && state.settings.lastCleanupAt;
  if (!last) return true;
  const daysSince = (Date.now() - new Date(last).getTime()) / 86400000;
  return daysSince >= CLEANUP_THROTTLE_DAYS;
}

/**
 * 清理 90 天前的舊訂單（本機 + Firebase）
 * 顧客主檔保留不刪
 * @returns {Object} { removed: number, fbRemoved: number }
 */
export async function cleanupOldOrders(){
  if (!shouldRunCleanup()) {
    return { removed: 0, fbRemoved: 0, skipped: true };
  }

  const cutoff = Date.now() - CLEANUP_DAYS * 86400000;
  const before = state.orders.length;

  // 找出要刪的訂單（先記下，因為可能要同步刪 Firebase）
  const toRemove = state.orders.filter(o => {
    const t = new Date(o.createdAt || 0).getTime();
    return t > 0 && t < cutoff;
  });

  // 本機刪除
  state.orders = state.orders.filter(o => {
    const t = new Date(o.createdAt || 0).getTime();
    return !(t > 0 && t < cutoff);
  });

  // 顧客主檔內的 orderIds 也要清理（但保留 orderCount 累計）
  if (state.customers) {
    const removedIds = new Set(toRemove.map(o => String(o.id || o.orderNo || '')));
    Object.values(state.customers).forEach(c => {
      if (Array.isArray(c.orderIds)) {
        c.orderIds = c.orderIds.filter(id => !removedIds.has(id));
      }
    });
  }

  // 標記清理時戳
  if (!state.settings) state.settings = {};
  state.settings.lastCleanupAt = new Date().toISOString();
  persistAll();

    // Firebase 端清理（best-effort，失敗不影響本機）
  let fbRemoved = 0;
  try {
    const rt = await import('./realtime-order-service.js');
    const cfg = rt.getRealtimeConfig();
    if (cfg.enabled && rt.getRealtimeAuthUser && rt.getRealtimeAuthUser()) {
      // 多店分流：取本店 storeCode，沒有就跳過 Firebase 清理（本機已清）
      let storeCode = '';
      try { storeCode = rt.getStoreCode(); } catch(e){ /* 沒設 storeId 就略過雲端 */ }

      for (const o of toRemove) {
        const orderId = String(o.id || '').replace(/^online_/, '');
        if (!orderId) continue;
        try {
          // 刪 onlineOrders/{storeCode}/{id}（多店分流路徑）
          if (storeCode) {
            const onlineRef = await rt._getRef(`onlineOrders/${storeCode}/${orderId}`);
            await rt._dbApi().remove(onlineRef);
          }
          // 刪 customerOrders/{phone}/{id}
          const phone = String(o.customerPhone || '').replace(/\D/g, '');
          if (phone) {
            const coRef = await rt._getRef(`customerOrders/${phone}/${orderId}`);
            await rt._dbApi().remove(coRef);
          }
          fbRemoved++;
        } catch (e) {
          // 個別失敗（網路斷、權限缺）不阻斷
        }
      }
    }
  } catch (e) {
    console.warn('cleanupOldOrders Firebase 端清理失敗（本機已成功）：', e.message);
  }


  return {
    removed: before - state.orders.length,
    fbRemoved,
    skipped: false
  };
}

// ============================================================
// 會員點數（v20260603 新增）
// 規則：
//   - 各店獨立，路徑 points/{storeCode}/{phone}/balance 與 /history/{pushId}
//   - 寫入只在 POS 端（已登入 staff/admin）；顧客端匿名只讀 balance 顯示
//   - 賺點：線上單結帳完成(completed)時，賺 = 該單現金折扣 order.discountAmount（優惠不折現、全變點數）
//   - 折抵：1點=1元，僅線上點餐用。店家接單(confirmed)時預扣 min(顧客宣告pointsRequested, 當下真實餘額)
//   - 退點：已接單未結帳的單被取消 → 退回該單 pointsUsed；已結帳完成作廢 → 不退
//   - 防重複：賺點用 order.pointsSettled 旗標
// ============================================================

/** 取得某顧客點數餘額（POS 與顧客端皆可呼叫，讀失敗回 0） */
export async function getPointsBalance(phone, storeCode){
  const ph = String(phone || '').replace(/\D/g, '');
  if(!ph) return 0;
  try{
    const rt = await import('./realtime-order-service.js');
    const cfg = rt.getRealtimeConfig();
    if(!cfg.enabled) return 0;
    const code = String(storeCode || '').trim() || (function(){ try{ return rt.getStoreCode(); }catch(e){ return ''; } })();
    if(!code) return 0;
    const ref = await rt._getRef(`points/${code}/${ph}/balance`);
    const snap = await rt._dbApi().get(ref);
    const v = Number(snap.val() || 0);
    return isNaN(v) ? 0 : Math.max(0, v);
  }catch(err){
    console.warn('getPointsBalance failed:', err && err.message);
    return 0;
  }
}

/** 內部：POS 端寫一筆點數異動（改餘額 + 推 history）。delta 可正可負，餘額不低於 0。 */
async function _writePointsTxn(phone, delta, type, orderNo){
  const ph = String(phone || '').replace(/\D/g, '');
  if(!ph) return { ok:false, reason:'no-phone' };
  const rt = await import('./realtime-order-service.js');
  const cfg = rt.getRealtimeConfig();
  if(!cfg.enabled) return { ok:false, reason:'disabled' };
  const user = rt.getRealtimeAuthUser && rt.getRealtimeAuthUser();
  if(!user) return { ok:false, reason:'not-logged-in' };
  const code = rt.getStoreCode(); // 沒設會丟錯，POS 端應已設定

  const balRef = await rt._getRef(`points/${code}/${ph}/balance`);
  const snap = await rt._dbApi().get(balRef);
  const cur = Math.max(0, Number(snap.val() || 0));
  const next = Math.max(0, cur + Number(delta || 0));
  await rt._dbApi().set(balRef, next);

  const histRoot = await rt._getRef(`points/${code}/${ph}/history`);
  const newRef = rt._dbApi().push(histRoot);
  await rt._dbApi().set(newRef, {
    at: new Date().toISOString(),
    type: String(type || ''),        // 'earn' | 'use' | 'refund'
    delta: Number(delta || 0),
    balanceAfter: next,
    orderNo: String(orderNo || '')
  });
  return { ok:true, balanceAfter: next };
}

/** 店家接單(confirmed)時：預扣折抵點數。以當下真實餘額為上限，回寫 order.pointsUsed。 */
export async function deductPointsOnConfirm(order){
  if(!order) return 0;
  const phone = String(order.customerPhone || '').replace(/\D/g, '');
  const want = Math.max(0, Number(order.pointsRequested || 0));
  if(!phone || want <= 0) return 0;
  try{
    const bal = await getPointsBalance(phone);
    const use = Math.min(want, bal);           // 以真實餘額為上限，杜絕超折
    if(use <= 0){ order.pointsUsed = 0; return 0; }
    const r = await _writePointsTxn(phone, -use, 'use', order.orderNo || order.id);
    if(r.ok){ order.pointsUsed = use; return use; }
    order.pointsUsed = 0;
    return 0;
  }catch(err){
    console.warn('deductPointsOnConfirm failed:', err && err.message);
    order.pointsUsed = 0;
    return 0;
  }
}

/** 取消「已接單未結帳」的單時：退回該單預扣的 pointsUsed。已結帳完成的單不退。 */
export async function refundPointsOnCancel(order){
  if(!order) return 0;
  if(order.status === 'completed') return 0;   // 已結帳完成 → 不退（規則四）
  const phone = String(order.customerPhone || '').replace(/\D/g, '');
  const used = Math.max(0, Number(order.pointsUsed || 0));
  if(!phone || used <= 0) return 0;
  try{
    const r = await _writePointsTxn(phone, used, 'refund', order.orderNo || order.id);
    if(r.ok){ order.pointsUsed = 0; return used; }
    return 0;
  }catch(err){
    console.warn('refundPointsOnCancel failed:', err && err.message);
    return 0;
  }
}

/** 結帳完成(completed)時：賺點 = 該單付款方式回饋點數 order.pointsEarnReward。用 pointsSettled 防重複。
 *  v20260603-v2：賺點來源改為「付款方式回饋(現金/電支)換算的點數」，與直接折現金的 discountAmount 完全脫鉤。
 *  支援小數點後一位（付款回饋 percent 可能有 .x），不再四捨五入成整數。 */
export async function earnPointsOnComplete(order){
  if(!order) return 0;
  if(order.pointsSettled === true) return 0;   // 防重複賺點
  const phone = String(order.customerPhone || '').replace(/\D/g, '');
  const earn = Math.max(0, Math.round(Number(order.pointsEarnReward || 0) * 10) / 10);
  if(!phone){ order.pointsSettled = true; return 0; }
  if(earn <= 0){ order.pointsSettled = true; order.pointsEarned = 0; return 0; }
  try{
    const r = await _writePointsTxn(phone, earn, 'earn', order.orderNo || order.id);
    if(r.ok){
      order.pointsEarned = earn;
      order.pointsSettled = true;
      return earn;
    }
    return 0;
  }catch(err){
    console.warn('earnPointsOnComplete failed:', err && err.message);
    return 0;
  }
}


/** POS 查詢區塊用：讀某顧客點數異動歷史（依時間新→舊）。 */
export async function getPointsHistory(phone, storeCode){
  const ph = String(phone || '').replace(/\D/g, '');
  if(!ph) return { balance: 0, history: [] };
  try{
    const rt = await import('./realtime-order-service.js');
    const code = String(storeCode || '').trim() || rt.getStoreCode();
    const root = await rt._getRef(`points/${code}/${ph}`);
    const snap = await rt._dbApi().get(root);
    const val = snap.val() || {};
    const balance = Math.max(0, Number(val.balance || 0));
    const history = Object.entries(val.history || {})
      .map(([id, row]) => ({ id, ...row }))
      .sort((a,b)=> new Date(b.at || 0) - new Date(a.at || 0));
    return { balance, history };
  }catch(err){
    console.warn('getPointsHistory failed:', err && err.message);
    return { balance: 0, history: [] };
  }
}
