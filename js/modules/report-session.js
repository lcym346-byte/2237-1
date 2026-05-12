/* 中文備註：班次（值班）服務模組 v20260613
 * 本版（相對 v2.1 v20260608）變更：
 *   - import biz-day.js，sessionHistory dateKey 改用「班次 startedAt 的營業日 BD」
 *   - endSession 接收 opts.deliveryPanda / opts.deliveryUber（外送平台手動輸入金額）
 *   - stats 新增 deliveryPanda / deliveryUber / deliveryTotal，並加入 byPayment['其他']
 *   - 上傳雲端後自動清理 90 自然日前的 sessionHistory 雲端節點
 *   - 本地 sessions 維持 90 天清理（不變）
 * 既有功能保留：
 *   - 作廢機制 isVoidedStatus / voidedCount / voidedAmount
 *   - 上傳雲端時保留 voidedAt / voidedReason / voidedBy
 *   - 線上點餐 pending 單追溯歸班 (attachOrphanOrdersToSession)
 */
import { state, persistAll } from '../core/store.js';
import { deepCopy, money } from '../core/utils.js';
import { _getRef, _dbApi } from './realtime-order-service.js';
import { getBusinessDay } from '../core/biz-day.js';


// ── 鈔票/硬幣面額（由大至小）──
export const CASH_DENOMINATIONS = [1000, 500, 100, 50, 10, 5, 1];

// ── 計算清點現金總額 ──
export function calcCashTotal(detail){
  if(!detail || typeof detail !== 'object') return 0;
  return CASH_DENOMINATIONS.reduce((sum, d) => sum + d * Number(detail[d] || 0), 0);
}

// ── 預設清點物件（全部 0）──
export function emptyCashDetail(){
  const obj = {};
  CASH_DENOMINATIONS.forEach(d => { obj[d] = 0; });
  return obj;
}

// ── 取得當前班次（沒則 null）──
export function getCurrentSession(){
  return (state.reports && state.reports.currentSession) || null;
}

export function hasOpenSession(){
  return !!getCurrentSession();
}

// ── 判斷是否為作廢/取消/退款單（與 dashboard-publish.js 規約一致）──
function isVoidedStatus(status){
  const s = String(status || '').toLowerCase();
  return s === 'void' || s === 'cancelled' || s === 'refunded';
}

// ── 取得 businessHours ──
function getBH(){
  return (state.settings && state.settings.businessHours) || {};
}

// ── 計算某些訂單的統計 ──
// v20260613：可選擇性傳入 deliveryPanda / deliveryUber（結班時手動輸入）
//            加總到 stats.deliveryTotal 與 byPayment['其他']
function summarizeOrders(orders, deliveryOpts){
  const stats = {
    orderCount: 0,
    salesTotal: 0,
    discountTotal: 0,
    byType: {},
    byPayment: {},
    cashSales: 0,
    voidedCount: 0,
    voidedAmount: 0,
    deliveryPanda: 0,
    deliveryUber: 0,
    deliveryTotal: 0
  };
  orders.forEach(o => {
    const total = Number(o.total || 0);
    const discount = Number(o.discountAmount || 0);
    if(isVoidedStatus(o.status)){
      stats.voidedCount++;
      stats.voidedAmount += total;
      return;
    }
    const type = o.orderType || '未分類';
    const pay = o.paymentMethod || '未設定';
    stats.orderCount++;
    stats.salesTotal += total;
    stats.discountTotal += discount;
    stats.byType[type] = (stats.byType[type] || 0) + total;
    stats.byPayment[pay] = (stats.byPayment[pay] || 0) + total;
    if(pay === '現金') stats.cashSales += total;
  });

  // 外送金額（不算進現金、不算進 orderCount，但加進 salesTotal 與「其他」付款）
  if(deliveryOpts){
    const panda = Math.max(0, Number(deliveryOpts.deliveryPanda || 0));
    const uber  = Math.max(0, Number(deliveryOpts.deliveryUber  || 0));
    stats.deliveryPanda = panda;
    stats.deliveryUber = uber;
    stats.deliveryTotal = panda + uber;
    if(stats.deliveryTotal > 0){
      stats.salesTotal += stats.deliveryTotal;
      stats.byPayment['其他'] = (stats.byPayment['其他'] || 0) + stats.deliveryTotal;
    }
  }

  return stats;
}

