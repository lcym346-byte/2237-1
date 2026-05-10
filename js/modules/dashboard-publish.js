/* 中文備註：多店看板資料 publish 模組 v1.2-tzfix
 * 修正：calcTodayStats 改用本機時區比對日期（解決跨日訂單數為 0 問題）
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

// 用本機時區產生 YYYY-MM-DD
function todayKey(){
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

// 把任意 createdAt（ISO 字串或 timestamp）轉成本機時區的 YYYY-MM-DD
function localDateKey(input){
  if(!input) return '';
  try{
    const d = new Date(input);
    if(isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
  }catch(e){
    return '';
  }
}

// ── 計算今日營業統計（含各支付方式分項）──
function calcTodayStats(){
  const today = todayKey();
  const orders = (state.orders || []).filter(o => {
    const status = String(o.status || '').toLowerCase();
    if(['void','cancelled','refunded'].includes(status)) return false;
    if(status !== 'completed') return false;
    return localDateKey(o.createdAt) === today;
  });
  const salesTotal = orders.reduce((s,o)=>s + Number(o.total||0), 0);
  const orderCount = orders.length;
  const avgTicket = orderCount > 0 ? Math.round(salesTotal / orderCount) : 0;

  // 各支付方式分項統計
  const payments = {};
  orders.forEach(o => {
    const pm = String(o.paymentMethod || '其他').trim() || '其他';
    if(!payments[pm]) payments[pm] = { amount: 0, count: 0 };
    payments[pm].amount += Number(o.total || 0);
    payments[pm].count += 1;
  });

  return { date: today, salesTotal, orderCount, avgTicket, payments };
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

// ── 收集 debug 資訊 ──
function collectDebugInfo(){
  const today = todayKey();
  const allOrders = state.orders || [];
  const sampleOrders = allOrders.slice(0, 3).map(o => ({
    orderNo: o.orderNo || '',
    status: String(o.status || ''),
    createdAt: String(o.createdAt || ''),
    createdAtSliced: localDateKey(o.createdAt),
    matchToday: localDateKey(o.createdAt) === today,
    total: Number(o.total || 0),
    subtotal: Number(o.subtotal || 0),
    paymentMethod: String(o.paymentMethod || ''),
    itemCount: Array.isArray(o.items) ? o.items.length : 0
  }));
  const matched = allOrders.filter(o => {
    if(String(o.status || '').toLowerCase() !== 'completed') return false;
    return localDateKey(o.createdAt) === today;
  });
  return {
    todayKey: today,
    nowISO: new Date().toISOString(),
    ordersInState: allOrders.length,
    sampleOrders,
    matchedTodayCount: matched.length,
    calcResult: calcTodayStats(),
    stateKeys: Object.keys(state || {}),
    hasOrdersArray: Array.isArray(state.orders)
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
