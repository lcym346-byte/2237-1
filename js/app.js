/* 中文備註：主程式初始化檔（v2.1.25）。
 * 變更：
 *   1. 補綁 window.posGoogleLogin / Logout / syncMenuToCloud / reinitRealtimeOrder
 *      / refreshRealtimeOrderPanel / googleDriveLogin / Logout / Backup / Restore
 *      / refreshGoogleBackupPanel / startGoogleAutoBackup
 *   2. POS Google 登入成功後自動 verifyPOSAccess + startPOSRealtimeListener
 *   3. 全域錯誤監聽（iPad 沒 console 也能看到）
 */
import { state, persistAll } from './core/store.js';
import { renderTabs, renderProducts, renderCart, initPOSPage } from './pages/pos-page.js';
import { renderOrders, initOrdersPage } from './pages/orders-page.js';
import { renderReports, initReportsPage } from './pages/reports-page.js';
import { renderCategoryOptions, renderCategoryList, renderModuleSelect, renderModuleLibrary, renderProductModulesEditor, renderProductsTable, renderPendingMenuList, initProductsPage } from './pages/products-page.js';
import { initSettingsPage } from './pages/settings-page.js';
import {
  startPOSRealtimeListener,
  waitForAuthReady,
  signInPOSWithGoogle,
  signOutPOSGoogle,
  syncMenuToFirebase,
  verifyPOSAccess,
  getRealtimeAuthUser,
  getRealtimeConfig,
  startReservationReminderLoop
} from './modules/realtime-order-service.js';
import { startDashboardPublish, publishDashboardNow } from './modules/dashboard-publish.js';


import {
  signInGoogleDrive,
  signOutGoogleDrive,
  backupToGoogle,
  restoreFromGoogle,
  listGoogleBackups,
  getGoogleDriveSession,
  startGoogleAutoBackup,
  stopGoogleAutoBackup
} from './modules/google-backup-service.js';

// ============================================================
// 安全執行
// ============================================================
function safeRun(fn, name){
  try { fn(); }
  catch (err) {
    console.error(`Init error in ${name}:`, err);
    showGlobalError(`${name}: ${err.message}`);
  }
}

// ============================================================
// 全域錯誤監聽（iPad 沒 console 用）
// ============================================================
function showGlobalError(msg){
  let box = document.getElementById('__globalErrorBar');
  if(!box){
    box = document.createElement('div');
    box.id = '__globalErrorBar';
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#dc2626;color:#fff;padding:8px 12px;font-size:13px;z-index:99999;max-height:30vh;overflow:auto;';
    box.onclick = ()=>{ box.style.display = 'none'; };
    document.body.appendChild(box);
  }
  box.style.display = 'block';
  const line = document.createElement('div');
  line.textContent = '⚠ ' + msg;
  box.appendChild(line);
}

window.addEventListener('error', (ev)=>{
  showGlobalError(`JS錯誤：${ev.message} @ ${ev.filename}:${ev.lineno}`);
});
window.addEventListener('unhandledrejection', (ev)=>{
  const msg = ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason);
  showGlobalError(`Promise錯誤：${msg}`);
});
// 模組載入錯誤偵聽（Safari 對 module link error 不會冒泡到 window，只能在 script 元素抓）
document.querySelectorAll('script[type="module"]').forEach(s => {
  s.addEventListener('error', e => {
    showGlobalError('模組載入失敗：' + (s.src || s.textContent.slice(0,50)));
  });
});

// ============================================================
// 導覽
// ============================================================
function setupNavigation(){
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.getElementById(btn.dataset.view)?.classList.add('active');
    });
  });
}

// ============================================================
// 全頁刷新
// ============================================================
window.refreshAllViews = function(){
  safeRun(renderTabs, 'renderTabs');
  safeRun(renderProducts, 'renderProducts');
  safeRun(renderCart, 'renderCart');
  safeRun(renderOrders, 'renderOrders');
  safeRun(renderReports, 'renderReports');
  safeRun(renderCategoryOptions, 'renderCategoryOptions');
  safeRun(renderCategoryList, 'renderCategoryList');
  safeRun(renderModuleSelect, 'renderModuleSelect');
  safeRun(renderModuleLibrary, 'renderModuleLibrary');
  safeRun(renderProductModulesEditor, 'renderProductModulesEditor');
  safeRun(renderProductsTable, 'renderProductsTable');
  safeRun(renderPendingMenuList, 'renderPendingMenuList');
  persistAll();
};

