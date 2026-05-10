/* 中文備註：班次（值班）服務模組 v2 — Batch 06.16/1
 * 重點變更：
 *   - startSession 接收 { staffId, cashDetail }
 *   - endSession 接收 { staffId, cashDetail, note } 並計算應收/誤差
 *   - 新增 getCurrentSession / hasOpenSession / attachOrphanOrdersToSession
 *   - 新增 getSessionOrders / calcSessionStats（給報表頁用）
 *   - sessions 上限 90 天（清理舊資料）
 */
import { state, persistAll } from '../core/store.js';
import { deepCopy, money } from '../core/utils.js';

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

// ── 計算某些訂單的統計 ──
function summarizeOrders(orders){
  const stats = {
    orderCount: orders.length,
    salesTotal: 0,
    discountTotal: 0,
    byType: {},        // {內用:..., 外帶:...}
    byPayment: {},     // {現金:..., LinePay:...}
    cashSales: 0       // 現金訂單合計（含結帳當下的現金）
  };
  orders.forEach(o => {
    const total = Number(o.total || 0);
    const discount = Number(o.discountAmount || 0);
    const type = o.orderType || '未分類';
    const pay = o.paymentMethod || '未設定';
    stats.salesTotal += total;
    stats.discountTotal += discount;
    stats.byType[type] = (stats.byType[type] || 0) + total;
    stats.byPayment[pay] = (stats.byPayment[pay] || 0) + total;
    if(pay === '現金') stats.cashSales += total;
  });
  return stats;
}

// ── 取得當前班次的所有訂單 ──
export function getSessionOrders(sessionId){
  if(!sessionId) return [];
  return (state.orders || []).filter(o => o.sessionId === sessionId);
}

// ── 計算當前班次即時統計（用於報表頁卡片）──
export function calcSessionStats(sessionId){
  const orders = getSessionOrders(sessionId);
  return summarizeOrders(orders);
}

// ── 開始值班 ──
// opts: { staffId: 'A1', cashDetail: {1000:1, 500:0, ...} }
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

  // 追溯歸班：把 sessionId 為空的「線上點餐 pending」訂單收進當班
  attachOrphanOrdersToSession(session.id);

  persistAll();
  return session;
}

// ── 結束值班 ──
// opts: { staffId, cashDetail, note }
export function endSession(opts){
  const current = getCurrentSession();
  if(!current) throw new Error('目前沒有進行中的班次');

  const staffId = String(opts && opts.staffId || '').trim();
  if(!staffId) throw new Error('請選擇結束人員');

  const cashDetail = (opts && opts.cashDetail) || emptyCashDetail();
  const closingCash = calcCashTotal(cashDetail);
  const note = String(opts && opts.note || '').trim();

  // 應收現金 = 期初備用金 + 本班現金訂單合計
  const stats = calcSessionStats(current.id);
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


  // 清理 90 天前的歷史班次
  cleanupOldSessions();

  persistAll();
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

// ── 清理 90 天前歷史班次 ──
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

// ── 舊 API：保留以避免引用錯誤（report 列印模組可能還在用）──
export function saveCurrentSnapshot(orders){
  state.reports.savedSnapshots.unshift({
    id: 'SN' + Date.now(),
    createdAt: new Date().toISOString(),
    summary: summarizeOrders(orders),
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
