/* 中文備註：列印服務模組（v2.1.25-debug）。
 * 變更：純加 log，零邏輯變更
 *   1. 顧客電話自動遮罩（保留店家電話完整）
 *   2. fields 欄位過濾（顧客單/廚房單/標籤獨立勾選）
 *   3. 統一列印路徑：Sunmi > 藍牙 > 網路 > 瀏覽器
 *   4. previewInModal 配合 index.html 既有 #printPreviewModal / #printPreviewFrame
 *   5. openDrawer 由設定旗標控制
 */

import { state, persistAll } from '../core/store.js';
import { maskCustomerPhone } from './customer-service.js';
import { detectPrinters, getCachedDetect, httpPrint, httpOpenDrawer, browserPrintHtml as bridgeBrowserPrint } from './print-bridge.js';

// ── 內部 log（同步寫進 window.__printLog 與 console）──
function pslog(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = '[' + ts + '][print-service] ' + msg;
  try { console.log(line); } catch(e) {}
  try {
    if (typeof window !== 'undefined') {
      if (!window.__printLog) window.__printLog = [];
      window.__printLog.push(line);
      if (window.__printLog.length > 200) window.__printLog.shift();
      // 也丟到螢幕浮動框（如果 print-bridge 已建立）
      const body = document.getElementById('__printLogBody');
      if (body) {
        const div = document.createElement('div');
        div.textContent = line;
        body.appendChild(div);
        while (body.childNodes.length > 30) body.removeChild(body.firstChild);
        const box = document.getElementById('__printLogBox');
        if (box) box.scrollTop = box.scrollHeight;
      }
    }
  } catch(e) {}
}

// ============================================================
// 設定取得
// ============================================================
const DEFAULT_FIELDS = {
  receipt: {
    storeName: true, storePhone: true, storeAddress: true,
    orderNo: true, dateTime: true, orderType: true, customerInfo: true,
    items: true, itemPrice: true, itemQty: true, itemNote: true,
    subtotal: true, discount: true, total: true,
    paymentMethod: true, orderNote: true, footer: true
  },
  kitchen: {
    storeName: true, orderNo: true, dateTime: true, orderType: true,
    customerInfo: false,
    items: true, itemQty: true, itemNote: true, orderNote: true
  },
  label: {
    storeName: true, orderNo: true, dateTime: true, orderType: true,
    customerInfo: false,
    items: true, itemQty: true, itemNote: true
  }
};

export function getPrintSettings(){
  if(!state.settings) state.settings = {};
  if(!state.settings.printConfig) state.settings.printConfig = {};
  const cfg = state.settings.printConfig;
  cfg.storeName = cfg.storeName || '我的店';
  cfg.storePhone = cfg.storePhone || '';
  cfg.storeAddress = cfg.storeAddress || '';
  cfg.receiptFooter = cfg.receiptFooter || '謝謝光臨';
  cfg.receiptPaperWidth = Number(cfg.receiptPaperWidth || 58);
  cfg.labelPaperWidth = Number(cfg.labelPaperWidth || 60);
  cfg.labelPaperHeight = Number(cfg.labelPaperHeight || 40);
  cfg.receiptFontSize = Number(cfg.receiptFontSize || 12);
  cfg.labelFontSize = Number(cfg.labelFontSize || 12);
  cfg.receiptOffsetX = Number(cfg.receiptOffsetX || 0);
  cfg.receiptOffsetY = Number(cfg.receiptOffsetY || 0);
  cfg.labelOffsetX = Number(cfg.labelOffsetX || 0);
  cfg.labelOffsetY = Number(cfg.labelOffsetY || 0);
  cfg.kitchenCopies = Math.max(1, Number(cfg.kitchenCopies || 1));
  if (typeof cfg.openDrawer === 'undefined') cfg.openDrawer = false;
  if (!cfg.fields) cfg.fields = JSON.parse(JSON.stringify(DEFAULT_FIELDS));
  ['receipt','kitchen','label'].forEach(kind => {
    if(!cfg.fields[kind]) cfg.fields[kind] = JSON.parse(JSON.stringify(DEFAULT_FIELDS[kind]));
    Object.keys(DEFAULT_FIELDS[kind]).forEach(f => {
      if(typeof cfg.fields[kind][f] === 'undefined'){
        cfg.fields[kind][f] = DEFAULT_FIELDS[kind][f];
      }
    });
  });
  return cfg;
}

// ============================================================
// 工具
// ============================================================
function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function money(v){
  return '$' + Number(v || 0).toLocaleString('zh-TW');
}

function buildSelectionText(item){
  if(!item || !Array.isArray(item.selections)) return '';
  return item.selections.map(s => `${s.moduleName}:${s.optionName}`).join(' / ');
}

