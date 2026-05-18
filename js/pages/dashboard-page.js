/* 中文備註：2237-1 內建多店看板。
 * 參考原 pos-dashboard：深色店卡、離線/班次警示、週/月累計、歷史報表、CSV、58/80mm 列印。
 * Firebase config 仍維持本機匯入，不硬寫專案金鑰。
 */

import {
  printReport,
  previewReport,
  buildSummaryReport,
  buildSessionReport,
  buildOrderDetailReport,
  buildAnomalyReport,
  exportCSV,
  summaryToCSV,
  sessionsToCSV,
  ordersToCSV,
  anomalyToCSV
} from '../print-service-dashboard.js';
import { listStores, loadHistory, getDateRange } from '../history-loader.js';

var FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
var CONFIG_KEY = 'posDashboardFirebaseConfig_v1';
var ONLINE_THRESHOLD = 90 * 1000;
var ALERT_SESSION_HOURS = 14;
var WEEK_MONTH_TTL_MS = 60 * 1000;

var appApi = null;
var dbApi = null;
var authApi = null;
var appInstance = null;
var dbInstance = null;
var authInstance = null;
var googleProvider = null;
var dashboardsUnsub = null;
var dashboardsData = {};
var currentUser = null;
var currentStaff = null;
var tickTimer = null;
var weekMonthTimer = null;
var weekMonthLoading = false;
var weekMonthCache = {};
var lastRawHistory = null;
var lastReportData = null;
var lastReportType = 'summary';

