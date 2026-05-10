/* 中文備註：多店看板資料 publish 模組 v1
 * 將本店即時狀態（心跳 / 今日營業 / 班次）寫到 Firebase Realtime Database
 * 路徑：dashboards/{storeId}/...
 *
 * 公開 API：
 *   ensureDashboardConfig()          → 取得/初始化 dashboard 設定
 *   startDashboardPublish()          → 啟動心跳（30 秒）+ 立即推一次
 *   stopDashboardPublish()
 *   publishDashboardNow()            → 立即推一次（POS 結帳完、班次變動時呼叫）
 *
 * 寫到 Firebase 的資料：
 *   dashboards/{storeId}/heartbeat   { storeName, lastSeenAt }
 *   dashboards/{storeId}/today       { date, salesTotal, orderCount, avgTicket }
 *   dashboards/{storeId}/session     { staffId, startedAt, openingCash, currentCash }  ← 沒班次時為 null
 */
import { state, persistAll } from '../core/store.js';
import { getCurrentSession, calcSessionStats } from './report-session.js';
import { _getRef, _dbApi } from './realtime-order-service.js';
 

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
let heartbeatTimer = null;

// ============================================================
// 設定
// ============================================================


// 中文備註：支援用 URL 設定 storeId，例：
//   https://.../2234/?storeId=store-001&storeName=1號店
// T2 沒 console，這是唯一可行的設定入口。設定一次寫入 localStorage 後，
// 之後不必再帶 query string。也可以用 ?dashboard=off 暫時停用。
function applyDashboardConfigFromURL(){
  try{
    const params = new URLSearchParams(location.search);
    const sid = params.get('storeId');
    const sname = params.get('storeName');
    const sw = params.get('dashboard');   // 'off' = 停用
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
  // 先處理 URL query（首次進站才有效）
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
  const session = calcSessionSummary();   // 可能為 null

  await Promise.all([
    writeNode('heartbeat', heartbeat),
    writeNode('today', today),
    writeNode('session', session)         // null 時 set(null) 會把節點刪掉
  ]);
}

// ============================================================
// 心跳
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
// 隱藏設定入口：在頁面任何位置快速點 5 下（2 秒內）叫出設定 prompt
// 設計給 T2 等無法操作網址列、無 console 的裝置
// ============================================================
(function setupHiddenConfigTrigger(){
  if(typeof window === 'undefined') return;
  let clickCount = 0;
  let lastClickAt = 0;
  document.addEventListener('click', (ev)=>{
    const now = Date.now();
    if(now - lastClickAt > 2000) clickCount = 0;
    lastClickAt = now;
    // 只計算點到頁首 logo / title 區（避免結帳按鈕被亂觸發）
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

