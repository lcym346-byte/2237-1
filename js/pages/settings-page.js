/* ============================================================
   js/pages/settings-page.js
   設定頁面：簡潔按鈕 + 浮動視窗
   ============================================================ */

import { state, persistAll } from '../core/store.js';
import { buildCartPreviewOrder, printOrderLabels, printOrderReceipt, printKitchenCopies, openCashDrawer, getPrintSettings, previewInModal, getReceiptHtml, getLabelHtml } from '../modules/print-service.js';
import { detectPrinters, clearDetectCache, getBridgeInfo, browserPrintHtml as bridgeBrowserPrint } from '../modules/print-bridge.js';

// ── 列印欄位矩陣（顧客單 / 廚房單 / 標籤 各自勾選） ──
const PRINT_FIELD_DEFS = [
  { key:'storeName',      label:'店名' },
  { key:'storePhone',     label:'電話' },
  { key:'storeAddress',   label:'地址' },
  { key:'orderNo',        label:'單號' },
  { key:'dateTime',       label:'時間' },
  { key:'orderType',      label:'類型 / 桌號' },
  { key:'paymentMethod',  label:'付款方式' },
  { key:'customerInfo',   label:'顧客資訊' },
  { key:'items',          label:'品項（名稱）' },
  { key:'itemQty',        label:'數量' },
  { key:'itemSelections', label:'品項模組' },
  { key:'itemNote',       label:'品項備註' },
  { key:'itemPrice',      label:'品項金額' },
  { key:'subtotal',       label:'小計' },
  { key:'discount',       label:'折扣' },
  { key:'total',          label:'合計' },
  { key:'orderNote',      label:'訂單備註' },
  { key:'footer',         label:'收據備註（頁尾）' }
];
const PRINT_KINDS = ['receipt','kitchen','label'];

function renderPrintFieldsMatrix(){
  var body = document.getElementById('printFieldsMatrixBody');
  if(!body) return;
  body.innerHTML = PRINT_FIELD_DEFS.map(function(def){
    return ''+
      '<tr style="border-top:1px solid #e2e8f0">'+
        '<td style="padding:6px 8px">'+def.label+'</td>'+
        '<td style="text-align:center"><input type="checkbox" id="pfm_receipt_'+def.key+'"></td>'+
        '<td style="text-align:center"><input type="checkbox" id="pfm_kitchen_'+def.key+'"></td>'+
        '<td style="text-align:center"><input type="checkbox" id="pfm_label_'+def.key+'"></td>'+
      '</tr>';
  }).join('');
}

function loadPrintFieldsMatrix(cfg){
  PRINT_KINDS.forEach(function(kind){
    var f = (cfg.fields && cfg.fields[kind]) || {};
    PRINT_FIELD_DEFS.forEach(function(def){
      var el = document.getElementById('pfm_'+kind+'_'+def.key);
      if(el) el.checked = f[def.key] !== false;
    });
  });
}

function collectPrintFieldsMatrix(){
  var out = { receipt:{}, kitchen:{}, label:{} };
  PRINT_KINDS.forEach(function(kind){
    PRINT_FIELD_DEFS.forEach(function(def){
      var el = document.getElementById('pfm_'+kind+'_'+def.key);
      out[kind][def.key] = !!(el && el.checked);
    });
      });
  return out;
}

// ── 浮動視窗開關工具 ──
function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function initModalSystem() {
  // 關閉按鈕
  document.querySelectorAll('[data-close-modal]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      closeModal(btn.getAttribute('data-close-modal'));
    });
  });

  // 點擊背景關閉
  document.querySelectorAll('.settings-modal-backdrop').forEach(function(backdrop) {
    backdrop.addEventListener('click', function(e) {
      if (e.target === backdrop) {
        backdrop.classList.remove('active');
      }
    });
  });
}

// ── Sunmi 印表機工具 ──
function hasSunmi() {
  return !!(window.SunmiPrinter && window.SunmiPrinter.isPrinterReady);
}

// ── 統一偵測：先 await detectPrinters() 再更新三個狀態框 ──
async function refreshAllPrinterStatus() {
  clearDetectCache();
  const d = await detectPrinters(true);
  refreshSunmiStatus(d);
  refreshBtStatus(d);
  refreshNetStatus(d);
  refreshBridgeModeBox(d);
}

function refreshBridgeModeBox(d) {
  // 在三個 modal 共用的位置顯示「現在走哪條路」
  ['bridgeModeBox_sunmi','bridgeModeBox_bt','bridgeModeBox_net'].forEach(function(id){
    var box = document.getElementById(id);
    if (!box) return;
    var info = getBridgeInfo();
    if (d.mode === 'http') {
      box.innerHTML = '<span class="sm-status connected">● 列印橋接：HTTP（'+info.base+'）v'+(d.version||'?')+'</span>';
    } else if (d.mode === 'webview') {
      box.innerHTML = '<span class="sm-status connected">● 列印橋接：WebView Bridge</span>';
    } else {
      box.innerHTML = '<span class="sm-status unknown">● 此裝置使用系統列印對話框（按下「測試列印」會彈出系統視窗讓你選印表機）</span>';
    }
  });
}

function refreshSunmiStatus(d) {
  var box = document.getElementById('sunmiStatusBox');
  if (!box) return;
  if (!d) { box.innerHTML = '<span class="sm-status unknown">● 偵測中…</span>'; return; }
  if (d.mode === 'browser') {
    box.innerHTML = '<span class="sm-status unknown">● 此裝置不適用 Sunmi 內建（請用系統列印對話框）</span>';
    return;
  }
  if (d.sunmi) {
    box.innerHTML = '<span class="sm-status connected">● 已連線</span>';
  } else {
    box.innerHTML = '<span class="sm-status disconnected">● 未連線（請確認 sunmi-pos-v2 APK 已啟動）</span>';
  }
}

function refreshBtStatus(d) {
  var box = document.getElementById('btStatusBox');
  if (!box) return;
  if (!d) { box.innerHTML = '<span class="sm-status unknown">● 偵測中…</span>'; return; }
  if (d.mode === 'browser') {
    box.innerHTML = '<span class="sm-status unknown">● 此裝置不適用（請用系統列印對話框，或在主機上裝列印橋接 APK）</span>';
    return;
  }
  box.innerHTML = d.bluetooth
    ? '<span class="sm-status connected">● 已連線</span>'
    : '<span class="sm-status disconnected">● 未連線</span>';
}

function refreshNetStatus(d) {
  var box = document.getElementById('netStatusBox');
  if (!box) return;
  if (!d) { box.innerHTML = '<span class="sm-status unknown">● 偵測中…</span>'; return; }
  if (d.mode === 'browser') {
    box.innerHTML = '<span class="sm-status unknown">● 此裝置不適用（請用系統列印對話框，或在主機上裝列印橋接 APK）</span>';
    return;
  }
  box.innerHTML = d.network
    ? '<span class="sm-status connected">● 已連線</span>'
    : '<span class="sm-status disconnected">● 未連線</span>';
}

