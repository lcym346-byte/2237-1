/* 中文備註：成本管理模組 v20260515-e
 * 功能：
 *   1. 自動從 state.products 讀取現有菜單，產生成本編輯列表（依分類分組）
 *   2. 成本資料存於 state.settings.costMap[productId] = { cost, updatedAt }
 *      （不跨店共用，跟著本店 state 走，雲端備份會自動帶上）
 *   3. 支援 Excel 匯出 / 匯入（SheetJS 已在 index.html 載入）
 *      匯入以 SKU 為主鍵對應，沒 SKU 才用品名
 *   4. 提供 calcSessionProfit(session) 給 reports-page.js 在班次摘要顯示預估獲利
 *      未設成本之品項從統計中跳過，並回傳 missingItems 清單供 UI 提示
 *   5. modal HTML 動態插入 body，不改 index.html
 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, money } from '../core/utils.js';

const COST_MAP_KEY = 'costMap';

// ──────────────────────────────────────────────
// 資料存取
// ──────────────────────────────────────────────
function ensureCostMap(){
  if(!state.settings) state.settings = {};
  if(!state.settings[COST_MAP_KEY] || typeof state.settings[COST_MAP_KEY] !== 'object'){
    state.settings[COST_MAP_KEY] = {};
  }
  return state.settings[COST_MAP_KEY];
}

function getCost(productId){
  const m = ensureCostMap();
  const r = m[productId];
  return r && typeof r.cost === 'number' ? r.cost : null;  // null 表示未設定
}

function setCost(productId, cost){
  const m = ensureCostMap();
  const n = Number(cost);
  if(!isFinite(n) || n < 0){
    // 0 是合法的（贈品成本可能為 0），但要明確輸入 0；空字串視為「清除」
    delete m[productId];
    return;
  }
  m[productId] = { cost: n, updatedAt: new Date().toISOString() };
}

// ──────────────────────────────────────────────
// 預估獲利計算（供 reports-page.js 在班次摘要顯示）
// 規則：
//   - 只算非作廢訂單的非折扣品項
//   - 用 productId 對應 costMap；未設成本的品項記入 missingItems 並跳過
//   - 回傳 { totalCost, profit, profitRate, missingItems:[{name,qty}] }
// ──────────────────────────────────────────────
export function calcSessionProfit(orders, salesTotal){
  const list = Array.isArray(orders) ? orders : [];
  let totalCost = 0;
  const missingMap = {};  // name -> qty 合計

  list.forEach(o => {
    const status = String(o.status || '').toLowerCase();
    if(status === 'void' || status === 'cancelled' || status === 'refunded') return;
    (o.items || []).forEach(it => {
      if(it.productId === '_discount_') return;
      const qty = Number(it.qty || 0);
      if(qty <= 0) return;
      const c = getCost(it.productId);
      if(c === null){
        const k = it.name || '(未命名)';
        missingMap[k] = (missingMap[k] || 0) + qty;
      } else {
        totalCost += c * qty;
      }
    });
  });

  const sales = Number(salesTotal || 0);
  const profit = sales - totalCost;
  const profitRate = sales > 0 ? (profit / sales) : 0;
  const missingItems = Object.entries(missingMap)
    .sort((a,b) => b[1] - a[1])
    .map(([name, qty]) => ({ name, qty }));

  return { totalCost, profit, profitRate, missingItems };
}

// ──────────────────────────────────────────────
// Modal HTML（動態插入，只插一次）
// ──────────────────────────────────────────────
function ensureModal(){
  let modal = document.getElementById('costManageModal');
  if(modal) return modal;

  modal = document.createElement('div');
  modal.id = 'costManageModal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-backdrop" data-cm-close></div>
        <div class="modal-dialog wide" style="max-width:880px;width:min(94vw,880px);max-height:90vh;padding:0;display:flex;flex-direction:column;overflow:hidden">
      <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #e2e8f0">
        <h2 style="margin:0;font-size:18px">💰 成本管理</h2>
        <button type="button" class="ghost-btn" data-cm-close style="font-size:20px;padding:4px 10px">✕</button>
      </div>

      <div style="padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <input type="text" id="costSearchInput" placeholder="🔍 搜尋品名 / SKU"
          style="flex:1;min-width:180px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">
        <button type="button" id="costExportBtn" class="secondary-btn" style="padding:8px 14px">📥 匯出 Excel</button>
        <button type="button" id="costImportBtn" class="secondary-btn" style="padding:8px 14px">📤 匯入 Excel</button>
        <input type="file" id="costImportFile" accept=".xlsx,.xls,.csv" style="display:none">
        <button type="button" id="costSaveBtn" class="primary-btn" style="padding:8px 14px">💾 儲存</button>
      </div>

      <div id="costSummaryBar" style="padding:8px 16px;background:#eff6ff;border-bottom:1px solid #dbeafe;font-size:13px;color:#1e40af"></div>

      <div id="costListWrap" style="flex:1;overflow:auto;padding:8px 16px"></div>

      <div style="padding:10px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc">
        <button type="button" class="ghost-btn" data-cm-close>關閉</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 綁定關閉
  modal.querySelectorAll('[data-cm-close]').forEach(el => {
    el.addEventListener('click', closeModal);
  });

  // 綁定按鈕
  modal.querySelector('#costExportBtn').addEventListener('click', exportExcel);
  modal.querySelector('#costImportBtn').addEventListener('click', () => {
    modal.querySelector('#costImportFile').click();
  });
  modal.querySelector('#costImportFile').addEventListener('change', handleImportFile);
  modal.querySelector('#costSaveBtn').addEventListener('click', saveAll);
  modal.querySelector('#costSearchInput').addEventListener('input', () => renderList());

  return modal;
}

// ──────────────────────────────────────────────
// 列表渲染
// ──────────────────────────────────────────────
let _draftCosts = {};  // 未儲存的編輯暫存 { productId: number }

function getEffectiveCost(productId){
  if(Object.prototype.hasOwnProperty.call(_draftCosts, productId)){
    return _draftCosts[productId];  // 可能是 null（清空）
  }
  return getCost(productId);
}

function renderList(){
  const modal = ensureModal();
  const wrap = modal.querySelector('#costListWrap');
  const kw = (modal.querySelector('#costSearchInput').value || '').trim().toLowerCase();

  const products = (state.products || []).slice().sort((a,b) => {
    const ca = a.category || '未分類';
    const cb = b.category || '未分類';
    if(ca !== cb) return ca.localeCompare(cb);
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });

  const filtered = products.filter(p => {
    if(!kw) return true;
    return (p.name || '').toLowerCase().includes(kw)
        || (p.sku || '').toLowerCase().includes(kw);
  });

  if(filtered.length === 0){
    wrap.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8">查無資料</div>';
    updateSummary();
    return;
  }

  // 依分類群組
  const groups = {};
  filtered.forEach(p => {
    const c = p.category || '未分類';
    (groups[c] = groups[c] || []).push(p);
  });

  const html = Object.keys(groups).map(cat => `
    <div style="margin-bottom:14px">
      <div style="font-weight:bold;font-size:14px;color:#0f172a;padding:6px 8px;background:#f1f5f9;border-radius:6px;margin-bottom:4px">
        ${escapeHtml(cat)}　<span style="color:#64748b;font-weight:normal">(${groups[cat].length})</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#fafafa;color:#475569">
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;width:90px">SKU</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">品名</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e2e8f0;width:80px">售價</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e2e8f0;width:110px">成本</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e2e8f0;width:80px">毛利</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e2e8f0;width:70px">毛利率</th>
          </tr>
        </thead>
        <tbody>
          ${groups[cat].map(p => rowHtml(p)).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  wrap.innerHTML = html;

  // 綁定每一行的 input
  wrap.querySelectorAll('input[data-cost-pid]').forEach(inp => {
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      const pid = inp.dataset.costPid;
      const v = inp.value.trim();
      if(v === ''){
        _draftCosts[pid] = null;  // 標記為清除
      } else {
        const n = Number(v);
        if(isFinite(n) && n >= 0){
          _draftCosts[pid] = n;
        }
      }
      updateRow(pid);
      updateSummary();
    });
  });

  updateSummary();
}

function rowHtml(p){
  const cost = getEffectiveCost(p.id);
  const price = Number(p.price || 0);
  const hasCost = (cost !== null && cost !== undefined);
  const profit = hasCost ? (price - cost) : null;
  const rate = hasCost && price > 0 ? (profit / price * 100) : null;
  const profitColor = profit === null ? '#94a3b8' : (profit < 0 ? '#dc2626' : '#10b981');

  return `
    <tr data-cost-row="${escapeHtml(p.id)}" style="border-bottom:1px solid #f1f5f9">
      <td style="padding:6px 8px;color:#64748b">${escapeHtml(p.sku || '-')}</td>
      <td style="padding:6px 8px">${escapeHtml(p.name || '')}</td>
      <td style="padding:6px 8px;text-align:right">${money(price)}</td>
      <td style="padding:6px 8px;text-align:right">
        <input type="number" inputmode="decimal" step="0.01" min="0"
          data-cost-pid="${escapeHtml(p.id)}"
          value="${hasCost ? cost : ''}"
          placeholder="未設定"
          style="width:90px;padding:5px 6px;border:1px solid #cbd5e1;border-radius:4px;text-align:right;font-size:13px">
      </td>
      <td style="padding:6px 8px;text-align:right;color:${profitColor}" data-cost-profit>
        ${hasCost ? money(profit) : '—'}
      </td>
      <td style="padding:6px 8px;text-align:right;color:${profitColor}" data-cost-rate>
        ${rate === null ? '—' : rate.toFixed(1) + '%'}
      </td>
    </tr>
  `;
}

function updateRow(pid){
  const modal = ensureModal();
  const row = modal.querySelector(`tr[data-cost-row="${CSS.escape(pid)}"]`);
  if(!row) return;
  const p = (state.products || []).find(x => x.id === pid);
  if(!p) return;
  const cost = getEffectiveCost(pid);
  const price = Number(p.price || 0);
  const hasCost = (cost !== null && cost !== undefined);
  const profit = hasCost ? (price - cost) : null;
  const rate = hasCost && price > 0 ? (profit / price * 100) : null;
  const color = profit === null ? '#94a3b8' : (profit < 0 ? '#dc2626' : '#10b981');

  const pf = row.querySelector('[data-cost-profit]');
  const rt = row.querySelector('[data-cost-rate]');
  if(pf){
    pf.textContent = hasCost ? money(profit) : '—';
    pf.style.color = color;
  }
  if(rt){
    rt.textContent = rate === null ? '—' : rate.toFixed(1) + '%';
    rt.style.color = color;
  }
}

function updateSummary(){
  const modal = ensureModal();
  const bar = modal.querySelector('#costSummaryBar');
  if(!bar) return;
  const products = state.products || [];
  let setCount = 0;
  let totalPrice = 0;
  let totalCost = 0;
  products.forEach(p => {
    const c = getEffectiveCost(p.id);
    if(c !== null && c !== undefined){
      setCount++;
      totalPrice += Number(p.price || 0);
      totalCost += c;
    }
  });
  const missing = products.length - setCount;
  const avgRate = totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice * 100) : 0;
  const dirty = Object.keys(_draftCosts).length > 0;
  bar.innerHTML = `
    共 ${products.length} 項商品　|　已設成本 <strong>${setCount}</strong>　|　未設 <strong style="color:${missing>0?'#dc2626':'#10b981'}">${missing}</strong>
    　|　已設項目平均毛利率 <strong>${avgRate.toFixed(1)}%</strong>
    ${dirty ? '　<span style="color:#f59e0b;font-weight:bold">● 有未儲存的變更</span>' : ''}
  `;
}

// ──────────────────────────────────────────────
// 儲存 / 開關
// ──────────────────────────────────────────────
function saveAll(){
  const changed = Object.keys(_draftCosts).length;
  if(changed === 0){
    alert('沒有變更');
    return;
  }
  Object.keys(_draftCosts).forEach(pid => {
    const v = _draftCosts[pid];
    if(v === null || v === undefined || v === ''){
      // 清除
      const m = ensureCostMap();
      delete m[pid];
    } else {
      setCost(pid, v);
    }
  });
  _draftCosts = {};
  persistAll();
  alert(`✅ 已儲存 ${changed} 項成本變更`);
  renderList();
}

function openModal(){
  const modal = ensureModal();
  _draftCosts = {};
  renderList();
  modal.classList.remove('hidden');
}

function closeModal(){
  const modal = document.getElementById('costManageModal');
  if(!modal) return;
  if(Object.keys(_draftCosts).length > 0){
    if(!confirm('有未儲存的變更，確定關閉？')) return;
    _draftCosts = {};
  }
  modal.classList.add('hidden');
}

export function openCostManageModal(){
  openModal();
}

// ──────────────────────────────────────────────
// Excel 匯出 / 匯入（SheetJS）
// ──────────────────────────────────────────────
function exportExcel(){
  if(typeof XLSX === 'undefined'){
    alert('Excel 函式庫尚未載入');
    return;
  }
  const products = (state.products || []).slice().sort((a,b) => {
    const ca = a.category || '未分類';
    const cb = b.category || '未分類';
    if(ca !== cb) return ca.localeCompare(cb);
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });

  const rows = [['SKU','品名','分類','售價','成本','毛利','毛利率(%)']];
  products.forEach(p => {
    const cost = getEffectiveCost(p.id);
    const price = Number(p.price || 0);
    const hasCost = (cost !== null && cost !== undefined);
    const profit = hasCost ? (price - cost) : '';
    const rate = hasCost && price > 0 ? Number((profit / price * 100).toFixed(2)) : '';
    rows.push([
      p.sku || '',
      p.name || '',
      p.category || '未分類',
      price,
      hasCost ? cost : '',
      profit,
      rate
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:24},{wch:10},{wch:8},{wch:10},{wch:8},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '成本表');

  const storeName = (state.settings?.store?.storeName || 'store').replace(/[\\/:*?"<>|]/g,'');
  const dateStr = new Date().toISOString().slice(0,10);
  const filename = `成本表_${storeName}_${dateStr}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function handleImportFile(ev){
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';  // reset，下次同檔可再選
  if(!file) return;
  if(typeof XLSX === 'undefined'){
    alert('Excel 函式庫尚未載入');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      applyImportedRows(rows);
    }catch(err){
      alert('讀取失敗：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function applyImportedRows(rows){
  if(!Array.isArray(rows) || rows.length < 2){
    alert('檔案內容為空或格式錯誤');
    return;
  }

  // 第一列當表頭，偵測 SKU / 品名 / 成本 欄位位置
  const header = rows[0].map(c => String(c || '').trim());
  const idxSku = header.findIndex(h => /sku/i.test(h));
  const idxName = header.findIndex(h => /品名|名稱|name/i.test(h));
  const idxCost = header.findIndex(h => /成本|cost/i.test(h));

  if(idxCost === -1){
    alert('找不到「成本」欄位，請確認表頭');
    return;
  }
  if(idxSku === -1 && idxName === -1){
    alert('找不到「SKU」或「品名」欄位（至少要有一個用來對應商品）');
    return;
  }

  // 建立對應表
  const products = state.products || [];
  const bySku = {};
  const byName = {};
  products.forEach(p => {
    if(p.sku) bySku[p.sku.toLowerCase()] = p;
    if(p.name) byName[p.name] = p;
  });

  let matched = 0;
  let unmatched = 0;
  const unmatchedList = [];

  for(let i = 1; i < rows.length; i++){
    const r = rows[i];
    if(!r || r.length === 0) continue;
    const sku = idxSku >= 0 ? String(r[idxSku] || '').trim() : '';
    const name = idxName >= 0 ? String(r[idxName] || '').trim() : '';
    const costRaw = r[idxCost];
    if(costRaw === '' || costRaw === null || costRaw === undefined) continue;

    const cost = Number(costRaw);
    if(!isFinite(cost) || cost < 0) continue;

    let p = null;
    if(sku && bySku[sku.toLowerCase()]) p = bySku[sku.toLowerCase()];
    else if(name && byName[name]) p = byName[name];

    if(p){
      _draftCosts[p.id] = cost;
      matched++;
    } else {
      unmatched++;
      unmatchedList.push(sku || name || `(列 ${i+1})`);
    }
  }

  renderList();
  let msg = `✅ 已套用 ${matched} 項成本（尚未儲存，請按「💾 儲存」確認）`;
  if(unmatched > 0){
    msg += `\n\n⚠️ ${unmatched} 項對不到商品：\n` + unmatchedList.slice(0, 10).join('、');
    if(unmatched > 10) msg += `\n…等共 ${unmatched} 項`;
  }
  alert(msg);
}
