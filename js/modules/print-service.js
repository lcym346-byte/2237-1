/* 中文備註：商用列印服務。提供顧客單、廚房單、標籤列印，並可調整紙張大小、位移與字體大小。 */
import { state } from '../core/store.js';

function ensurePrintConfig(){
  if(!state.settings) state.settings = {};
  if(!state.settings.printConfig){
    state.settings.printConfig = {
      storeName: '餐廳 POS',
      storePhone: '',
      storeAddress: '',
      receiptFooter: '謝謝光臨，歡迎再次蒞臨',
      receiptPaperWidth: '58',
      labelPaperWidth: '60',
      labelPaperHeight: '40',
      receiptFontSize: 12,
      labelFontSize: 12,
      receiptOffsetX: 0,
      receiptOffsetY: 0,
      labelOffsetX: 0,
      labelOffsetY: 0,
      kitchenCopies: 1,
      autoPrintCheckout: false,
      autoPrintKitchen: true
    };
  }
  return state.settings.printConfig;
}

export function getPrintSettings(){
  return ensurePrintConfig();
}

function escapeHtml(text){
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value){
  return '$' + Number(value || 0).toFixed(0);
}

function buildSelectionText(item){
  const optionText = (item.selections || []).map(s => `${s.moduleName}:${s.optionName}`).join(' / ');
  const noteText = item.note ? `備註：${item.note}` : '';
  return [optionText, noteText].filter(Boolean).join(' ｜ ');
}