// 提供「測試列印」按鈕用：產生一張簡單測試頁，走系統列印對話框
window.__bridgeTestPrint = async function(){
  var html = '<!doctype html><html><head><meta charset="utf-8"><style>'
    + '@page{size:80mm auto;margin:0}'
    + 'body{font-family:sans-serif;font-size:14px;width:80mm;padding:5mm;text-align:center}'
    + 'h2{margin:0 0 8px}</style></head><body>'
    + '<h2>列印測試</h2>'
    + '<div>時間：' + new Date().toLocaleString() + '</div>'
    + '<div style="margin-top:6mm">如果你看到這張紙或選到了印表機，<br>表示列印功能正常。</div>'
    + '</body></html>';
  await bridgeBrowserPrint(html);
};

// ── 列印設定：讀取欄位 ──
function loadPrintSettingsToForm() {
  var cfg = getPrintSettings();
  var el = function(id) { return document.getElementById(id); };
  if (el('printStoreName')) el('printStoreName').value = cfg.storeName || '';
  if (el('printStorePhone')) el('printStorePhone').value = cfg.storePhone || '';
  if (el('printStoreAddress')) el('printStoreAddress').value = cfg.storeAddress || '';
  if (el('printReceiptFooter')) el('printReceiptFooter').value = cfg.receiptFooter || '';
  if (el('printReceiptPaperWidth')) el('printReceiptPaperWidth').value = cfg.receiptPaperWidth || '58';
  if (el('printLabelPaperWidth')) el('printLabelPaperWidth').value = Number(cfg.labelPaperWidth || 60);
  if (el('printLabelPaperHeight')) el('printLabelPaperHeight').value = Number(cfg.labelPaperHeight || 40);
  if (el('printReceiptFontSize')) el('printReceiptFontSize').value = Number(cfg.receiptFontSize || 12);
  if (el('printLabelFontSize')) el('printLabelFontSize').value = Number(cfg.labelFontSize || 12);
  if (el('printReceiptOffsetX')) el('printReceiptOffsetX').value = Number(cfg.receiptOffsetX || 0);
  if (el('printReceiptOffsetY')) el('printReceiptOffsetY').value = Number(cfg.receiptOffsetY || 0);
  if (el('printLabelOffsetX')) el('printLabelOffsetX').value = Number(cfg.labelOffsetX || 0);
  if (el('printLabelOffsetY')) el('printLabelOffsetY').value = Number(cfg.labelOffsetY || 0);
  if (el('printKitchenCopies')) el('printKitchenCopies').value = Number(cfg.kitchenCopies || 1);
  if (el('printAutoCheckout')) el('printAutoCheckout').checked = !!cfg.autoPrintCheckout;
  if (el('printAutoKitchen')) el('printAutoKitchen').checked = !!cfg.autoPrintKitchen;
      // 回顯欄位勾選（顧客單 / 廚房單 / 標籤 各自勾選）
  renderPrintFieldsMatrix();
  loadPrintFieldsMatrix(cfg);

}


// ── 即時接單：讀取欄位 ──
function loadRealtimeSettingsToForm() {
  var s = state.settings || {};
  var rt = s.realtimeOrder || {};
  var el = function(id) { return document.getElementById(id); };
  if (el('realtimeOrderEnabled')) el('realtimeOrderEnabled').checked = !!rt.enabled;
  if (el('deviceRole')) el('deviceRole').value = rt.deviceRole || 'master';
  if (el('firebaseApiKey')) el('firebaseApiKey').value = rt.apiKey || '';
  if (el('firebaseAuthDomain')) el('firebaseAuthDomain').value = rt.authDomain || '';
  if (el('firebaseDatabaseUrl')) el('firebaseDatabaseUrl').value = rt.databaseURL || '';
  if (el('firebaseProjectId')) el('firebaseProjectId').value = rt.projectId || '';
  if (el('firebaseStorageBucket')) el('firebaseStorageBucket').value = rt.storageBucket || '';
  if (el('firebaseMessagingSenderId')) el('firebaseMessagingSenderId').value = rt.messagingSenderId || '';
  if (el('firebaseAppId')) el('firebaseAppId').value = rt.appId || '';
  if (el('firebaseMeasurementId')) el('firebaseMeasurementId').value = rt.measurementId || '';
  if (el('onlineStoreTitle')) el('onlineStoreTitle').value = rt.onlineStoreTitle || '';
  if (el('onlineStoreSubtitle')) el('onlineStoreSubtitle').value = rt.onlineStoreSubtitle || '';
   if (el('onlineConfirmAutoPrintKitchen')) el('onlineConfirmAutoPrintKitchen').checked = !!rt.autoPrintKitchenOnConfirm;
  if (el('onlineConfirmAutoPrintReceipt')) el('onlineConfirmAutoPrintReceipt').checked = !!rt.autoPrintReceiptOnConfirm;
  if (el('onlineIncomingSoundEnabled')) el('onlineIncomingSoundEnabled').checked = rt.incomingSoundEnabled !== false;

  // 從機鎖定上傳按鈕：deviceRole === 'slave' 時 disable
  applyDeviceRoleLock();
}

function applyDeviceRoleLock(){
  var role = state.settings?.realtimeOrder?.deviceRole || 'master';
  var isSlave = role === 'slave';
  var syncBtn = document.getElementById('syncMenuBtn');
  if (syncBtn){
    syncBtn.disabled = isSlave;
    syncBtn.style.opacity = isSlave ? '0.45' : '1';
    syncBtn.title = isSlave ? '從機僅可讀取，不可上傳菜單' : '';
    syncBtn.textContent = isSlave ? '⬆ 從機僅讀取' : '⬆ 上傳菜單到雲端';
  }
}



// ── Google 備份：讀取欄位 ──
function loadGoogleSettingsToForm() {
  var s = state.settings || {};
  var g = s.googleDriveBackup || {};   // ← 改為 googleDriveBackup
  var el = function(id) { return document.getElementById(id); };
  if (el('googleClientId')) el('googleClientId').value = g.clientId || '';
  if (el('googleFolderId')) el('googleFolderId').value = g.folderId || '';
  if (el('googleAutoBackupEnabled')) el('googleAutoBackupEnabled').checked = !!g.autoBackupEnabled;
  if (el('googleAutoBackupMinutes')) el('googleAutoBackupMinutes').value = g.autoBackupMinutes || 60;
}

// ── 提示音：讀取狀態 ──
function loadSoundStatus() {
  var statusBox = document.getElementById('customSoundStatusBox');
  if (statusBox) {
    var saved = localStorage.getItem('customAlertSound');
    statusBox.textContent = saved ? '已設定自訂提示音' : '尚未設定自訂提示音';
  }
}

// ── 營業時間：常數與工具 ──
var WEEKDAY_KEYS = ['mon','tue','wed','thu','fri','sat','sun'];
var WEEKDAY_LABELS = {mon:'週一',tue:'週二',wed:'週三',thu:'週四',fri:'週五',sat:'週六',sun:'週日'};

function getBusinessHours(){
  var bh = (state.settings && state.settings.businessHours) || {};
  WEEKDAY_KEYS.forEach(function(k){ if(!Array.isArray(bh[k])) bh[k] = []; });
  return bh;
}

