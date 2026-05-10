/* 中文備註：多店看板資料 publish 模組 v1.1-debug
 * 與 v1 相同邏輯，但額外寫入 dashboards/{storeId}/_debug 節點
 * 用於診斷 calcTodayStats 為何回傳 0
 *
 * _debug 內容（純診斷用，UI 看板不讀）：
 *   todayKey            : 看板認定的「今天」字串
 *   ordersInState       : state.orders 總筆數
 *   sampleOrders        : 最近 3 筆訂單的關鍵欄位（status / createdAt / total / subtotal / paymentMethod）
 *   matchedToday        : 通過 filter 的訂單筆數
 *   calcResult          : calcTodayStats 的回傳值
 *   stateKeys           : state 物件第一層 key 列表（確認訂單是否真的存在 state.orders）
 *
 * 公開 API：
 *   ensureDashboardConfig() / startDashboardPublish() / stopDashboardPublish() / publishDashboardNow()
 */
import { state, persistAll } from '../core/store.js';
import { getCurrentSession, calcSessionStats } from './report-session.js';
import { _getRef, _dbApi } from './realtime-order-service.js';

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
let heartbeatTimer = null;

// ============================================================
// 設定
// ============================================================
function applyDashboardConfigFromURL(){
  try{
    const params = new URLSearchParams(location.search);
    const sid = params.get('storeId');
    const sname = params.get('storeName');
    const sw = params.get('dashboard');
    if(!sid && !sname && !sw) return false;
    if(!state.settings) state.settings = {};
    const cur = state.settings.dashboard || {};
    state.settings.dashboard = {
      enabled: sw === 'off' ? false : (typeof cur.enabled === 'boolean' ? cur.enabled : true),
      storeId: sid ? String(sid).trim() : String(cur.storeId || '').trim(),
      storeName: sname ? String(sname).trim() : String(cur.storeName || '').trim()
    };
    persistAll();
    return true;
  }catch(e){
    console.warn('[dashboard-publish] applyDashboardConfigFromURL failed', e);
    return false;
  }
}

export function ensureDashboardConfig(){
  if(!state.settings) state.settings = {};
  applyDashboardConfigFromURL();
  const cur = state.settings.dashboard || {};
  state.settings.dashboard = {
    enabled: typeof cur.enabled === 'boolean' ? cur.enabled : true,
    storeId: String(cur.storeId || '').trim(),
    storeName: String(cur.storeName || '').trim() || (state.settings.storeName || '未命名店')
  };
  return state.settings.dashboard;
}

