/* 中文備註：多店看板資料 publish 模組 v20260613
 * 本版（相對 v1.2-tzfix）變更：
 *   - 今日範圍改用「營業日 BD」切（跨日營業時段歸屬同一 BD）
 *   - 預約待付款單依 reservationAt 歸屬 BD（不是 createdAt）
 *   - 營業額 = completed + pending（含預約待付款）+ 今日 BD 內已結束班次的外送加總
 *   - 異常欄位 voided（status=void/cancelled/refunded）保持看板相容
 *   - 新增 publish dashboards/{storeId}/businessHours 節點供看板讀取
 *   - 新增 today.delivery {panda, uber, total} 外送金額（從已結束班次 stats 累加）
 *   - 移除 netSalesTotal（避免混淆，營業額本身已是正確值）
 *   - 用語：心跳 → 更新（變數 heartbeat 維持，避免破壞既有 Firebase 節點）
 * 公開 API：
 *   ensureDashboardConfig() / startDashboardPublish() / stopDashboardPublish() / publishDashboardNow()
 */
import { state, persistAll } from '../core/store.js';
import { getCurrentSession, calcSessionStats } from './report-session.js';
import { _getRef, _dbApi } from './realtime-order-service.js';
import { getBusinessDay, getCurrentBusinessDay } from '../core/biz-day.js';

const UPDATE_INTERVAL_MS = 30 * 1000;  // 30 秒更新一次
let updateTimer = null;

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

// ── 取得 businessHours（含 fallback 預設） ──
function getBH(){
  return (state.settings && state.settings.businessHours) || {};
}

// ── 取訂單歸屬時間：預約待付款看 reservationAt，其他看 createdAt ──
function getOrderRefTime(o){
  const status = String(o.status || '').toLowerCase();
  if(status === 'pending' && o.reservationAt){
    return o.reservationAt;
  }
  return o.createdAt;
}

// ── 計算今日營業統計（用 BD 切；含外送加總；異常單獨統計） ──
function calcTodayStats(){
  const bh = getBH();
  const todayBD = getCurrentBusinessDay(bh);
  const allOrders = state.orders || [];

  // 篩選歸屬今日 BD 的訂單
  const todayOrders = allOrders.filter(o => {
    const refTime = getOrderRefTime(o);
    if(!refTime) return false;
    return getBusinessDay(refTime, bh) === todayBD;
  });

  // 營業額訂單：completed + pending（pending 含預約待付款）
  const validOrders = todayOrders.filter(o => {
    const status = String(o.status || '').toLowerCase();
    return status === 'completed' || status === 'pending';
  });
  const salesFromOrders = validOrders.reduce((s,o)=>s + Number(o.total||0), 0);
  const orderCount = validOrders.length;

  // 各支付方式分項統計
  const payments = {};
  validOrders.forEach(o => {
    const pm = String(o.paymentMethod || '其他').trim() || '其他';
    if(!payments[pm]) payments[pm] = { amount: 0, count: 0 };
    payments[pm].amount += Number(o.total || 0);
    payments[pm].count += 1;
  });

  // 異常統計（作廢 / 取消 / 退款）
  const voided = { amount: 0, count: 0, byType: { void: 0, cancelled: 0, refunded: 0 } };
  todayOrders.forEach(o => {
    const status = String(o.status || '').toLowerCase();
    if(!['void','cancelled','refunded'].includes(status)) return;
    const amt = Number(o.total || o.subtotal || 0);
    voided.amount += amt;
    voided.count += 1;
    if(voided.byType[status] !== undefined) voided.byType[status] += amt;
  });

  // 今日 BD 內已結束班次的外送加總（從 state.reports.sessions 撈）
  const delivery = { panda: 0, uber: 0, total: 0 };
  const sessions = (state.reports && state.reports.sessions) || [];
  sessions.forEach(s => {
    if(!s.endedAt) return;
    // 班次歸屬：用 startedAt 的 BD
    const sessBD = getBusinessDay(s.startedAt, bh);
    if(sessBD !== todayBD) return;
    const st = s.stats || {};
    delivery.panda += Number(st.deliveryPanda || 0);
    delivery.uber  += Number(st.deliveryUber  || 0);
  });
  delivery.total = delivery.panda + delivery.uber;

  // 總營業額 = 訂單加總 + 已結班外送
  const salesTotal = salesFromOrders + delivery.total;
  const avgTicket = orderCount > 0 ? Math.round(salesFromOrders / orderCount) : 0;

  return {
    date: todayBD,
    salesTotal,
    salesFromOrders,        // 純訂單部分（給看板拆分顯示）
    orderCount,
    avgTicket,
    payments,
    voided,
    delivery
  };
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
  const bh = getBH();
  const todayBD = getCurrentBusinessDay(bh);
  const allOrders = state.orders || [];
  const sampleOrders = allOrders.slice(0, 3).map(o => ({
    orderNo: o.orderNo || '',
    status: String(o.status || ''),
    createdAt: String(o.createdAt || ''),
    reservationAt: String(o.reservationAt || ''),
    refBD: getBusinessDay(getOrderRefTime(o), bh),
    matchToday: getBusinessDay(getOrderRefTime(o), bh) === todayBD,
    total: Number(o.total || 0),
    subtotal: Number(o.subtotal || 0),
    paymentMethod: String(o.paymentMethod || ''),
    itemCount: Array.isArray(o.items) ? o.items.length : 0
  }));
  return {
    todayBD,
    nowISO: new Date().toISOString(),
    ordersInState: allOrders.length,
    sampleOrders,
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
    lastSeenAt: new Date().toISOString()  // 最後更新時間（節點名 heartbeat 維持向下相容）
  };
  const today = calcTodayStats();
  const session = calcSessionSummary();
  const debugInfo = collectDebugInfo();
  const businessHours = getBH();

  await Promise.all([
    writeNode('heartbeat', heartbeat),
    writeNode('today', today),
    writeNode('session', session),
    writeNode('businessHours', businessHours),
    writeNode('_debug', debugInfo)
  ]);
}

// ============================================================
// 更新計時器（每 30 秒推一次）
// ============================================================
export function startDashboardPublish(){
  stopDashboardPublish();
  const cfg = ensureDashboardConfig();
  if(!cfg.enabled || !cfg.storeId) return;
  publishDashboardNow();
  updateTimer = setInterval(publishDashboardNow, UPDATE_INTERVAL_MS);
}

export function stopDashboardPublish(){
  if(updateTimer){
    clearInterval(updateTimer);
    updateTimer = null;
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