function renderBusinessHoursForm(){
  var body = document.getElementById('businessHoursBody');
  if(!body) return;
  var bh = getBusinessHours();
  body.innerHTML = '';
  WEEKDAY_KEYS.forEach(function(key){
    var slots = bh[key] || [];
    var isClosed = slots.length === 0;
    var card = document.createElement('div');
    card.className = 'bh-day-card';
    card.dataset.day = key;
    card.innerHTML =
      '<div class="bh-day-head">' +
        '<strong>'+ WEEKDAY_LABELS[key] +'</strong>' +
        '<label class="bh-closed-toggle">' +
          '<input type="checkbox" class="bh-closed" '+ (isClosed?'checked':'') +'>' +
          '<span>公休</span>' +
        '</label>' +
      '</div>' +
      '<div class="bh-slots"></div>' +
      '<button type="button" class="sm-btn bh-add-slot" '+ (slots.length>=4?'disabled':'') +'>＋ 新增時段</button>';
    body.appendChild(card);
    var slotsBox = card.querySelector('.bh-slots');
    if(!isClosed){
      slots.forEach(function(s, idx){
        slotsBox.appendChild(buildSlotRow(s.start, s.end, idx));
      });
    }
  });
  bindBusinessHoursEvents();
}

function buildSlotRow(start, end, idx){
  var row = document.createElement('div');
  row.className = 'bh-slot-row';
  row.innerHTML =
    '<input type="time" class="bh-start" value="'+ (start||'11:00') +'">' +
    '<span>～</span>' +
    '<input type="time" class="bh-end" value="'+ (end||'21:00') +'">' +
    '<button type="button" class="bh-remove" data-idx="'+ idx +'">✕</button>';
  return row;
}

function bindBusinessHoursEvents(){
  document.querySelectorAll('.bh-day-card').forEach(function(card){
    var key = card.dataset.day;
    card.querySelector('.bh-closed').onchange = function(e){
      var bh = getBusinessHours();
      if(e.target.checked){
        bh[key] = [];
      } else {
        bh[key] = [{start:'11:00', end:'21:00'}];
      }
      state.settings.businessHours = bh;
      renderBusinessHoursForm();
    };
    card.querySelector('.bh-add-slot').onclick = function(){
      var bh = getBusinessHours();
      if(bh[key].length >= 4) return;
      collectDayFromUI(card, key, bh);
      bh[key].push({start:'17:00', end:'21:00'});
      state.settings.businessHours = bh;
      renderBusinessHoursForm();
    };
    card.querySelectorAll('.bh-remove').forEach(function(btn){
      btn.onclick = function(){
        var bh = getBusinessHours();
        collectDayFromUI(card, key, bh);
        bh[key].splice(Number(btn.dataset.idx), 1);
        state.settings.businessHours = bh;
        renderBusinessHoursForm();
      };
    });
  });
}

function collectDayFromUI(card, key, bh){
  var rows = card.querySelectorAll('.bh-slot-row');
  var arr = [];
  rows.forEach(function(r){
    var s = r.querySelector('.bh-start').value;
    var e = r.querySelector('.bh-end').value;
    if(s && e) arr.push({start:s, end:e});
  });
  bh[key] = arr;
}

function collectAllBusinessHours(){
  var bh = getBusinessHours();
  document.querySelectorAll('.bh-day-card').forEach(function(card){
    var key = card.dataset.day;
    var closed = card.querySelector('.bh-closed').checked;
    if(closed){ bh[key] = []; return; }
    collectDayFromUI(card, key, bh);
  });
  return bh;
}

function saveBusinessHours(){
  var bh = collectAllBusinessHours();
  var error = '';
  WEEKDAY_KEYS.forEach(function(key){
    (bh[key]||[]).forEach(function(s, i){
      if(!s.start || !s.end){
        error = WEEKDAY_LABELS[key] + ' 第'+(i+1)+'時段未填完整';
      }
    });
  });
  if(error){ alert('儲存失敗：' + error); return; }
  state.settings.businessHours = bh;
  persistAll();
  alert('營業時間已儲存');
}

// ── SKU 圖庫對應 ──
function getImageLibrary(){
  if(!state.settings) state.settings = {};
  if(!state.settings.imageLibrary){
    state.settings.imageLibrary = {
      baseUrl: 'https://jess0937588151-hue.github.io/2234/images/products/',
      skuMap: {},
      importedAt: '',
      itemCount: 0
    };
  }
  if(!state.settings.imageLibrary.skuMap || typeof state.settings.imageLibrary.skuMap !== 'object'){
    state.settings.imageLibrary.skuMap = {};
  }
  return state.settings.imageLibrary;
}

function loadImageLibraryToForm(){
  var lib = getImageLibrary();
  var baseInput = document.getElementById('imageLibraryBaseUrl');
  if(baseInput) baseInput.value = lib.baseUrl || '';
  var status = document.getElementById('imageLibraryImportStatus');
  if(status){
    var count = Object.keys(lib.skuMap||{}).length;
    status.textContent = count > 0
      ? ('目前已匯入 ' + count + ' 筆，最後匯入：' + (lib.importedAt || '未知'))
      : '尚未匯入';
  }
  renderImageLibraryList();
}

