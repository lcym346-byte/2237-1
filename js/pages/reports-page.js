/* 中文備註：js/pages/reports-page.js，此檔已加入中文說明，方便後續維護。 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, money, todayStr, downloadFile } from '../core/utils.js';
import { startSession, endSession, saveCurrentSnapshot, getSessionListHtml } from '../modules/report-session.js';

function getReportOrders(){
  if(state.viewReportOrders) return state.viewReportOrders;
  const from = document.getElementById('reportDateFrom')?.value || '';
  const to = document.getElementById('reportDateTo')?.value || '';
  return state.orders.filter(o=>{
    const d = (o.createdAt || '').slice(0,10);
    return (!from || d >= from) && (!to || d <= to);
  });
}

export function renderReports(){
  const cards = document.getElementById('reportCards');
  if(!cards) return;

  const orders = getReportOrders();
  const today = todayStr();
  const ordersToday = orders.filter(o=>(o.createdAt || '').slice(0,10)===today);
  const todaySales = ordersToday.reduce((s,o)=>s + Number(o.total || 0),0);
  const seven = orders.filter(o=> Date.now() - new Date(o.createdAt).getTime() <= 7*86400000).reduce((s,o)=>s + Number(o.total || 0),0);
  const thirty = orders.filter(o=> Date.now() - new Date(o.createdAt).getTime() <= 30*86400000).reduce((s,o)=>s + Number(o.total || 0),0);

  cards.innerHTML = [
    ['今日營業額', money(todaySales)],
    ['今日訂單數', ordersToday.length],
    ['近7日營業額', money(seven)],
    ['近30日營業額', money(thirty)],
  ].map(([l,v])=> `<div class="stat-card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

  const productMap = {};
  orders.forEach(o=> (o.items || []).forEach(i=> {
    productMap[i.name] = (productMap[i.name]||0) + Number(i.qty || 0);
  }));
  const top = Object.entries(productMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const topEl = document.getElementById('topProducts');
  if(topEl){
    topEl.innerHTML = top.length ? top.map(([k,v])=> `<div class="list-row"><div>${escapeHtml(k)}</div><strong>${v}</strong><span>份</span></div>`).join('') : '<div class="muted">尚無資料</div>';
  }

  const payMap = {};
  orders.forEach(o=> {
    const key = o.paymentMethod || '未設定';
    payMap[key] = (payMap[key]||0) + Number(o.total || 0);
  });
  const payEl = document.getElementById('paymentStats');
  if(payEl){
    payEl.innerHTML = Object.keys(payMap).length ? Object.entries(payMap).map(([k,v])=> `<div class="list-row"><div>${escapeHtml(k)}</div><strong>${money(v)}</strong><span></span></div>`).join('') : '<div class="muted">尚無資料</div>';
  }

  const productAnalysis = {};
  orders.forEach(o=> (o.items || []).forEach(i=>{
    const key = i.name;
    productAnalysis[key] = productAnalysis[key] || {qty:0, sales:0};
    productAnalysis[key].qty += Number(i.qty || 0);
    productAnalysis[key].sales += (Number(i.basePrice || 0) + Number(i.extraPrice || 0)) * Number(i.qty || 0);
  }));
  const pa = Object.entries(productAnalysis).sort((a,b)=>b[1].sales-a[1].sales);
  const paEl = document.getElementById('productAnalysis');
  if(paEl){
    paEl.innerHTML = pa.length ? pa.map(([k,v])=> `<div class="list-row"><div>${escapeHtml(k)}</div><strong>${v.qty}份 / ${money(v.sales)}</strong><span></span></div>`).join('') : '<div class="muted">尚無資料</div>';
  }

  const hourMap = {};
  orders.forEach(o=>{
    const h = new Date(o.createdAt).getHours();
    const key = String(h).padStart(2,'0') + ':00';
    hourMap[key] = hourMap[key] || {count:0, sales:0};
    hourMap[key].count += 1;
    hourMap[key].sales += Number(o.total || 0);
  });
  const ha = Object.entries(hourMap).sort((a,b)=> a[0].localeCompare(b[0]));
  const hourEl = document.getElementById('hourAnalysis');
  if(hourEl){
    hourEl.innerHTML = ha.length ? ha.map(([k,v])=> `<div class="list-row"><div>${k}</div><strong>${v.count}單 / ${money(v.sales)}</strong><span></span></div>`).join('') : '<div class="muted">尚無資料</div>';
  }

  const sessionEl = document.getElementById('reportSessionList');
  if(sessionEl){
    sessionEl.innerHTML = getSessionListHtml(escapeHtml);
  }
}

export function initReportsPage(){
  document.getElementById('applyReportRangeBtn')?.addEventListener('click', ()=>{
    state.viewReportOrders = null;
    renderReports();
  });

  document.getElementById('reportBackLiveBtn')?.addEventListener('click', ()=>{
    const fromEl = document.getElementById('reportDateFrom');
    const toEl = document.getElementById('reportDateTo');
    if(fromEl) fromEl.value = '';
    if(toEl) toEl.value = '';
    state.viewReportOrders = null;
    renderReports();
  });

  document.getElementById('reportStartBtn')?.addEventListener('click', ()=>{
    startSession();
    persistAll();
    alert('已開始統計');
  });

  document.getElementById('reportEndBtn')?.addEventListener('click', ()=>{
    const session = endSession();
    persistAll();
    renderReports();
    if(session) alert(`已結束統計：${session.summary.orderCount} 單 / ${session.summary.salesText}`);
    else alert('尚未開始統計');
  });

  document.getElementById('saveReportSnapshotBtn')?.addEventListener('click', ()=>{
    const orders = getReportOrders();
    saveCurrentSnapshot(orders);
    persistAll();
    alert('已儲存報表');
  });

  document.getElementById('exportTodayBtn')?.addEventListener('click', ()=>{
    const rows = [['訂單號','時間','狀態','類型','桌號','付款','總計']];
    state.orders
      .filter(o => (o.createdAt || '').slice(0,10) === todayStr())
      .forEach(o => rows.push([
        o.orderNo || '',
        o.createdAt || '',
        o.status || '',
        o.orderType || '',
        o.tableNo || '',
        o.paymentMethod || '',
        o.total || 0
      ]));
    downloadFile('today-report.csv', rows.map(r=>r.join(',')).join('\n'), 'text/csv');
  });
}