function $(id){ return document.getElementById(id); }
function esc(value){
  return String(value == null ? '' : value).replace(/[&<>'"]/g, function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];
  });
}
function money(value){ return (Number(value || 0)).toLocaleString('zh-TW') + ' 元'; }
function pad(n){ return String(n).padStart(2, '0'); }
function dateKey(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function nowTime(){ return new Date().toLocaleTimeString('zh-TW', { hour12:false }); }
function setText(id, value){ var el = $(id); if(el) el.textContent = value; }
function show(el, display){ if(el) el.style.display = display || ''; }
function hide(el){ if(el) el.style.display = 'none'; }
function showAuthError(html){ var box = $('authError'); if(box){ box.style.display = 'block'; box.innerHTML = html; } }
function clearAuthError(){ var box = $('authError'); if(box){ box.style.display = 'none'; box.innerHTML = ''; } }
function statusText(message, type){ var box = $('dashStatus'); if(box){ box.className = 'dash-status' + (type ? ' ' + type : ''); box.textContent = message; } }
function showLogin(){ show($('loginScreen'), 'flex'); hide($('dashboardScreen')); }
function showDashboard(){ hide($('loginScreen')); show($('dashboardScreen'), 'block'); }
function fmtClock(iso){
  if(!iso) return '--';
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '--';
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function timeAgo(iso){
  if(!iso) return '未知';
  var t = new Date(iso).getTime();
  if(isNaN(t)) return String(iso);
  var diff = Math.max(0, Date.now() - t);
  if(diff < 60000) return Math.floor(diff / 1000) + ' 秒前';
  if(diff < 3600000) return Math.floor(diff / 60000) + ' 分鐘前';
  if(diff < 86400000) return Math.floor(diff / 3600000) + ' 小時前';
  return Math.floor(diff / 86400000) + ' 天前';
}
function isVoidedStatus(status){
  var s = String(status || '').toLowerCase();
  return s === 'void' || s === 'cancelled' || s === 'refunded';
}
function readSavedConfig(){ try{ var raw = localStorage.getItem(CONFIG_KEY); return raw ? JSON.parse(raw) : null; }catch(e){ return null; } }
function saveConfig(cfg){ localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
function extractFirebaseValue(text, key){
  var raw = String(text || '');
  var re = new RegExp(key + '\\s*:\\s*(["' + "'" + '])([^"' + "'" + ']*)["' + "'" + ']', 'i');
  var m = raw.match(re);
  return m ? String(m[2] || '').trim() : '';
}
function parseFirebaseConfigText(text){
  var raw = String(text || '').trim();
  if(!raw) throw new Error('沒有可匯入的 Firebase 設定內容');
  var keys = ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId','measurementId'];
  var cfg = {};
  try{
    var json = JSON.parse(raw);
    if(json && typeof json === 'object') keys.forEach(function(k){ if(json[k]) cfg[k] = String(json[k]).trim(); });
  }catch(e){}
  keys.forEach(function(k){ if(!cfg[k]) cfg[k] = extractFirebaseValue(raw, k); });
  if(!cfg.apiKey || !cfg.projectId || !cfg.appId) throw new Error('找不到必要 Firebase 欄位 apiKey / projectId / appId');
  if(!cfg.databaseURL) throw new Error('缺少 databaseURL。請填入 Realtime Database URL');
  return cfg;
}
function readFileAsText(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){ resolve(String(reader.result || '')); };
    reader.onerror = function(){ reject(reader.error || new Error('讀取檔案失敗')); };
    reader.readAsText(file);
  });
}
async function loadFirebase(){
  if(appInstance && dbInstance && authInstance) return;
  appApi = await import(FIREBASE_BASE + '/firebase-app.js');
  dbApi = await import(FIREBASE_BASE + '/firebase-database.js');
  authApi = await import(FIREBASE_BASE + '/firebase-auth.js');
  var cfg = readSavedConfig();
  if(!cfg) throw new Error('尚未匯入 Firebase 設定');
  if(!cfg.apiKey || !cfg.databaseURL || !cfg.projectId || !cfg.appId) throw new Error('Firebase 設定不完整，請重新匯入');
  appInstance = appApi.initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain || undefined,
    databaseURL: cfg.databaseURL,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket || undefined,
    messagingSenderId: cfg.messagingSenderId || undefined,
    appId: cfg.appId,
    measurementId: cfg.measurementId || undefined
  }, 'pos-dashboard-' + Date.now());
  dbInstance = dbApi.getDatabase(appInstance);
  authInstance = authApi.getAuth(appInstance);
  googleProvider = new authApi.GoogleAuthProvider();
  authApi.onAuthStateChanged(authInstance, handleAuthState);
}
async function importConfigFromUI(){
  var fileEl = $('dashConfigFile');
  var textEl = $('dashConfigText');
  var raw = String(textEl && textEl.value || '').trim();
  if(!raw && fileEl && fileEl.files && fileEl.files[0]) raw = await readFileAsText(fileEl.files[0]);
  var cfg = parseFirebaseConfigText(raw);
  saveConfig(cfg);
  appInstance = dbInstance = authInstance = googleProvider = null;
  statusText('Firebase 設定已儲存在本機。現在可按「使用 Google 登入」。\nDatabase: ' + cfg.databaseURL, 'ok');
}
async function login(){ await loadFirebase(); await authApi.signInWithPopup(authInstance, googleProvider); }
async function logout(){ if(authInstance && confirm('確定要登出嗎？')) await authApi.signOut(authInstance); }
async function verifyStaff(){
  if(!currentUser) throw new Error('尚未登入 Google');
  var snap = await dbApi.get(dbApi.ref(dbInstance, 'staff/' + currentUser.uid));
  var staff = snap.val() || null;
  var role = staff && staff.role ? String(staff.role) : '';
  if(role !== 'admin' && role !== 'staff'){
    throw new Error('此 Google 帳號沒有看板權限。請在 staff/' + currentUser.uid + ' 設定 role=admin 或 staff。');
  }
  currentStaff = staff;
  return staff;
}
async function handleAuthState(user){
  currentUser = user || null;
  if(!user){
    currentStaff = null;
    stopDashboardListener();
    showLogin();
    clearAuthError();
    var label = $('googleSignInLabel'); if(label) label.textContent = '使用 Google 登入';
    var btn = $('googleSignInBtn'); if(btn){ btn.disabled = false; btn.style.display = ''; }
    statusText(readSavedConfig() ? '已找到本機 Firebase 設定，可直接登入。' : '請先匯入 Firebase 設定，再用 staff/admin Google 帳號登入。', readSavedConfig() ? 'ok' : '');
    return;
  }
  var displayEmail = user.email || user.displayName || user.uid;
  var loginBtn = $('googleSignInBtn');
  var label2 = $('googleSignInLabel');
  if(loginBtn) loginBtn.disabled = true;
  if(label2) label2.textContent = '檢查權限中...';
  try{
    await verifyStaff();
    setText('currentUserEmail', displayEmail);
    clearAuthError();
    showDashboard();
    if(loginBtn) loginBtn.disabled = false;
    if(label2) label2.textContent = '使用 Google 登入';
    startDashboardListener();
  }catch(err){
    showLogin();
    showAuthError('<strong>沒有看板權限或讀取 staff 失敗</strong><br><br>登入帳號：<code>' + esc(displayEmail) + '</code><br>UID：<code>' + esc(user.uid) + '</code><br><br>' + esc(err && err.message ? err.message : err));
    if(loginBtn) loginBtn.style.display = 'none';
  }
}
function stopDashboardListener(){ if(dashboardsUnsub){ dashboardsUnsub(); dashboardsUnsub = null; } }
function startDashboardListener(){
  stopDashboardListener();
  dashboardsUnsub = dbApi.onValue(dbApi.ref(dbInstance, 'dashboards'), function(snapshot){
    dashboardsData = snapshot.val() || {};
    renderDashboard();
    startWeekMonthLoader();
  }, function(error){
    show($('empty'), 'block');
    if($('empty')) $('empty').innerHTML = '<h2>連線失敗</h2><p>' + esc(error.message) + '</p>';
  });
}
function isOnline(store){
  var last = store && store.heartbeat && store.heartbeat.lastSeenAt;
  if(!last) return false;
  var t = new Date(last).getTime();
  return !isNaN(t) && Date.now() - t <= ONLINE_THRESHOLD;
}
function detectAlerts(d){
  var alerts = [];
  var hb = d.heartbeat || {};
  var session = d.session || null;
  if(hb.lastSeenAt){
    var ageMin = (Date.now() - new Date(hb.lastSeenAt).getTime()) / 60000;
    if(ageMin > 5 && ageMin < 60) alerts.push('離線 ' + Math.floor(ageMin) + ' 分');
    if(ageMin >= 60) alerts.push('離線 ' + Math.floor(ageMin / 60) + ' 小時');
  }
  if(session && session.startedAt){
    var hrs = (Date.now() - new Date(session.startedAt).getTime()) / 3600000;
    if(hrs > ALERT_SESSION_HOURS) alerts.push('班次未結 ' + Math.floor(hrs) + ' 小時');
  }
  return alerts;
}
function datesBetween(from, to){
  var out = [];
  var cur = new Date(from);
  while(cur <= to){ out.push(dateKey(cur)); cur.setDate(cur.getDate() + 1); }
  return out;
}
function getWeekStart(){
  var d = new Date(); d.setHours(0,0,0,0);
  var day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function getMonthStart(){ var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
function sumDayFromSessions(dayObj){
  var total = 0;
  Object.values(dayObj || {}).forEach(function(session){
    if(!session || !Array.isArray(session.orders)) return;
    session.orders.forEach(function(o){ if(!isVoidedStatus(o.status)) total += Number(o.total || 0); });
  });
  return total;
}
async function loadWeekMonthHistorical(storeIds){
  if(weekMonthLoading || !dbInstance || !dbApi) return;
  weekMonthLoading = true;
  try{
    var todayDate = new Date(); todayDate.setHours(0,0,0,0);
    var yesterday = new Date(todayDate); yesterday.setDate(yesterday.getDate() - 1);
    var weekStart = getWeekStart();
    var monthStart = getMonthStart();
    if(yesterday < monthStart){
      storeIds.forEach(function(sid){ weekMonthCache[sid] = { weekHistorical:0, monthHistorical:0, fetchedAt:Date.now() }; });
      return;
    }
    var allDates = datesBetween(monthStart, yesterday);
    for(var s = 0; s < storeIds.length; s++){
      var sid = storeIds[s];
      var weekHist = 0, monthHist = 0;
      for(var i = 0; i < allDates.length; i += 8){
        var chunk = allDates.slice(i, i + 8);
        var snaps = await Promise.all(chunk.map(function(d){ return dbApi.get(dbApi.ref(dbInstance, 'sessionHistory/' + sid + '/' + d)).catch(function(){ return null; }); }));
        snaps.forEach(function(snap, idx){
          if(!snap) return;
          var daySum = sumDayFromSessions(snap.val());
          monthHist += daySum;
          if(chunk[idx] >= dateKey(weekStart)) weekHist += daySum;
        });
      }
      weekMonthCache[sid] = { weekHistorical:weekHist, monthHistorical:monthHist, fetchedAt:Date.now() };
    }
  }catch(err){ console.warn('[dashboard week/month] load failed', err); }
  finally{ weekMonthLoading = false; renderDashboard(); }
}
function startWeekMonthLoader(){
  if(weekMonthTimer) return;
  var tick = function(){
    var storeIds = Object.keys(dashboardsData || {});
    if(!storeIds.length) return;
    var now = Date.now();
    var need = storeIds.some(function(sid){ var c = weekMonthCache[sid]; return !c || (now - c.fetchedAt > WEEK_MONTH_TTL_MS); });
    if(need) loadWeekMonthHistorical(storeIds);
  };
  tick();
  weekMonthTimer = setInterval(tick, 30000);
}
function getStoreWeekMonth(storeId, todayObj){
  var cache = weekMonthCache[storeId];
  var todaySales = Number((todayObj && todayObj.salesTotal) || 0);
  if(!cache) return { loading:true, week:0, month:0 };
  return { loading:false, week:cache.weekHistorical + todaySales, month:cache.monthHistorical + todaySales };
}
function paymentsHtml(payments){
  var entries = Object.entries(payments || {});
  if(!entries.length) return '';
  return '<div class="payments"><div class="payments-title">支付方式分項</div>' + entries.map(function(pair){
    var name = pair[0]; var info = pair[1] || {};
    return '<div class="payment-row"><span>' + esc(name) + '</span><span>' + money(info.amount) + '（' + Number(info.count || 0) + ' 單）</span></div>';
  }).join('') + '</div>';
}
function sessionHtml(session){
  if(!session) return '<div class="session"><div class="no-session">目前無人值班</div></div>';
  return '<div class="session"><div class="session-title"><span>目前班次</span><span>' + esc(fmtClock(session.startedAt)) + ' 開班</span></div>' +
    '<div class="session-row"><span>值班人員</span><span>' + esc(session.staffName || session.staffId || '--') + '</span></div>' +
    '<div class="session-row"><span>開班現金</span><span>' + money(session.openingCash) + '</span></div>' +
    '<div class="session-row"><span>目前現金</span><span>' + money(session.currentCash) + '</span></div></div>';
}
function promosHtml(promotions){
  var coupons = promotions && Array.isArray(promotions.coupons) ? promotions.coupons : [];
  var banners = promotions && Array.isArray(promotions.banners) ? promotions.banners : [];
  var lines = [];
  coupons.slice(0,2).forEach(function(c){ lines.push('<div class="promo-row"><span>' + esc(c.code || '') + '</span><span>' + esc(c.title || '') + '</span></div>'); });
  banners.slice(0,1).forEach(function(b){ lines.push('<div class="promo-row"><span>廣告</span><span>' + esc(b.title || '') + '</span></div>'); });
  return lines.length ? '<div class="promos"><div class="promos-title">促銷 / 廣告</div>' + lines.join('') + '</div>' : '';
}
function getFilteredStores(){
  var searchEl = $('dashStoreSearch');
  var filterEl = $('dashStatusFilter');
  var q = String(searchEl && searchEl.value || '').trim().toLowerCase();
  var filter = String(filterEl && filterEl.value || 'all');
  return Object.entries(dashboardsData || {}).map(function(pair){ return { storeId:pair[0], data:pair[1] || {} }; }).filter(function(item){
    var name = String(item.data.heartbeat && item.data.heartbeat.storeName || item.storeId).toLowerCase();
    var matchQ = !q || item.storeId.toLowerCase().indexOf(q) >= 0 || name.indexOf(q) >= 0;
    var online = isOnline(item.data);
    return matchQ && (filter === 'all' || (filter === 'online' && online) || (filter === 'offline' && !online));
  }).sort(function(a,b){
    var ao = isOnline(a.data) ? 0 : 1, bo = isOnline(b.data) ? 0 : 1;
    if(ao !== bo) return ao - bo;
    return a.storeId.localeCompare(b.storeId);
  });
}
function renderSummary(allStores){
  var totalSales = 0, totalOrders = 0, totalVoided = 0, online = 0;
  allStores.forEach(function(item){
    var today = item.data.today || {};
    totalSales += Number(today.salesTotal || 0);
    totalOrders += Number(today.orderCount || 0);
    totalVoided += Number(today.voided && today.voided.amount || 0);
    if(isOnline(item.data)) online++;
  });
  setText('sumSales', money(totalSales));
  setText('sumOrders', String(totalOrders));
  setText('sumOnline', online + ' / ' + allStores.length);
  setText('sumVoided', money(totalVoided));
}
function renderDashboard(){
  var allStores = Object.entries(dashboardsData || {}).map(function(pair){ return { storeId:pair[0], data:pair[1] || {} }; });
  renderSummary(allStores);
  setText('storeCount', '店鋪數：' + allStores.length);
  setText('updateTime', nowTime());
  var stores = getFilteredStores();
  var grid = $('grid'); var empty = $('empty');
  if(!grid) return;
  if(!stores.length){ grid.innerHTML = ''; show(empty, 'block'); return; }
  hide(empty);
  grid.innerHTML = stores.map(function(item){
    var d = item.data || {};
    var hb = d.heartbeat || {};
    var today = d.today || {};
    var session = d.session || null;
    var online = isOnline(d);
    var name = hb.storeName || item.storeId;
    var voided = today.voided || {};
    var delivery = today.delivery || {};
    var weekMonth = getStoreWeekMonth(item.storeId, today);
    var alerts = detectAlerts(d);
    var alertHtml = alerts.map(function(a){ return '<span class="alert-badge">⚠ ' + esc(a) + '</span>'; }).join('');
    return '<article class="card ' + (online ? 'online' : 'offline') + '">' +
      '<div class="card-head"><div><div class="store-name">' + esc(name) + alertHtml + '</div><div class="store-id">' + esc(item.storeId) + '</div><div class="last-seen">最後更新：' + esc(timeAgo(hb.lastSeenAt)) + '</div></div>' +
      '<span class="status ' + (online ? 'online' : 'offline') + '">' + (online ? '● 線上' : '● 離線') + '</span></div>' +
      '<div class="totals"><div class="total-cell"><div class="total-label">本週累計</div><div class="total-value ' + (weekMonth.loading ? 'total-loading' : '') + '">' + (weekMonth.loading ? '載入中...' : money(weekMonth.week)) + '</div></div>' +
      '<div class="total-cell"><div class="total-label">本月累計</div><div class="total-value ' + (weekMonth.loading ? 'total-loading' : '') + '">' + (weekMonth.loading ? '載入中...' : money(weekMonth.month)) + '</div></div></div>' +
      '<div class="stats"><div class="stat"><div class="stat-label">營業額</div><div class="stat-value">' + money(today.salesTotal) + '</div></div><div class="stat"><div class="stat-label">訂單數</div><div class="stat-value">' + Number(today.orderCount || 0) + '</div></div><div class="stat"><div class="stat-label">客單價</div><div class="stat-value">' + money(today.avgTicket) + '</div></div></div>' +
      '<div class="stats"><div class="stat"><div class="stat-label">異常單金額</div><div class="stat-value ' + (Number(voided.amount || 0) > 0 ? 'negative' : '') + '">' + (Number(voided.amount || 0) > 0 ? '-' : '') + money(voided.amount) + '</div></div><div class="stat"><div class="stat-label">異常單數</div><div class="stat-value ' + (Number(voided.count || 0) > 0 ? 'negative' : '') + '">' + Number(voided.count || 0) + ' 單</div></div><div class="stat"><div class="stat-label">外送</div><div class="stat-value">' + money(delivery.total) + '</div></div></div>' +
      paymentsHtml(today.payments || {}) + sessionHtml(session) + promosHtml(d.promotions) + '</article>';
  }).join('');
}
function applyPreset(preset){
  var r = getDateRange(preset || 'today');
  if($('dateFrom')) $('dateFrom').value = r.from;
  if($('dateTo')) $('dateTo').value = r.to;
}
async function loadStoreCheckList(){
  var body = $('storeChkBody');
  if(!body) return;
  body.innerHTML = '<div style="color:#94a3b8;font-size:13px">載入中...</div>';
  try{
    var stores = await listStores(dbInstance);
    if(!stores.length){ body.innerHTML = '<div style="color:#fbbf24;font-size:13px">尚未偵測到任何店鋪</div>'; return; }
    body.innerHTML = stores.map(function(s){ return '<label><input type="checkbox" class="store-chk" value="' + esc(s.storeId) + '" checked> ' + esc(s.storeName) + '（' + esc(s.storeId) + '）</label>'; }).join('');
    var all = $('storeAllChk');
    if(all) all.onchange = function(e){ Array.prototype.forEach.call(body.querySelectorAll('.store-chk'), function(c){ c.checked = e.target.checked; }); };
  }catch(err){ body.innerHTML = '<div style="color:#ef4444;font-size:13px">載入店鋪失敗：' + esc(err.message || err.code || err) + '</div>'; }
}
function showModal(id){ var el = $(id); if(el) el.classList.add('show'); }
function hideModal(id){ var el = $(id); if(el) el.classList.remove('show'); }
async function generateReport(){
  var dateFrom = $('dateFrom').value;
  var dateTo = $('dateTo').value;
  var reportType = $('reportType').value;
  if(!dateFrom || !dateTo){ alert('請選擇日期'); return; }
  if(dateFrom > dateTo){ alert('起始日期不能晚於結束日期'); return; }
  var span = (new Date(dateTo + 'T00:00:00') - new Date(dateFrom + 'T00:00:00')) / 86400000;
  if(span > 60){ alert('區間最多 60 天'); return; }
  var selectedStores = Array.prototype.map.call(document.querySelectorAll('.store-chk:checked'), function(c){ return c.value; });
  if(!selectedStores.length){ alert('請至少選擇一家店鋪'); return; }
  var btn = $('generateReportBtn');
  btn.disabled = true; btn.textContent = '撈取中...';
  try{
    var history = await loadHistory(dbInstance, selectedStores, dateFrom, dateTo);
    lastRawHistory = history;
    lastReportType = reportType;
    if(reportType === 'summary') lastReportData = buildSummaryReport(history);
    else if(reportType === 'session') lastReportData = buildSessionReport(history);
    else if(reportType === 'order') lastReportData = buildOrderDetailReport({ date: history.dateFrom + ' ~ ' + history.dateTo, stores: history.stores });
    else lastReportData = buildAnomalyReport(history);
    var paperWidth = Number($('paperWidth').value || 58);
    var html = previewReport(lastReportData, paperWidth);
    var frame = $('reportPreviewFrame');
    var doc = frame.contentDocument || frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    setText('reportPreviewTitle', lastReportData.title + ' — ' + (lastReportData.subtitle || ''));
    hideModal('reportModal'); showModal('reportPreviewModal');
  }catch(err){ console.error('產生報表失敗', err); alert('產生報表失敗：' + (err.message || err.code || err)); }
  finally{ btn.disabled = false; btn.textContent = '產生報表 →'; }
}
function exportLastCsv(){
  if(!lastRawHistory) return;
  var rows, filename;
  if(lastReportType === 'summary'){ rows = summaryToCSV(lastRawHistory); filename = '營業彙總_' + lastRawHistory.dateFrom + '_' + lastRawHistory.dateTo + '.csv'; }
  else if(lastReportType === 'session'){ rows = sessionsToCSV(lastRawHistory); filename = '班次明細_' + lastRawHistory.dateFrom + '_' + lastRawHistory.dateTo + '.csv'; }
  else if(lastReportType === 'order'){ rows = ordersToCSV({ stores:lastRawHistory.stores }); filename = '訂單明細_' + lastRawHistory.dateFrom + '_' + lastRawHistory.dateTo + '.csv'; }
  else { rows = anomalyToCSV(lastRawHistory); filename = '異常單_' + lastRawHistory.dateFrom + '_' + lastRawHistory.dateTo + '.csv'; }
  exportCSV(rows, filename);
}
async function printLastReport(){
  if(!lastReportData) return;
  var btn = $('printReportBtn'); btn.disabled = true; btn.textContent = '列印中...';
  try{
    var r = await printReport(lastReportData, { paperWidth:Number($('paperWidth').value || 58) });
    if(!r.ok) alert('列印失敗，請檢查印表機連線');
  }catch(err){ alert('列印失敗：' + (err.message || err.code || err)); }
  finally{ btn.disabled = false; btn.textContent = '列印'; }
}
function bindEvents(){
  $('dashImportConfigBtn').addEventListener('click', function(){ importConfigFromUI().catch(function(err){ statusText('匯入失敗：' + (err.message || err), 'err'); }); });
  $('googleSignInBtn').addEventListener('click', function(){ login().catch(function(err){ showAuthError('登入失敗：' + esc(err.message || err)); }); });
  $('logoutBtn').addEventListener('click', function(){ logout().catch(function(){}); });
  $('dashRefreshBtn').addEventListener('click', function(){ renderDashboard(); if(dashboardsUnsub) startDashboardListener(); });
  $('dashStoreSearch').addEventListener('input', renderDashboard);
  $('dashStatusFilter').addEventListener('change', renderDashboard);
  $('dashConfigFile').addEventListener('change', function(){ var f = this.files && this.files[0]; if(f) statusText('已選擇：' + f.name + '，請按「匯入設定」。', ''); });
  $('openReportBtn').addEventListener('click', function(){ applyPreset('7d'); loadStoreCheckList().then(function(){ showModal('reportModal'); }); });
  $('closeReportBtn').addEventListener('click', function(){ hideModal('reportModal'); });
  $('cancelReportBtn').addEventListener('click', function(){ hideModal('reportModal'); });
  $('generateReportBtn').addEventListener('click', generateReport);
  $('closePreviewBtn').addEventListener('click', function(){ hideModal('reportPreviewModal'); });
  $('backToConditionBtn').addEventListener('click', function(){ hideModal('reportPreviewModal'); showModal('reportModal'); });
  $('exportCsvBtn').addEventListener('click', exportLastCsv);
  $('printReportBtn').addEventListener('click', printLastReport);
  Array.prototype.forEach.call(document.querySelectorAll('.preset-btn'), function(btn){
    btn.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('.preset-btn'), function(b){ b.classList.remove('active'); });
      btn.classList.add('active'); applyPreset(btn.getAttribute('data-preset'));
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.modal-mask'), function(mask){ mask.addEventListener('click', function(e){ if(e.target === mask) mask.classList.remove('show'); }); });
}

bindEvents();
if(readSavedConfig()) statusText('已找到本機 Firebase 設定，可直接 Google 登入。', 'ok');
loadFirebase().catch(function(){ showLogin(); });
tickTimer = setInterval(renderDashboard, 15000);
window.addEventListener('beforeunload', function(){
  stopDashboardListener();
  if(tickTimer) clearInterval(tickTimer);
  if(weekMonthTimer) clearInterval(weekMonthTimer);
});