// ============================================================
// 即時接單面板刷新
// ============================================================
window.refreshRealtimeOrderPanel = function(){
  const cfg = getRealtimeConfig();
  const statusBox = document.getElementById('realtimeOrderStatusBox');
  if(statusBox){
    statusBox.textContent = '同步狀態：' + (cfg.lastSyncStatus || '無');
  }
  const accountBox = document.getElementById('posGoogleAccountBox');
  if(accountBox){
    const user = getRealtimeAuthUser();
    accountBox.textContent = 'POS 登入帳號：' + (user ? (user.email || user.displayName || '已登入') : '未登入');
  }
};

// ============================================================
// Google Drive 面板刷新
// ============================================================
window.refreshGoogleBackupPanel = function(){
  const cfg = state.settings?.googleDriveBackup || {};
  const session = getGoogleDriveSession();
  const accountBox = document.getElementById('googleDriveAccountBox');
  if(accountBox){
    accountBox.textContent = '登入狀態：' + (session.isSignedIn ? (session.email || '已登入') : '未登入');
  }
  const statusBox = document.getElementById('googleBackupStatusBox');
  if(statusBox){
    statusBox.textContent = '備份狀態：' + (cfg.lastBackupStatus || '無')
      + (cfg.lastBackupAt ? ' / ' + new Date(cfg.lastBackupAt).toLocaleString('zh-TW') : '');
  }
};

// ============================================================
// POS Google 登入 / 登出
// ============================================================
window.posGoogleLogin = async function(){
  try{
    const user = await signInPOSWithGoogle();
    const accountBox = document.getElementById('posGoogleAccountBox');
    if(accountBox) accountBox.textContent = 'POS 登入帳號：' + (user.email || user.displayName || '已登入');

    // 驗證 staff 權限
    try{
      await verifyPOSAccess();
      alert('Google 登入成功：' + (user.email || ''));
    }catch(verifyErr){
      alert('Google 登入成功，但 ' + verifyErr.message);
      window.refreshRealtimeOrderPanel();
      return;
    }

    // 自動啟動即時接單監聽
    const cfg = getRealtimeConfig();
    if(cfg.enabled){
      try{
        await startPOSRealtimeListener(()=> window.refreshAllViews());
      }catch(e){
        console.error('啟動監聽失敗：', e);
      }
    }
    window.refreshRealtimeOrderPanel();
    window.refreshAllViews();
  }catch(err){
    alert('Google 登入失敗：' + err.message);
  }
};

window.posGoogleLogout = async function(){
  try{
    await signOutPOSGoogle();
    const accountBox = document.getElementById('posGoogleAccountBox');
    if(accountBox) accountBox.textContent = 'POS 登入帳號：未登入';
    alert('已登出 POS Google');
    window.refreshRealtimeOrderPanel();
    window.refreshAllViews();
  }catch(err){
    alert('登出失敗：' + err.message);
  }
};

// ============================================================
// 同步菜單到雲端（含 loading 與成功/失敗提示）
// ============================================================
window.syncMenuToCloud = async function(triggerBtn){
  const btn = triggerBtn || document.getElementById('syncMenuToCloudBtn') || document.getElementById('syncMenuBtn');
  const originalText = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '同步中...'; }
  try{
    await syncMenuToFirebase();
    window.refreshRealtimeOrderPanel();
    if(btn){ btn.textContent = '✓ 同步成功'; setTimeout(()=>{ btn.textContent = originalText; btn.disabled = false; }, 2000); }
    else alert('菜單同步成功');
  }catch(err){
    if(btn){ btn.textContent = originalText; btn.disabled = false; }
    alert('同步菜單失敗：' + (err.message || err));
  }
};

