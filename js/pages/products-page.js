/* 中文備註：商品管理頁程式（Batch 06.13/A，分類列表移除 ▲▼ 排序按鈕）。 */

import { state, persistAll } from '../core/store.js';
import { escapeHtml, escapeAttr, money, id, deepCopy } from '../core/utils.js';
import { openCategoryManage, closeCategoryManage, renderCategoryManage, saveCategoryManage } from '../modules/product-category-manager.js';
import { openModuleManage, closeModuleManage, renderModuleManage, saveModuleManage } from '../modules/product-module-manager.js';
import { syncMenuToFirebase, getRealtimeConfig } from '../modules/realtime-order-service.js';

// 主機自動推送雲端：從機呼叫不會丟錯，只 console
function autoPushIfMaster(){
  try{
    const cfg = getRealtimeConfig();
    if(cfg.deviceRole !== 'master') return;
    if(!cfg.enabled) return;
    syncMenuToFirebase().catch(err => console.warn('autoPush 失敗：', err.message));
  }catch(e){ console.warn('autoPush exception:', e); }
}

function getProductModuleNames(product){
  return (product.modules||[]).map(a=> state.modules.find(m=>m.id===a.moduleId)?.name).filter(Boolean);
}

function renderProductImagePreview(imageData){
  const preview = document.getElementById('productImagePreview');
  if(!preview) return;
  if(imageData){
    preview.innerHTML = `<img src="${escapeAttr(imageData)}" alt="商品圖片預覽" class="product-form-image">`;
    preview.classList.remove('muted');
  }else{
    preview.textContent = '尚未上傳圖片';
    preview.classList.add('muted');
  }
}

function readImageFileAsDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataURL(dataUrl){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function optimizeProductImage(file){
  const rawDataUrl = await readImageFileAsDataURL(file);
  const image = await loadImageFromDataURL(rawDataUrl);
  const sourceSize = Math.min(image.width, image.height);
  const sx = Math.max(0, Math.floor((image.width - sourceSize) / 2));
  const sy = Math.max(0, Math.floor((image.height - sourceSize) / 2));
  const targetSize = 900;
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, targetSize, targetSize);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function getProductFormElements(){
  return {
    nameInput: document.getElementById('productName'),
    priceInput: document.getElementById('productPrice'),
    nameError: document.getElementById('productNameError'),
    priceError: document.getElementById('productPriceError'),
    saveBtn: document.querySelector('#productForm button[type="submit"]')
  };
}
function validateProductForm(showMessage = false){
  const { nameInput, priceInput, nameError, priceError, saveBtn } = getProductFormElements();
  if(!nameInput || !priceInput) return { valid: false, nameOk: false, priceOk: false };
  const name = nameInput.value.trim();
  const rawPrice = priceInput.value;
  const price = Number(rawPrice);
  const nameOk = !!name;
  const priceOk = rawPrice !== '' && !Number.isNaN(price) && price > 0;
  nameInput.classList.toggle('input-error', !nameOk && showMessage);
  priceInput.classList.toggle('input-error', !priceOk && showMessage);
  if(nameError) nameError.classList.toggle('hidden', nameOk || !showMessage);
  if(priceError) priceError.classList.toggle('hidden', priceOk || !showMessage);
  if(saveBtn){
    saveBtn.disabled = !(nameOk && priceOk);
    saveBtn.style.opacity = nameOk && priceOk ? '1' : '0.5';
  }
  return { valid: nameOk && priceOk, nameOk, priceOk };
}
function focusFirstInvalidField(result){
  const { nameInput, priceInput } = getProductFormElements();
  if(!result.nameOk && nameInput) return nameInput.focus();
  if(!result.priceOk && priceInput) return priceInput.focus();
}

function createExcelTemplateRows(){
  return [
    { 商品名稱:'紅茶', 價格:30, 分類:'飲料', 狀態:'啟用' },
    { 商品名稱:'奶茶', 價格:45, 分類:'飲料', 狀態:'啟用' },
    { 商品名稱:'雞排', 價格:80, 分類:'炸物', 狀態:'啟用' }
  ];
}
function buildWorkbookFromRows(rows){
  if(!window.XLSX) throw new Error('XLSX library not loaded');
  const workbook = window.XLSX.utils.book_new();
  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  window.XLSX.utils.book_append_sheet(workbook, worksheet, '菜單');
  return workbook;
}
function workbookToBlob(workbook){
  const buffer = window.XLSX.write(workbook, { bookType:'xlsx', type:'array' });
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(()=> URL.revokeObjectURL(url), 1200);
}
function normalizeImportedRow(row){
  const name = String(row['商品名稱'] ?? row['名稱'] ?? row['name'] ?? row['Name'] ?? '').trim();
  const price = Number(row['價格'] ?? row['售價'] ?? row['price'] ?? row['Price'] ?? 0);
  const category = String(row['分類'] ?? row['category'] ?? row['Category'] ?? '未分類').trim() || '未分類';
  const enabledText = String(row['狀態'] ?? row['啟用'] ?? row['enabled'] ?? '啟用').trim();
  const enabled = !['false', '停用', '0', '關閉'].includes(enabledText);
  return { name, price, category, enabled };
}
function importExcelRowsToPending(rows){
  const imported = [];
  rows.forEach(raw => {
    const item = normalizeImportedRow(raw);
    if(!item.name) return;
    if(!(item.price > 0)) return;
    const exists = (state.pendingProducts||[]).some(p => p.name === item.name && Number(p.price) === Number(item.price))
      || state.products.some(p => p.name === item.name && Number(p.price) === Number(item.price));
    if(exists) return;
    imported.push({
      id: id(), name: item.name, price: item.price,
      category: item.category || '未分類', enabled: item.enabled,
      modules: [], image: '',
      sortOrder: state.products.length + imported.length, status: 'pending'
    });
  });
  if(!imported.length){ alert('Excel 沒有可匯入的新資料'); return; }
  if(!Array.isArray(state.pendingProducts)) state.pendingProducts = [];
  state.pendingProducts.unshift(...imported);
  document.getElementById('pendingMenuPanel')?.removeAttribute('hidden');
  persistAll();
  window.refreshAllViews();
  alert(`已匯入 ${imported.length} 筆到待上架商品`);
}
async function importExcelFile(file){
  if(!window.XLSX){ alert('Excel 套件尚未載入，請重新整理'); return; }
  const arrayBuffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(arrayBuffer, { type:'array' });
  const firstSheetName = workbook.SheetNames[0];
  if(!firstSheetName){ alert('Excel 內沒有工作表'); return; }
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = window.XLSX.utils.sheet_to_json(worksheet, { defval:'' });
  importExcelRowsToPending(rows);
}

export function renderCategoryOptions(){
  const sel = document.getElementById('productCategory');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = (state.categories || []).map(c=> `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if((state.categories || []).includes(current)) sel.value = current;
}

export function renderCategoryList(){
  const wrap = document.getElementById('categoryList');
  if(!wrap) return;
  const uncategorized = (state.products || []).filter(p => !p.category || p.category === '未分類');
  wrap.innerHTML = '';
  const uncatCard = document.createElement('div');
  uncatCard.className = 'entity-card warning';
  uncatCard.innerHTML = `<strong>未分類</strong><div class="meta">${uncategorized.length} 筆商品</div>`;
  wrap.appendChild(uncatCard);

  (state.categories || []).filter(cat => cat !== '未分類').forEach(cat=>{
    const count = (state.products || []).filter(p=>p.category===cat).length;
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `<strong>${escapeHtml(cat)}</strong><div class="meta">${count} 筆商品</div><div class="card-actions"><button class="manage">管理</button><button class="rename">改名</button><button class="delete">刪除</button></div>`;
    card.querySelector('.manage').onclick = ()=> openCategoryManage && openCategoryManage(cat);
    card.querySelector('.rename').onclick = ()=>{
      const nv = prompt('輸入新分類名稱', cat);
      if(!nv || nv.trim()===cat) return;
      if(state.categories.includes(nv.trim())) return alert('分類已存在');
      state.categories = state.categories.map(c=> c===cat ? nv.trim() : c);
      state.products.forEach(p=>{ if(p.category===cat) p.category = nv.trim(); });
      persistAll(); window.refreshAllViews();
    };
    card.querySelector('.delete').onclick = ()=>{
      if(!confirm(`確定刪除分類「${cat}」？`)) return;
      state.categories = state.categories.filter(c=>c!==cat);
      state.products.forEach(p=>{ if(p.category===cat) p.category = '未分類'; });
      if(state.settings && state.settings.selectedCategory===cat) state.settings.selectedCategory='全部';
      persistAll(); window.refreshAllViews();
    };
    wrap.appendChild(card);
  });
}

export function renderModuleSelect(){
  const sel = document.getElementById('moduleSelect');
  if(!sel) return;
  sel.innerHTML = (state.modules || []).map(m=> `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
}

function renderModuleEditorOptions(optWrap, mod, expandModuleId){
  if(!optWrap) return;
  optWrap.innerHTML = '';
  (mod.options || []).forEach((opt, index)=>{
    const row = document.createElement('div');
    row.className = 'option-edit-row';
    row.innerHTML = `<input value="${escapeAttr(opt.name)}" placeholder="選項名稱"><input type="number" min="0" value="${Number(opt.price||0)}" placeholder="加價"><button type="button" class="secondary-btn small-btn">${opt.enabled!==false ? '啟用中' : '已停用'}</button><button type="button" class="danger-btn small-btn">刪除</button>`;
    const [n,p,t,d] = row.querySelectorAll('input,button');
    n.oninput = ()=> opt.name = n.value;
    p.oninput = ()=> opt.price = Number(p.value||0);
    t.onclick = ()=>{ opt.enabled = !(opt.enabled!==false); renderModuleLibrary(expandModuleId); };
    d.onclick = ()=>{ mod.options.splice(index,1); renderModuleLibrary(expandModuleId); };
    optWrap.appendChild(row);
  });
}

export function renderModuleLibrary(expandModuleId=''){
  const wrap = document.getElementById('moduleLibrary');
  if(!wrap) return;
  wrap.innerHTML = '';
  (state.modules || []).forEach(mod=>{
    const usedCount = (state.products || []).filter(p=> (p.modules||[]).some(a=>a.moduleId===mod.id)).length;
    const isOpen = expandModuleId === mod.id;
    const card = document.createElement('div');
    card.className = 'module-card';
    card.innerHTML = `<strong>${escapeHtml(mod.name)}</strong><div class="meta">${mod.selection==='multi'?'多選':'單選'} ・ ${mod.required?'必選':'非必選'} ・ ${usedCount} 商品</div><div class="card-actions"><button class="apply">套用</button><button class="edit">${isOpen?'收合':'編輯'}</button><button class="delete">刪除</button></div>${isOpen ? '<div class="module-expand"></div>' : ''}`;
    card.querySelector('.apply').onclick = ()=> openModuleManage && openModuleManage(mod.id);
    card.querySelector('.edit').onclick = ()=> renderModuleLibrary(isOpen ? '' : mod.id);
    card.querySelector('.delete').onclick = ()=>{
      if(!confirm(`確定刪除模組「${mod.name}」？`)) return;
      state.modules = state.modules.filter(m=>m.id!==mod.id);
      state.products.forEach(p=> p.modules = (p.modules||[]).filter(a=>a.moduleId!==mod.id));
      persistAll(); window.refreshAllViews();
    };
    if(isOpen){
      const expandDiv = card.querySelector('.module-expand');
      expandDiv.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label style="font-size:12px">模組名稱</label><input class="module-name" value="${escapeAttr(mod.name)}" style="width:100%;padding:6px;border:1px solid #e2e8f0;border-radius:8px"></div><div><label style="font-size:12px">規則</label><select class="module-selection" style="width:100%;padding:6px;border:1px solid #e2e8f0;border-radius:8px"><option value="single" ${mod.selection==='single'?'selected':''}>單選</option><option value="multi" ${mod.selection==='multi'?'selected':''}>多選</option></select></div></div><div class="switch-row"><span style="font-size:12px">必選</span><button type="button" class="switch ${mod.required?'on':''}">${mod.required?'開':'關'}</button></div><div class="module-options-list"></div><button type="button" class="secondary-btn small-btn" style="margin-top:6px;font-size:11px">新增子選項</button>`;
      const nameInput = expandDiv.querySelector('.module-name');
      const selectionSel = expandDiv.querySelector('.module-selection');
      const switchBtn = expandDiv.querySelector('.switch');
      nameInput.oninput = ()=>{ mod.name = nameInput.value; renderModuleSelect(); };
      selectionSel.onchange = ()=>{ mod.selection = selectionSel.value; renderModuleLibrary(mod.id); };
      switchBtn.onclick = ()=>{ mod.required = !mod.required; renderModuleLibrary(mod.id); };
      renderModuleEditorOptions(expandDiv.querySelector('.module-options-list'), mod, mod.id);
      expandDiv.querySelector('button:last-child').onclick = ()=>{ mod.options.push({id:id(), name:'', price:0, enabled:true}); renderModuleLibrary(mod.id); };
    }
    wrap.appendChild(card);
  });
}

export function renderProductModulesEditor(){
  const wrap = document.getElementById('productModulesEditor');
  if(!wrap) return;
  if(!Array.isArray(state.editModules)) state.editModules = [];
  wrap.innerHTML = '';
  if(!state.editModules.length){ wrap.innerHTML = '<div class="muted">尚未套用口味模組</div>'; return; }
  state.editModules.forEach((att, index)=>{
    const mod = (state.modules || []).find(m=>m.id===att.moduleId);
    if(!mod) return;
    const effectiveRequired = att.requiredOverride === null ? mod.required : att.requiredOverride;
    const block = document.createElement('div');
    block.className = 'attached-module';
    block.innerHTML = `<div class="row between wrap"><div><strong>${escapeHtml(mod.name)}</strong><div class="muted">${mod.selection==='multi'?'多選':'單選'} ・ 目前${effectiveRequired?'必選':'非必選'}</div></div><div class="row gap wrap"><select><option value="">沿用模組預設</option><option value="true" ${att.requiredOverride===true?'selected':''}>強制必選</option><option value="false" ${att.requiredOverride===false?'selected':''}>改為非必選</option></select><button type="button" class="danger-btn small-btn">移除</button></div></div>`;
    const [overrideSel, removeBtn] = block.querySelectorAll('select,button');
    overrideSel.onchange = ()=>{ att.requiredOverride = overrideSel.value === '' ? null : overrideSel.value === 'true'; renderProductModulesEditor(); };
    removeBtn.onclick = ()=>{ state.editModules.splice(index,1); renderProductModulesEditor(); };
    wrap.appendChild(block);
  });
}

function moveProduct(productId, direction){
  const list = [...(state.products || [])].sort((a,b)=>a.sortOrder-b.sortOrder);
  const idx = list.findIndex(p=>p.id===productId);
  if(idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if(swapIdx < 0 || swapIdx >= list.length) return;
  const a = list[idx], b = list[swapIdx], temp = a.sortOrder;
  a.sortOrder = b.sortOrder; b.sortOrder = temp;
  state.products.sort((x,y)=>x.sortOrder-y.sortOrder);
  persistAll(); renderProductsTable();
  if(window.refreshPublicProducts) window.refreshPublicProducts();
}

export function renderPendingMenuList(){
  const wrap = document.getElementById('pendingMenuList');
  const panel = document.getElementById('pendingMenuPanel');
  if(wrap){
    wrap.innerHTML = '';
    const list = state.pendingProducts || [];
    if(!list.length){
      if(panel) panel.setAttribute('hidden', '');
    } else {
      if(panel) panel.removeAttribute('hidden');
      list.forEach(item=>{
        const row = document.createElement('div');
        row.className = 'pending-card';
        row.innerHTML = `<div class="pending-main"><div class="row between wrap"><div><strong>${escapeHtml(item.name || '')}</strong><span class="tag">${escapeHtml(item.category || '未分類')}</span></div><span class="badge pending">待處理</span></div></div>`;
        wrap.appendChild(row);
      });
    }
  }
  updatePendingCountLabel();
}

export function renderProductsTable(){
  const wrap = document.getElementById('productTable');
  if(!wrap) return;
  (state.products || []).sort((a,b)=>a.sortOrder-b.sortOrder);

  const keyword = (document.getElementById('productSearchTop')?.value || '').trim().toLowerCase();
  const filtered = (state.products || []).filter(p=>{
    if(!keyword) return true;
    return [p.name, p.category].join(' ').toLowerCase().includes(keyword);
  });

  const countLbl = document.getElementById('productCountLabel');
  if(countLbl) countLbl.textContent = `共 ${filtered.length} 筆 / 全部 ${(state.products||[]).length} 筆`;

  wrap.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'product-grid';
  wrap.appendChild(grid);

  if(!filtered.length){
    grid.innerHTML = '<div class="muted" style="grid-column:1/-1;padding:20px;text-align:center">沒有符合的商品</div>';
    return;
  }
  filtered.forEach((p)=>{
    const card = document.createElement('div');
    card.className = 'product-card' + (p.enabled===false ? ' disabled' : '');
    const modNames = getProductModuleNames(p);
    card.innerHTML = `${p.image ? `<img class="card-thumb" src="${escapeAttr(p.image)}">` : '<div class="card-thumb-placeholder">📷</div>'}
      <div class="card-line1"><span class="card-name">${escapeHtml(p.name)}</span><span class="card-price">${money(p.price)}</span></div>
      <div class="card-line2"><span class="card-cat">${escapeHtml(p.category)}</span>${modNames.length ? `<span class="card-mods">${escapeHtml(modNames.join('、'))}</span>` : ''}</div>
      <div class="card-status">
        <span class="status ${p.enabled===false?'off':'on'}">${p.enabled===false?'已下架':'上架中'}</span>
      </div>
      <div class="card-actions">
        <button class="move-up">▲</button>
        <button class="move-down">▼</button>
        <button class="edit">編輯</button>
        <button class="toggle">${p.enabled===false?'上架':'下架'}</button>
        <button class="delete">刪除</button>
      </div>`;



        card.querySelector('.move-up').onclick = ()=> { moveProduct(p.id, 'up'); autoPushIfMaster(); };
    card.querySelector('.move-down').onclick = ()=> { moveProduct(p.id, 'down'); autoPushIfMaster(); };
    card.querySelector('.edit').onclick = ()=> openProductEditModal(p);
    card.querySelector('.toggle').onclick = ()=>{
      p.enabled = !(p.enabled!==false);
      persistAll(); renderProductsTable();
      if(window.refreshPublicProducts) window.refreshPublicProducts();
      autoPushIfMaster();
    };
    
    card.querySelector('.delete').onclick = ()=>{
      if(!confirm(`確定刪除「${p.name}」？`)) return;
      state.products = state.products.filter(x=>x.id!==p.id);
      persistAll(); renderProductsTable();
      if(window.refreshPublicProducts) window.refreshPublicProducts();
      autoPushIfMaster();
    };
    grid.appendChild(card);

  });
}

export function resetProductForm(){
  const idEl = document.getElementById('productId');
  const nameEl = document.getElementById('productName');
  const priceEl = document.getElementById('productPrice');
  const imgDataEl = document.getElementById('productImageData');
  const imgInputEl = document.getElementById('productImageInput');
  const enabledEl = document.getElementById('productEnabled');
  const catEl = document.getElementById('productCategory');
  if(idEl) idEl.value = '';
  if(nameEl) nameEl.value = '';
  if(priceEl) priceEl.value = '';
  const descEl = document.getElementById('productDescription');
  if(descEl) descEl.value = '';

  if(imgDataEl) imgDataEl.value = '';
  if(imgInputEl) imgInputEl.value = '';
  if(enabledEl) enabledEl.value = 'true';
  renderCategoryOptions();
  if(catEl) catEl.value = '未分類';
  state.editModules = [];
  renderProductImagePreview('');
  renderProductModulesEditor();
  validateProductForm(false);
  bindFormButtonsState();
}

function bindFormButtonsState(){
  const idEl = document.getElementById('productId');
  const btn = document.getElementById('deleteProductBtn');
  if(!idEl || !btn) return;
  const hasId = !!idEl.value;
  btn.disabled = !hasId;
  btn.style.opacity = hasId ? '1' : '0.5';
}

function openProductForm(product){
  const idEl = document.getElementById('productId');
  if(!idEl) return;
  idEl.value = product.id;
  document.getElementById('productName').value = product.name;
  document.getElementById('productPrice').value = product.price;
  const descEl2 = document.getElementById('productDescription');
  if(descEl2) descEl2.value = product.description || '';

  const imgData = document.getElementById('productImageData');
  if(imgData) imgData.value = product.image || '';
  const imgInput = document.getElementById('productImageInput');
  if(imgInput) imgInput.value = '';
  renderProductImagePreview(product.image || '');
  document.getElementById('productEnabled').value = String(product.enabled!==false);
  renderCategoryOptions();
  document.getElementById('productCategory').value = product.category || '未分類';
  state.editModules = deepCopy(product.modules||[]);
  renderModuleSelect();
  renderProductModulesEditor();
  validateProductForm(false);
  bindFormButtonsState();
}

function openProductEditModal(product){
  const modal = document.getElementById('productEditModal');
  const title = document.getElementById('productEditModalTitle');
  if(!modal) return;
  if(product){
    if(title) title.textContent = '編輯商品';
    openProductForm(product);
  } else {
    if(title) title.textContent = '新增商品';
    resetProductForm();
    renderModuleSelect();
  }
  modal.style.display = 'flex';
}

function closeProductEditModal(){
  const modal = document.getElementById('productEditModal');
  if(modal) modal.style.display = 'none';
  resetProductForm();
}

// ============================================================
// 分類列表彈窗（Batch 06.13/A：移除 ▲▼ 排序按鈕）
// ============================================================
function ensureCategoryListModal(){
  let el = document.getElementById('__categoryListDynamicModal');
  if(el) return el;
  el = document.createElement('div');
  el.id = '__categoryListDynamicModal';
  el.className = 'dyn-modal-backdrop';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="dyn-modal">
      <div class="dyn-head">
        <h3>分類管理</h3>
        <button class="btn small" data-act="close">✕</button>
      </div>
      <div class="dyn-body">
        <div style="margin-bottom:10px"><button class="btn primary" data-act="add">＋ 新增分類</button></div>
        <div id="__categoryListBody"></div>
      </div>
      <div class="dyn-foot">
        <span style="flex:1"></span>
        <button class="btn" data-act="close">關閉</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e)=>{
    if(e.target === el){ el.style.display='none'; return; }
    const act = e.target.getAttribute('data-act');
    if(!act) return;
    if(act === 'close') el.style.display='none';
    else if(act === 'add'){
      const name = prompt('請輸入新分類名稱');
      if(!name) return;
      const t = name.trim();
      if(!t) return;
      if(state.categories.includes(t)) return alert('分類已存在');
      state.categories.push(t);
      persistAll(); renderCategoryListModal(); window.refreshAllViews();
    }
  });
  return el;
}
function renderCategoryListModal(){
  const body = document.getElementById('__categoryListBody');
  if(!body) return;
  body.innerHTML = '';
  const cats = state.categories || [];

  cats.forEach((cat, idx)=>{
    const count = (state.products||[]).filter(p=>p.category===cat).length;
    const isUncat = cat === '未分類';
    const isFirst = idx === 0;
    const isLast  = idx === cats.length - 1;

    const card = document.createElement('div');
    card.className = 'entity-card' + (isUncat ? ' warning' : '');
    card.innerHTML = `
      <strong>${escapeHtml(cat)}</strong>
      <div class="meta">${count} 筆商品</div>
      <div class="card-actions">
        <button class="move up" ${isFirst?'disabled':''}>▲</button>
        <button class="move down" ${isLast?'disabled':''}>▼</button>
        <button class="manage">編輯</button>
        ${!isUncat ? '<button class="rename">改名</button><button class="delete">刪除</button>' : ''}
      </div>`;

    const upBtn = card.querySelector('.move.up');
    const downBtn = card.querySelector('.move.down');
    if(upBtn && !isFirst) upBtn.onclick = ()=>{
      const arr = state.categories;
      [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
      persistAll(); renderCategoryListModal(); window.refreshAllViews();
    };
    if(downBtn && !isLast) downBtn.onclick = ()=>{
      const arr = state.categories;
      [arr[idx+1], arr[idx]] = [arr[idx], arr[idx+1]];
      persistAll(); renderCategoryListModal(); window.refreshAllViews();
    };

    card.querySelector('.manage').onclick = ()=>{
      document.getElementById('__categoryListDynamicModal').style.display='none';
      openCategoryManage && openCategoryManage(cat);
    };

    if(!isUncat){
      card.querySelector('.rename').onclick = ()=>{
        const nv = prompt('輸入新分類名稱', cat);
        if(!nv || nv.trim()===cat) return;
        const t = nv.trim();
        if(!t) return;
        if(state.categories.includes(t)) return alert('分類已存在');
        state.categories = state.categories.map(c=> c===cat ? t : c);
        state.products.forEach(p=>{ if(p.category===cat) p.category = t; });
        persistAll(); renderCategoryListModal(); window.refreshAllViews();
      };
      card.querySelector('.delete').onclick = ()=>{
        if(!confirm(`確定刪除分類「${cat}」？此分類下商品將改為未分類`)) return;
        state.categories = state.categories.filter(c=>c!==cat);
        state.products.forEach(p=>{ if(p.category===cat) p.category = '未分類'; });
        persistAll(); renderCategoryListModal(); window.refreshAllViews();
      };
    }
    body.appendChild(card);
  });
}


function openCategoryListModal(){
  ensureCategoryListModal();
  renderCategoryListModal();
  document.getElementById('__categoryListDynamicModal').style.display='flex';
}

// ============================================================
// 模組列表彈窗（保留 ▲▼ 排序）
// ============================================================
function ensureModuleListModal(){
  let el = document.getElementById('__moduleListDynamicModal');
  if(el) return el;
  el = document.createElement('div');
  el.id = '__moduleListDynamicModal';
  el.className = 'dyn-modal-backdrop';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="dyn-modal">
      <div class="dyn-head">
        <h3>模組管理</h3>
        <button class="btn small" data-act="close">✕</button>
      </div>
      <div class="dyn-body">
        <div style="margin-bottom:10px"><button class="btn primary" data-act="add">＋ 新增模組</button></div>
        <div id="__moduleListBody"></div>
      </div>
      <div class="dyn-foot">
        <span style="flex:1"></span>
        <button class="btn" data-act="close">關閉</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e)=>{
    if(e.target === el){ el.style.display='none'; return; }
    const act = e.target.getAttribute('data-act');
    if(!act) return;
    if(act === 'close') el.style.display='none';
    else if(act === 'add'){
      const name = prompt('請輸入新模組名稱（例如：甜度、冰量）');
      if(!name) return;
      const t = name.trim();
      if(!t) return;
      state.modules.push({id:id(), name:t, selection:'single', required:true, options:[]});
      persistAll(); renderModuleListModal(); window.refreshAllViews();
    }
  });
  return el;
}
function renderModuleListModal(){
  const body = document.getElementById('__moduleListBody');
  if(!body) return;
  body.innerHTML = '';
  const mods = state.modules || [];
  mods.forEach((mod, idx)=>{
    const usedCount = (state.products||[]).filter(p=> (p.modules||[]).some(a=>a && a.moduleId===mod.id)).length;
    const isFirst = idx === 0;
    const isLast = idx === mods.length - 1;
    const card = document.createElement('div');
    card.className = 'module-card';
    card.innerHTML = `
      <strong>${escapeHtml(mod.name)}</strong>
      <div class="meta">${mod.selection==='multi'?'多選':'單選'} ・ ${mod.required?'必選':'非必選'} ・ ${usedCount} 商品</div>
      <div class="card-actions">
        <button class="move up" ${isFirst?'disabled':''}>▲</button>
        <button class="move down" ${isLast?'disabled':''}>▼</button>
        <button class="edit">編輯</button>
        <button class="delete">刪除</button>
      </div>`;
    const upBtn = card.querySelector('.move.up');
    const downBtn = card.querySelector('.move.down');
    if(upBtn && !isFirst) upBtn.onclick = ()=>{
      const arr = state.modules;
      [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
      persistAll(); renderModuleListModal(); window.refreshAllViews();
    };
    if(downBtn && !isLast) downBtn.onclick = ()=>{
      const arr = state.modules;
      [arr[idx+1], arr[idx]] = [arr[idx], arr[idx+1]];
      persistAll(); renderModuleListModal(); window.refreshAllViews();
    };
    card.querySelector('.edit').onclick = ()=>{
      document.getElementById('__moduleListDynamicModal').style.display='none';
      openModuleManage && openModuleManage(mod.id);
    };
    card.querySelector('.delete').onclick = ()=>{
      if(!confirm(`確定刪除模組「${mod.name}」？所有商品身上的此模組將被移除`)) return;
      state.modules = state.modules.filter(m=>m.id!==mod.id);
      state.products.forEach(p=> p.modules = (p.modules||[]).filter(a=>a && a.moduleId!==mod.id));
      persistAll(); renderModuleListModal(); window.refreshAllViews();
    };
    body.appendChild(card);
  });
}

function openModuleListModal(){
  ensureModuleListModal();
  renderModuleListModal();
  document.getElementById('__moduleListDynamicModal').style.display='flex';
}

// ============================================================
// 待上架商品彈窗
// ============================================================
function ensurePendingModal(){
  let el = document.getElementById('__pendingDynamicModal');
  if(el) return el;
  el = document.createElement('div');
  el.id = '__pendingDynamicModal';
  el.className = 'dyn-modal-backdrop';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="dyn-modal">
      <div class="dyn-head">
        <h3>待上架商品</h3>
        <button class="btn small" data-act="close">✕</button>
      </div>
      <div class="dyn-body" id="__pendingDynamicBody"></div>
      <div class="dyn-foot">
        <button class="btn danger" data-act="discard">捨棄全部</button>
        <span style="flex:1"></span>
        <button class="btn" data-act="close">關閉</button>
        <button class="btn primary" data-act="apply">套用全部</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e)=>{
    if(e.target === el){ el.style.display='none'; return; }
    const act = e.target.getAttribute('data-act');
    if(!act) return;
    if(act === 'close') el.style.display='none';
    else if(act === 'apply'){
      const list = state.pendingProducts || [];
      if(!list.length) return alert('沒有待上架商品');
      let applied = 0;
      list.slice().forEach(item=>{
        const name = (item.name||'').trim();
        const price = Number(item.price||0);
        if(!name || !(price > 0)) return;
        state.products.push({
          id:item.id||id(), name, price,
          category:item.category||'未分類',
          enabled:item.enabled!==false,
          image:item.image||'',
          modules:item.modules||[],
          sortOrder:state.products.length
        });
        state.pendingProducts = state.pendingProducts.filter(x=>x.id !== item.id);
        applied++;
      });
      state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((p,i)=> p.sortOrder = i);
      persistAll(); window.refreshAllViews();
      alert(`已套用 ${applied} 筆`);
      renderPendingModal();
      updatePendingCountLabel();
    }
    else if(act === 'discard'){
      if(!(state.pendingProducts||[]).length) return;
      if(!confirm('確定捨棄全部待上架商品？')) return;
      state.pendingProducts = [];
      persistAll(); window.refreshAllViews();
      renderPendingModal();
      updatePendingCountLabel();
    }
  });
  return el;
}
function renderPendingModal(){
  const body = document.getElementById('__pendingDynamicBody');
  if(!body) return;
  const list = state.pendingProducts || [];
  if(!list.length){
    body.innerHTML = '<div class="muted" style="padding:20px;text-align:center">目前沒有待上架商品</div>';
    return;
  }
  body.innerHTML = '';
  list.forEach(item=>{
    const row = document.createElement('div');
    row.className = 'pending-card';
    row.innerHTML = `
      <div class="row"><strong>${escapeHtml(item.name||'')}</strong><span class="tag">${escapeHtml(item.category||'未分類')}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div><label>品項名稱</label><input class="pending-name" value="${escapeAttr(item.name||'')}"></div>
        <div><label>價格</label><input class="pending-price" type="number" min="0" value="${Number(item.price||0)}"></div>
      </div>
      <div class="row gap wrap" style="margin-top:10px">
        <button type="button" class="btn primary approve-btn">確認加入菜單</button>
        <button type="button" class="btn danger delete-btn">刪除</button>
      </div>`;
    const nameInput = row.querySelector('.pending-name');
    const priceInput = row.querySelector('.pending-price');
    nameInput.addEventListener('input', ()=>{ item.name = nameInput.value; persistAll(); });
    priceInput.addEventListener('input', ()=>{ item.price = Number(priceInput.value||0); persistAll(); });
    row.querySelector('.approve-btn').onclick = ()=>{
      const name = (item.name||'').trim();
      const price = Number(item.price||0);
      if(!name) return alert('請先輸入品項名稱');
      if(!price || price <= 0) return alert('請先輸入正確價格');
      state.products.push({
        id:item.id||id(), name, price,
        category:item.category||'未分類',
        enabled:true, image:item.image||'',
        modules:item.modules||[],
        sortOrder:state.products.length
      });
      state.pendingProducts = state.pendingProducts.filter(x=>x.id !== item.id);
      state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((p,i)=> p.sortOrder = i);
      persistAll(); window.refreshAllViews();
      renderPendingModal();
      updatePendingCountLabel();
    };
    row.querySelector('.delete-btn').onclick = ()=>{
      state.pendingProducts = state.pendingProducts.filter(x=>x.id !== item.id);
      persistAll(); renderPendingModal(); updatePendingCountLabel();
      window.refreshAllViews();
    };
    body.appendChild(row);
  });
}
function openPendingModal(){
  ensurePendingModal();
  renderPendingModal();
  document.getElementById('__pendingDynamicModal').style.display='flex';
}
function updatePendingCountLabel(){
  const lbl = document.getElementById('pendingCountLabel');
  const btn = document.getElementById('openPendingBtn');
  const count = (state.pendingProducts||[]).length;
  if(lbl) lbl.textContent = count;
  if(btn){
    btn.disabled = count === 0;
    btn.style.opacity = count === 0 ? '0.5' : '1';
  }
}

// ============================================================
// 雲端同步菜單（與設定頁一致：上傳 + 讀取 + 從機鎖）
// ============================================================
function applyProductsRoleLock(){
  const cfg = (typeof getRealtimeConfig === 'function') ? getRealtimeConfig() : {};
  const isSlave = cfg.deviceRole === 'slave';
  const upBtn = document.getElementById('syncMenuBtnProducts');

  if(upBtn){
    upBtn.disabled = isSlave;
    upBtn.style.opacity = isSlave ? '0.5' : '1';
    upBtn.style.cursor = isSlave ? 'not-allowed' : 'pointer';
    upBtn.title = isSlave ? '從機僅能讀取，無法上傳' : '';
    upBtn.textContent = isSlave ? '⬆ 從機僅讀取' : '⬆ 上傳';
  }
}

async function syncMenuHandler(btn){
  const cfg = (typeof getRealtimeConfig === 'function') ? getRealtimeConfig() : {};
  if(cfg.deviceRole === 'slave'){
    alert('此裝置為從機，無法上傳菜單');
    return;
  }
  if(typeof window.syncMenuToCloud === 'function'){
    await window.syncMenuToCloud(btn);
  } else {
    // fallback：保留舊邏輯
    const original = btn.textContent;
    try{
      btn.disabled = true; btn.textContent = '同步中...';
      await syncMenuToFirebase();
      btn.textContent = '✓ 同步成功';
      setTimeout(()=>{ btn.textContent = original; btn.disabled = false; }, 2000);
    }catch(err){
      alert('同步失敗：' + (err.message || err));
      btn.textContent = original; btn.disabled = false;
    }
  }
}

async function fetchMenuHandler(btn){
  if(typeof window.fetchMenuFromCloud === 'function'){
    await window.fetchMenuFromCloud(btn);
    if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
  } else {
    alert('讀取功能尚未載入，請重新整理頁面');
  }
}


// ============================================================
// 初始化
// ============================================================
export function initProductsPage(){
  document.getElementById('addProductBtnTop')?.addEventListener('click', ()=> openProductEditModal(null));
  document.getElementById('productSearchTop')?.addEventListener('input', renderProductsTable);
  document.getElementById('syncMenuBtnProducts')?.addEventListener('click', (e)=> syncMenuHandler(e.currentTarget));
  document.getElementById('fetchMenuBtnProducts')?.addEventListener('click', (e)=> fetchMenuHandler(e.currentTarget));

  applyProductsRoleLock();
  document.getElementById('deviceRole')?.addEventListener('change', applyProductsRoleLock);


  document.getElementById('openCategoryListBtn')?.addEventListener('click', openCategoryListModal);
  document.getElementById('openModuleListBtn')?.addEventListener('click', openModuleListModal);
  document.getElementById('openPendingBtn')?.addEventListener('click', openPendingModal);

  document.getElementById('closeProductEditModal')?.addEventListener('click', closeProductEditModal);
  document.getElementById('productEditModal')?.addEventListener('click', (e)=>{
    if(e.target.id === 'productEditModal') closeProductEditModal();
  });

  document.getElementById('excelTemplateBtn')?.addEventListener('click', ()=>{
    try{
      const workbook = buildWorkbookFromRows(createExcelTemplateRows());
      const blob = workbookToBlob(workbook);
      downloadBlob(blob, '菜單匯入範本.xlsx');
    }catch(e){ alert('範本下載失敗：' + e.message); }
  });
  document.getElementById('excelImportInput')?.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    await importExcelFile(file);
    e.target.value = '';
  });

  document.getElementById('addCategoryBtn')?.addEventListener('click', ()=>{
    const name = prompt('請輸入新分類名稱');
    if(!name) return;
    const trimmed = name.trim();
    if(!trimmed) return;
    if(state.categories.includes(trimmed)) return alert('分類已存在');
    state.categories.push(trimmed);
    persistAll(); window.refreshAllViews();
  });

  document.getElementById('addModuleBtn')?.addEventListener('click', ()=>{
    const name = prompt('請輸入新模組名稱（例如：甜度、冰量）');
    if(!name) return;
    const trimmed = name.trim();
    if(!trimmed) return;
    state.modules.push({id:id(), name:trimmed, selection:'single', required:true, options:[]});
    persistAll(); window.refreshAllViews();
  });

  document.getElementById('attachModuleBtn')?.addEventListener('click', ()=>{
    const moduleId = document.getElementById('moduleSelect')?.value; if(!moduleId) return;
    if(!Array.isArray(state.editModules)) state.editModules = [];
    if(state.editModules.some(m=>m.moduleId===moduleId)) return alert('此模組已加入');
    state.editModules.push({moduleId, requiredOverride:null});
    renderProductModulesEditor();
  });

  document.getElementById('removeProductImageBtn')?.addEventListener('click', ()=>{
    const imgData = document.getElementById('productImageData'); if(imgData) imgData.value = '';
    const imgInput = document.getElementById('productImageInput'); if(imgInput) imgInput.value = '';
    renderProductImagePreview('');
  });
  document.getElementById('productImageInput')?.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0]; if(!file) return;
    try{
      const dataUrl = await optimizeProductImage(file);
      const imgData = document.getElementById('productImageData');
      if(imgData) imgData.value = dataUrl;
      renderProductImagePreview(dataUrl);
    }catch(err){ alert('圖片處理失敗，請換一張圖片再試'); }
  });

  document.getElementById('deleteProductBtn')?.addEventListener('click', ()=>{
    const pid = document.getElementById('productId')?.value; if(!pid) return;
    const product = state.products.find(p=>p.id===pid); if(!product) return;
    if(!confirm(`確定刪除商品「${product.name}」？`)) return;
    state.products = state.products.filter(p=>p.id!==pid);
    state.products.forEach((item, i)=> item.sortOrder = i);
    persistAll(); window.refreshAllViews(); resetProductForm();
    closeProductEditModal();
  });

  const { nameInput, priceInput } = getProductFormElements();
  nameInput?.addEventListener('input', ()=> validateProductForm(false));
  priceInput?.addEventListener('input', ()=> validateProductForm(false));

  document.getElementById('productForm')?.addEventListener('submit', (e)=>{
    e.preventDefault();
    const validation = validateProductForm(true);
    if(!validation.valid){ focusFirstInvalidField(validation); return; }
    const idEl = document.getElementById('productId');
    const product = {
      id: idEl?.value || id(),
      name: document.getElementById('productName').value.trim(),
      price: Number(document.getElementById('productPrice').value || 0),
      category: document.getElementById('productCategory').value || '未分類',
      enabled: document.getElementById('productEnabled').value === 'true',
      image: document.getElementById('productImageData')?.value || '',
      description: (document.getElementById('productDescription')?.value || '').trim().slice(0, 60),
      modules: deepCopy(state.editModules || []),
      sortOrder: idEl?.value ? (state.products.find(p=>p.id===idEl.value)?.sortOrder ?? state.products.length) : state.products.length,
    };
    const idx = state.products.findIndex(p=>p.id===product.id);
    if(idx>=0) state.products[idx] = product;
    else state.products.push(product);
    state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((item, i)=> item.sortOrder = i);
    persistAll(); window.refreshAllViews();
    closeProductEditModal();
  });

  document.getElementById('applyPendingMenuBtn')?.addEventListener('click', ()=>{
    const list = state.pendingProducts || [];
    if(!list.length) return alert('沒有待上架商品');
    let applied = 0;
    list.slice().forEach(item=>{
      const name = (item.name || '').trim();
      const price = Number(item.price || 0);
      if(!name || !(price > 0)) return;
      state.products.push({
        id: item.id || id(), name, price,
        category: item.category || '未分類',
        enabled: item.enabled !== false,
        image: item.image || '',
        modules: item.modules || [],
        sortOrder: state.products.length
      });
      state.pendingProducts = state.pendingProducts.filter(x=>x.id !== item.id);
      applied++;
    });
    state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((p,i)=> p.sortOrder = i);
    persistAll(); window.refreshAllViews();
    alert(`已套用 ${applied} 筆`);
  });
  document.getElementById('discardPendingMenuBtn')?.addEventListener('click', ()=>{
    if(!(state.pendingProducts||[]).length) return;
    if(!confirm('確定捨棄全部待上架商品？')) return;
    state.pendingProducts = [];
    persistAll(); window.refreshAllViews();
  });

  document.getElementById('closeCategoryManageModal')?.addEventListener('click', closeCategoryManage);
  document.getElementById('cancelCategoryManageBtn')?.addEventListener('click', closeCategoryManage);
  document.querySelector('#categoryManageModal .modal-backdrop')?.addEventListener('click', closeCategoryManage);
  document.getElementById('categoryManageSearch')?.addEventListener('input', renderCategoryManage);
  document.getElementById('saveCategoryManageBtn')?.addEventListener('click', ()=>{ saveCategoryManage(); persistAll(); window.refreshAllViews(); });
  document.getElementById('closeModuleManageModal')?.addEventListener('click', closeModuleManage);
  document.getElementById('cancelModuleManageBtn')?.addEventListener('click', closeModuleManage);
  document.querySelector('#moduleManageModal .modal-backdrop')?.addEventListener('click', closeModuleManage);
  document.getElementById('moduleManageSearch')?.addEventListener('input', renderModuleManage);
  document.getElementById('saveModuleManageBtn')?.addEventListener('click', ()=>{ saveModuleManage(); persistAll(); window.refreshAllViews(); });

  resetProductForm();
}
