/* 中文備註：商品管理頁程式。此版已移除 OCR，改為 Excel 菜單匯入。 */

import { state, persistAll } from '../core/store.js';
import { escapeHtml, escapeAttr, money, id, deepCopy } from '../core/utils.js';
import { openCategoryManage, closeCategoryManage, renderCategoryManage, saveCategoryManage } from '../modules/product-category-manager.js';
import { openModuleManage, closeModuleManage, renderModuleManage, saveModuleManage } from '../modules/product-module-manager.js';

function getModuleSummary(mod, usedCount){
  return `${mod.selection === 'multi' ? '多選' : '單選'} ・ ${mod.required ? '必選' : '非必選'} ・ 已套用 ${usedCount} 商品`;
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
    preview.textContent = '尚未上傳圖片（上傳後會自動裁成正方形並壓縮）';
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
  const name = nameInput.value.trim();
  const rawPrice = priceInput.value;
  const price = Number(rawPrice);
  const nameOk = !!name;
  const priceOk = rawPrice !== '' && !Number.isNaN(price) && price > 0;
  nameInput.classList.toggle('input-error', !nameOk && showMessage);
  priceInput.classList.toggle('input-error', !priceOk && showMessage);
  nameError.classList.toggle('hidden', nameOk || !showMessage);
  priceError.classList.toggle('hidden', priceOk || !showMessage);
  if(saveBtn){
    saveBtn.disabled = !(nameOk && priceOk);
    saveBtn.style.opacity = nameOk && priceOk ? '1' : '0.5';
  }
  return { valid: nameOk && priceOk, nameOk, priceOk };
}
function focusFirstInvalidField(result){
  const { nameInput, priceInput } = getProductFormElements();
  if(!result.nameOk) return nameInput.focus();
  if(!result.priceOk) return priceInput.focus();
}


