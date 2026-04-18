import { state } from '../core/store.js';
import { deepCopy, money } from '../core/utils.js';

function summarizeOrders(orders){
  const total = orders.reduce((s,o)=> s + Number(o.total || 0), 0);
  const paymentStats = {};
  orders.forEach(o => paymentStats[o.paymentMethod] = (paymentStats[o.paymentMethod] || 0) + Number(o.total || 0));
  return {
    orderCount: orders.length,
    salesTotal: total,
    salesText: money(total),
    paymentStats
  };
}

export function startSession(){
  state.reports.currentSession = {
    id: 'RS' + Date.now(),
    startedAt: new Date().toISOString(),
    startSnapshot: deepCopy(state.orders),
  };
}

export function endSession(){
  const current = state.reports.currentSession;
  if(!current) return null;
  const endOrders = deepCopy(state.orders);
  const startIds = new Set((current.startSnapshot || []).map(o=>o.id));
  const diffOrders = endOrders.filter(o=> !startIds.has(o.id) || new Date(o.updatedAt || o.createdAt) >= new Date(current.startedAt));
  const session = {
    id: current.id,
    startedAt: current.startedAt,
    endedAt: new Date().toISOString(),
    summary: summarizeOrders(diffOrders),
    orders: diffOrders
  };
  state.reports.sessions.unshift(session);
  state.reports.currentSession = null;
  return session;
}

export function saveCurrentSnapshot(orders){
  state.reports.savedSnapshots.unshift({
    id: 'SN' + Date.now(),
    createdAt: new Date().toISOString(),
    summary: summarizeOrders(orders),
    orders: deepCopy(orders)
  });
}

export function getSessionListHtml(escapeHtml){
  if(!state.reports.sessions.length){
    return '<div class="muted">尚無紀錄</div>';
  }
  return state.reports.sessions.map(s => `
    <div class="list-row">
      <div>
        <strong>${escapeHtml(new Date(s.startedAt).toLocaleString('zh-TW'))}</strong>
        <div class="muted">結束：${escapeHtml(new Date(s.endedAt).toLocaleString('zh-TW'))}</div>
      </div>
      <strong>${s.summary.salesText}</strong>
      <span>${s.summary.orderCount}單</span>
    </div>
  `).join('');
}