function renderImageLibraryList(){
  var box = document.getElementById('imageLibraryListBox');
  if(!box) return;
  var lib = getImageLibrary();
  var keys = Object.keys(lib.skuMap || {});
  if(keys.length === 0){ box.innerHTML = '（尚無資料）'; return; }
  keys.sort();
  box.innerHTML = keys.map(function(sku){
    var file = lib.skuMap[sku];
    return '<div style="padding:3px 0;border-bottom:1px dashed #e2e8f0">'
      + '<strong>' + escapeHtml(sku) + '</strong> → '
      + '<span style="color:#475569">' + escapeHtml(file) + '</span>'
      + '</div>';
  }).join('');
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function parseImageLibraryJson(text){
  var data = JSON.parse(text);
  var map = {};
  // 支援三種格式：
  // 1) { "A001":"A001.jpg", "A002":"A002.png" }
  // 2) [ {"sku":"A001","file":"A001.jpg"}, ... ]
  // 3) gallery.html 匯出：{ version, baseUrl, items:[{sku,file},...] }
  var rows = null;
  if(Array.isArray(data)){
    rows = data;
  } else if(data && typeof data === 'object' && Array.isArray(data.items)){
    rows = data.items;
    // 若 JSON 自帶 baseUrl，順便同步到 imageLibrary.baseUrl 欄位（呼叫端會處理）
    if(data.baseUrl){
      var baseInput = document.getElementById('imageLibraryBaseUrl');
      if(baseInput && !baseInput.value) baseInput.value = String(data.baseUrl);
    }
  }
  if(rows){
    rows.forEach(function(row){
      if(row && row.sku && row.file){
        map[String(row.sku).trim()] = String(row.file).trim();
      }
    });
  } else if(data && typeof data === 'object'){
    Object.keys(data).forEach(function(k){
      var v = data[k];
      if(v && typeof v === 'string') map[String(k).trim()] = String(v).trim();
    });
  } else {
    throw new Error('JSON 格式無法解析');
  }
  if(Object.keys(map).length === 0) throw new Error('JSON 內沒有有效資料');
  return map;
}


async function importImageLibraryFile(replaceMode){
  var fileInput = document.getElementById('imageLibraryFileInput');
  if(!fileInput || !fileInput.files || !fileInput.files[0]){
    alert('請先選擇 JSON 檔');
    return;
  }
  var file = fileInput.files[0];
  try {
    var text = await file.text();
    var newMap = parseImageLibraryJson(text);
    var lib = getImageLibrary();
    if(replaceMode){
      lib.skuMap = newMap;
    } else {
      Object.keys(newMap).forEach(function(k){ lib.skuMap[k] = newMap[k]; });
    }
    lib.importedAt = new Date().toLocaleString();
    lib.itemCount = Object.keys(lib.skuMap).length;
    persistAll();
    loadImageLibraryToForm();
    alert((replaceMode ? '覆蓋' : '合併') + '完成，共 ' + lib.itemCount + ' 筆');
    fileInput.value = '';
  } catch(err){
    alert('匯入失敗：' + (err && err.message ? err.message : err));
  }
}

function clearImageLibrary(){
  if(!confirm('確定清空所有 SKU 對應？此動作無法復原。')) return;
  var lib = getImageLibrary();
  lib.skuMap = {};
  lib.itemCount = 0;
  lib.importedAt = '';
  persistAll();
  loadImageLibraryToForm();
}

function exportImageLibrary(){
  var lib = getImageLibrary();
  var blob = new Blob([JSON.stringify(lib.skuMap || {}, null, 2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'sku-image-map-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function saveImageLibrarySettings(){
  var lib = getImageLibrary();
  var baseInput = document.getElementById('imageLibraryBaseUrl');
  if(baseInput){
    var v = (baseInput.value || '').trim();
    if(v && !/\/$/.test(v)) v = v + '/';
    lib.baseUrl = v;
  }
  persistAll();
  alert('圖庫設定已儲存');
}

// ── 主函式 ──

export function initSettingsPage() {

  initModalSystem();

  // ============================
  // Tile 開啟事件（每個 tile 開啟前先載入最新資料）
  // ============================

  // 列印設定
  document.querySelector('[data-modal="modalPrint"]')?.addEventListener('click', function() {
    loadPrintSettingsToForm();
    openModal('modalPrint');
  });

  // Sunmi 印表機
   document.querySelector('[data-modal="modalSunmi"]')?.addEventListener('click', function() {
    openModal('modalSunmi');
    refreshAllPrinterStatus();
  });

  document.querySelector('[data-modal="modalBluetooth"]')?.addEventListener('click', function() {
    openModal('modalBluetooth');
    refreshAllPrinterStatus();
    refreshBtDevices();
  });

  document.querySelector('[data-modal="modalNetwork"]')?.addEventListener('click', function() {
    openModal('modalNetwork');
    refreshAllPrinterStatus();
  });


  // 即時接單
  document.querySelector('[data-modal="modalRealtime"]')?.addEventListener('click', function() {
    loadRealtimeSettingsToForm();
    openModal('modalRealtime');
  });

  // Google 備份
  document.querySelector('[data-modal="modalGoogle"]')?.addEventListener('click', function() {
    loadGoogleSettingsToForm();
    openModal('modalGoogle');
  });

  // 本機資料
  document.querySelector('[data-modal="modalLocalData"]')?.addEventListener('click', function() {
    openModal('modalLocalData');
  });

  // 進單提示音
  document.querySelector('[data-modal="modalSound"]')?.addEventListener('click', function() {
    loadSoundStatus();
    openModal('modalSound');
  });
     // 營業時間
  document.querySelector('[data-modal="modalBusinessHours"]')?.addEventListener('click', function() {
    renderBusinessHoursForm();
    openModal('modalBusinessHours');
  });

    document.getElementById('saveBusinessHoursBtn')?.addEventListener('click', saveBusinessHours);

  // SKU 圖庫對應
  document.querySelector('[data-modal="modalImageLibrary"]')?.addEventListener('click', function() {
    loadImageLibraryToForm();
    openModal('modalImageLibrary');
  });
  document.getElementById('imageLibraryImportBtn')?.addEventListener('click', function(){ importImageLibraryFile(false); });
  document.getElementById('imageLibraryReplaceBtn')?.addEventListener('click', function(){ importImageLibraryFile(true); });
  document.getElementById('imageLibraryClearBtn')?.addEventListener('click', clearImageLibrary);
  document.getElementById('imageLibraryExportBtn')?.addEventListener('click', exportImageLibrary);
  document.getElementById('saveImageLibraryBtn')?.addEventListener('click', saveImageLibrarySettings);


  // ============================
  // 列印設定 — 儲存
  // ============================

  document.getElementById('savePrintSettingsBtn')?.addEventListener('click', function() {
    var cfg = getPrintSettings();
    cfg.storeName = (document.getElementById('printStoreName')?.value || '').trim();
    cfg.storePhone = (document.getElementById('printStorePhone')?.value || '').trim();
    cfg.storeAddress = (document.getElementById('printStoreAddress')?.value || '').trim();
    cfg.receiptFooter = (document.getElementById('printReceiptFooter')?.value || '').trim();
    cfg.receiptPaperWidth = Number(document.getElementById('printReceiptPaperWidth')?.value) || 58;
    cfg.labelPaperWidth = Number(document.getElementById('printLabelPaperWidth')?.value) || 60;
    cfg.labelPaperHeight = Number(document.getElementById('printLabelPaperHeight')?.value) || 40;
    cfg.receiptFontSize = Number(document.getElementById('printReceiptFontSize')?.value) || 12;
    cfg.labelFontSize = Number(document.getElementById('printLabelFontSize')?.value) || 12;
    cfg.receiptOffsetX = Number(document.getElementById('printReceiptOffsetX')?.value) || 0;
    cfg.receiptOffsetY = Number(document.getElementById('printReceiptOffsetY')?.value) || 0;
    cfg.labelOffsetX = Number(document.getElementById('printLabelOffsetX')?.value) || 0;
    cfg.labelOffsetY = Number(document.getElementById('printLabelOffsetY')?.value) || 0;
    cfg.kitchenCopies = Math.max(1, Number(document.getElementById('printKitchenCopies')?.value) || 1);
    cfg.autoPrintCheckout = !!document.getElementById('printAutoCheckout')?.checked;
    cfg.autoPrintKitchen = !!document.getElementById('printAutoKitchen')?.checked;
                // 儲存欄位勾選（顧客單 / 廚房單 / 標籤 各自獨立）
    cfg.fields = collectPrintFieldsMatrix();

     persistAll();

    // 同步到 APK
    if (hasSunmi() && window.SunmiPrinter.saveSettings) {
      try { window.SunmiPrinter.saveSettings(JSON.stringify(cfg)); } catch(e) {}
    }
    alert('列印設定已儲存');
  });

  // ============================
  // 列印預覽
  // ============================
  function buildPreviewOrder() {
    if (Array.isArray(state.cart) && state.cart.length) return buildCartPreviewOrder();
    return {
      orderNo: 'PREVIEW-' + Date.now(),
      createdAt: new Date().toISOString(),
      orderType: '內用', tableNo: 'A1', paymentMethod: '現金',
      subtotal: 145, discountAmount: 0, total: 145,
      items: [{
        rowId: 'p1', productId: 'p1', name: '範例商品',
        basePrice: 70, qty: 2, note: '不要切',
        selections: [
          { moduleName: '辣度', optionName: '小辣', price: 0 },
          { moduleName: '灑粉', optionName: '梅粉', price: 5 }
        ],
        extraPrice: 5
      }]
    };
  }
     // ============================
  // 列印預覽（欄位選擇 → 浮動視窗預覽 → 列印）
  // 完整搬自 v2332 舊版
  // ============================

  function esc(text){
    return String(text==null?'':text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function moneyFmt(v){ return '$' + Number(v||0).toFixed(0); }

  function getFieldFlags(mode){
  var kind = mode === 'kitchen' ? 'kitchen' : (mode === 'label' ? 'label' : 'receipt');
  var f = (getPrintSettings().fields || {})[kind] || {};
  return {
    storeName: f.storeName !== false,
    storePhone: f.storePhone !== false,
    storeAddress: f.storeAddress !== false,
    orderNo: f.orderNo !== false,
    createdAt: f.dateTime !== false,
    orderType: f.orderType !== false,
    paymentMethod: f.paymentMethod !== false,
    itemSelections: f.itemSelections !== false,
    itemNote: f.itemNote !== false,
    itemPrice: f.itemPrice !== false,
    totalSection: (f.subtotal !== false) || (f.total !== false),
    footer: f.footer !== false
  };
}


  function buildPreviewOrderLocal(){
    if (Array.isArray(state.cart) && state.cart.length) return buildCartPreviewOrder();
    return {
      orderNo:'PREVIEW-'+Date.now(), createdAt:new Date().toISOString(),
      orderType:'內用', tableNo:'A1', paymentMethod:'現金',
      subtotal:145, discountAmount:0, total:145,
      items:[{
        rowId:'p1', productId:'p1', name:'雞排', basePrice:70, qty:2, note:'不要切',
        selections:[{moduleName:'辣度',optionName:'小辣',price:0},{moduleName:'灑粉',optionName:'梅粉',price:5}],
        extraPrice:5
      }]
    };
  }

  function buildReceiptHtmlLocal(order, mode, flags){
    var cfg = getPrintSettings();
    var w = Number(cfg.receiptPaperWidth||58);
    var fs = Math.max(8, Number(cfg.receiptFontSize||12));
    var ox = Number(cfg.receiptOffsetX||0);
    var oy = Number(cfg.receiptOffsetY||0);
    var isKitchen = mode==='kitchen';
    var title = isKitchen ? '廚房出單' : '顧客收據';
    var time = String(order.createdAt||'').replace('T',' ').slice(0,16);

    var rows = (order.items||[]).map(function(item){
      var up = Number(item.basePrice||0)+Number(item.extraPrice||0);
      var subParts = [];
      if(flags.itemSelections && (item.selections||[]).length){
        subParts.push((item.selections||[]).map(function(s){ return s.moduleName+':'+s.optionName; }).join(' / '));
      }
      if(flags.itemNote && item.note) subParts.push('備註：'+item.note);
      return '<div class="item-row">' +
        '<div class="item-top"><div class="item-name">'+esc(item.name)+'</div><div class="item-qty">x '+Number(item.qty||0)+'</div></div>' +
        (subParts.length ? '<div class="item-sub">'+esc(subParts.join(' ｜ '))+'</div>' : '') +
        (flags.itemPrice && !isKitchen ? '<div class="item-sub">'+moneyFmt(up)+' / 小計 '+moneyFmt(up*Number(item.qty||0))+'</div>' : '') +
      '</div>';
    }).join('');

    return '<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><style>' +
      '@page{size:'+w+'mm auto;margin:0}' +
      'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;color:#000}' +
      '.sheet{width:'+w+'mm;padding:4mm;box-sizing:border-box;transform:translate('+ox+'mm,'+oy+'mm);font-size:'+fs+'px;line-height:1.45}' +
      '.center{text-align:center}.title{font-size:'+(fs+5)+'px;font-weight:800}.sub{font-size:'+(fs-1)+'px;margin-top:2px}' +
      '.line{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px}' +
      '.item-row{padding:6px 0;border-bottom:1px dashed #bbb}.item-top{display:flex;justify-content:space-between;gap:8px;font-weight:700}' +
      '.item-name{flex:1}.item-qty{white-space:nowrap}.item-sub{margin-top:3px;font-size:'+(fs-1)+'px;color:#333}' +
      '.big{font-size:'+(fs+2)+'px;font-weight:800}.footer{margin-top:10px;text-align:center;font-size:'+(fs-1)+'px}' +
    '</style></head><body><div class="sheet">' +
      (flags.storeName ? '<div class="center"><div class="title">'+esc(cfg.storeName||'餐廳 POS')+'</div></div>' : '') +
      (flags.storePhone && cfg.storePhone ? '<div class="center"><div class="sub">電話：'+esc(cfg.storePhone)+'</div></div>' : '') +
      (flags.storeAddress && cfg.storeAddress ? '<div class="center"><div class="sub">地址：'+esc(cfg.storeAddress)+'</div></div>' : '') +
      '<div class="center"><div class="sub">'+esc(title)+'</div></div>' +
      '<div class="line"></div>' +
      (flags.orderNo ? '<div class="sub">單號：'+esc(order.orderNo||'')+'</div>' : '') +
      (flags.createdAt ? '<div class="sub">時間：'+esc(time)+'</div>' : '') +
      (flags.orderType ? '<div class="sub">類型：'+esc(order.orderType||'')+(order.tableNo?' / '+esc(order.tableNo):'')+'</div>' : '') +
      (flags.paymentMethod && !isKitchen ? '<div class="sub">付款：'+esc(order.paymentMethod||'')+'</div>' : '') +
      '<div class="line"></div>' + rows +
      (flags.totalSection && !isKitchen ?
        '<div class="line"></div>' +
        '<div class="row"><span>小計</span><strong>'+moneyFmt(order.subtotal||0)+'</strong></div>' +
        '<div class="row"><span>折扣</span><strong>'+moneyFmt(order.discountAmount||0)+'</strong></div>' +
        '<div class="row big"><span>合計</span><span>'+moneyFmt(order.total||0)+'</span></div>'
      : '') +
      (flags.footer && cfg.receiptFooter ? '<div class="line"></div><div class="footer">'+esc(cfg.receiptFooter)+'</div>' : '') +
    '</div></body></html>';
  }

  function buildLabelHtmlLocal(order, flags){
    var cfg = getPrintSettings();
    var w = Math.max(30,Number(cfg.labelPaperWidth||60));
    var h = Math.max(20,Number(cfg.labelPaperHeight||40));
    var fs = Math.max(8,Number(cfg.labelFontSize||12));
    var ox = Number(cfg.labelOffsetX||0);
    var oy = Number(cfg.labelOffsetY||0);
    var labels = (order.items||[]).map(function(item){
      var subParts = [];
      if(flags.itemSelections && (item.selections||[]).length){
        subParts.push((item.selections||[]).map(function(s){ return s.moduleName+':'+s.optionName; }).join(' / '));
      }
      if(flags.itemNote && item.note) subParts.push('備註：'+item.note);
      return '<div class="label">' +
        (flags.storeName ? '<div class="store">'+esc(cfg.storeName||'餐廳 POS')+'</div>' : '') +
        '<div class="main">'+esc(item.name)+' x '+Number(item.qty||0)+'</div>' +
        (subParts.length ? '<div class="sub">'+esc(subParts.join(' ｜ '))+'</div>' : '') +
        (flags.orderNo ? '<div class="sub">單號：'+esc(order.orderNo||'')+'</div>' : '') +
        (flags.createdAt ? '<div class="sub">'+esc(String(order.createdAt||'').replace('T',' ').slice(0,16))+'</div>' : '') +
      '</div>';
    }).join('');
    return '<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><style>' +
      '@page{size:'+w+'mm '+h+'mm;margin:0}' +
      'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;color:#000}' +
      '.label{width:'+w+'mm;height:'+h+'mm;box-sizing:border-box;page-break-after:always;padding:3mm;' +
      'transform:translate('+ox+'mm,'+oy+'mm);font-size:'+fs+'px;line-height:1.35}' +
      '.store{font-size:'+(fs-1)+'px;font-weight:700}.main{font-size:'+(fs+3)+'px;font-weight:800;margin-top:2mm}' +
      '.sub{font-size:'+(fs-1)+'px;margin-top:1mm}' +
    '</style></head><body>'+labels+'</body></html>';
  }

  function openPreview(title, html){
    var modal = document.getElementById('printPreviewModal');
    var frame = document.getElementById('printPreviewFrame');
    document.getElementById('printPreviewTitle').textContent = title;
    modal.classList.remove('hidden');
    var clean = html.replace(/<script[\s\S]*?<\/script>/gi,'');
    var doc = frame.contentDocument || frame.contentWindow.document;
    doc.open(); doc.write(clean); doc.close();
  }
  function closePreview(){
    document.getElementById('printPreviewModal').classList.add('hidden');
    var frame = document.getElementById('printPreviewFrame');
    var doc = frame.contentDocument || frame.contentWindow.document;
    doc.open(); doc.write(''); doc.close();
  }
  document.getElementById('printPreviewPrintBtn')?.addEventListener('click', function(){
  var order = buildPreviewOrderLocal();
  if(pendingPreviewMode === 'kitchen'){
    printKitchenCopies(order);
  } else if(pendingPreviewMode === 'label'){
    printOrderLabels(order);
  } else {
    printOrderReceipt(order, 'customer');
  }
});

  document.getElementById('closePrintPreviewModal')?.addEventListener('click', closePreview);
  document.querySelector('#printPreviewModal .modal-backdrop')?.addEventListener('click', closePreview);

  var pendingPreviewMode = null;
  function openFieldsModal(mode){
    pendingPreviewMode = mode;
    var titles = { receipt:'預覽顧客單 — 選擇列印欄位', kitchen:'預覽廚房單 — 選擇列印欄位', label:'預覽標籤 — 選擇列印欄位' };
    document.getElementById('printFieldsTitle').textContent = titles[mode] || '選擇列印欄位';

    if(mode==='kitchen'){
      document.querySelectorAll('#printFieldsModal input[type="checkbox"]').forEach(function(cb){ cb.checked = true; });
      document.getElementById('pf_paymentMethod').checked = false;
      document.getElementById('pf_itemPrice').checked = false;
      document.getElementById('pf_totalSection').checked = false;
      document.getElementById('pf_footer').checked = false;
    } else if(mode==='label'){
      document.querySelectorAll('#printFieldsModal input[type="checkbox"]').forEach(function(cb){ cb.checked = true; });
      document.getElementById('pf_storePhone').checked = false;
      document.getElementById('pf_storeAddress').checked = false;
      document.getElementById('pf_orderType').checked = false;
      document.getElementById('pf_paymentMethod').checked = false;
      document.getElementById('pf_itemPrice').checked = false;
      document.getElementById('pf_totalSection').checked = false;
      document.getElementById('pf_footer').checked = false;
    } else {
      document.querySelectorAll('#printFieldsModal input[type="checkbox"]').forEach(function(cb){ cb.checked = true; });
    }
    document.getElementById('printFieldsModal').classList.remove('hidden');
  }
  function closeFieldsModal(){
    document.getElementById('printFieldsModal').classList.add('hidden');
    pendingPreviewMode = null;
  }
  document.getElementById('closePrintFieldsModal')?.addEventListener('click', closeFieldsModal);
  document.getElementById('printFieldsCancelBtn')?.addEventListener('click', closeFieldsModal);
  document.querySelector('#printFieldsModal .modal-backdrop')?.addEventListener('click', closeFieldsModal);

  document.getElementById('printFieldsConfirmBtn')?.addEventListener('click', function(){
    var flags = getFieldFlags();
    var order = buildPreviewOrderLocal();
    var html = '', title = '';
    if(pendingPreviewMode==='receipt'){
      html = buildReceiptHtmlLocal(order, 'customer', flags);
      title = '預覽顧客單';
    } else if(pendingPreviewMode==='kitchen'){
      html = buildReceiptHtmlLocal(order, 'kitchen', flags);
      title = '預覽廚房單';
    } else if(pendingPreviewMode==='label'){
      html = buildLabelHtmlLocal(order, flags);
      title = '預覽標籤';
    }
    closeFieldsModal();
    if(html) openPreview(title, html);
  });

  document.getElementById('previewReceiptPrintBtn')?.addEventListener('click', function(){
  pendingPreviewMode = 'receipt';          // ← 新增
  applyFormToConfig();
  var order = buildPreviewOrderLocal();
  var html = getReceiptHtml(order, 'customer');
  openPreview('預覽顧客單', html);
});
document.getElementById('previewKitchenPrintBtn')?.addEventListener('click', function(){
  pendingPreviewMode = 'kitchen';          // ← 新增
  applyFormToConfig();
  var order = buildPreviewOrderLocal();
  var html = getReceiptHtml(order, 'kitchen');
  openPreview('預覽廚房單', html);
});
document.getElementById('previewLabelPrintBtn')?.addEventListener('click', function(){
  pendingPreviewMode = 'label';            // ← 新增
  applyFormToConfig();
  var order = buildPreviewOrderLocal();
  var html = getLabelHtml(order);
  openPreview('預覽標籤', html);
});


  /** 把表單上目前填的值即時寫入設定（這樣預覽才會用到最新的數值） */
  function applyFormToConfig() {
    var cfg = getPrintSettings();
    cfg.storeName = (document.getElementById('printStoreName')?.value || '').trim();
    cfg.storePhone = (document.getElementById('printStorePhone')?.value || '').trim();
    cfg.storeAddress = (document.getElementById('printStoreAddress')?.value || '').trim();
    cfg.receiptFooter = (document.getElementById('printReceiptFooter')?.value || '').trim();
    cfg.receiptPaperWidth = Number(document.getElementById('printReceiptPaperWidth')?.value) || 58;
    cfg.labelPaperWidth = Number(document.getElementById('printLabelPaperWidth')?.value) || 60;
    cfg.labelPaperHeight = Number(document.getElementById('printLabelPaperHeight')?.value) || 40;
    cfg.receiptFontSize = Number(document.getElementById('printReceiptFontSize')?.value) || 12;
    cfg.labelFontSize = Number(document.getElementById('printLabelFontSize')?.value) || 12;
    cfg.receiptOffsetX = Number(document.getElementById('printReceiptOffsetX')?.value) || 0;
    cfg.receiptOffsetY = Number(document.getElementById('printReceiptOffsetY')?.value) || 0;
    cfg.labelOffsetX = Number(document.getElementById('printLabelOffsetX')?.value) || 0;
    cfg.labelOffsetY = Number(document.getElementById('printLabelOffsetY')?.value) || 0;
    cfg.kitchenCopies = Math.max(1, Number(document.getElementById('printKitchenCopies')?.value) || 1);
  }
  

  // ============================
  // Sunmi 印表機
  // ============================
  document.getElementById('sunmiRefreshStatusBtn')?.addEventListener('click', function() {
    refreshSunmiStatus();
  });
  document.getElementById('sunmiTestPrintBtn')?.addEventListener('click', function() {
    if (!hasSunmi()) { alert('未偵測到 Sunmi 印表機'); return; }
    var ok = window.SunmiPrinter.printTestReceipt ? window.SunmiPrinter.printTestReceipt() : false;
    alert(ok ? '測試列印成功' : '測試列印失敗');
  });
  document.getElementById('sunmiTestCutBtn')?.addEventListener('click', function() {
    if (!hasSunmi()) { alert('未偵測到 Sunmi 印表機'); return; }
    var ok = window.SunmiPrinter.cutPaper ? window.SunmiPrinter.cutPaper() : false;
    alert(ok ? '切紙成功' : '切紙失敗');
  });
  document.getElementById('sunmiTestDrawerBtn')?.addEventListener('click', function() {
    if (!hasSunmi()) { alert('未偵測到 Sunmi 印表機'); return; }
    var ok = window.SunmiPrinter.openCashDrawer ? window.SunmiPrinter.openCashDrawer() : false;
    alert(ok ? '錢箱已開' : '開錢箱失敗');
  });
  document.getElementById('sunmiTestBuzzerBtn')?.addEventListener('click', function() {
    if (!hasSunmi()) { alert('未偵測到 Sunmi 印表機'); return; }
    var ok = window.SunmiPrinter.buzzer ? window.SunmiPrinter.buzzer() : false;
    alert(ok ? '蜂鳴成功' : '蜂鳴失敗');
  });

  // ============================
  // 藍牙印表機
  // ============================
  document.getElementById('btRefreshBtn')?.addEventListener('click', function() {
    refreshBtDevices();
    refreshBtStatus();
  });
  document.getElementById('btConnectBtn')?.addEventListener('click', function() {
    if (!hasSunmi() || !window.SunmiPrinter.connectBtPrinter) { alert('需透過 Sunmi APK 操作'); return; }
    var addr = document.getElementById('btDeviceSelect')?.value;
    if (!addr) { alert('請選擇裝置'); return; }
    var ok = window.SunmiPrinter.connectBtPrinter(addr);
    refreshBtStatus();
    alert(ok ? '藍牙已連線' : '藍牙連線失敗');
  });
  document.getElementById('btDisconnectBtn')?.addEventListener('click', function() {
    if (hasSunmi() && window.SunmiPrinter.disconnectBtPrinter) window.SunmiPrinter.disconnectBtPrinter();
    refreshBtStatus();
  });
  document.getElementById('btTestPrintBtn')?.addEventListener('click', function() {
    if (!hasSunmi() || !window.SunmiPrinter.btPrintText) { alert('需透過 Sunmi APK 操作'); return; }
    var ok = window.SunmiPrinter.btPrintText('藍牙測試列印\n' + new Date().toLocaleString() + '\n');
    alert(ok ? '藍牙測試成功' : '藍牙測試失敗');
  });

  // ============================
  // 網路印表機
  // ============================
  document.getElementById('netConnectBtn')?.addEventListener('click', function() {
    if (!hasSunmi() || !window.SunmiPrinter.connectNetPrinter) { alert('需透過 Sunmi APK 操作'); return; }
    var ip = (document.getElementById('netIpInput')?.value || '').trim();
    var port = parseInt(document.getElementById('netPortInput')?.value) || 9100;
    if (!ip) { alert('請輸入 IP'); return; }
    var ok = window.SunmiPrinter.connectNetPrinter(ip, port);
    refreshNetStatus();
    alert(ok ? '網路已連線：' + ip + ':' + port : '網路連線失敗');
  });
  document.getElementById('netDisconnectBtn')?.addEventListener('click', function() {
    if (hasSunmi() && window.SunmiPrinter.disconnectNetPrinter) window.SunmiPrinter.disconnectNetPrinter();
    refreshNetStatus();
  });
  document.getElementById('netTestPrintBtn')?.addEventListener('click', function() {
    if (!hasSunmi() || !window.SunmiPrinter.netPrintText) { alert('需透過 Sunmi APK 操作'); return; }
    var ok = window.SunmiPrinter.netPrintText('網路測試列印\n' + new Date().toLocaleString() + '\n');
    alert(ok ? '網路測試成功' : '網路測試失敗');
  });

  // ============================
  // 即時接單 — 儲存
  // ============================
    document.getElementById('saveRealtimeOrderSettingsBtn')?.addEventListener('click', function() {
    if (!state.settings) state.settings = {};
    // 保留服務端寫入的狀態欄位
    var existing = state.settings.realtimeOrder || {};
    state.settings.realtimeOrder = {
      enabled: !!document.getElementById('realtimeOrderEnabled')?.checked,
      deviceRole: document.getElementById('deviceRole')?.value || 'master',
      apiKey: (document.getElementById('firebaseApiKey')?.value || '').trim(),
      authDomain: (document.getElementById('firebaseAuthDomain')?.value || '').trim(),
      databaseURL: (document.getElementById('firebaseDatabaseUrl')?.value || '').trim(),
      projectId: (document.getElementById('firebaseProjectId')?.value || '').trim(),
      storageBucket: (document.getElementById('firebaseStorageBucket')?.value || '').trim(),
      messagingSenderId: (document.getElementById('firebaseMessagingSenderId')?.value || '').trim(),
      appId: (document.getElementById('firebaseAppId')?.value || '').trim(),
      measurementId: (document.getElementById('firebaseMeasurementId')?.value || '').trim(),
      onlineStoreTitle: (document.getElementById('onlineStoreTitle')?.value || '').trim(),
      onlineStoreSubtitle: (document.getElementById('onlineStoreSubtitle')?.value || '').trim(),
      autoPrintKitchenOnConfirm: !!document.getElementById('onlineConfirmAutoPrintKitchen')?.checked,
      autoPrintReceiptOnConfirm: !!document.getElementById('onlineConfirmAutoPrintReceipt')?.checked,
      incomingSoundEnabled: !!document.getElementById('onlineIncomingSoundEnabled')?.checked,
      // 保留服務端的狀態欄位
      lastSyncStatus: existing.lastSyncStatus || '',
      lastOrderAt: existing.lastOrderAt || '',
      lastConfirmedAt: existing.lastConfirmedAt || '',
      lastSyncTime: existing.lastSyncTime || ''
    };
    persistAll();
    alert('即時接單設定已儲存');

    if (typeof window.reinitRealtimeOrder === 'function') {
      window.reinitRealtimeOrder();
    }
  });


    // 上傳菜單到雲端（主機才可用）
  document.getElementById('syncMenuBtn')?.addEventListener('click', async function() {
    var role = state.settings?.realtimeOrder?.deviceRole || 'master';
    if (role === 'slave'){ alert('從機僅可讀取，不可上傳菜單'); return; }
    if (typeof window.syncMenuToCloud === 'function') {
      await window.syncMenuToCloud(this);
    } else {
      alert('同步模組未載入');
    }
  });

  // 從雲端讀取菜單（主機與從機都可用）
  document.getElementById('fetchMenuBtn')?.addEventListener('click', async function() {
    if (typeof window.fetchMenuFromCloud === 'function') {
      await window.fetchMenuFromCloud(this);
      if (typeof window.refreshAllViews === 'function') window.refreshAllViews();
    } else {
      alert('讀取模組未載入');
    }
  });

  // deviceRole 變動時即時鎖定按鈕
  document.getElementById('deviceRole')?.addEventListener('change', function(){
    if (!state.settings) state.settings = {};
    if (!state.settings.realtimeOrder) state.settings.realtimeOrder = {};
    state.settings.realtimeOrder.deviceRole = this.value;
    applyDeviceRoleLock();
  });


  // POS Google 登入/登出
  document.getElementById('posGoogleLoginBtn')?.addEventListener('click', function() {
    if (typeof window.posGoogleLogin === 'function') {
      window.posGoogleLogin();
    } else {
      alert('Google 登入模組未載入');
    }
  });
  document.getElementById('posGoogleLogoutBtn')?.addEventListener('click', function() {
    if (typeof window.posGoogleLogout === 'function') {
      window.posGoogleLogout();
    }
    var box = document.getElementById('posGoogleAccountBox');
    if (box) box.textContent = '尚未登入';
    alert('已登出');
  });

  // ============================
  // Google Drive — 儲存
  // ============================
    document.getElementById('saveGoogleBackupSettingsBtn')?.addEventListener('click', function() {
    if (!state.settings) state.settings = {};
    // 保留服務端寫入的狀態欄位
    var existing = state.settings.googleDriveBackup || {};
    state.settings.googleDriveBackup = {   // ← 改為 googleDriveBackup
      clientId: (document.getElementById('googleClientId')?.value || '').trim(),
      folderId: (document.getElementById('googleFolderId')?.value || '').trim(),
      autoBackupEnabled: !!document.getElementById('googleAutoBackupEnabled')?.checked,
      autoBackupMinutes: parseInt(document.getElementById('googleAutoBackupMinutes')?.value) || 60,
      // 保留服務端的狀態欄位
      lastBackupAt: existing.lastBackupAt || '',
      lastRestoreAt: existing.lastRestoreAt || '',
      lastBackupStatus: existing.lastBackupStatus || '',
      lastRestoreStatus: existing.lastRestoreStatus || ''
    };
    persistAll();
    alert('Google Drive 設定已儲存');

    // 重啟自動備份
    if (typeof window.startGoogleAutoBackup === 'function') {
      window.startGoogleAutoBackup();
    }
  });


  document.getElementById('googleLoginBtn')?.addEventListener('click', function() {
    if (typeof window.googleDriveLogin === 'function') {
      window.googleDriveLogin();
    } else {
      alert('Google Drive 模組未載入');
    }
  });
  document.getElementById('googleLogoutBtn')?.addEventListener('click', function() {
    if (typeof window.googleDriveLogout === 'function') {
      window.googleDriveLogout();
    }
    var box = document.getElementById('googleDriveAccountBox');
    if (box) box.textContent = '尚未登入';
    alert('已登出 Google Drive');
  });

  document.getElementById('manualGoogleBackupBtn')?.addEventListener('click', async function() {
    if (typeof window.googleDriveBackup === 'function') {
      var statusBox = document.getElementById('googleBackupStatusBox');
      if (statusBox) statusBox.textContent = '備份中...';
      try {
        await window.googleDriveBackup();
        if (statusBox) statusBox.textContent = '備份完成 ' + new Date().toLocaleString();
      } catch (e) {
        if (statusBox) statusBox.textContent = '備份失敗: ' + e.message;
      }
    } else {
      alert('Google Drive 備份模組未載入');
    }
  });

  document.getElementById('manualGoogleRestoreBtn')?.addEventListener('click', async function() {
    if (!confirm('確定要從 Google Drive 還原？本機資料將被覆蓋。')) return;
    if (typeof window.googleDriveRestore === 'function') {
      var statusBox = document.getElementById('googleBackupStatusBox');
      if (statusBox) statusBox.textContent = '還原中...';
      try {
        await window.googleDriveRestore();
        if (statusBox) statusBox.textContent = '還原完成，重新載入中...';
        setTimeout(function() { location.reload(); }, 1500);
      } catch (e) {
        if (statusBox) statusBox.textContent = '還原失敗: ' + e.message;
      }
    } else {
      alert('Google Drive 還原模組未載入');
    }
  });

  // ============================
  // 本機資料
  // ============================
  document.getElementById('exportJsonBtn')?.addEventListener('click', function() {
    try {
      var allData = state.exportAllData ? state.exportAllData() : state;
      var blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'pos-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      alert('匯出完成');
    } catch (e) {
      alert('匯出失敗: ' + e.message);
    }
  });

  document.getElementById('importJsonInput')?.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (!confirm('匯入將覆蓋現有資料，確定繼續？')) {
      e.target.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (state.importAllData) {
          state.importAllData(data);
        }
        alert('匯入完成，重新載入中...');
        setTimeout(function() { location.reload(); }, 1000);
      } catch (err) {
        alert('匯入失敗: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('seedDemoBtn')?.addEventListener('click', function() {
    if (!confirm('確定要重建預設資料？現有商品及分類將被覆蓋。')) return;
    if (typeof state.seedDemoData === 'function') {
      state.seedDemoData();
      alert('預設資料已重建，重新載入中...');
      setTimeout(function() { location.reload(); }, 1000);
    }
  });

    document.getElementById('showProductImagesToggle')?.addEventListener('change', function(e) {
    if (!state.settings) state.settings = {};
    state.settings.showProductImages = e.target.checked;
    persistAll();
    // 立即重新渲染 POS 點餐頁，不必切頁或重整就會生效
    if (typeof window.refreshPublicProducts === 'function') {
      window.refreshPublicProducts();
    }
  });

  // 開啟「本機資料」Modal 時，把目前設定值回填到 checkbox
  document.querySelectorAll('[data-modal="modalLocalData"]').forEach(function(tile){
    tile.addEventListener('click', function(){
      var cb = document.getElementById('showProductImagesToggle');
      if (cb) cb.checked = !!(state.settings && state.settings.showProductImages);
    });
  });


  // ============================
  // 進單提示音
  // ============================
  document.getElementById('uploadCustomSoundBtn')?.addEventListener('click', function() {
    var input = document.getElementById('customSoundFileInput');
    if (!input) return;
    // 觸發檔案選擇
    input.click();
  });

  document.getElementById('customSoundFileInput')?.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { alert('檔案過大，上限 500 KB'); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      localStorage.setItem('customAlertSound', ev.target.result);
      var statusBox = document.getElementById('customSoundStatusBox');
      if (statusBox) statusBox.textContent = '已設定自訂提示音: ' + file.name;
      alert('提示音已上傳');
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('previewCustomSoundBtn')?.addEventListener('click', function() {
    var saved = localStorage.getItem('customAlertSound');
    if (!saved) { alert('尚未設定提示音'); return; }
    var audio = new Audio(saved);
    audio.play().catch(function() { alert('播放失敗'); });
  });

  document.getElementById('removeCustomSoundBtn')?.addEventListener('click', function() {
    localStorage.removeItem('customAlertSound');
    var statusBox = document.getElementById('customSoundStatusBox');
    if (statusBox) statusBox.textContent = '尚未設定自訂提示音';
    alert('已移除自訂提示音');
  });

  // ============================
  // 初始化完成
  // ============================
  console.log('settings-page.js initialized (modal mode)');
}