function openPrintWindow(html){
  const printWindow = window.open('', '_blank', 'width=480,height=820');
  if(!printWindow){
    alert('瀏覽器阻擋了列印視窗，請允許彈出視窗後再試。');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function buildReceiptHtml(order, mode){
  const cfg = ensurePrintConfig();
  const widthMm = Number(cfg.receiptPaperWidth || 58);
  const fontSize = Math.max(8, Number(cfg.receiptFontSize || 12));
  const offsetX = Number(cfg.receiptOffsetX || 0);
  const offsetY = Number(cfg.receiptOffsetY || 0);
  const kitchenMode = mode === 'kitchen';
  const title = kitchenMode ? '廚房出單' : '顧客收據';
  const createdAt = String(order.createdAt || '').replace('T', ' ').slice(0, 16);
  const rows = (order.items || []).map(item => {
    const unitPrice = Number(item.basePrice || 0) + Number(item.extraPrice || 0);
    const subText = buildSelectionText(item);
    return `
      <div class="item-row">
        <div class="item-top">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-qty">x ${Number(item.qty || 0)}</div>
        </div>
        ${subText ? `<div class="item-sub">${escapeHtml(subText)}</div>` : ''}
        ${kitchenMode ? '' : `<div class="item-sub">${money(unitPrice)} / 小計 ${money(unitPrice * Number(item.qty || 0))}</div>`}
      </div>
    `;
  }).join('');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif; color: #000; }
  .sheet { width: ${widthMm}mm; padding: 4mm; box-sizing: border-box; transform: translate(${offsetX}mm, ${offsetY}mm); font-size: ${fontSize}px; line-height: 1.45; }
  .center { text-align: center; }
  .title { font-size: ${fontSize + 5}px; font-weight: 800; }
  .sub { font-size: ${fontSize - 1}px; margin-top: 2px; }
  .line { border-top: 1px dashed #000; margin: 8px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .item-row { padding: 6px 0; border-bottom: 1px dashed #bbb; }
  .item-top { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; }
  .item-name { flex: 1; }
  .item-qty { white-space: nowrap; }
  .item-sub { margin-top: 3px; font-size: ${fontSize - 1}px; color: #333; }
  .big { font-size: ${fontSize + 2}px; font-weight: 800; }
  .footer { margin-top: 10px; text-align: center; font-size: ${fontSize - 1}px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="center">
      <div class="title">${escapeHtml(cfg.storeName || '餐廳 POS')}</div>
      ${cfg.storePhone ? `<div class="sub">電話：${escapeHtml(cfg.storePhone)}</div>` : ''}
      ${cfg.storeAddress ? `<div class="sub">地址：${escapeHtml(cfg.storeAddress)}</div>` : ''}
      <div class="sub">${escapeHtml(title)}</div>
    </div>
    <div class="line"></div>
    <div class="sub">單號：${escapeHtml(order.orderNo || '')}</div>
    <div class="sub">時間：${escapeHtml(createdAt)}</div>
    <div class="sub">類型：${escapeHtml(order.orderType || '')}${order.tableNo ? ' / ' + escapeHtml(order.tableNo) : ''}</div>
    ${kitchenMode ? '' : `<div class="sub">付款：${escapeHtml(order.paymentMethod || '')}</div>`}
    <div class="line"></div>
    ${rows}
    ${kitchenMode ? '' : `
      <div class="line"></div>
      <div class="row"><span>小計</span><strong>${money(order.subtotal || 0)}</strong></div>
      <div class="row"><span>折扣</span><strong>${money(order.discountAmount || 0)}</strong></div>
      <div class="row big"><span>合計</span><span>${money(order.total || 0)}</span></div>
    `}
    <div class="line"></div>
    <div class="footer">${escapeHtml(cfg.receiptFooter || '')}</div>
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),120);</script>
</body>
</html>`;
}

function buildLabelHtml(order){
  const cfg = ensurePrintConfig();
  const widthMm = Math.max(30, Number(cfg.labelPaperWidth || 60));
  const heightMm = Math.max(20, Number(cfg.labelPaperHeight || 40));
  const fontSize = Math.max(8, Number(cfg.labelFontSize || 12));
  const offsetX = Number(cfg.labelOffsetX || 0);
  const offsetY = Number(cfg.labelOffsetY || 0);

  const labels = (order.items || []).map(item => {
    const subText = buildSelectionText(item);
    return `
      <div class="label">
        <div class="store">${escapeHtml(cfg.storeName || '餐廳 POS')}</div>
        <div class="main">${escapeHtml(item.name)} x ${Number(item.qty || 0)}</div>
        ${subText ? `<div class="sub">${escapeHtml(subText)}</div>` : ''}
        <div class="sub">單號：${escapeHtml(order.orderNo || '')}</div>
        <div class="sub">${escapeHtml(String(order.createdAt || '').replace('T', ' ').slice(0, 16))}</div>
      </div>
    `;
  }).join('');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>商品標籤</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif; color: #000; }
  .label {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    box-sizing: border-box;
    page-break-after: always;
    padding: 3mm;
    transform: translate(${offsetX}mm, ${offsetY}mm);
    font-size: ${fontSize}px;
    line-height: 1.35;
  }
  .store { font-size: ${fontSize - 1}px; font-weight: 700; }
  .main { font-size: ${fontSize + 3}px; font-weight: 800; margin-top: 2mm; }
  .sub { font-size: ${fontSize - 1}px; margin-top: 1mm; }
</style>
</head>
<body>
  ${labels}
  <script>window.onload=()=>setTimeout(()=>window.print(),120);</script>
</body>
</html>`;
}

export function printOrderReceipt(order, mode = 'customer'){
  if(!order) return;
  openPrintWindow(buildReceiptHtml(order, mode));
}

export function printKitchenCopies(order){
  const copies = Math.max(1, Number(ensurePrintConfig().kitchenCopies || 1));
  for(let i = 0; i < copies; i += 1){
    setTimeout(()=> printOrderReceipt(order, 'kitchen'), i * 250);
  }
}

export function printOrderLabels(order){
  if(!order) return;
  openPrintWindow(buildLabelHtml(order));
}

export function buildCartPreviewOrder(){
  const subtotal = state.cart.reduce((sum, item) => sum + ((Number(item.basePrice || 0) + Number(item.extraPrice || 0)) * Number(item.qty || 0)), 0);
  const discountValue = Number(document.getElementById('discountValue')?.value || 0);
  const discountType = state.settings.discountType || 'amount';
  const discountAmount = discountType === 'percent'
    ? Math.floor(subtotal * (discountValue / 100))
    : Math.min(subtotal, discountValue);
  const total = Math.max(0, subtotal - discountAmount);

  return {
    orderNo: 'PREVIEW-' + Date.now(),
    createdAt: new Date().toISOString(),
    orderType: document.getElementById('orderType')?.value || '內用',
    tableNo: document.getElementById('tableNo')?.value?.trim() || '',
    paymentMethod: '未結帳',
    subtotal,
    discountAmount,
    total,
    items: state.cart
  };
}