// ── 取得當前班次的所有訂單（含作廢單；篩選交給上層）──
export function getSessionOrders(sessionId){
  if(!sessionId) return [];
  return (state.orders || []).filter(o => o.sessionId === sessionId);
}

// ── 計算當前班次即時統計（用於報表頁卡片；當班中沒外送金額）──
export function calcSessionStats(sessionId){
  const orders = getSessionOrders(sessionId);
  return summarizeOrders(orders, null);
}

// ── 開始值班 ──
export function startSession(opts){
  if(hasOpenSession()){
    throw new Error('已有進行中的班次，請先結束才能開新班');
  }
  const staffId = String(opts && opts.staffId || '').trim();
  if(!staffId) throw new Error('請選擇值班人員');

  const cashDetail = (opts && opts.cashDetail) || emptyCashDetail();
  const openingCash = calcCashTotal(cashDetail);

  if(!state.reports) state.reports = { currentSession: null, sessions: [], savedSnapshots: [] };

  const session = {
    id: 'sess_' + Date.now(),
    staffId,
    startedAt: new Date().toISOString(),
    openingCash,
    openingCashDetail: { ...cashDetail },
    endedAt: null,
    endStaffId: null,
    closingCash: null,
    closingCashDetail: null,
    expectedCash: null,
    cashDiff: null,
    note: ''
  };
  state.reports.currentSession = session;

  attachOrphanOrdersToSession(session.id);

  persistAll();
  return session;
}

// ── 結束值班 ──
// opts: { staffId, cashDetail, note, deliveryPanda, deliveryUber }
export function endSession(opts){
  const current = getCurrentSession();
  if(!current) throw new Error('目前沒有進行中的班次');

  const staffId = String(opts && opts.staffId || '').trim();
  if(!staffId) throw new Error('請選擇結束人員');

  const cashDetail = (opts && opts.cashDetail) || emptyCashDetail();
  const closingCash = calcCashTotal(cashDetail);
  const note = String(opts && opts.note || '').trim();

  // 外送平台手動輸入金額
  const deliveryPanda = Math.max(0, Number(opts && opts.deliveryPanda || 0));
  const deliveryUber  = Math.max(0, Number(opts && opts.deliveryUber  || 0));

  // 統計（含外送加總）
  const orders = getSessionOrders(current.id);
  const stats = summarizeOrders(orders, { deliveryPanda, deliveryUber });

  // 應收現金 = 期初備用金 + 現金訂單合計（外送不計入現金）
  const expectedCash = Number(current.openingCash || 0) + Number(stats.cashSales || 0);
  const cashDiff = closingCash - expectedCash;

  const ended = {
    ...current,
    endedAt: new Date().toISOString(),
    endStaffId: staffId,
    closingCash,
    closingCashDetail: { ...cashDetail },
    expectedCash,
    cashDiff,
    note,
    stats
  };

  if(!state.reports) state.reports = { currentSession: null, sessions: [], savedSnapshots: [] };
  if(!Array.isArray(state.reports.sessions)) state.reports.sessions = [];
  state.reports.sessions.unshift(ended);
  state.reports.currentSession = null;

  // 清理 90 天前的本地歷史班次
  cleanupOldSessions();

  persistAll();

  // 上傳班次歷史到雲端（非同步、不阻塞關班流程）
  uploadSessionToCloud(ended);

  return ended;
}


