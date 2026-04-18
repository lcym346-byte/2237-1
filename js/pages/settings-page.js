/* 中文備註：js/pages/settings-page.js，此檔已加入中文說明，方便後續維護。 */
import { state, persistAll, seedDefaults } from '../core/store.js';
import { downloadFile } from '../core/utils.js';
import { buildCartPreviewOrder, printOrderLabels, printOrderReceipt, getPrintSettings } from '../modules/print-service.js';
import { backupToGoogle, getGoogleBackupConfig, getGoogleDriveSession, initializeGoogleDriveApi, listGoogleBackups, restoreFromGoogle, signInGoogleDrive, signOutGoogleDrive, startGoogleAutoBackup } from '../modules/google-backup-service.js';
import { getRealtimeAuthUser, getRealtimeConfig, signInPOSWithGoogle, signOutPOSGoogle, startPOSRealtimeListener, verifyPOSAccess, waitForAuthReady } from '../modules/realtime-order-service.js';

export function initSettingsPage(){
  const printConfig = getPrintSettings();
  document.getElementById('printStoreName').value = printConfig.storeName || '';
  document.getElementById('printStorePhone').value = printConfig.storePhone || '';
  document.getElementById('printStoreAddress').value = printConfig.storeAddress || '';
  document.getElementById('printReceiptFooter').value = printConfig.receiptFooter || '';
  document.getElementById('printReceiptPaperWidth').value = printConfig.receiptPaperWidth || '58';
  document.getElementById('printLabelPaperWidth').value = Number(printConfig.labelPaperWidth || 60);
  document.getElementById('printLabelPaperHeight').value = Number(printConfig.labelPaperHeight || 40);
  document.getElementById('printReceiptFontSize').value = Number(printConfig.receiptFontSize || 12);
  document.getElementById('printLabelFontSize').value = Number(printConfig.labelFontSize || 12);
  document.getElementById('printReceiptOffsetX').value = Number(printConfig.receiptOffsetX || 0);
  document.getElementById('printReceiptOffsetY').value = Number(printConfig.receiptOffsetY || 0);
  document.getElementById('printLabelOffsetX').value = Number(printConfig.labelOffsetX || 0);
  document.getElementById('printLabelOffsetY').value = Number(printConfig.labelOffsetY || 0);
  document.getElementById('printKitchenCopies').value = Number(printConfig.kitchenCopies || 1);
  document.getElementById('printAutoCheckout').checked = !!printConfig.autoPrintCheckout;
  document.getElementById('printAutoKitchen').checked = !!printConfig.autoPrintKitchen;

  const realtimeCfg = getRealtimeConfig();
  document.getElementById('realtimeOrderEnabled').checked = !!realtimeCfg.enabled;
  document.getElementById('firebaseApiKey').value = realtimeCfg.apiKey || '';
  document.getElementById('firebaseAuthDomain').value = realtimeCfg.authDomain || '';
  document.getElementById('firebaseDatabaseUrl').value = realtimeCfg.databaseURL || '';
  document.getElementById('firebaseProjectId').value = realtimeCfg.projectId || '';
  document.getElementById('firebaseStorageBucket').value = realtimeCfg.storageBucket || '';
  document.getElementById('firebaseMessagingSenderId').value = realtimeCfg.messagingSenderId || '';
  document.getElementById('firebaseAppId').value = realtimeCfg.appId || '';
  document.getElementById('firebaseMeasurementId').value = realtimeCfg.measurementId || '';
  document.getElementById('onlineStoreTitle').value = realtimeCfg.onlineStoreTitle || '';
  document.getElementById('onlineStoreSubtitle').value = realtimeCfg.onlineStoreSubtitle || '';
  document.getElementById('onlineConfirmAutoPrintKitchen').checked = !!realtimeCfg.autoPrintKitchenOnConfirm;
  document.getElementById('onlineConfirmAutoPrintReceipt').checked = !!realtimeCfg.autoPrintReceiptOnConfirm;
  document.getElementById('onlineIncomingSoundEnabled').checked = realtimeCfg.incomingSoundEnabled !== false;


async function renderPOSGoogleAccountBox(){
  await waitForAuthReady().catch(()=> null);
  const user = getRealtimeAuthUser();
  document.getElementById('posGoogleAccountBox').innerHTML = user
    ? `POS 登入帳號：${user.email || user.uid}`
    : 'POS 登入帳號：未登入';
}

  function renderRealtimeOrderPanel(){
    const cfg = getRealtimeConfig();
    const incomingCount = Array.isArray(state.onlineIncomingOrders) ? state.onlineIncomingOrders.filter(x => x.status === 'pending_confirm').length : 0;
    document.getElementById('realtimeOrderStatusBox').innerHTML =
      `同步狀態：${cfg.lastSyncStatus || '無'}<br>` +
      `最近收到訂單：${cfg.lastOrderAt ? cfg.lastOrderAt.replace('T',' ').slice(0,16) : '無'}<br>` +
      `最近確認訂單：${cfg.lastConfirmedAt ? cfg.lastConfirmedAt.replace('T',' ').slice(0,16) : '無'}<br>` +
      `線上待確認：${incomingCount} 筆`;
  }
  window.refreshRealtimeOrderPanel = renderRealtimeOrderPanel;
  renderRealtimeOrderPanel();
  renderPOSGoogleAccountBox();

  document.getElementById('saveRealtimeOrderSettingsBtn').onclick = ()=>{
    const cfg = getRealtimeConfig();
    cfg.enabled = document.getElementById('realtimeOrderEnabled').checked;
    cfg.apiKey = document.getElementById('firebaseApiKey').value.trim();
    cfg.authDomain = document.getElementById('firebaseAuthDomain').value.trim();
    cfg.databaseURL = document.getElementById('firebaseDatabaseUrl').value.trim();
    cfg.projectId = document.getElementById('firebaseProjectId').value.trim();
    cfg.storageBucket = document.getElementById('firebaseStorageBucket').value.trim();
    cfg.messagingSenderId = document.getElementById('firebaseMessagingSenderId').value.trim();
    cfg.appId = document.getElementById('firebaseAppId').value.trim();
    cfg.measurementId = document.getElementById('firebaseMeasurementId').value.trim();
    cfg.onlineStoreTitle = document.getElementById('onlineStoreTitle').value.trim();
    cfg.onlineStoreSubtitle = document.getElementById('onlineStoreSubtitle').value.trim();
    cfg.autoPrintKitchenOnConfirm = document.getElementById('onlineConfirmAutoPrintKitchen').checked;
    cfg.autoPrintReceiptOnConfirm = document.getElementById('onlineConfirmAutoPrintReceipt').checked;
    cfg.incomingSoundEnabled = document.getElementById('onlineIncomingSoundEnabled').checked;
    persistAll();
    renderRealtimeOrderPanel();
    startPOSRealtimeListener(()=> window.refreshAllViews()).catch(err=> console.error(err));
    alert('即時接單設定已儲存');
  };
  document.getElementById('showProductImagesToggle').checked = !!state.settings.showProductImages;




const googleCfg = getGoogleBackupConfig();
document.getElementById('googleClientId').value = googleCfg.clientId || '';
document.getElementById('googleFolderId').value = googleCfg.folderId || '';
document.getElementById('googleAutoBackupEnabled').checked = !!googleCfg.autoBackupEnabled;
document.getElementById('googleAutoBackupMinutes').value = Number(googleCfg.autoBackupMinutes || 60);

async function renderGoogleBackupPanel(){
  const cfg = getGoogleBackupConfig();
  const session = getGoogleDriveSession();

  document.getElementById('googleDriveAccountBox').innerHTML =
    `登入狀態：${session.isSignedIn ? '已登入' : '未登入'}${session.email ? ' / ' + session.email : ''}`;

  document.getElementById('googleBackupStatusBox').innerHTML =
    `最近備份：${cfg.lastBackupAt ? cfg.lastBackupAt.replace('T',' ').slice(0,16) : '無'}<br>` +
    `備份狀態：${cfg.lastBackupStatus || '無'}<br>` +
    `最近還原：${cfg.lastRestoreAt ? cfg.lastRestoreAt.replace('T',' ').slice(0,16) : '無'}<br>` +
    `還原狀態：${cfg.lastRestoreStatus || '無'}`;

  const listBox = document.getElementById('googleBackupFileList');
  if(!session.isSignedIn){
    listBox.innerHTML = '備份清單：請先登入 Google';
    return;
  }
  try{
    const files = await listGoogleBackups();
    listBox.innerHTML = files.length
      ? '最近備份檔：<br>' + files.slice(0,5).map(f => `${f.name} / ${String(f.modifiedTime || '').replace('T',' ').slice(0,16)}`).join('<br>')
      : '最近備份檔：無';
  }catch(err){
    listBox.innerHTML = '最近備份檔：讀取失敗';
  }
}

window.refreshGoogleBackupPanel = renderGoogleBackupPanel;
initializeGoogleDriveApi().then(()=> renderGoogleBackupPanel()).catch(()=> renderGoogleBackupPanel());

document.getElementById('saveGoogleBackupSettingsBtn').onclick = ()=>{
  const cfg = getGoogleBackupConfig();
  cfg.clientId = document.getElementById('googleClientId').value.trim();
  cfg.folderId = document.getElementById('googleFolderId').value.trim();
  cfg.autoBackupEnabled = document.getElementById('googleAutoBackupEnabled').checked;
  cfg.autoBackupMinutes = Math.max(5, Number(document.getElementById('googleAutoBackupMinutes').value || 60));
  persistAll();
  startGoogleAutoBackup();
  renderGoogleBackupPanel();
  alert('Google Drive 設定已儲存');
};

document.getElementById('googleLoginBtn').onclick = async ()=>{
  try{
    const cfg = getGoogleBackupConfig();
    cfg.clientId = document.getElementById('googleClientId').value.trim();
    cfg.folderId = document.getElementById('googleFolderId').value.trim();
    persistAll();
    await signInGoogleDrive();
    await renderGoogleBackupPanel();
    alert('已登入 Google');
  }catch(err){
    alert(err.message || 'Google 登入失敗');
  }
};

document.getElementById('googleLogoutBtn').onclick = ()=>{
  signOutGoogleDrive();
  renderGoogleBackupPanel();
  alert('已登出 Google');
};

document.getElementById('manualGoogleBackupBtn').onclick = async ()=>{
  try{
    const cfg = getGoogleBackupConfig();
    cfg.lastBackupStatus = '備份中...';
    persistAll();
    await renderGoogleBackupPanel();
    await backupToGoogle();
    await renderGoogleBackupPanel();
    alert('已完成 Google Drive 備份');
  }catch(err){
    const cfg = getGoogleBackupConfig();
    cfg.lastBackupStatus = err.message || '備份失敗';
    persistAll();
    await renderGoogleBackupPanel();
    alert(cfg.lastBackupStatus);
  }
};

document.getElementById('manualGoogleRestoreBtn').onclick = async ()=>{
  if(!confirm('確定要從 Google Drive 還原？目前本機資料會被覆蓋。')) return;
  try{
    const cfg = getGoogleBackupConfig();
    cfg.lastRestoreStatus = '還原中...';
    persistAll();
    await renderGoogleBackupPanel();
    await restoreFromGoogle();
    await renderGoogleBackupPanel();
    window.refreshAllViews();
    alert('已完成 Google Drive 還原');
  }catch(err){
    const cfg = getGoogleBackupConfig();
    cfg.lastRestoreStatus = err.message || '還原失敗';
    persistAll();
    await renderGoogleBackupPanel();
    alert(cfg.lastRestoreStatus);
  }
};


document.getElementById('posGoogleLoginBtn').onclick = async ()=>{
  try{
    await signInPOSWithGoogle();
    const access = await verifyPOSAccess();
    await renderPOSGoogleAccountBox();
    await startPOSRealtimeListener(()=> window.refreshAllViews());
    if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
    alert(`POS Google 登入成功（${access.role}）`);
  }catch(err){
    alert(err.message || 'POS Google 登入失敗');
  }
};

document.getElementById('posGoogleLogoutBtn').onclick = async ()=>{
  try{
    await signOutPOSGoogle();
    await renderPOSGoogleAccountBox();
    alert('POS Google 已登出');
  }catch(err){
    alert(err.message || 'POS Google 登出失敗');
  }
};

  document.getElementById('exportJsonBtn').onclick = ()=>{
    downloadFile('pos-backup.json', JSON.stringify({
      categories: state.categories,
      modules: state.modules,
      products: state.products,
      orders: state.orders,
      settings: state.settings,
      reports: state.reports
    }, null, 2), 'application/json');
  };

  document.getElementById('importJsonInput').onchange = async (e)=>{
    const f = e.target.files[0];
    if(!f) return;
    try{
      const data = JSON.parse(await f.text());
      if(Array.isArray(data.categories)) state.categories = data.categories.includes('未分類') ? data.categories : ['未分類', ...data.categories];
      if(Array.isArray(data.modules)) state.modules = data.modules;
      if(Array.isArray(data.products)) state.products = data.products;
      if(Array.isArray(data.orders)) state.orders = data.orders;
      if(data.settings) state.settings = data.settings;
      if(data.reports) state.reports = data.reports;
      persistAll();
      window.refreshAllViews();
      alert('匯入成功');
    }catch(err){
      alert('匯入失敗');
    }
  };

  document.getElementById('seedDemoBtn').onclick = ()=>{
    seedDefaults();
    window.refreshAllViews();
    alert('已重建預設資料');
  };

  document.getElementById('showProductImagesToggle').onchange = (e)=>{
    state.settings.showProductImages = !!e.target.checked;
    persistAll();
    window.refreshAllViews();
  };



  function buildPreviewOrderForSettings(){
    if(Array.isArray(state.cart) && state.cart.length){
      return buildCartPreviewOrder();
    }
    return {
      orderNo: 'PREVIEW-' + Date.now(),
      createdAt: new Date().toISOString(),
      orderType: '內用',
      tableNo: 'A1',
      paymentMethod: '現金',
      subtotal: 145,
      discountAmount: 0,
      total: 145,
      items: [
        {
          rowId: 'preview1',
          productId: 'preview1',
          name: '雞排',
          basePrice: 70,
          qty: 2,
          note: '不要切',
          selections: [
            { moduleName: '辣度', optionName: '小辣', price: 0 },
            { moduleName: '灑粉', optionName: '梅粉', price: 5 }
          ],
          extraPrice: 5
        }
      ]
    };
  }

  document.getElementById('previewReceiptPrintBtn').onclick = ()=>{
    printOrderReceipt(buildPreviewOrderForSettings(), 'customer');
  };

  document.getElementById('previewLabelPrintBtn').onclick = ()=>{
    printOrderLabels(buildPreviewOrderForSettings());
  };

  document.getElementById('savePrintSettingsBtn').onclick = ()=>{
    const cfg = getPrintSettings();
    cfg.storeName = document.getElementById('printStoreName').value.trim();
    cfg.storePhone = document.getElementById('printStorePhone').value.trim();
    cfg.storeAddress = document.getElementById('printStoreAddress').value.trim();
    cfg.receiptFooter = document.getElementById('printReceiptFooter').value.trim();
    cfg.receiptPaperWidth = document.getElementById('printReceiptPaperWidth').value || '58';
    cfg.labelPaperWidth = Number(document.getElementById('printLabelPaperWidth').value || 60);
    cfg.labelPaperHeight = Number(document.getElementById('printLabelPaperHeight').value || 40);
    cfg.receiptFontSize = Number(document.getElementById('printReceiptFontSize').value || 12);
    cfg.labelFontSize = Number(document.getElementById('printLabelFontSize').value || 12);
    cfg.receiptOffsetX = Number(document.getElementById('printReceiptOffsetX').value || 0);
    cfg.receiptOffsetY = Number(document.getElementById('printReceiptOffsetY').value || 0);
    cfg.labelOffsetX = Number(document.getElementById('printLabelOffsetX').value || 0);
    cfg.labelOffsetY = Number(document.getElementById('printLabelOffsetY').value || 0);
    cfg.kitchenCopies = Math.max(1, Number(document.getElementById('printKitchenCopies').value || 1));
    cfg.autoPrintCheckout = document.getElementById('printAutoCheckout').checked;
    cfg.autoPrintKitchen = document.getElementById('printAutoKitchen').checked;
    persistAll();
    alert('列印設定已儲存');
  };
}