/* 中文備註：以下為 Excel 匯入工具。Excel 匯入後先進待處理菜單，確認後才正式加入菜單。 */
function createExcelTemplateRows(){
  return [
    { 商品名稱:'紅茶', 價格:30, 分類:'飲料', 狀態:'啟用', 商品別名:'古早味紅茶' },
    { 商品名稱:'奶茶', 價格:45, 分類:'飲料', 狀態:'啟用', 商品別名:'招牌奶茶' },
    { 商品名稱:'雞排', 價格:80, 分類:'炸物', 狀態:'啟用', 商品別名:'大雞排' }
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
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
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
  const aliases = String(row['商品別名'] ?? row['別名'] ?? row['aliases'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const enabled = !['false', '停用', '0', '關閉'].includes(enabledText);
  return { name, price, category, aliases, enabled };
}

function importExcelRowsToPending(rows){
  const imported = [];
  rows.forEach(raw => {
    const item = normalizeImportedRow(raw);
    if(!item.name) return;
    if(!(item.price > 0)) return;

    const exists = state.pendingProducts.some(p => p.name === item.name && Number(p.price) === Number(item.price))
      || state.products.some(p => p.name === item.name && Number(p.price) === Number(item.price));
    if(exists) return;

    imported.push({
      id: id(),
      name: item.name,
      price: item.price,
      category: item.category || '未分類',
      enabled: item.enabled,
      aliases: item.aliases,
      modules: [],
      sortOrder: state.products.length + imported.length,
      status: 'pending'
    });
  });

  if(!imported.length){
    alert('Excel 沒有可匯入的新資料，請檢查欄位名稱或內容。');
    return;
  }

  state.pendingProducts.unshift(...imported);
  persistAll();
  window.refreshAllViews();
  alert(`已匯入 ${imported.length} 筆到待處理菜單`);
}

async function importExcelFile(file){
  if(!window.XLSX){
    alert('Excel 套件尚未載入，請重新整理後再試。');
    return;
  }
  const arrayBuffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(arrayBuffer, { type:'array' });
  const firstSheetName = workbook.SheetNames[0];
  if(!firstSheetName){
    alert('Excel 內沒有工作表。');
    return;
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = window.XLSX.utils.sheet_to_json(worksheet, { defval:'' });
  importExcelRowsToPending(rows);
}

export function renderCategoryOptions(){
  const sel = document.getElementById('productCategory');
  const current = sel.value;
  sel.innerHTML = state.categories.map(c=> `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if(state.categories.includes(current)) sel.value = current;
}
export function renderCategoryList(){
  const wrap = document.getElementById('categoryList');
  const uncategorized = state.products.filter(p => !p.category || p.category === '未分類');
  wrap.innerHTML = '';
  const uncategorizedRow = document.createElement('div');
  uncategorizedRow.className = 'entity-row warning';
  uncategorizedRow.innerHTML = `<div><strong>未分類</strong><div class="meta">${uncategorized.length ? uncategorized.map(p => escapeHtml(p.name)).join('、') : '目前沒有未分類商品'}</div></div><div><span class="badge pending">${uncategorized.length} 筆</span></div>`;
  wrap.appendChild(uncategorizedRow);

  state.categories.filter(cat => cat !== '未分類').forEach(cat=>{
    const count = state.products.filter(p=>p.category===cat).length;
    const row = document.createElement('div');
    row.className = 'entity-row';
    row.innerHTML = `<div><strong>${escapeHtml(cat)}</strong><div class="meta">商品數：${count}</div></div><div class="action-stack"><button class="secondary-btn small-btn">管理商品</button><button class="secondary-btn small-btn">改名</button><button class="danger-btn small-btn">刪除</button></div>`;
    const [manageBtn, renameBtn, deleteBtn] = row.querySelectorAll('button');
    manageBtn.onclick = ()=> openCategoryManage(cat);
    renameBtn.onclick = ()=>{
      const nv = prompt('輸入新分類名稱', cat);
      if(!nv || nv.trim()===cat) return;
      if(state.categories.includes(nv.trim())) return alert('分類已存在');
      state.categories = state.categories.map(c=> c===cat ? nv.trim() : c);
      state.products.forEach(p=>{ if(p.category===cat) p.category = nv.trim(); });
      persistAll(); window.refreshAllViews();
    };
    deleteBtn.onclick = ()=>{
      if(!confirm(`確定刪除分類「${cat}」？`)) return;
      state.categories = state.categories.filter(c=>c!==cat);
      state.products.forEach(p=>{ if(p.category===cat) p.category = '未分類'; });
      if(state.settings.selectedCategory===cat) state.settings.selectedCategory='全部';
      persistAll(); window.refreshAllViews();
    };
    wrap.appendChild(row);
  });
}
export function renderModuleSelect(){
  const sel = document.getElementById('moduleSelect');
  sel.innerHTML = state.modules.map(m=> `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
}
function renderModuleEditorOptions(optWrap, mod, expandModuleId){
  optWrap.innerHTML = '';
  mod.options.forEach((opt, index)=>{
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
  const wrap = document.getElementById('moduleLibraryList');
  wrap.innerHTML = '';
  state.modules.forEach(mod=>{
    const usedCount = state.products.filter(p=> (p.modules||[]).some(a=>a.moduleId===mod.id)).length;
    const isOpen = expandModuleId === mod.id;
    const block = document.createElement('div');
    block.className = 'module-editor';
    block.innerHTML = `<div class="row between wrap"><div><strong>${escapeHtml(mod.name)}</strong><div class="meta module-summary">${escapeHtml(getModuleSummary(mod, usedCount))}</div></div><div class="action-stack"><button type="button" class="secondary-btn small-btn">套用商品</button><button type="button" class="secondary-btn small-btn">${isOpen ? '收合' : '編輯模組'}</button><button type="button" class="danger-btn small-btn">刪除模組</button></div></div><div class="module-options ${isOpen ? '' : 'hidden'}"></div><div class="row gap wrap ${isOpen ? '' : 'hidden'} footer-tools" style="margin-top:10px"><button type="button" class="secondary-btn small-btn add-option-btn">新增子選項</button></div>`;
    const buttons = block.querySelectorAll('button');
    const optionsWrap = block.querySelector('.module-options');
    const footerRow = block.querySelector('.footer-tools');
    buttons[0].onclick = ()=> openModuleManage(mod.id);
    buttons[1].onclick = ()=> renderModuleLibrary(isOpen ? '' : mod.id);
    buttons[2].onclick = ()=>{
      if(!confirm(`確定刪除模組「${mod.name}」？`)) return;
      state.modules = state.modules.filter(m=>m.id!==mod.id);
      state.products.forEach(p=> p.modules = (p.modules||[]).filter(a=>a.moduleId!==mod.id));
      persistAll(); window.refreshAllViews();
    };
    if(isOpen){
      optionsWrap.innerHTML = `<div class="grid2"><div><label>模組名稱</label><input class="module-name" value="${escapeAttr(mod.name)}"></div><div><label>規則</label><select class="module-selection"><option value="single" ${mod.selection==='single'?'selected':''}>單選</option><option value="multi" ${mod.selection==='multi'?'selected':''}>多選</option></select></div></div><div class="switch-row"><span>必選</span><button type="button" class="switch ${mod.required ? 'on' : ''}">${mod.required ? '開' : '關'}</button></div><div class="module-options-list"></div>`;
      const nameInput = optionsWrap.querySelector('.module-name');
      const selectionSel = optionsWrap.querySelector('.module-selection');
      const switchBtn = optionsWrap.querySelector('.switch');
      nameInput.oninput = ()=>{ mod.name = nameInput.value; renderModuleSelect(); const summary = block.querySelector('.module-summary'); if(summary) summary.textContent = getModuleSummary(mod, usedCount); };
      selectionSel.onchange = ()=>{ mod.selection = selectionSel.value; renderModuleLibrary(mod.id); };
      switchBtn.onclick = ()=>{ mod.required = !mod.required; renderModuleLibrary(mod.id); };
      renderModuleEditorOptions(optionsWrap.querySelector('.module-options-list'), mod, mod.id);
      footerRow.querySelector('.add-option-btn').onclick = ()=>{ mod.options.push({id:id(), name:'', price:0, enabled:true}); renderModuleLibrary(mod.id); };
    }
    wrap.appendChild(block);
  });
}
export function renderProductModulesEditor(){
  const wrap = document.getElementById('productModulesEditor');
  wrap.innerHTML = '';
  if(!state.editModules.length) return wrap.innerHTML = '<div class="muted">尚未套用口味模組</div>';
  state.editModules.forEach((att, index)=>{
    const mod = state.modules.find(m=>m.id===att.moduleId);
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
  const list = [...state.products].sort((a,b)=>a.sortOrder-b.sortOrder);
  const idx = list.findIndex(p=>p.id===productId);
  if(idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if(swapIdx < 0 || swapIdx >= list.length) return;
  const a = list[idx], b = list[swapIdx], temp = a.sortOrder;
  a.sortOrder = b.sortOrder; b.sortOrder = temp;
  state.products.sort((x,y)=>x.sortOrder-y.sortOrder);
  persistAll(); renderProductsTable(); if(window.refreshPublicProducts) window.refreshPublicProducts();
}
function saveInlinePrice(product, value){
  const price = Number(value || 0);
  if(Number.isNaN(price) || price < 0) return;
  product.price = price;
  persistAll(); if(window.refreshPublicProducts) window.refreshPublicProducts();
}
function toggleInlineModule(product, moduleId, checked){
  const has = (product.modules||[]).some(m=>m.moduleId===moduleId);
  if(checked && !has) product.modules = [...(product.modules||[]), {moduleId, requiredOverride:null}];
  if(!checked && has) product.modules = (product.modules||[]).filter(m=>m.moduleId!==moduleId);
  persistAll(); if(window.refreshPublicProducts) window.refreshPublicProducts();
}
function productRowHtml(p, index, total, expanded){
  const modNames = getProductModuleNames(p);
  return `<div class="product-card-row ${p.enabled===false ? 'disabled' : ''}"><div class="left">${p.image ? `<img class="product-list-thumb" src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}">` : `<div class="drag-icon">≡</div>`}</div><div class="center"><div class="title">${escapeHtml(p.name)}<span class="tag">${escapeHtml(p.category || '未分類')}</span><span class="status ${p.enabled!==false ? 'on' : 'off'}">${p.enabled!==false ? '啟用中' : '停用中'}</span></div><div class="inline-edit-row"><label class="inline-label">價格</label><input class="inline-price" type="number" min="0" value="${Number(p.price||0)}"></div><div class="modules">${modNames.length ? modNames.map(n=>`<span class="chip">${escapeHtml(n)}</span>`).join('') : '<span class="muted">無模組</span>'}</div><button type="button" class="inline-module-toggle">${expanded ? '收合模組' : '編輯模組'}</button></div><div class="right"><button type="button" class="move-up" ${index===0?'disabled':''}>⬆</button><button type="button" class="move-down" ${index===total-1?'disabled':''}>⬇</button><button type="button" class="toggle">${p.enabled!==false ? '停用' : '啟用'}</button><button type="button" class="edit">編輯</button><button type="button" class="delete">刪除</button></div></div><div class="inline-module-panel ${expanded ? '' : 'hidden'}"><div class="inline-module-grid">${state.modules.map(mod => `<label class="inline-module-item"><input type="checkbox" data-module-id="${mod.id}" ${(p.modules||[]).some(m=>m.moduleId===mod.id) ? 'checked' : ''}><span>${escapeHtml(mod.name)}</span></label>`).join('')}</div></div>`;
}
export function renderPendingMenuList(){
  const wrap = document.getElementById('pendingMenuList');
  wrap.innerHTML = '';
  if(!state.pendingProducts.length) return wrap.innerHTML = '<div class="muted">目前沒有待處理菜單</div>';
  state.pendingProducts.forEach(item=>{
    const row = document.createElement('div');
    row.className = 'pending-card';
    row.innerHTML = `<div class="pending-main"><div class="row between wrap"><div><strong>${escapeHtml(item.name || '')}</strong><span class="tag">${escapeHtml(item.category || '未分類')}</span></div><span class="badge pending">待處理</span></div><div class="grid2" style="margin-top:10px"><div><label>品項名稱</label><input class="pending-name" value="${escapeAttr(item.name || '')}"></div><div><label>價格</label><input class="pending-price" type="number" min="0" value="${Number(item.price || 0)}"></div></div></div><div class="row gap wrap" style="margin-top:12px"><button type="button" class="primary-btn small-btn approve-btn">確認加入菜單</button><button type="button" class="danger-btn small-btn delete-btn">刪除</button></div>`;
    const nameInput = row.querySelector('.pending-name');
    const priceInput = row.querySelector('.pending-price');
    nameInput.addEventListener('input', ()=>{ item.name = nameInput.value; persistAll(); });
    priceInput.addEventListener('input', ()=>{ item.price = Number(priceInput.value || 0); persistAll(); });
    row.querySelector('.approve-btn').onclick = ()=>{
      const name = (item.name || '').trim();
      const price = Number(item.price || 0);
      if(!name) return alert('請先輸入品項名稱');
      if(!price || price <= 0) return alert('請先輸入正確價格');
      state.products.push({id: item.id || id(), name, price, category: item.category || '未分類', enabled: true, aliases: item.aliases || [], image: item.image || '', modules: item.modules || [], sortOrder: state.products.length});
      state.pendingProducts = state.pendingProducts.filter(x=>x.id !== item.id);
      state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((p, i)=> p.sortOrder = i);
      persistAll(); window.refreshAllViews();
    };
    row.querySelector('.delete-btn').onclick = ()=>{ state.pendingProducts = state.pendingProducts.filter(x=>x.id !== item.id); persistAll(); renderPendingMenuList(); };
    wrap.appendChild(row);
  });
}
export function renderProductsTable(){
  state.products.sort((a,b)=>a.sortOrder-b.sortOrder);
  const wrap = document.getElementById('productsTable');
  wrap.innerHTML = '';
  if(!state.products.length) return wrap.innerHTML = '<div class="muted">尚無商品</div>';
  const total = state.products.length;
  const expandedId = wrap.dataset.expandedProductId || '';
  state.products.forEach((p, index)=>{
    const row = document.createElement('div');
    row.className = 'product-list-item';
    const expanded = expandedId === p.id;
    row.innerHTML = productRowHtml(p, index, total, expanded);
    row.querySelector('.move-up').onclick = ()=> moveProduct(p.id, 'up');
    row.querySelector('.move-down').onclick = ()=> moveProduct(p.id, 'down');
    row.querySelector('.toggle').onclick = ()=>{ p.enabled = !(p.enabled!==false); persistAll(); window.refreshAllViews(); };
    row.querySelector('.edit').onclick = ()=> openProductForm(p);
    row.querySelector('.delete').onclick = ()=>{ if(!confirm(`確定刪除商品「${p.name}」？`)) return; state.products = state.products.filter(x=>x.id!==p.id); state.products.forEach((item, i)=> item.sortOrder = i); persistAll(); window.refreshAllViews(); if(document.getElementById('productId').value===p.id) resetProductForm(); };
    const priceInput = row.querySelector('.inline-price');
    priceInput.addEventListener('change', ()=> saveInlinePrice(p, priceInput.value));
    priceInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); saveInlinePrice(p, priceInput.value); priceInput.blur(); }});
    row.querySelector('.inline-module-toggle').onclick = ()=>{ wrap.dataset.expandedProductId = expanded ? '' : p.id; renderProductsTable(); };
    row.querySelectorAll('.inline-module-item input').forEach(chk=> chk.addEventListener('change', ()=>{ toggleInlineModule(p, chk.dataset.moduleId, chk.checked); wrap.dataset.expandedProductId = p.id; renderProductsTable(); }));
    wrap.appendChild(row);
  });
}
export function resetProductForm(){
  document.getElementById('productId').value = '';
  document.getElementById('productName').value = '';
  document.getElementById('productPrice').value = '';
  document.getElementById('productAliases').value = '';
  document.getElementById('productImageData').value = '';
  if(document.getElementById('productImageInput')) document.getElementById('productImageInput').value = '';
  document.getElementById('productEnabled').value = 'true';
  renderCategoryOptions();
  document.getElementById('productCategory').value = '未分類';
  state.editModules = [];
  renderProductImagePreview('');
  renderProductModulesEditor();
  validateProductForm(false);
  bindFormButtonsState();
}
function bindFormButtonsState(){
  const hasId = !!document.getElementById('productId').value;
  const btn = document.getElementById('deleteProductBtn');
  btn.disabled = !hasId;
  btn.style.opacity = hasId ? '1' : '0.5';
}
function openProductForm(product){
  document.getElementById('productId').value = product.id;
  document.getElementById('productName').value = product.name;
  document.getElementById('productPrice').value = product.price;
  document.getElementById('productAliases').value = (product.aliases||[]).join(', ');
  document.getElementById('productImageData').value = product.image || '';
  if(document.getElementById('productImageInput')) document.getElementById('productImageInput').value = '';
  renderProductImagePreview(product.image || '');
  document.getElementById('productEnabled').value = String(product.enabled!==false);
  renderCategoryOptions();
  document.getElementById('productCategory').value = product.category || '未分類';
  state.editModules = deepCopy(product.modules||[]);
  renderProductImagePreview('');
  renderProductModulesEditor();
  validateProductForm(false);
  bindFormButtonsState();
}

export function initProductsPage(){
  /* 中文備註：商品管理頁新增三個 Excel 按鈕。這些功能只影響商品管理，不會影響其他頁面。 */
  document.getElementById('excelTemplateBtn').onclick = ()=>{
    const workbook = buildWorkbookFromRows(createExcelTemplateRows());
    const blob = workbookToBlob(workbook);
    downloadBlob(blob, '菜單匯入範本.xlsx');
  };

  document.getElementById('excelImportInput').onchange = async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    await importExcelFile(file);
    e.target.value = '';
  };

  document.getElementById('addCategoryBtn').onclick = ()=>{ const input = document.getElementById('newCategoryInput'); const name = input.value.trim(); if(!name) return; if(state.categories.includes(name)) return alert('分類已存在'); state.categories.push(name); input.value = ''; persistAll(); window.refreshAllViews(); };
  document.getElementById('addModuleBtn').onclick = ()=>{ const input = document.getElementById('newModuleInput'); const name = input.value.trim(); if(!name) return; state.modules.push({id:id(), name, selection:'single', required:true, options:[]}); input.value = ''; persistAll(); window.refreshAllViews(); };
  document.getElementById('attachModuleBtn').onclick = ()=>{ const moduleId = document.getElementById('moduleSelect').value; if(!moduleId) return; if(state.editModules.some(m=>m.moduleId===moduleId)) return alert('此模組已加入'); state.editModules.push({moduleId, requiredOverride:null}); renderProductModulesEditor(); };
  document.getElementById('resetProductBtn').onclick = resetProductForm;
  document.getElementById('removeProductImageBtn').onclick = ()=>{
    document.getElementById('productImageData').value = '';
    if(document.getElementById('productImageInput')) document.getElementById('productImageInput').value = '';
    renderProductImagePreview('');
  };
  document.getElementById('productImageInput').onchange = async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    try{
      const dataUrl = await optimizeProductImage(file);
      document.getElementById('productImageData').value = dataUrl;
      renderProductImagePreview(dataUrl);
    }catch(err){
      alert('圖片處理失敗，請換一張圖片再試');
    }
  };
  document.getElementById('deleteProductBtn').onclick = ()=>{ const pid = document.getElementById('productId').value; if(!pid) return; const product = state.products.find(p=>p.id===pid); if(!product) return; if(!confirm(`確定刪除商品「${product.name}」？`)) return; state.products = state.products.filter(p=>p.id!==pid); state.products.forEach((item, i)=> item.sortOrder = i); persistAll(); window.refreshAllViews(); resetProductForm(); };
  const { nameInput, priceInput } = getProductFormElements();
  nameInput.addEventListener('input', ()=> validateProductForm(false));
  priceInput.addEventListener('input', ()=> validateProductForm(false));
  document.getElementById('productForm').onsubmit = (e)=>{
    e.preventDefault();
    const validation = validateProductForm(true);
    if(!validation.valid){ focusFirstInvalidField(validation); return; }
    const product = {
      id: document.getElementById('productId').value || id(),
      name: document.getElementById('productName').value.trim(),
      price: Number(document.getElementById('productPrice').value || 0),
      category: document.getElementById('productCategory').value || '未分類',
      enabled: document.getElementById('productEnabled').value === 'true',
      aliases: document.getElementById('productAliases').value.split(',').map(s=>s.trim()).filter(Boolean),
      image: document.getElementById('productImageData').value || '',
      modules: deepCopy(state.editModules),
      sortOrder: document.getElementById('productId').value ? (state.products.find(p=>p.id===document.getElementById('productId').value)?.sortOrder ?? state.products.length) : state.products.length,
    };
    const idx = state.products.findIndex(p=>p.id===product.id);
    if(idx>=0) state.products[idx] = product;
    else state.products.push(product);
    state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((item, i)=> item.sortOrder = i);
    persistAll(); window.refreshAllViews(); resetProductForm(); alert('商品已保存');
  };
  document.getElementById('saveAllBtn').onclick = ()=>{ persistAll(); alert('已保存'); };
  document.getElementById('closeCategoryManageModal').onclick = closeCategoryManage;
  document.getElementById('cancelCategoryManageBtn').onclick = closeCategoryManage;
  document.querySelector('#categoryManageModal .modal-backdrop').onclick = closeCategoryManage;
  document.getElementById('categoryManageSearch').addEventListener('input', renderCategoryManage);
  document.getElementById('saveCategoryManageBtn').onclick = ()=>{ saveCategoryManage(); persistAll(); window.refreshAllViews(); };
  document.getElementById('closeModuleManageModal').onclick = closeModuleManage;
  document.getElementById('cancelModuleManageBtn').onclick = closeModuleManage;
  document.querySelector('#moduleManageModal .modal-backdrop').onclick = closeModuleManage;
  document.getElementById('moduleManageSearch').addEventListener('input', renderModuleManage);
  document.getElementById('saveModuleManageBtn').onclick = ()=>{ saveModuleManage(); persistAll(); window.refreshAllViews(); };
  resetProductForm();
}