function todayKey(){
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

// ── 計算今日營業統計（用本機 state.orders）──
function calcTodayStats(){
  const today = todayKey();
  const orders = (state.orders || []).filter(o => {
    if(o.status !== 'completed') return false;
    const t = o.createdAt ? o.createdAt.slice(0,10) : '';
    return t === today;
  });
  const salesTotal = orders.reduce((s,o)=>s + Number(o.total||0), 0);
  const orderCount = orders.length;
  const avgTicket = orderCount > 0 ? Math.round(salesTotal / orderCount) : 0;
  return { date: today, salesTotal, orderCount, avgTicket };
}

// ── 計算當前班次摘要 ──
function calcSessionSummary(){
  const cur = getCurrentSession();
  if(!cur) return null;
  const stats = calcSessionStats(cur.id);
  const currentCash = Number(cur.openingCash || 0) + Number(stats.cashSales || 0);
  return {
    staffId: cur.staffId || '',
    startedAt: cur.startedAt || '',
    openingCash: Number(cur.openingCash || 0),
    currentCash
  };
}

// ── 收集 debug 資訊（不影響原邏輯）──
function collectDebugInfo(){
  const today = todayKey();
  const allOrders = state.orders || [];
  // 取最近 3 筆訂單的關鍵欄位（不送整筆，避免太大）
  const sampleOrders = allOrders.slice(0, 3).map(o => ({
    orderNo: o.orderNo || '',
    status: String(o.status || ''),
    createdAt: String(o.createdAt || ''),
    const t = o.createdAt ? new Date(o.createdAt).toLocaleDateString('sv-SE') : '';
    matchToday: o.createdAt ? String(o.createdAt).slice(0,10) === today : false,
    total: Number(o.total || 0),
    subtotal: Number(o.subtotal || 0),
    paymentMethod: String(o.paymentMethod || ''),
    itemCount: Array.isArray(o.items) ? o.items.length : 0
  }));
  const matched = allOrders.filter(o => {
    if(o.status !== 'completed') return false;
    const t = o.createdAt ? String(o.createdAt).slice(0,10) : '';
    return t === today;
  });
  return {
    todayKey: today,
    nowISO: new Date().toISOString(),
    ordersInState: allOrders.length,
    sampleOrders,
    matchedTodayCount: matched.length,
    calcResult: calcTodayStats(),
    stateKeys: Object.keys(state || {}),
    hasOrdersArray: Array.isArray(state.orders),
    // 也記錄一下 state.reports 結構，以防訂單存在別處
    reportsKeys: state.reports ? Object.keys(state.reports) : [],
    sessionsCount: state.reports && Array.isArray(state.reports.sessions) ? state.reports.sessions.length : 0
  };
}

// ============================================================
// 寫入 Firebase
// ============================================================
async function writeNode(subPath, data){
  const cfg = ensureDashboardConfig();
  if(!cfg.enabled || !cfg.storeId) return;
  try{
    const ref = await _getRef(`dashboards/${cfg.storeId}/${subPath}`);
    const api = _dbApi();
    if(!ref || !api) return;
    await api.set(ref, data);
  }catch(err){
    console.warn('[dashboard-publish] writeNode failed', subPath, err);
  }
}

export async function publishDashboardNow(){
  const cfg = ensureDashboardConfig();
  if(!cfg.enabled || !cfg.storeId) return;

  const heartbeat = {
    storeName: cfg.storeName,
    lastSeenAt: new Date().toISOString()
  };
  const today = calcTodayStats();
  const session = calcSessionSummary();
  const debugInfo = collectDebugInfo();

  await Promise.all([
    writeNode('heartbeat', heartbeat),
    writeNode('today', today),
    writeNode('session', session),
    writeNode('_debug', debugInfo)
  ]);
}

// ============================================================
// 更新
// ============================================================
export function startDashboardPublish(){
  stopDashboardPublish();
  const cfg = ensureDashboardConfig();
  if(!cfg.enabled || !cfg.storeId) return;
  publishDashboardNow();
  heartbeatTimer = setInterval(publishDashboardNow, HEARTBEAT_INTERVAL_MS);
}

export function stopDashboardPublish(){
  if(heartbeatTimer){
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ============================================================
// 隱藏設定入口：頁首快速點 5 下（2 秒內）叫出設定 prompt
// ============================================================
(function setupHiddenConfigTrigger(){
  if(typeof window === 'undefined') return;
  let clickCount = 0;
  let lastClickAt = 0;
  document.addEventListener('click', (ev)=>{
    const now = Date.now();
    if(now - lastClickAt > 2000) clickCount = 0;
    lastClickAt = now;
    const target = ev.target;
    if(!target) return;
    const tag = (target.tagName || '').toLowerCase();
    const isHeader = tag === 'h1' || tag === 'h2' ||
                     (target.closest && target.closest('header')) ||
                     (target.id === 'pageTitle');
    if(!isHeader) return;
    clickCount++;
    if(clickCount >= 5){
      clickCount = 0;
      openDashboardConfigPrompt();
    }
  }, true);
})();

function openDashboardConfigPrompt(){
  const cfg = ensureDashboardConfig();
  const sid = prompt('店鋪 ID（英數，例 store-001）\n目前：' + (cfg.storeId || '未設定'), cfg.storeId || '');
  if(sid === null) return;
  const sname = prompt('店鋪名稱（顯示在看板）\n目前：' + (cfg.storeName || ''), cfg.storeName || '');
  if(sname === null) return;
  if(!state.settings) state.settings = {};
  state.settings.dashboard = {
    enabled: true,
    storeId: String(sid).trim(),
    storeName: String(sname).trim()
  };
  persistAll();
  alert('已設定店鋪：' + state.settings.dashboard.storeId + ' / ' + state.settings.dashboard.storeName + '\n即將重新整理');
  location.reload();
}