// 讀取雲端菜單（merge：雲端覆蓋同 id 項目，本地獨有項目保留）
window.fetchMenuFromCloud = async function(triggerBtn){
  const btn = triggerBtn || document.getElementById('fetchMenuFromCloudBtn');
  const originalText = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '讀取中...'; }
  try{
    const mod = await import('./modules/realtime-order-service.js');
    const result = await mod.fetchAndMergeMenuFromFirebase();
    window.refreshAllViews();
    window.refreshRealtimeOrderPanel();
    if(btn){ btn.textContent = `✓ 讀取成功（雲端 ${result.cloudCount} / 本地保留 ${result.localKeptCount}）`; setTimeout(()=>{ btn.textContent = originalText; btn.disabled = false; }, 2500); }
    else alert(`讀取成功，雲端 ${result.cloudCount} 筆 / 本地獨有保留 ${result.localKeptCount} 筆`);
  }catch(err){
    if(btn){ btn.textContent = originalText; btn.disabled = false; }
    alert('讀取菜單失敗：' + (err.message || err));
  }
};


// ============================================================
// 即時接單重新初始化（儲存設定後呼叫）
// ============================================================
window.reinitRealtimeOrder = async function(){
  try{
    const cfg = getRealtimeConfig();
    if(!cfg.enabled){
      window.refreshRealtimeOrderPanel();
      return;
    }
    const user = getRealtimeAuthUser();
    if(!user){
      // 還沒登入：什麼都不做（等使用者按登入）
      window.refreshRealtimeOrderPanel();
      return;
    }
    await startPOSRealtimeListener(()=> window.refreshAllViews());
    window.refreshRealtimeOrderPanel();
  }catch(err){
    console.error('reinitRealtimeOrder failed:', err);
    showGlobalError('重啟即時接單失敗：' + err.message);
  }
};

// ============================================================
// Google Drive（補別名給 settings-page 用）
// ============================================================
window.googleDriveLogin = async function(){
  try{
    await signInGoogleDrive();
    alert('Google Drive 登入成功');
    window.refreshGoogleBackupPanel();
  }catch(err){
    alert('Google Drive 登入失敗：' + err.message);
  }
};

window.googleDriveLogout = function(){
  try{
    signOutGoogleDrive();
    window.refreshGoogleBackupPanel();
  }catch(err){
    alert('Google Drive 登出失敗：' + err.message);
  }
};

window.googleDriveBackup = async function(){
  await backupToGoogle();
  window.refreshGoogleBackupPanel();
};

window.googleDriveRestore = async function(fileId){
  await restoreFromGoogle(fileId);
  window.refreshGoogleBackupPanel();
  window.refreshAllViews();
};

window.startGoogleAutoBackup = startGoogleAutoBackup;
window.stopGoogleAutoBackup = stopGoogleAutoBackup;

// ============================================================
// PWA
// ============================================================
function setupPWA(){
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installBtn')?.classList.remove('hidden');
  });
  document.getElementById('installBtn')?.addEventListener('click', async ()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('installBtn')?.classList.add('hidden');
  });
  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=> navigator.serviceWorker.register('./service-worker.js'));
  }
}

// ============================================================
// 啟動時自動啟用即時接單監聽（如果已登入）
// ============================================================
async function autoStartRealtimeListener(){
  try{
    const cfg = getRealtimeConfig();
    if(!cfg.enabled) return;
    const user = await waitForAuthReady();
    if(!user) return;
    // 已登入 → 嘗試驗證並啟動
    try{
      await verifyPOSAccess();
      await startPOSRealtimeListener(()=> window.refreshAllViews());
    }catch(e){
      console.warn('自動啟動監聽失敗（可能未授權 staff 角色）：', e.message);
    }
    window.refreshRealtimeOrderPanel();
  }catch(err){
    console.error('Auto start realtime listener failed:', err);
  }
}

// ============================================================
// 初始化
// ============================================================
setupNavigation();
safeRun(initPOSPage, 'initPOSPage');
safeRun(initOrdersPage, 'initOrdersPage');
safeRun(initReportsPage, 'initReportsPage');
safeRun(initProductsPage, 'initProductsPage');
safeRun(initSettingsPage, 'initSettingsPage');
window.refreshAllViews();
window.refreshRealtimeOrderPanel();
window.refreshGoogleBackupPanel();
startGoogleAutoBackup();
autoStartRealtimeListener();
startReservationReminderLoop();
setupPWA();
startDashboardPublish();
window.publishDashboardNow = publishDashboardNow;

// 任何 view 刷新（含結帳、開/結班）後即時推一次看板資料
const _origRefreshAllViews = window.refreshAllViews;
window.refreshAllViews = function(){
  _origRefreshAllViews();
  try { publishDashboardNow(); } catch(e) { console.warn('publishDashboardNow failed', e); }
};
