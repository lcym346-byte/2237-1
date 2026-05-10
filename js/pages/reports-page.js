/* 中文備註：報表頁 v2.1.26 — Batch 06.16/3
 * 班次主導：只顯示「當班即時數據」與「歷史班次」。
 * 依賴 report-session.js 的 startSession / endSession / 等 API。
 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, money, downloadFile, fmtLocalDateTime } from '../core/utils.js';
import { printSessionReportViaBridge } from '../modules/print-service.js';
import {
  CASH_DENOMINATIONS,
  calcCashTotal,
  emptyCashDetail,
  getCurrentSession,
  hasOpenSession,
  startSession,
  endSession,
  getSessionOrders,
  calcSessionStats,
  getRecentSessions
} from '../modules/report-session.js';

// 暫存目前要列印的班次（讓 confirmPrintBtn 取用）
let _pendingPrintSession = null;

// ──────────────────────────────────────────────
// 工具：把 session 訂單抓出來（含 fallback 給尚未寫入 sessionId 的舊單）
// ──────────────────────────────────────────────
function getCurrentSessionOrders(){
  const cur = getCurrentSession();
  if(!cur) return [];
  const startTs = new Date(cur.startedAt).getTime();
  return (state.orders || []).filter(o => {
    if(o.sessionId === cur.id) return true;
    if(!o.sessionId){
      const t = new Date(o.createdAt || 0).getTime();
      return t >= startTs;
    }
    return false;
  });
}

// ──────────────────────────────────────────────
// 班次狀態列
// ──────────────────────────────────────────────
function renderSessionStatusBar(){
  const bar = document.getElementById('sessionStatusText');
  const startBtn = document.getElementById('startSessionBtn');
  const endBtn = document.getElementById('endSessionBtn');
  const panel = document.getElementById('currentSessionPanel');
  const lock = document.getElementById('posLockOverlay');

  const cur = getCurrentSession();
  if(cur){
    const startedAt = new Date(cur.startedAt);
    const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const hh = String(Math.floor(elapsed/3600)).padStart(2,'0');
    const mm = String(Math.floor((elapsed%3600)/60)).padStart(2,'0');
    const ss = String(elapsed%60).padStart(2,'0');
    const orderCount = getCurrentSessionOrders().length;
    if(bar){
      bar.innerHTML = `🟢 <strong>值班中</strong>　${escapeHtml(cur.staffId)}　已開班 ${hh}:${mm}:${ss}　${orderCount} 筆`;
    }
    if(startBtn) startBtn.style.display = 'none';
    if(endBtn) endBtn.style.display = 'inline-block';
    if(panel) panel.style.display = '';
    if(lock) lock.style.display = 'none';
  } else {
    if(bar){ bar.innerHTML = '⚪ <strong>未開班</strong>　請先開始值班'; }
    if(startBtn) startBtn.style.display = 'inline-block';
    if(endBtn) endBtn.style.display = 'none';
    if(panel) panel.style.display = 'none';
    if(lock) lock.style.display = 'flex';
  }
}

// 每秒刷新一次計時
let statusTimer = null;
function startStatusTimer(){
  if(statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(renderSessionStatusBar, 1000);
}

// ──────────────────────────────────────────────
// 數據區渲染
// ──────────────────────────────────────────────
function renderCurrentSessionData(){
  const cur = getCurrentSession();
  if(!cur) return;
  const orders = getCurrentSessionOrders();

  // 卡片
  const sales = orders.reduce((s,o)=>s+Number(o.total||0),0);
  const count = orders.length;
  const avg = count ? Math.round(sales/count) : 0;
// 折扣：掃描每張訂單的 items 找折扣品項（productId === '_discount_'），把負金額加總後取絕對值
const discount = orders.reduce((s,o) => {
  const itemDiscount = (o.items||[]).reduce((ss, it) => {
    if(it.productId === '_discount_'){
      const amt = (Number(it.basePrice||0) + Number(it.extraPrice||0)) * Number(it.qty||1);
      return ss + amt;  // 折扣 item 的金額是負值
    }
    return ss;
  }, 0);
  // 加上 order.discountAmount（向後相容，未來若改成 discountAmount 也能算到）
  return s + Math.abs(itemDiscount) + Number(o.discountAmount||0);
}, 0);
  const cards = document.getElementById('reportCards');
  if(cards){
    cards.innerHTML = [
      ['營業額', money(sales)],
      ['訂單數', count],
      ['客單價', money(avg)],
      ['折扣', money(discount)]
    ].map(p => `<div class="stat-card"><div class="label">${p[0]}</div><div class="value">${p[1]}</div></div>`).join('');
  }

  // 訂單類型
  const typeMap = {};
  orders.forEach(o => {
    const k = o.orderType || '未分類';
    typeMap[k] = typeMap[k] || {count:0, sales:0};
    typeMap[k].count++;
    typeMap[k].sales += Number(o.total||0);
  });
  const typeEl = document.getElementById('orderTypeStats');
  if(typeEl){
    const keys = Object.keys(typeMap);
    typeEl.innerHTML = keys.length
      ? keys.map(k=>`<div class="list-row"><div>${escapeHtml(k)}</div><strong>${typeMap[k].count}單</strong><span>${money(typeMap[k].sales)}</span></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }

  // 付款方式
  const payMap = {};
  orders.forEach(o => {
    const k = o.paymentMethod || '未設定';
    payMap[k] = (payMap[k]||0) + Number(o.total||0);
  });
  const payEl = document.getElementById('paymentStats');
  if(payEl){
    const keys = Object.keys(payMap);
    payEl.innerHTML = keys.length
      ? keys.map(k=>`<div class="list-row"><div>${escapeHtml(k)}</div><strong>${money(payMap[k])}</strong><span></span></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }

  // 熱銷 TOP10
  const prodMap = {};
  orders.forEach(o => (o.items||[]).forEach(i=>{
    prodMap[i.name] = (prodMap[i.name]||0) + Number(i.qty||0);
  }));
  const top = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const topEl = document.getElementById('topProducts');
  if(topEl){
    topEl.innerHTML = top.length
      ? top.map(p=>`<div class="list-row"><div>${escapeHtml(p[0])}</div><strong>${p[1]}</strong><span>份</span></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }

  // 時段分布
  const hourMap = {};
  orders.forEach(o => {
    const h = new Date(o.createdAt).getHours();
    const k = String(h).padStart(2,'0') + ':00';
    hourMap[k] = hourMap[k] || {count:0, sales:0};
    hourMap[k].count++;
    hourMap[k].sales += Number(o.total||0);
  });
  const hourEl = document.getElementById('hourAnalysis');
  if(hourEl){
    const arr = Object.entries(hourMap).sort((a,b)=>a[0].localeCompare(b[0]));
    hourEl.innerHTML = arr.length
      ? arr.map(p=>`<div class="list-row"><div>${p[0]}</div><strong>${p[1].count}單</strong><span>${money(p[1].sales)}</span></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }
}

// 歷史班次列表
// 歷史班次列表（在浮動視窗內渲染）
function renderHistorySessionsInModal(dateFrom, dateTo){
  const el = document.getElementById('historySessionsList');
  if(!el) return;

  // ★ 修正：班次儲存在 state.reports.sessions，不是 state.sessions
  let list = ((state.reports && state.reports.sessions) || []).filter(s => s.endedAt);

  if(dateFrom){
    const from = new Date(dateFrom + 'T00:00:00');
    list = list.filter(s => new Date(s.endedAt) >= from);
  }
  if(dateTo){
    const to = new Date(dateTo + 'T23:59:59');
    list = list.filter(s => new Date(s.endedAt) <= to);
  }
  if(!dateFrom && !dateTo){
    const cutoff = Date.now() - 30*24*3600*1000;
    list = list.filter(s => new Date(s.endedAt).getTime() >= cutoff);
  }

  list.sort((a,b) => new Date(b.endedAt) - new Date(a.endedAt));

  if(!list.length){
    el.innerHTML = '<div class="muted" style="text-align:center;padding:30px;color:#94a3b8">查無資料</div>';
    return;
  }

  el.innerHTML = list.map(s => {
    const start = fmtLocalDateTime(s.startedAt).slice(5);
    const end = s.endedAt ? fmtLocalDateTime(s.endedAt).slice(11) : '進行中';
    const sales = s.stats ? money(s.stats.salesTotal) : money(0);
    const count = s.stats ? s.stats.orderCount : 0;
    const diffNum = Number(s.cashDiff||0);
    let diffHtml = '';
    if(diffNum===0) diffHtml = '<span style="color:#10b981;font-weight:bold">✓ 平衡</span>';
    else if(diffNum<0) diffHtml = `<span style="color:#ef4444;font-weight:bold">短少 ${diffNum}</span>`;
    else diffHtml = `<span style="color:#f59e0b;font-weight:bold">溢收 +${diffNum}</span>`;

    return `
      <div class="history-session-card" data-session-id="${escapeHtml(s.id)}" style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;background:#fff;cursor:pointer;transition:all 0.15s">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong>${escapeHtml(start)} ~ ${escapeHtml(end)}</strong>
          <span style="font-size:13px;color:#64748b">${escapeHtml(s.staffId||'')}${s.endStaffId&&s.endStaffId!==s.staffId?' / '+escapeHtml(s.endStaffId):''}</span>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:#475569">
          <span>${count} 單</span>
          <span>營業額 <strong style="color:#0f172a">${sales}</strong></span>
          <span>${diffHtml}</span>
        </div>
        ${s.note?`<div style="margin-top:6px;font-size:12px;color:#64748b">備註：${escapeHtml(s.note)}</div>`:''}
        <div style="margin-top:6px;font-size:12px;color:#3b82f6">👉 點擊查看摘要與列印</div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.history-session-card').forEach(card => {
    card.addEventListener('click', () => {
      const sid = card.dataset.sessionId;
      // ★ 修正：同樣改讀 state.reports.sessions
      const session = ((state.reports && state.reports.sessions) || []).find(s => s.id === sid);
      if(session){
        document.getElementById('historySessionsModal').classList.add('hidden');
        openSessionSummaryModal(session);
      }
    });
  });
}

function openHistorySessionsModal(){
  const modal = document.getElementById('historySessionsModal');
  if(!modal) return;
  document.getElementById('historyDateFrom').value = '';
  document.getElementById('historyDateTo').value = '';
  renderHistorySessionsInModal();
  modal.classList.remove('hidden');
}
function closeHistorySessionsModal(){
  document.getElementById('historySessionsModal')?.classList.add('hidden');
}


// ──────────────────────────────────────────────
// 主刷新 export
// ──────────────────────────────────────────────
export function renderReports(){
  renderSessionStatusBar();
  renderCurrentSessionData();
  
}

// ──────────────────────────────────────────────
// 開始/結束值班 — 浮動視窗
// ──────────────────────────────────────────────
function renderCashGrid(containerId, prefix, onChange){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = CASH_DENOMINATIONS.map(d => `
    <div style="display:flex;align-items:center;gap:6px;background:#fff;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px">
      <span style="font-size:13px;width:50px">$${d}</span>
      <span style="font-size:12px;color:#94a3b8">×</span>
      <input type="tel" inputmode="numeric" pattern="[0-9]*" value="0" data-denom="${d}" id="${prefix}_${d}" style="flex:1;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:14px;text-align:right;-webkit-appearance:none;appearance:none">
      <span style="font-size:12px;color:#64748b;width:60px;text-align:right" id="${prefix}_${d}_sub">$0</span>
    </div>
  `).join('');
    el.querySelectorAll('input[data-denom]').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      // 過濾非數字
      input.value = input.value.replace(/[^0-9]/g, '');
      const d = Number(input.dataset.denom);
      const n = Math.max(0, Number(input.value)||0);
      const sub = document.getElementById(`${prefix}_${d}_sub`);
      if(sub) sub.textContent = '$' + (d*n);
      if(onChange) onChange(getCashDetailFromGrid(prefix));
    });
  });

}

function getCashDetailFromGrid(prefix){
  const detail = emptyCashDetail();
  CASH_DENOMINATIONS.forEach(d => {
    const el = document.getElementById(`${prefix}_${d}`);
    if(el) detail[d] = Math.max(0, Number(el.value)||0);
  });
  return detail;
}

function openStartSessionModal(){
  const modal = document.getElementById('startSessionModal');
  if(!modal) return;
  document.getElementById('startStaffSelect').value = 'A1';
  renderCashGrid('startCashGrid', 'startCash', detail => {
    document.getElementById('startCashTotal').textContent = '$' + calcCashTotal(detail);
  });
  document.getElementById('startCashTotal').textContent = '$0';
  modal.classList.remove('hidden');
}

function confirmStartSession(){
  const modal = document.getElementById('startSessionModal');
  try{
    const staffId = document.getElementById('startStaffSelect').value;
    const cashDetail = getCashDetailFromGrid('startCash');
    startSession({ staffId, cashDetail });
    if(modal) modal.classList.add('hidden');
    renderReports();
    if(typeof window.refreshPosLockState === 'function') window.refreshPosLockState();
    if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
    alert(`已開始值班\n人員：${staffId}\n備用金：$${calcCashTotal(cashDetail)}`);
  }catch(err){
    if(modal) modal.classList.add('hidden');
    alert('開班失敗：' + err.message);
  }
}


function openEndSessionModal(){
  const modal = document.getElementById('endSessionModal');
  const cur = getCurrentSession();
  if(!cur){
    // 沒有進行中的班次 → 詢問是否查看最近一次已結束班次的摘要
const sessions = ((state.reports && state.reports.sessions) || []).filter(s => s.endedAt).sort((a,b) => new Date(b.endedAt) - new Date(a.endedAt));
    if(sessions.length > 0){
      if(confirm('目前沒有進行中的班次。\n\n是否查看最近一次已結束班次的摘要？')){
        openSessionSummaryModal(sessions[0]);
      }
    } else {
      alert('目前沒有進行中的班次，也沒有歷史班次紀錄');
    }
    return;
  }
  // 有進行中的班次 → 顯示結束班次表單
    document.getElementById('endStaffSelect').value = cur.staffId || '';
  document.getElementById('endSessionInfo').innerHTML = 
    '人員：' + (cur.staffId || '-') + '<br>' +
    '開始時間：' + fmtLocalDateTime(cur.startedAt);
  document.getElementById('endSessionNote').value = '';

  // 先計算應收現金（系統計算）
  const stats = calcSessionStats(cur.id);
  const expectedCash = Number(cur.openingCash || 0) + Number(stats.cashSales || 0);
  document.getElementById('endOpeningCash').textContent = '$' + Number(cur.openingCash || 0);
  document.getElementById('endCashSales').textContent = '$' + Number(stats.cashSales || 0);
  document.getElementById('endExpectedCash').textContent = '$' + expectedCash;

  // 渲染盤點輸入格子（即時更新實收現金與誤差）
  renderCashGrid('endCashGrid', 'endCash', detail => {
    const closing = calcCashTotal(detail);
    document.getElementById('endClosingCash').textContent = '$' + closing;
    const d = closing - expectedCash;
    const diffEl = document.getElementById('endCashDiff');
    if(d === 0){
      diffEl.textContent = '$0 ✓';
      diffEl.style.color = '#10b981';
    } else if(d < 0){
      diffEl.textContent = `短少 $${-d}`;
      diffEl.style.color = '#ef4444';
    } else {
      diffEl.textContent = `溢收 +$${d}`;
      diffEl.style.color = '#f59e0b';
    }
  });
  document.getElementById('endClosingCash').textContent = '$0';
  document.getElementById('endCashDiff').textContent = '$0 ✓';
  document.getElementById('endCashDiff').style.color = '#10b981';

  if(modal) modal.classList.remove('hidden');
} 
function confirmEndSession(){
  const modal = document.getElementById('endSessionModal');
  if(!getCurrentSession()){
    if(modal) modal.classList.add('hidden');
    alert('目前沒有進行中的班次（可能已被結束）');
    renderReports();
    if(typeof window.refreshPosLockState === 'function') window.refreshPosLockState();
    if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
    return;
  }
  try{
    const staffId = document.getElementById('endStaffSelect').value;
    const cashDetail = getCashDetailFromGrid('endCash');
    const note = document.getElementById('endSessionNote').value || '';
    const ended = endSession({ staffId, cashDetail, note });

    if(modal) modal.classList.add('hidden');
    renderReports();
    if(typeof window.refreshPosLockState === 'function') window.refreshPosLockState();
    if(typeof window.refreshAllViews === 'function') window.refreshAllViews();

    setTimeout(() => {
      openSessionSummaryModal(ended);
    }, 100);
  }catch(err){
    if(modal) modal.classList.add('hidden');
    renderReports();
    if(typeof window.refreshPosLockState === 'function') window.refreshPosLockState();
    if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
    alert('結束值班失敗：' + err.message);
  }
}


// ──────────────────────────────────────────────
// 班次摘要 Modal
// ──────────────────────────────────────────────
function openSessionSummaryModal(session){
  const modal = document.getElementById('sessionSummaryModal');
  if(!modal) return;

  // 取出該班次訂單（已結束的 session 仍可從 state.orders 撈）
 const orders = (state.orders || []).filter(o => o.sessionId === session.id);

// 班次資訊
document.getElementById('summaryStaffInfo').innerHTML =
  `人員：${escapeHtml(session.staffId)}　${escapeHtml(fmtLocalDateTime(session.startedAt))} ~ ${escapeHtml(fmtLocalDateTime(session.endedAt || new Date().toISOString()))}` +
  (orders.length === 0 ? '<div style="margin-top:6px;padding:6px 10px;background:#f1f5f9;border-radius:6px;color:#64748b">📭 本班無交易紀錄</div>' : '');

  // 現金誤差橫幅
  const diff = Number(session.cashDiff || 0);
  const banner = document.getElementById('summaryCashDiffBanner');
  if(diff === 0){
    banner.textContent = '✓ 現金平衡';
    banner.style.background = '#f0fdf4';
    banner.style.color = '#10b981';
  } else if(diff < 0){
    banner.textContent = `⚠ 現金短少 $${-diff}`;
    banner.style.background = '#fef2f2';
    banner.style.color = '#ef4444';
  } else {
    banner.textContent = `⚠ 現金溢收 $${diff}`;
    banner.style.background = '#fffbeb';
    banner.style.color = '#f59e0b';
  }

  // 卡片
  const sales = orders.reduce((s,o)=>s+Number(o.total||0),0);
  const count = orders.length;
  const avg = count ? Math.round(sales/count) : 0;
// 折扣：掃描每張訂單的 items 找折扣品項（productId === '_discount_'），把負金額加總後取絕對值
const discount = orders.reduce((s,o) => {
  const itemDiscount = (o.items||[]).reduce((ss, it) => {
    if(it.productId === '_discount_'){
      const amt = (Number(it.basePrice||0) + Number(it.extraPrice||0)) * Number(it.qty||1);
      return ss + amt;  // 折扣 item 的金額是負值
    }
    return ss;
  }, 0);
  // 加上 order.discountAmount（向後相容，未來若改成 discountAmount 也能算到）
  return s + Math.abs(itemDiscount) + Number(o.discountAmount||0);
}, 0);
  document.getElementById('summaryStats').innerHTML = [
    ['營業額', money(sales)],
    ['訂單數', count],
    ['客單價', money(avg)],
    ['折扣', money(discount)]
  ].map(p => `<div class="stat-card"><div class="label">${p[0]}</div><div class="value">${p[1]}</div></div>`).join('');

  // 訂單類型
  const typeMap = {};
  orders.forEach(o => {
    const k = o.orderType || '未分類';
    typeMap[k] = typeMap[k] || {count:0, sales:0};
    typeMap[k].count++;
    typeMap[k].sales += Number(o.total||0);
  });
  const typeKeys = Object.keys(typeMap);
  document.getElementById('summaryOrderTypes').innerHTML = typeKeys.length
    ? typeKeys.map(k=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9"><span>${escapeHtml(k)}</span><span><strong>${typeMap[k].count}單</strong> · ${money(typeMap[k].sales)}</span></div>`).join('')
    : '<div class="muted">無</div>';

  // 付款方式
  const payMap = {};
  orders.forEach(o => {
    const k = o.paymentMethod || '未設定';
    payMap[k] = (payMap[k]||0) + Number(o.total||0);
  });
  const payKeys = Object.keys(payMap);
  document.getElementById('summaryPayments').innerHTML = payKeys.length
    ? payKeys.map(k=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9"><span>${escapeHtml(k)}</span><strong>${money(payMap[k])}</strong></div>`).join('')
    : '<div class="muted">無</div>';

  // TOP5
  const prodMap = {};
  orders.forEach(o => (o.items||[]).forEach(i=>{
    prodMap[i.name] = (prodMap[i.name]||0) + Number(i.qty||0);
  }));
  const top = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  document.getElementById('summaryTopProducts').innerHTML = top.length
    ? top.map((p,i)=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9"><span>${i+1}. ${escapeHtml(p[0])}</span><strong>${p[1]} 份</strong></div>`).join('')
    : '<div class="muted">無</div>';

  // 綁按鈕
  document.getElementById('summaryPrintBtn').onclick = ()=> openPrintOptions(session);
  document.getElementById('summaryExportBtn').onclick = ()=> exportSessionCsv(session);
  document.getElementById('summaryDoneBtn').onclick = ()=> {
    modal.classList.add('hidden');
  };

  modal.classList.remove('hidden');
}
function openPrintOptions(session){
  _pendingPrintSession = session;
  const modal = document.getElementById('printOptionsModal');
  const summaryModal = document.getElementById('sessionSummaryModal');
  if(!modal){
    printSessionReport(session, null);
    return;
  }

  // 1. 依列印設定預選紙張
  const cfg = (state.settings && state.settings.printConfig) || {};
  const paperWidth = Number(cfg.receiptPaperWidth || 0);
  const useThermal = (paperWidth === 58 || paperWidth === 80);
  const radios = document.querySelectorAll('input[name="paperSize"]');
  radios.forEach(r => {
    if(useThermal && r.value === '80mm') r.checked = true;
    else if(!useThermal && r.value === 'A4') r.checked = true;
    else r.checked = false;
  });

  // 2. 讀取上次勾選狀態（首次使用全部不勾）
  let lastOpts = {};
  try{
    lastOpts = JSON.parse(localStorage.getItem('printOptions_lastChecked') || '{}');
  }catch(e){ lastOpts = {}; }
  const optIds = ['optSummary','optOrderTypes','optPayments','optTopProducts','optHourly','optOrderList'];
  optIds.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.checked = !!lastOpts[id];
  });

  // 3. 暫時隱藏摘要避免重疊
  if(summaryModal) summaryModal.classList.add('hidden');
  modal.classList.remove('hidden');

  // 4. 取消鈕：關閉列印選項 + 重新顯示摘要
  const cancelBtns = modal.querySelectorAll('.secondary-btn, .ghost-btn');
  cancelBtns.forEach(btn => {
    btn.onclick = () => {
      modal.classList.add('hidden');
      if(summaryModal) summaryModal.classList.remove('hidden');
    };
  });

  // 5. 確認列印
  document.getElementById('confirmPrintBtn').onclick = () => {
    let opts = {
      summary: document.getElementById('optSummary').checked,
      orderTypes: document.getElementById('optOrderTypes').checked,
      payments: document.getElementById('optPayments').checked,
      topProducts: document.getElementById('optTopProducts').checked,
      hourly: document.getElementById('optHourly').checked,
      orderList: document.getElementById('optOrderList').checked,
      paperSize: document.querySelector('input[name="paperSize"]:checked')?.value || 'A4'
    };

    // 儲存本次勾選狀態
    try{
      const toSave = {
        optSummary: opts.summary,
        optOrderTypes: opts.orderTypes,
        optPayments: opts.payments,
        optTopProducts: opts.topProducts,
        optHourly: opts.hourly,
        optOrderList: opts.orderList
      };
      localStorage.setItem('printOptions_lastChecked', JSON.stringify(toSave));
    }catch(e){}

    // 防呆：一個都沒勾就全部當有勾
    const noneChecked = !opts.summary && !opts.orderTypes && !opts.payments && !opts.topProducts && !opts.hourly && !opts.orderList;
    if(noneChecked){
      opts.summary = true;
      opts.orderTypes = true;
      opts.payments = true;
      opts.topProducts = true;
      opts.hourly = true;
    }

    // ⭐ 關鍵：在 user gesture 期間立刻開窗（這是 1d95f632 會印的方式）
    modal.classList.add('hidden');
if(summaryModal) summaryModal.classList.remove('hidden');

printSessionReport(_pendingPrintSession, opts, null);
};  
}     

function buildSessionReportHtml(session, opts){
  opts = opts || { summary:true, orderTypes:true, payments:true, topProducts:true, hourly:true, orderList:false, paperSize:'A4' };

  const orders = (state.orders || []).filter(o => o.sessionId === session.id);
  const sales = orders.reduce((s,o)=>s+Number(o.total||0),0);
  const count = orders.length;
  const avg = count ? Math.round(sales/count) : 0;
  const discount = orders.reduce((s,o) => {
    const itemDiscount = (o.items||[]).reduce((ss, it) => {
      if(it.productId === '_discount_'){
        const amt = (Number(it.basePrice||0) + Number(it.extraPrice||0)) * Number(it.qty||1);
        return ss + amt;
      }
      return ss;
    }, 0);
    return s + Math.abs(itemDiscount) + Number(o.discountAmount||0);
  }, 0);

  const typeMap = {};
  orders.forEach(o => {
    const k = o.orderType || '未分類';
    typeMap[k] = typeMap[k] || {count:0, sales:0};
    typeMap[k].count++;
    typeMap[k].sales += Number(o.total||0);
  });

  const payMap = {};
  orders.forEach(o => {
    const k = o.paymentMethod || '未設定';
    payMap[k] = (payMap[k]||0) + Number(o.total||0);
  });

  const prodMap = {};
  orders.forEach(o => (o.items||[]).forEach(i=>{
    prodMap[i.name] = (prodMap[i.name]||0) + Number(i.qty||0);
  }));
  const top = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,10);

  const hourMap = {};
  orders.forEach(o => {
    const h = new Date(o.createdAt).getHours();
    const k = String(h).padStart(2,'0') + ':00';
    hourMap[k] = hourMap[k] || {count:0, sales:0};
    hourMap[k].count++;
    hourMap[k].sales += Number(o.total||0);
  });
  const hourEntries = Object.entries(hourMap).sort((a,b)=>a[0].localeCompare(b[0]));

  const diff = Number(session.cashDiff || 0);
  const diffText = diff===0 ? '✓ 平衡' : (diff<0 ? `短少 $${-diff}` : `溢收 +$${diff}`);
  const diffColor = diff===0 ? '#10b981' : (diff<0 ? '#ef4444' : '#f59e0b');
  const diffBg = diff===0 ? '#f0fdf4' : (diff<0 ? '#fef2f2' : '#fffbeb');

  const is80 = opts.paperSize === '80mm';
  const pageCss = is80
    ? `@page{size:80mm auto;margin:3mm} body{width:74mm;font-size:12px;padding:0;margin:0}`
    : `@page{size:A4;margin:10mm} body{padding:20px}`;

  const html_summary = !opts.summary ? '' : `
<div class="section">
  <h2>💰 班次總覽</h2>
  <div class="summary-row"><span>營業額</span><strong>${money(sales)}</strong></div>
  <div class="summary-row"><span>訂單數</span><strong>${count}</strong></div>
  <div class="summary-row"><span>客單價</span><strong>${money(avg)}</strong></div>
  <div class="summary-row"><span>折扣</span><strong>${money(discount)}</strong></div>
  <div class="summary-row"><span>開班備用金</span><strong>${money(Number(session.openingCash||0))}</strong></div>
  <div class="summary-row"><span>應有現金</span><strong>${money(Number(session.expectedCash||0))}</strong></div>
  <div class="summary-row"><span>實收現金</span><strong>${money(Number(session.closingCash||0))}</strong></div>
  <div class="diff" style="background:${diffBg};color:${diffColor};margin-top:8px">${diffText}</div>
  ${session.note?`<div style="margin-top:8px;font-size:13px;color:#64748b">備註：${escapeHtml(session.note)}</div>`:''}
</div>`;

  const html_orderTypes = !opts.orderTypes ? '' : `
<div class="section">
  <h2>🍱 訂單類型</h2>
  <table>
    <tr><th>類型</th><th class="right">單數</th><th class="right">金額</th></tr>
    ${Object.entries(typeMap).map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td class="right">${v.count}</td><td class="right">${money(v.sales)}</td></tr>`).join('') || '<tr><td colspan="3">無</td></tr>'}
  </table>
</div>`;

  const html_payments = !opts.payments ? '' : `
<div class="section">
  <h2>💳 付款方式</h2>
  <table>
    <tr><th>方式</th><th class="right">金額</th></tr>
    ${Object.entries(payMap).map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td class="right">${money(v)}</td></tr>`).join('') || '<tr><td colspan="2">無</td></tr>'}
  </table>
</div>`;

  const html_top = !opts.topProducts ? '' : `
<div class="section">
  <h2>🔥 熱銷 TOP10</h2>
  <table>
    <tr><th>#</th><th>商品</th><th class="right">數量</th></tr>
    ${top.map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p[0])}</td><td class="right">${p[1]}</td></tr>`).join('') || '<tr><td colspan="3">無</td></tr>'}
  </table>
</div>`;

  const html_hourly = !opts.hourly ? '' : `
<div class="section">
  <h2>🕐 時段分布</h2>
  <table>
    <tr><th>時段</th><th class="right">單數</th><th class="right">金額</th></tr>
    ${hourEntries.map(([k,v])=>`<tr><td>${k}</td><td class="right">${v.count}</td><td class="right">${money(v.sales)}</td></tr>`).join('') || '<tr><td colspan="3">無</td></tr>'}
  </table>
</div>`;

  const html_orderList = !opts.orderList ? '' : `
<div class="section">
  <h2>📝 訂單明細</h2>
  <table>
    <tr><th>編號</th><th>時間</th><th>類型</th><th>付款</th><th class="right">金額</th></tr>
    ${orders.map(o=>`<tr><td>${escapeHtml(o.orderNo||o.id)}</td><td>${escapeHtml(fmtLocalDateTime(o.createdAt))}</td><td>${escapeHtml(o.orderType||'')}</td><td>${escapeHtml(o.paymentMethod||'')}</td><td class="right">${money(Number(o.total||0))}</td></tr>`).join('') || '<tr><td colspan="5">無</td></tr>'}
  </table>
</div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>班次報表</title>
<style>
  ${pageCss}
  body{font-family:'Microsoft JhengHei','PingFang TC',sans-serif;color:#0f172a}
  h1{text-align:center;margin:0 0 6px;font-size:${is80?'15px':'22px'}}
  .sub{text-align:center;color:#64748b;font-size:${is80?'11px':'13px'};margin-bottom:12px}
  .section{margin-top:12px;page-break-inside:avoid}
  h2{font-size:${is80?'13px':'15px'};margin:0 0 6px;border-bottom:2px solid #0f172a;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:${is80?'11px':'13px'}}
  td,th{border:1px solid #cbd5e1;padding:${is80?'2px 4px':'5px 8px'}}
  th{background:#f1f5f9;text-align:left}
  .right{text-align:right}
  .summary-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;font-size:${is80?'12px':'14px'}}
  .diff{padding:8px;border-radius:6px;text-align:center;font-weight:bold;font-size:${is80?'13px':'15px'}}
</style></head><body>
<h1>📋 班次報表</h1>
<div class="sub">人員：${escapeHtml(session.staffId)}<br>${escapeHtml(fmtLocalDateTime(session.startedAt))} ~ ${escapeHtml(fmtLocalDateTime(session.endedAt || new Date().toISOString()))}</div>
${html_summary}${html_orderTypes}${html_payments}${html_top}${html_hourly}${html_orderList}
</body></html>`;
}

function printSessionReport(session, opts, printWin){
  // 不再使用 printWin（新分頁），直接呼叫 Sunmi Bridge
  if(printWin){
    try{ printWin.close(); }catch(e){}
  }

  const orders = (state.orders || []).filter(o => o.sessionId === session.id);
  const sales = orders.reduce((s,o)=>s+Number(o.total||0),0);
  const count = orders.length;
  const avg = count ? Math.round(sales/count) : 0;
  const discount = orders.reduce((s,o) => {
    const itemDiscount = (o.items||[]).reduce((ss, it) => {
      if(it.productId === '_discount_'){
        const amt = (Number(it.basePrice||0) + Number(it.extraPrice||0)) * Number(it.qty||1);
        return ss + amt;
      }
      return ss;
    }, 0);
    return s + Math.abs(itemDiscount) + Number(o.discountAmount||0);
  }, 0);

  const lines = [];
  const sep = { label:'------------------------', value:'' };

  // 班次總覽
  if(opts.summary !== false){
    lines.push({ label:'-- 班次總覽 --', value:'' });
    lines.push({ label:`營業額      $${sales}`, value:'' });
    lines.push({ label:`訂單數      ${count}`, value:'' });
    lines.push({ label:`客單價      $${avg}`, value:'' });
    lines.push({ label:`折扣        $${discount}`, value:'' });
    lines.push({ label:`開班備用金  $${Number(session.openingCash||0)}`, value:'' });
    lines.push({ label:`應有現金    $${Number(session.expectedCash||0)}`, value:'' });
    lines.push({ label:`實收現金    $${Number(session.closingCash||0)}`, value:'' });
    const diff = Number(session.cashDiff||0);
    const diffText = diff===0 ? '平衡' : (diff<0 ? `短少 $${-diff}` : `溢收 +$${diff}`);
    lines.push({ label:`差異        ${diffText}`, value:'' });
    lines.push(sep);
  }

  // 訂單類型
  if(opts.orderTypes){
    const typeMap = {};
    orders.forEach(o => {
      const k = o.orderType || '未分類';
      typeMap[k] = typeMap[k] || {count:0, sales:0};
      typeMap[k].count++;
      typeMap[k].sales += Number(o.total||0);
    });
    lines.push({ label:'-- 訂單類型 --', value:'' });
    Object.entries(typeMap).forEach(([k,v]) => {
      lines.push({ label:`${k}  ${v.count}單  $${v.sales}`, value:'' });
    });
    if(!Object.keys(typeMap).length) lines.push({ label:'(無資料)', value:'' });
    lines.push(sep);
  }

  // 付款方式
  if(opts.payments){
    const payMap = {};
    orders.forEach(o => {
      const k = o.paymentMethod || '未設定';
      payMap[k] = (payMap[k]||0) + Number(o.total||0);
    });
    lines.push({ label:'-- 付款方式 --', value:'' });
    Object.entries(payMap).forEach(([k,v]) => {
      lines.push({ label:`${k}  $${v}`, value:'' });
    });
    if(!Object.keys(payMap).length) lines.push({ label:'(無資料)', value:'' });
    lines.push(sep);
  }

  // 熱銷 TOP10
  if(opts.topProducts){
    const prodMap = {};
    orders.forEach(o => (o.items||[]).forEach(i => {
      if(i.productId === '_discount_') return;
      prodMap[i.name] = (prodMap[i.name]||0) + Number(i.qty||0);
    }));
    const top = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
    lines.push({ label:'-- 熱銷 TOP10 --', value:'' });
    top.forEach((p,i) => {
      lines.push({ label:`${i+1}. ${p[0]}  ${p[1]}份`, value:'' });
    });
    if(!top.length) lines.push({ label:'(無資料)', value:'' });
    lines.push(sep);
  }

  // 時段分布
  if(opts.hourly){
    const hourMap = {};
    orders.forEach(o => {
      const h = new Date(o.createdAt).getHours();
      const k = String(h).padStart(2,'0') + ':00';
      hourMap[k] = hourMap[k] || {count:0, sales:0};
      hourMap[k].count++;
      hourMap[k].sales += Number(o.total||0);
    });
    const hourEntries = Object.entries(hourMap).sort((a,b) => a[0].localeCompare(b[0]));
    lines.push({ label:'-- 時段分布 --', value:'' });
    hourEntries.forEach(([k,v]) => {
      lines.push({ label:`${k}  ${v.count}單  $${v.sales}`, value:'' });
    });
    if(!hourEntries.length) lines.push({ label:'(無資料)', value:'' });
    lines.push(sep);
  }

  // 訂單明細
  if(opts.orderList){
    lines.push({ label:'-- 訂單明細 --', value:'' });
    orders.forEach(o => {
      lines.push({ label:`${o.orderNo||o.id}  $${Number(o.total||0)}`, value:'' });
    });
    if(!orders.length) lines.push({ label:'(無訂單)', value:'' });
  }

  if(session.note){
    lines.push(sep);
    lines.push({ label:`備註: ${session.note}`, value:'' });
  }

  // 呼叫 Sunmi Bridge 列印
  printSessionReportViaBridge({
    title: '班次報表',
    subtitle: `${session.staffId}　${fmtLocalDateTime(session.startedAt).slice(5,16)}~${fmtLocalDateTime(session.endedAt||new Date().toISOString()).slice(11,16)}`,
    lines
  }).then(result => {
    if(result.ok){
      console.log('班次報表列印成功，路徑：', result.route);
    }
  }).catch(err => {
    console.error('班次報表列印失敗：', err);
    alert('列印失敗：' + (err.message || err));
  });
}

// ──────────────────────────────────────────────
// 匯出 CSV（共用邏輯，相容 Sunmi T2 / Android WebView）
//   csvDownload(filename, rows)
//   - 有些 Android WebView 不支援 Blob 下載，這裡用 data URL 開新分頁
//   - 若連 window.open 都被擋，就 fallback 顯示全螢幕 textarea 讓使用者長按複製
// ──────────────────────────────────────────────
function csvDownload(filename, rows){
  const csv = '\uFEFF' + rows.map(r =>
    r.map(c => `"${String(c == null ? '' : c).replace(/"/g,'""')}"`).join(',')
  ).join('\n');

  const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  const w = window.open(dataUrl, '_blank');
  if(w) return;

  // fallback：開新分頁失敗 → 全螢幕顯示，使用者長按複製
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;flex-direction:column;padding:20px;box-sizing:border-box';
  overlay.innerHTML = `
    <div style="color:#fff;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
      <strong>${filename}</strong>
      <button id="csvCloseBtn" style="padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px">關閉</button>
    </div>
    <div style="color:#fff;font-size:13px;margin-bottom:10px">長按下方文字 → 全選 → 複製，貼到 Email 或記事本另存為 .csv</div>
    <textarea readonly style="flex:1;width:100%;font-family:monospace;font-size:12px;padding:10px;border-radius:6px"></textarea>
  `;
  overlay.querySelector('textarea').value = csv;
  document.body.appendChild(overlay);
  overlay.querySelector('#csvCloseBtn').onclick = () => overlay.remove();
}

// 報表頁頂部「📥 匯出 Excel」（今日全部訂單）
function exportCurrentReportCsv(){
  const today = new Date().toISOString().slice(0,10);
  const rows = [['訂單號','時間','狀態','類型','桌號','付款','總計']];
  (state.orders || [])
    .filter(o => (o.createdAt || '').slice(0,10) === today)
    .forEach(o => rows.push([
      o.orderNo || '',
      o.createdAt || '',
      o.status || '',
      o.orderType || '',
      o.tableNo || '',
      o.paymentMethod || '',
      Number(o.total || 0)
    ]));
  csvDownload(`today-report_${today}.csv`, rows);
}

// 歷史紀錄裡某一班次的「📥 匯出 Excel」
function exportSessionCsv(session){
  const orders = (state.orders || []).filter(o => o.sessionId === session.id);
  const rows = [['訂單編號','時間','類型','付款','金額','折扣','桌號']];
  orders.forEach(o => rows.push([
    o.orderNo || o.id,
    fmtLocalDateTime(o.createdAt),
    o.orderType || '',
    o.paymentMethod || '',
    Number(o.total || 0),
    Number(o.discountAmount || 0),
    o.tableNo || ''
  ]));
  const dateStr = fmtLocalDateTime(session.endedAt || session.startedAt).slice(0,10);
  csvDownload(`班次_${session.staffId}_${dateStr}.csv`, rows);
}


// ──────────────────────────────────────────────
// 初始化
// ──────────────────────────────────────────────
export function initReportsPage(){
  document.getElementById('startSessionBtn')?.addEventListener('click', openStartSessionModal);
  document.getElementById('endSessionBtn')?.addEventListener('click', openEndSessionModal);
    document.getElementById('openHistorySessionsBtn')?.addEventListener('click', openHistorySessionsModal);
  document.getElementById('closeHistorySessionsModal')?.addEventListener('click', closeHistorySessionsModal);
  document.querySelector('#historySessionsModal .modal-backdrop')?.addEventListener('click', closeHistorySessionsModal);
  document.getElementById('historyDateFilterBtn')?.addEventListener('click', () => {
    const f = document.getElementById('historyDateFrom').value;
    const t = document.getElementById('historyDateTo').value;
    renderHistorySessionsInModal(f, t);
  });
  document.getElementById('historyDateResetBtn')?.addEventListener('click', () => {
    document.getElementById('historyDateFrom').value = '';
    document.getElementById('historyDateTo').value = '';
    renderHistorySessionsInModal();
  });

  document.getElementById('confirmStartSessionBtn')?.addEventListener('click', confirmStartSession);
  document.getElementById('confirmEndSessionBtn')?.addEventListener('click', confirmEndSession);
  document.getElementById('reportExportBtn')?.addEventListener('click', exportCurrentReportCsv);
  document.getElementById('costManageBtn')?.addEventListener('click', () => {
    alert('💰 成本管理功能將在 Batch 06.16/7 提供');
  });
  document.getElementById('toggleTopProductsBtn')?.addEventListener('click', () => {
    const el = document.getElementById('topProducts');
    el?.classList.toggle('collapsed');
  });
  document.getElementById('goToReportsBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-view="reportsView"]')?.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('reportsView')?.classList.add('active');
  });
  

  startStatusTimer();
  renderReports();
}