function fmtDate(s){
  if(!s) return '';
  return String(s).replace('T',' ').slice(0,16);
}

function sunmiPrintReceiptByFont(order, mode){
  if(!hasSunmi() || typeof window.SunmiPrinter.printTextWithFont !== 'function') return false;
  const cfg = getPrintSettings();
  const fields = cfg.fields[mode === 'kitchen' ? 'kitchen' : (mode === 'label' ? 'label' : 'receipt')];
  const isKitchen = mode === 'kitchen';
  const isLabel = mode === 'label';
  const baseSize = isLabel
    ? Math.max(16, Number(cfg.labelFontSize || 12) * 2)
    : Math.max(16, Number(cfg.receiptFontSize || 12) * 2);
  const bigSize = baseSize + 8;
  const smallSize = Math.max(14, baseSize - 4);
  const paperWidth = Number(cfg.receiptPaperWidth || 58);
  const baseCols = paperWidth >= 76 ? 42 : (paperWidth >= 70 ? 38 : 32);
  const sepLen = Math.max(8, Math.floor(baseCols * (24 / baseSize)));
  const sep = '-'.repeat(sepLen);

  const sp = window.SunmiPrinter;

  function line(text, size){
    try { sp.printTextWithFont(String(text || '') + '\n', '', size || baseSize); }
    catch(e){ console.warn('printTextWithFont 失敗', e); }
  }

  try {
    if(fields.storeName && cfg.storeName) line(cfg.storeName, bigSize);
    if(isKitchen) line('** 廚房單 **', bigSize);
    if(isLabel) line('** 標籤 **', bigSize);
    if(!isKitchen && !isLabel){
      if(fields.storePhone && cfg.storePhone) line('電話：' + cfg.storePhone, smallSize);
      if(fields.storeAddress && cfg.storeAddress) line('地址：' + cfg.storeAddress, smallSize);
    }
    line(sep, smallSize);

    if(fields.orderNo) line('單號：' + (order.orderNo || order.id || ''), baseSize);
    if(fields.dateTime) line('時間：' + fmtDate(order.createdAt), baseSize);
    if(fields.orderType){
      const t = (order.orderType || '') + (order.tableNo ? ' / ' + order.tableNo : '');
      if(t.trim()) line('類型：' + t, baseSize);
    }
    if(fields.customerInfo){
      const cName = order.customerName || '';
      const cPhone = maskCustomerPhone(order.customerPhone) || '';
      if(cName || cPhone) line('顧客：' + cName + (cPhone ? ' / ' + cPhone : ''), baseSize);
    }
    if(!isKitchen && !isLabel && fields.paymentMethod && order.paymentMethod){
      line('付款：' + order.paymentMethod, baseSize);
    }
    line(sep, smallSize);

    if(fields.items){
      (order.items || []).forEach(it => {
        const name = it.name || '';
        const qty = Number(it.qty || 0);
        const sel = fields.itemSelections !== false ? buildSelectionText(it) : '';
        const note = it.note || '';
        const unitPrice = Number(it.basePrice || 0) + Number(it.extraPrice || 0);
        const lineTotal = unitPrice * qty;

        if(isKitchen || isLabel){
          line(name + (fields.itemQty ? ' x' + qty : ''), bigSize);
        } else {
          const left = name + (fields.itemQty ? ' x' + qty : '');
          const right = fields.itemPrice !== false ? ('$' + lineTotal) : '';
          line(right ? (left + '   ' + right) : left, baseSize);
        }
        if(sel) line('  ' + sel, smallSize);
        if(fields.itemNote && note) line('  備註：' + note, smallSize);
      });
    }

    if(fields.orderNote && order.customerNote){
      line(sep, smallSize);
      line('訂單備註：' + order.customerNote, baseSize);
    }

    if(!isKitchen && !isLabel){
      let drewSep = false;
      if(fields.subtotal){ line(sep, smallSize); drewSep = true; line('小計      $' + Number(order.subtotal || order.total || 0), baseSize); }
      if(fields.discount && Number(order.discountAmount || 0) > 0){
        if(!drewSep){ line(sep, smallSize); drewSep = true; }
        line('折扣     -$' + Number(order.discountAmount), baseSize);
      }
      if(fields.total){
        if(!drewSep){ line(sep, smallSize); drewSep = true; }
        line('合計      $' + Number(order.total || 0), bigSize);
      }
      if(fields.footer && cfg.receiptFooter){
        line(sep, smallSize);
        line(cfg.receiptFooter, baseSize);
      }
    }

    line(' ', smallSize);

    if(typeof sp.cutPaper === 'function'){
      try { sp.cutPaper(); } catch(e) {}
    }
    return true;

  } catch(e) {
    console.warn('sunmiPrintReceiptByFont 失敗', e);
    return false;
  }
}