// ── 追溯歸班：把未指派 sessionId 的線上 pending 單收進指定班次 ──
export function attachOrphanOrdersToSession(sessionId){
  if(!sessionId) return 0;
  let count = 0;
  (state.orders || []).forEach(o => {
    if(!o.sessionId
       && (o.orderType || '').indexOf('線上點餐') === 0
       && o.status !== 'completed'){
      o.sessionId = sessionId;
      count++;
    }
  });
  return count;
}

// ── 清理 90 天前本地歷史班次 ──
function cleanupOldSessions(){
  const cutoff = Date.now() - 90 * 86400000;
  state.reports.sessions = (state.reports.sessions || []).filter(s => {
    const t = new Date(s.endedAt || s.startedAt || 0).getTime();
    return t === 0 || t >= cutoff;
  });
}

// ── 取得歷史班次清單（給報表頁用，預設 30 天）──
export function getRecentSessions(days = 30){
  const cutoff = Date.now() - days * 86400000;
  return (state.reports.sessions || []).filter(s => {
    const t = new Date(s.endedAt || s.startedAt || 0).getTime();
    return t >= cutoff;
  });
}

// ── 舊 API：保留以避免引用錯誤 ──
export function saveCurrentSnapshot(orders){
  state.reports.savedSnapshots.unshift({
    id: 'SN' + Date.now(),
    createdAt: new Date().toISOString(),
    summary: summarizeOrders(orders, null),
    orders: deepCopy(orders)
  });
}

export function getSessionListHtml(escapeHtml){
  const sessions = getRecentSessions(30);
  if(!sessions.length){
    return '<div class="muted">尚無班次紀錄</div>';
  }
  return sessions.map(s => {
    const start = new Date(s.startedAt).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    const end = s.endedAt ? new Date(s.endedAt).toLocaleString('zh-TW', { hour:'2-digit', minute:'2-digit' }) : '進行中';
    const sales = s.stats ? money(s.stats.salesTotal) : money(0);
    const count = s.stats ? s.stats.orderCount : 0;
    const diffNum = Number(s.cashDiff || 0);
    let diffHtml = '';
    if(s.endedAt){
      if(diffNum === 0) diffHtml = '<span style="color:#10b981">✓</span>';
      else if(diffNum < 0) diffHtml = `<span style="color:#ef4444">${diffNum}</span>`;
      else diffHtml = `<span style="color:#f59e0b">+${diffNum}</span>`;
    }
    return `
      <div class="list-row" style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9">
        <div style="flex:1">
          <strong>${escapeHtml(start)} ~ ${escapeHtml(end)}</strong>
          <div class="muted" style="font-size:12px">${escapeHtml(s.staffId || '')} · ${count} 單</div>
        </div>
        <strong style="color:#0f172a">${sales}</strong>
        ${diffHtml}
      </div>
    `;
  }).join('');
}