function buildPlainTextFromOrder(order, mode){
  const cfg = getPrintSettings();
  const isKitchen = mode === 'kitchen';
  const isLabel = mode === 'label';
  const fields = cfg.fields[isKitchen ? 'kitchen' : (isLabel ? 'label' : 'receipt')];
  const lines = [];

  const paperWidth = Number(cfg.receiptPaperWidth || 58);
  const sepLen = paperWidth >= 76 ? 42 : (paperWidth >= 70 ? 38 : 32);
  const sep = '-'.repeat(sepLen);

  if(fields.storeName && cfg.storeName) lines.push(cfg.storeName);
  if(isKitchen) lines.push('** 廚房單 **');
  if(isLabel) lines.push('** 標籤 **');
  if(!isKitchen && !isLabel){
    if(fields.storePhone && cfg.storePhone) lines.push('電話：' + cfg.storePhone);
    if(fields.storeAddress && cfg.storeAddress) lines.push('地址：' + cfg.storeAddress);
  }
  lines.push(sep);

  if(fields.orderNo) lines.push('單號：' + (order.orderNo || order.id || ''));
  if(fields.dateTime) lines.push('時間：' + fmtDate(order.createdAt));
  if(fields.orderType){
    const t = (order.orderType || '') + (order.tableNo ? ' / ' + order.tableNo : '');
    if(t.trim()) lines.push('類型：' + t);
  }
  if(fields.customerInfo){
    const cName = order.customerName || '';
    const cPhone = maskCustomerPhone(order.customerPhone) || '';
    if(cName || cPhone) lines.push('顧客：' + cName + (cPhone ? ' / ' + cPhone : ''));
  }
  if(!isKitchen && !isLabel && fields.paymentMethod && order.paymentMethod){
    lines.push('付款：' + order.paymentMethod);
  }
  lines.push(sep);

  if(fields.items){
    (order.items || []).forEach(it => {
      const name = it.name || '';
      const qty = Number(it.qty || 0);
      const sel = fields.itemSelections !== false ? buildSelectionText(it) : '';
      const note = it.note || '';
      const unitPrice = Number(it.basePrice || 0) + Number(it.extraPrice || 0);
      const lineTotal = unitPrice * qty;
      if(isKitchen || isLabel){
        lines.push(name + (fields.itemQty ? ' x' + qty : ''));
      } else {
        const left = name + (fields.itemQty ? ' x' + qty : '');
        const right = fields.itemPrice ? '$' + lineTotal : '';
        lines.push(right ? (left + '  ' + right) : left);
      }
      if(sel) lines.push('  ' + sel);
      if(fields.itemNote && note) lines.push('  備註：' + note);
    });
  }

  if(fields.orderNote && order.customerNote){
    lines.push(sep);
    lines.push('訂單備註：' + order.customerNote);
  }

  if(!isKitchen && !isLabel){
    lines.push(sep);
    if(fields.subtotal) lines.push('小計  $' + Number(order.subtotal || order.total || 0));
    if(fields.discount && Number(order.discountAmount || 0) > 0){
      lines.push('折扣  -$' + Number(order.discountAmount));
    }
    if(fields.total) lines.push('合計  $' + Number(order.total || 0));
    if(fields.footer && cfg.receiptFooter){
      lines.push(sep);
      lines.push(cfg.receiptFooter);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ============================================================
// 預覽 modal
// ============================================================
export function previewInModal(html){
  const modal = document.getElementById('printPreviewModal');
  const frame = document.getElementById('printPreviewFrame');
  if(!modal || !frame){
    alert('找不到列印預覽視窗，請更新頁面後再試');
    return;
  }
  modal.classList.remove('hidden');
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const printBtn = document.getElementById('printPreviewPrintBtn');
  if(printBtn){
    printBtn.onclick = function(){
      try{ frame.contentWindow.print(); }
      catch(e){ alert('列印失敗：' + e.message); }
    };
  }
  const closeBtn = document.getElementById('closePrintPreviewModal');
  if(closeBtn){
    closeBtn.onclick = function(){ modal.classList.add('hidden'); };
  }
}

// ============================================================
// HTML 產生
// ============================================================
export function getReceiptHtml(order, mode){
  const cfg = getPrintSettings();
  const isKitchen = mode === 'kitchen';
  const fields = cfg.fields[isKitchen ? 'kitchen' : 'receipt'];
  const fontSize = Number(cfg.receiptFontSize || 12);
  const paperWidthMm = Number(cfg.receiptPaperWidth || 58);
  const offX = Number(cfg.receiptOffsetX || 0);
  const offY = Number(cfg.receiptOffsetY || 0);

  const customerPhoneMasked = maskCustomerPhone(order.customerPhone);
  const lines = [];

  if(fields.storeName) lines.push(`<div class="center bold big">${escapeHtml(cfg.storeName)}</div>`);
  if(isKitchen) lines.push(`<div class="center bold">** 廚房單 **</div>`);

  const headerInfo = [];
  if(!isKitchen){
    if(fields.storePhone && cfg.storePhone) headerInfo.push(`電話：${escapeHtml(cfg.storePhone)}`);
    if(fields.storeAddress && cfg.storeAddress) headerInfo.push(`地址：${escapeHtml(cfg.storeAddress)}`);
  }
  if(headerInfo.length) lines.push(`<div class="center small">${headerInfo.join(' / ')}</div>`);

  lines.push('<div class="sep"></div>');

  if(fields.orderNo) lines.push(`<div>單號：${escapeHtml(order.orderNo || order.id || '')}</div>`);
  if(fields.dateTime) lines.push(`<div>時間：${escapeHtml(fmtDate(order.createdAt))}</div>`);
  if(fields.orderType){
    const tableInfo = order.tableNo ? ` / ${escapeHtml(order.tableNo)}` : '';
    lines.push(`<div>類型：${escapeHtml(order.orderType || '')}${tableInfo}</div>`);
  }
  if(fields.customerInfo){
    const cName = order.customerName ? escapeHtml(order.customerName) : '';
    const cPhone = customerPhoneMasked ? escapeHtml(customerPhoneMasked) : '';
    if(cName || cPhone) lines.push(`<div>顧客：${cName}${cPhone ? ' / ' + cPhone : ''}</div>`);
  }
  if(!isKitchen && fields.paymentMethod && order.paymentMethod){
    lines.push(`<div>付款：${escapeHtml(order.paymentMethod)}</div>`);
  }

  lines.push('<div class="sep"></div>');

  if(fields.items){
    (order.items || []).forEach(it => {
      const name = escapeHtml(it.name || '');
      const qty = Number(it.qty || 0);
      const sel = fields.itemSelections !== false ? buildSelectionText(it) : '';
      const note = it.note || '';
      const unitPrice = Number(it.basePrice || 0) + Number(it.extraPrice || 0);
      const lineTotal = unitPrice * qty;

      let mainLine = '';
      if(isKitchen){
        mainLine = `<div class="bold big-item">${name}${fields.itemQty ? ' x' + qty : ''}</div>`;
      } else {
        const left = `${name}${fields.itemQty ? ' x' + qty : ''}`;
        const right = fields.itemPrice !== false ? money(lineTotal) : '';
        mainLine = `<div class="row"><span>${left}</span><span>${right}</span></div>`;
      }
      lines.push(mainLine);

      if(sel) lines.push(`<div class="indent small">${escapeHtml(sel)}</div>`);
      if(fields.itemNote && note) lines.push(`<div class="indent small">備註：${escapeHtml(note)}</div>`);
    });
  }

  if(fields.orderNote && order.customerNote){
    lines.push('<div class="sep"></div>');
    lines.push(`<div class="small">訂單備註：${escapeHtml(order.customerNote)}</div>`);
  }

  if(!isKitchen){
    lines.push('<div class="sep"></div>');
    if(fields.subtotal) lines.push(`<div class="row"><span>小計</span><span>${money(order.subtotal || order.total || 0)}</span></div>`);
    if(fields.discount && Number(order.discountAmount || 0) > 0){
      lines.push(`<div class="row"><span>折扣</span><span>-${money(order.discountAmount)}</span></div>`);
    }
    if(fields.total){
      lines.push(`<div class="row big bold"><span>合計</span><span>${money(order.total || 0)}</span></div>`);
    }
    if(fields.footer && cfg.receiptFooter){
      lines.push('<div class="sep"></div>');
      lines.push(`<div class="center">${escapeHtml(cfg.receiptFooter)}</div>`);
    }
  } else {
    lines.push('<div class="sep"></div>');
  }

  const css = `
    <style>
      @page { size: ${paperWidthMm}mm auto; margin: 0; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: "PingFang TC","Microsoft JhengHei","Heiti TC", sans-serif;
        font-size: ${fontSize}px;
        width: ${paperWidthMm}mm;
        padding: 4mm 3mm;
        margin-left: ${offX}mm;
        margin-top: ${offY}mm;
        color: #000;
      }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .big { font-size: ${fontSize + 4}px; }
      .big-item { font-size: ${fontSize + 2}px; }
      .small { font-size: ${fontSize - 2}px; }
      .indent { padding-left: 12px; }
      .sep { border-top: 1px dashed #000; margin: 4px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; }
      div { line-height: 1.5; word-break: break-all; }
    </style>
  `;

  return `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>${lines.join('')}</body></html>`;
}

export function getLabelHtml(order){
  const cfg = getPrintSettings();
  const fields = cfg.fields.label;
  const fontSize = Number(cfg.labelFontSize || 12);
  const w = Number(cfg.labelPaperWidth || 60);
  const h = Number(cfg.labelPaperHeight || 40);
  const offX = Number(cfg.labelOffsetX || 0);
  const offY = Number(cfg.labelOffsetY || 0);

  const customerPhoneMasked = maskCustomerPhone(order.customerPhone);
  const items = order.items || [];

    const labels = items.flatMap(it => {
    const qty = Math.max(1, Number(it.qty || 0));
    const oneLabel = () => {
      const lines = [];
      if(fields.storeName) lines.push(`<div class="bold center">${escapeHtml(cfg.storeName)}</div>`);
      if(fields.orderNo) lines.push(`<div class="small">${escapeHtml(order.orderNo || order.id || '')}</div>`);
      if(fields.dateTime) lines.push(`<div class="small">${escapeHtml(fmtDate(order.createdAt))}</div>`);
      if(fields.orderType) lines.push(`<div class="small">${escapeHtml(order.orderType || '')}</div>`);
      if(fields.customerInfo){
        const cName = order.customerName ? escapeHtml(order.customerName) : '';
        const cPhone = customerPhoneMasked ? escapeHtml(customerPhoneMasked) : '';
        if(cName || cPhone) lines.push(`<div class="small">${cName}${cPhone ? ' / ' + cPhone : ''}</div>`);
      }
      if(fields.items){
        const name = escapeHtml(it.name || '');
        // 一張一份，不再顯示 x數量
        lines.push(`<div class="bold big-item">${name}</div>`);
        const sel = fields.itemSelections !== false ? buildSelectionText(it) : '';
        if(sel) lines.push(`<div class="small">${escapeHtml(sel)}</div>`);
        if(fields.itemNote && it.note) lines.push(`<div class="small">備註：${escapeHtml(it.note)}</div>`);
      }
      return `<div class="label">${lines.join('')}</div>`;
    };
    return Array.from({ length: qty }, oneLabel);
  }).join('');


  const css = `
    <style>
      @page { size: ${w}mm ${h}mm; margin: 0; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: "PingFang TC","Microsoft JhengHei","Heiti TC", sans-serif;
        font-size: ${fontSize}px;
        color: #000;
        margin-left: ${offX}mm;
        margin-top: ${offY}mm;
      }
      .label {
        width: ${w}mm; height: ${h}mm; padding: 2mm; box-sizing: border-box;
        page-break-after: always; overflow: hidden;
      }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .big-item { font-size: ${fontSize + 2}px; }
      .small { font-size: ${fontSize - 2}px; }
      div { line-height: 1.4; word-break: break-all; }
    </style>
  `;

  return `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>${labels}</body></html>`;
}

// ============================================================
function getDetect(){
  return getCachedDetect();
}
function hasSunmi(){
  const d = getDetect();
  if (!d) return false;
  if (d.mode === 'webview') return !!(window.SunmiPrinter);
  return d.mode === 'http';
}
function isSunmiReady(){
  const d = getDetect();
  return !!(d && d.sunmi);
}
function isBtReady(){
  const d = getDetect();
  return !!(d && d.bluetooth);
}
function isNetReady(){
  const d = getDetect();
  return !!(d && d.network);
}

function buildBridgePayload(order, mode){
  const cfg = getPrintSettings();
  const kind = mode === 'kitchen' ? 'kitchen' : (mode === 'label' ? 'label' : 'receipt');
  const fields = cfg.fields[kind];
  const isKitchen = kind === 'kitchen';
  const isLabel = kind === 'label';

  // ── 依 fields 勾選結果，未勾選 → 傳空字串/空陣列，APK 看到空就不印 ──
  const payload = {
    mode,
    fields,
    openDrawer: false,

    // 店家資訊（廚房單/標籤本來就不印電話地址）
    shopName:    fields.storeName    ? (cfg.storeName    || '') : '',
    shopPhone:  (fields.storePhone   && !isKitchen && !isLabel) ? (cfg.storePhone   || '') : '',
    shopAddress:(fields.storeAddress && !isKitchen && !isLabel) ? (cfg.storeAddress || '') : '',

    // 副標：廚房單 / 標籤 才需要
    subtitle: isKitchen ? '** 廚房單 **' : (isLabel ? '** 標籤 **' : ''),

    // 頁尾
    footer: (fields.footer && !isKitchen && !isLabel) ? (cfg.receiptFooter || '') : '',

    // 訂單資訊
    orderNumber: fields.orderNo  ? String(order.orderNo || order.id || '') : '',
    dateTime:    fields.dateTime ? fmtDate(order.createdAt) : '',
    orderType:   fields.orderType
                   ? ((order.orderType || '') + (order.tableNo ? ' / ' + order.tableNo : '')).trim()
                   : '',
    tableNo: order.tableNo || '',

    // 付款方式（僅顧客單）
    paymentMethod: (fields.paymentMethod && !isKitchen && !isLabel)
                     ? (order.paymentMethod || '') : '',

    // 顧客資訊
    customerName:        fields.customerInfo ? (order.customerName || '') : '',
    customerPhoneMasked: fields.customerInfo ? (maskCustomerPhone(order.customerPhone) || '') : '',

    // 訂單備註
    customerNote: fields.orderNote ? (order.customerNote || '') : '',

        // 品項
    items: fields.items
      ? (order.items || []).flatMap(it => {
          const base  = Number(it.basePrice  || 0);
          const extra = Number(it.extraPrice || 0);
          const qty   = Math.max(1, Number(it.qty || 0));

          // 標籤模式：每個 qty 展開成一個獨立 item（每張一份），APK 看到 N 個 item 就印 N 張
          if(isLabel){
            return Array.from({ length: qty }, () => ({
              name: it.name || '',
              qty: 1,
              basePrice: base,
              extraPrice: extra,
              price: 0,
              options: fields.itemSelections !== false ? buildSelectionText(it) : '',
              note:    fields.itemNote       !== false ? (it.note || '') : ''
            }));
          }

          // 顧客單 / 廚房單：原樣保留 qty
          return [{
            name: it.name || '',
            qty:  fields.itemQty   !== false ? qty : 1,
            basePrice: base,
            extraPrice: extra,
            price: (!isKitchen && fields.itemPrice !== false)
                     ? (base + extra) * qty : 0,
            options: fields.itemSelections !== false ? buildSelectionText(it) : '',
            note:    fields.itemNote       !== false ? (it.note || '') : ''
          }];
        })
      : [],

    // 金額（僅顧客單）
    subtotal:       (fields.subtotal && !isKitchen && !isLabel) ? Number(order.subtotal || 0)       : 0,
    discountAmount: (fields.discount && !isKitchen && !isLabel) ? Number(order.discountAmount || 0) : 0,
    total:          (fields.total    && !isKitchen && !isLabel) ? Number(order.total || 0)          : 0
  };
  return payload;
}


// ============================================================
// 主路由：顧客單
// ============================================================
export async function printOrderReceipt(order, mode){
  pslog('printOrderReceipt CALL mode=' + mode + ' orderNo=' + (order && (order.orderNo || order.id)));
  const realMode = mode === 'kitchen' ? 'kitchen' : 'receipt';
  const payload = buildBridgePayload(order, realMode);
  const html = getReceiptHtml(order, realMode === 'kitchen' ? 'kitchen' : 'customer');

  await detectPrinters(true);
  const d = getDetect();
  pslog('printOrderReceipt detect mode=' + (d && d.mode) + ' sunmi=' + (d && d.sunmi)
    + ' bt=' + (d && d.bluetooth) + ' net=' + (d && d.network));

  if (d && d.mode === 'http') {
    if (d.sunmi) {
      pslog('printOrderReceipt → http-sunmi');
      const r = await httpPrint('sunmi', payload);
      pslog('printOrderReceipt http-sunmi result ok=' + r.ok + ' err=' + r.error);
      if (r.ok) return { route:'http-sunmi', ok:true };
    }
    if (d.bluetooth) {
      pslog('printOrderReceipt → http-bluetooth');
      const r = await httpPrint('bluetooth', payload);
      pslog('printOrderReceipt http-bluetooth result ok=' + r.ok + ' err=' + r.error);
      if (r.ok) return { route:'http-bluetooth', ok:true };
    }
    if (d.network) {
      pslog('printOrderReceipt → http-network');
      const r = await httpPrint('network', payload);
      pslog('printOrderReceipt http-network result ok=' + r.ok + ' err=' + r.error);
      if (r.ok) return { route:'http-network', ok:true };
    }
    pslog('printOrderReceipt http all failed, fallback browser');
  }

  if (d && d.mode === 'webview') {
    pslog('printOrderReceipt → webview');
    const jsonStr = JSON.stringify(payload);
    if (sunmiPrintReceiptByFont(order, realMode)) return { route:'sunmi-font', ok:true };
    if (window.SunmiPrinter?.isBtPrinterConnected?.() && window.SunmiPrinter.btPrintReceipt) {
      try { if (window.SunmiPrinter.btPrintReceipt(jsonStr)) return { route:'bluetooth', ok:true }; } catch(e){}
    }
    if (window.SunmiPrinter?.isNetPrinterConnected?.() && window.SunmiPrinter.netPrintReceipt) {
      try { if (window.SunmiPrinter.netPrintReceipt(jsonStr)) return { route:'network', ok:true }; } catch(e){}
    }
  }

  pslog('printOrderReceipt → browser fallback');
  await bridgeBrowserPrint(html);
  return { route:'browser', ok:true };
}

// ============================================================
// 主路由：廚房單
// ============================================================
export async function printKitchenCopies(order){
  pslog('printKitchenCopies CALL orderNo=' + (order && (order.orderNo || order.id)));
  const cfg = getPrintSettings();
  const copies = Math.max(1, Number(cfg.kitchenCopies || 1));
  const payload = buildBridgePayload(order, 'kitchen');
  const html = getReceiptHtml(order, 'kitchen');

  await detectPrinters(true);
  const d = getDetect();
  pslog('printKitchenCopies detect mode=' + (d && d.mode) + ' copies=' + copies);

  for (let i = 0; i < copies; i++) {
    let printed = false;
    pslog('printKitchenCopies copy ' + (i+1) + '/' + copies);

    if (d && d.mode === 'http') {
      if (d.sunmi) {
        const r = await httpPrint('sunmi', payload); if (r.ok) printed = true;
        pslog('  http-sunmi ok=' + r.ok + ' err=' + r.error);
      }
      if (!printed && d.bluetooth) {
        const r = await httpPrint('bluetooth', payload); if (r.ok) printed = true;
        pslog('  http-bluetooth ok=' + r.ok + ' err=' + r.error);
      }
      if (!printed && d.network) {
        const r = await httpPrint('network', payload); if (r.ok) printed = true;
        pslog('  http-network ok=' + r.ok + ' err=' + r.error);
      }
    } else if (d && d.mode === 'webview') {
      const jsonStr = JSON.stringify(payload);
      if (sunmiPrintReceiptByFont(order, 'kitchen')) printed = true;
      if (!printed && window.SunmiPrinter?.isBtPrinterConnected?.() && window.SunmiPrinter.btPrintKitchen) {
        try { if (window.SunmiPrinter.btPrintKitchen(jsonStr)) printed = true; } catch(e){}
      }
      if (!printed && window.SunmiPrinter?.isNetPrinterConnected?.() && window.SunmiPrinter.netPrintKitchen) {
        try { if (window.SunmiPrinter.netPrintKitchen(jsonStr)) printed = true; } catch(e){}
      }
    }

    if (!printed) {
      pslog('  → browser fallback');
      await bridgeBrowserPrint(html);
    }
  }
  return { ok:true, copies };
}

// ============================================================
// 主路由：標籤
// ============================================================
export async function printOrderLabels(order){
  pslog('printOrderLabels CALL orderNo=' + (order && (order.orderNo || order.id)));
  const payload = buildBridgePayload(order, 'label');
  const html = getLabelHtml(order);

  await detectPrinters(true);
  const d = getDetect();
  pslog('printOrderLabels detect mode=' + (d && d.mode));

  if (d && d.mode === 'http') {
    if (d.sunmi) {
      const r = await httpPrint('sunmi', payload);
      pslog('printOrderLabels http-sunmi ok=' + r.ok + ' err=' + r.error);
      if (r.ok) return { route:'http-sunmi', ok:true };
    }
    if (d.bluetooth) {
      const r = await httpPrint('bluetooth', payload);
      pslog('printOrderLabels http-bluetooth ok=' + r.ok + ' err=' + r.error);
      if (r.ok) return { route:'http-bluetooth', ok:true };
    }
    if (d.network) {
      const r = await httpPrint('network', payload);
      pslog('printOrderLabels http-network ok=' + r.ok + ' err=' + r.error);
      if (r.ok) return { route:'http-network', ok:true };
    }
  } else if (d && d.mode === 'webview') {
    const jsonStr = JSON.stringify(payload);
    if (sunmiPrintReceiptByFont(order, 'label')) return { route:'sunmi-font', ok:true };
    if (window.SunmiPrinter?.isBtPrinterConnected?.() && window.SunmiPrinter.btPrintReceipt) {
      try { if (window.SunmiPrinter.btPrintReceipt(jsonStr)) return { route:'bluetooth', ok:true }; } catch(e){}
    }
    if (window.SunmiPrinter?.isNetPrinterConnected?.() && window.SunmiPrinter.netPrintReceipt) {
      try { if (window.SunmiPrinter.netPrintReceipt(jsonStr)) return { route:'network', ok:true }; } catch(e){}
    }
  }

  pslog('printOrderLabels → browser fallback');
  await bridgeBrowserPrint(html);
  return { route:'browser', ok:true };
}

// ============================================================
// 錢箱
// ============================================================
export async function openCashDrawer(){
  pslog('openCashDrawer CALL');

  // 直接打 HTTP，不先 detect（避免連續按 /ping 撞到 socket 未釋放）
  try {
    const r = await httpOpenDrawer();
    pslog('openCashDrawer http result ok=' + r.ok + ' err=' + r.error);
    if (r.ok) return true;
  } catch(e) {
    pslog('openCashDrawer http exception: ' + (e && e.message || e));
  }

  // HTTP 失敗才退回 webview / 快取 detect
  const d = getCachedDetect() || await detectPrinters(false);
  pslog('openCashDrawer fallback detect mode=' + (d && d.mode));

  if (d && d.mode === 'webview') {
    pslog('openCashDrawer → webview');
    if (isSunmiReady() && window.SunmiPrinter.openCashDrawer) {
      try { return window.SunmiPrinter.openCashDrawer(); } catch(e) { return false; }
    }
    if (isBtReady() && window.SunmiPrinter.btOpenCashDrawer) {
      try { return window.SunmiPrinter.btOpenCashDrawer(); } catch(e) { return false; }
    }
    if (isNetReady() && window.SunmiPrinter.netOpenCashDrawer) {
      try { return window.SunmiPrinter.netOpenCashDrawer(); } catch(e) { return false; }
    }
  }

  pslog('openCashDrawer → browser mode, cannot open drawer, return false');
  return false;
}


export function buildCartPreviewOrder(){
  const items = Array.isArray(state.cart) ? state.cart : [];
  const subtotal = items.reduce((s, it) => s + (Number(it.basePrice || 0) + Number(it.extraPrice || 0)) * Number(it.qty || 0), 0);
  return {
    orderNo: 'PREVIEW-' + Date.now(),
    createdAt: new Date().toISOString(),
    orderType: '內用',
    tableNo: '',
    paymentMethod: '現金',
    customerName: '範例顧客',
    customerPhone: '0912345678',
    items,
    subtotal,
    discountAmount: 0,
    total: subtotal
  };
}

export async function printSessionReportViaBridge(reportData){
  const lines = reportData.lines || [];
  const title = reportData.title || '班次報表';
  const subtitle = reportData.subtitle || '';

  let body = title + '\n';
  if(subtitle) body += subtitle + '\n';
  body += '--------------------------------\n';
  lines.forEach(line => { body += (line.label || '') + '\n'; });
  body += '\n\n\n';

  if(hasSunmi() && typeof window.SunmiPrinter.printText === 'function'){
    try {
      const ok = window.SunmiPrinter.printText(body);
      if(typeof window.SunmiPrinter.cutPaper === 'function'){
        try { window.SunmiPrinter.cutPaper(); } catch(e){}
      }
      if(ok !== false) return { route:'sunmi-text', ok:true };
    } catch(e) { console.warn('Sunmi printText 失敗：', e); }
  }
  if(hasSunmi() && typeof window.SunmiPrinter.printReceipt === 'function'){
    try {
      const ok = window.SunmiPrinter.printReceipt(title, body);
      if(ok !== false) return { route:'sunmi-receipt', ok:true };
    } catch(e) {}
  }

  if(hasSunmi()
     && typeof window.SunmiPrinter.isBtPrinterConnected === 'function'
     && window.SunmiPrinter.isBtPrinterConnected()
     && typeof window.SunmiPrinter.btPrintText === 'function'){
    try {
      const ok = window.SunmiPrinter.btPrintText(body);
      if(ok !== false) return { route:'bluetooth-text', ok:true };
    } catch(e) {}
  }

  if(hasSunmi()
     && typeof window.SunmiPrinter.isNetPrinterConnected === 'function'
     && window.SunmiPrinter.isNetPrinterConnected()
     && typeof window.SunmiPrinter.netPrintText === 'function'){
    try {
      const ok = window.SunmiPrinter.netPrintText(body);
      if(ok !== false) return { route:'network-text', ok:true };
    } catch(e) {}
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:58mm auto;margin:0}
    body{font-family:"PingFang TC",sans-serif;font-size:13px;width:58mm;padding:3mm;margin:0;color:#000;white-space:pre-wrap;word-break:break-all}
  </style></head><body>${escapeHtml(body)}</body></html>`;
  await bridgeBrowserPrint(html);
  return { route:'browser', ok:true };
}