// ============================================================
// 上傳班次歷史到雲端（Firebase Realtime DB）
// 路徑：sessionHistory/{storeId}/{BD}/{sessionId}
// v20260613：dateKey 改用「班次 startedAt 的營業日 BD」（不再用自然日 endedAt）
//            上傳後自動清理 90 天前的雲端節點
// ============================================================
export async function uploadSessionToCloud(session){
  try{
    if(!session || !session.id) return;
    const cfg = (state.settings && state.settings.dashboard) || {};
    if(!cfg.enabled || !cfg.storeId){
      console.warn('[session-cloud] 未設定 storeId，略過上傳');
      return;
    }

    // v20260613：用班次 startedAt 的 BD 當 key（跨日營業班次會正確歸到開班那一天）
    const bh = getBH();
    const dateKey = getBusinessDay(session.startedAt, bh)
                 || getBusinessDay(session.endedAt, bh)
                 || getBusinessDay(new Date(), bh);
    if(!dateKey){
      console.warn('[session-cloud] 無法判定 BD，略過上傳');
      return;
    }
    const path = `sessionHistory/${cfg.storeId}/${dateKey}/${session.id}`;

    // 把該班所有訂單一起打包（含作廢單）
    const orders = getSessionOrders(session.id).map(o => ({
      orderNo: o.orderNo || '',
      createdAt: o.createdAt || '',
      updatedAt: o.updatedAt || '',
      reservationAt: o.reservationAt || '',
      total: Number(o.total || 0),
      subtotal: Number(o.subtotal || 0),
      discountAmount: Number(o.discountAmount || 0),
      discountValue: Number(o.discountValue || 0),
      discountType: o.discountType || '',
      paymentMethod: o.paymentMethod || '',
      orderType: o.orderType || '',
      tableNo: o.tableNo || '',
      status: o.status || '',
      statusBeforeVoid: o.statusBeforeVoid || '',
      voidedAt: o.voidedAt || '',
      voidedReason: o.voidedReason || '',
      voidedBy: o.voidedBy || '',
      itemCount: Array.isArray(o.items) ? o.items.length : 0,
      items: (o.items || []).map(it => ({
        name: it.name || '',
        qty: Number(it.qty || 1),
        basePrice: Number(it.basePrice || 0),
        extraPrice: Number(it.extraPrice || 0),
        options: it.options || null,
        note: it.note || ''
      }))
    }));

    const payload = {
      sessionId: session.id,
      storeId: cfg.storeId,
      storeName: cfg.storeName || '',
      staffId: session.staffId || '',
      endStaffId: session.endStaffId || '',
      startedAt: session.startedAt || '',
      endedAt: session.endedAt || '',
      openingCash: Number(session.openingCash || 0),
      closingCash: Number(session.closingCash || 0),
      expectedCash: Number(session.expectedCash || 0),
      cashDiff: Number(session.cashDiff || 0),
      note: session.note || '',
      stats: session.stats || null,   // v20260613：含 deliveryPanda / deliveryUber / deliveryTotal
      orders,
      bdDate: dateKey,                // 標註此節點屬於哪個 BD
      uploadedAt: new Date().toISOString()
    };

    const ref = await _getRef(path);
    const api = _dbApi();
    if(!ref || !api){
      console.warn('[session-cloud] Firebase ref 取得失敗');
      return;
    }
    await api.set(ref, payload);
    console.log('[session-cloud] 上傳成功 BD=' + dateKey, path);

    // 上傳成功後嘗試清理 90 天前的雲端節點
    cleanupOldCloudSessions(cfg.storeId).catch(err => {
      console.warn('[session-cloud] 雲端清理失敗（不影響本次上傳）', err);
    });

  }catch(err){
    console.warn('[session-cloud] 上傳失敗', err);
  }
}

// ============================================================
// 清理雲端 90 自然日前的 sessionHistory 節點
// 邏輯：列出 sessionHistory/{storeId} 下所有日期 key，
//       早於 90 天前的 key 直接 remove
// ============================================================
function pad2(n){ return String(n).padStart(2,'0'); }
function dateStrLocal(d){
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
}

async function cleanupOldCloudSessions(storeId){
  if(!storeId) return;
  try{
    const ref = await _getRef(`sessionHistory/${storeId}`);
    const api = _dbApi();
    if(!ref || !api) return;
    const snap = await api.get(ref);
    if(!snap || !snap.val) return;
    const data = snap.val() || {};
    const keys = Object.keys(data);
    if(keys.length === 0) return;

    // 90 自然日前的截止日
    const cutoff = new Date();
    cutoff.setHours(0,0,0,0);
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = dateStrLocal(cutoff);

    const toDelete = keys.filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && k < cutoffStr);
    if(toDelete.length === 0) return;

    for(const k of toDelete){
      try{
        const subRef = await _getRef(`sessionHistory/${storeId}/${k}`);
        if(subRef) await api.set(subRef, null);
      }catch(e){
        console.warn('[session-cloud] 刪除舊節點失敗', k, e);
      }
    }
    console.log('[session-cloud] 已清理 ' + toDelete.length + ' 個 90 天前節點');
  }catch(err){
    console.warn('[session-cloud] cleanupOldCloudSessions 失敗', err);
  }
}
