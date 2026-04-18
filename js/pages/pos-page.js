/* 中文備註：js/pages/pos-page.js，此檔已加入中文說明，方便後續維護。 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, money, id } from '../core/utils.js';
import { getDiscountResult, getDiscountType, setDiscountType, handleDiscountInput } from '../modules/cart-service.js';
import { createOrUpdateOrder, markPendingOrderPaid } from '../modules/order-service.js';
import { buildCartPreviewOrder, getPrintSettings, printOrderLabels, printOrderReceipt } from '../modules/print-service.js';

function createConfigState(product){
  const selections = {};
  for(const att of product.modules || []){
    const mod = state.modules.find(m=>m.id===att.moduleId);
    if(mod) selections[mod.id] = mod.selection === 'multi' ? [] : null;
  }
  return selections;
}

function flattenSelections(product){
  const rows = [];
  for(const att of product.modules || []){
    const mod = state.modules.find(m=>m.id===att.moduleId);
    if(!mod) continue;
    const val = state.currentSelections[mod.id];
    if(Array.isArray(val)){
      val.forEach(idv=>{
        const opt = mod.options.find(o=>o.id===idv);
        if(opt) rows.push({moduleId:mod.id, moduleName:mod.name, optionId:opt.id, optionName:opt.name, price:opt.price});
      });
    } else if(val){
      const opt = mod.options.find(o=>o.id===val);
      if(opt) rows.push({moduleId:mod.id, moduleName:mod.name, optionId:opt.id, optionName:opt.name, price:opt.price});
    }
  }
  return rows;
}

function updateItemPricePreview(product){
  let add = 0;
  const selections = flattenSelections(product);
  selections.forEach(s=> add += Number(s.price || 0));
  const qty = Math.max(1, Number(document.getElementById('itemQtyInput').value || 1));
  const subtotal = (Number(product.price||0) + add) * qty;
  document.getElementById('itemPricePreview').textContent = '小計：' + money(subtotal);
}

function renderProductConfig(product){
  document.getElementById('productConfigTitle').textContent = product.name + ' - 設定';
  const wrap = document.getElementById('productConfigModules');
  wrap.innerHTML = '';
  (product.modules || []).forEach(att=>{
    const mod = state.modules.find(m=>m.id===att.moduleId);
    if(!mod) return;
    const required = att.requiredOverride === null ? mod.required : att.requiredOverride;
    const block = document.createElement('div');
    block.className = 'module-block';
    block.innerHTML = `
      <div class="module-header">
        <div>
          <strong>${escapeHtml(mod.name)}</strong>
          <div class="muted">${required ? '必選' : '非必選'}・${mod.selection === 'multi' ? '多選' : '單選'}</div>
        </div>
      </div>
      <div class="option-list"></div>
    `;
    const list = block.querySelector('.option-list');
    mod.options.filter(o=>o.enabled!==false).forEach(opt=>{
      const active = Array.isArray(state.currentSelections[mod.id]) ?
        state.currentSelections[mod.id].includes(opt.id) :
        state.currentSelections[mod.id] === opt.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-chip' + (active ? ' active' : '');
      btn.innerHTML = `<span>${escapeHtml(opt.name)}</span><strong>${opt.price ? '+' + money(opt.price) : money(0)}</strong>`;
      btn.onclick = ()=>{
        if(mod.selection === 'multi'){
          const arr = state.currentSelections[mod.id] || [];
          if(arr.includes(opt.id)) state.currentSelections[mod.id] = arr.filter(x=>x!==opt.id);
          else state.currentSelections[mod.id] = [...arr, opt.id];
        } else {
          state.currentSelections[mod.id] = state.currentSelections[mod.id] === opt.id ? null : opt.id;
        }
        renderProductConfig(product);
      };
      list.appendChild(btn);
    });
    wrap.appendChild(block);
  });
  updateItemPricePreview(product);
}

function openProductConfigForNew(productId){
  const product = state.products.find(p=>p.id===productId);
  if(!product || product.enabled === false) return;
  state.configTarget = {mode:'new', productId};
  state.currentSelections = createConfigState(product);
  document.getElementById('itemNoteInput').value = '';
  document.getElementById('itemQtyInput').value = 1;
  renderProductConfig(product);
  document.getElementById('productConfigModal').classList.remove('hidden');
}

function openProductConfigForEdit(rowId){
  const item = state.cart.find(x=>x.rowId===rowId);
  if(!item) return;
  const product = state.products.find(p=>p.id===item.productId);
  if(!product) return;
  state.configTarget = {mode:'edit', rowId, productId:item.productId};
  state.currentSelections = createConfigState(product);
  (item.selections || []).forEach(sel=>{
    if(Array.isArray(state.currentSelections[sel.moduleId])) state.currentSelections[sel.moduleId].push(sel.optionId);
    else state.currentSelections[sel.moduleId] = sel.optionId;
  });
  document.getElementById('itemNoteInput').value = item.note || '';
  document.getElementById('itemQtyInput').value = item.qty || 1;
  renderProductConfig(product);
  document.getElementById('productConfigModal').classList.remove('hidden');
}

function closeProductConfig(){
  document.getElementById('productConfigModal').classList.add('hidden');
  state.configTarget = null;
  state.currentSelections = {};
}

function sameSelections(a=[], b=[]){
  if(a.length !== b.length) return false;
  const format = rows => rows.map(x=>`${x.moduleId}:${x.optionId}`).sort().join('|');
  return format(a) === format(b);
}

function mergeOrPushCartItem(payload){
  const existing = state.cart.find(item =>
    item.productId === payload.productId &&
    String(item.note || '') === String(payload.note || '') &&
    Number(item.basePrice || 0) === Number(payload.basePrice || 0) &&
    Number(item.extraPrice || 0) === Number(payload.extraPrice || 0) &&
    sameSelections(item.selections || [], payload.selections || [])
  );
  if(existing) existing.qty += payload.qty;
  else state.cart.push(payload);
}

export function renderTabs(){
  const wrap = document.getElementById('categoryTabs');
  wrap.innerHTML = '';
  ['全部', ...state.categories].forEach(cat=>{
    const b = document.createElement('button');
    b.className = 'category-chip' + (state.settings.selectedCategory===cat ? ' active' : '');
    b.textContent = cat;
    b.onclick = ()=>{
      state.settings.selectedCategory = cat;
      persistAll();
      renderTabs();
      renderProducts();
    };
    wrap.appendChild(b);
  });
}

export function renderProducts(){
  const keyword = document.getElementById('productSearch').value.trim();
  const grid = document.getElementById('productGrid');
  const list = [...state.products].sort((a,b)=>a.sortOrder-b.sortOrder).filter(p=>{
    const catOk = state.settings.selectedCategory==='全部' || p.category===state.settings.selectedCategory;
    const kwOk = !keyword || [p.name, p.category, ...(p.aliases||[])].join(' ').includes(keyword);
    return catOk && kwOk;
  });
  grid.innerHTML = '';
  if(!list.length){
    grid.innerHTML = '<div class="muted">沒有符合的商品</div>';
    return;
  }
  list.forEach(p=>{
    const moduleNames = (p.modules||[]).map(att=> state.modules.find(m=>m.id===att.moduleId)?.name).filter(Boolean);
    const card = document.createElement('div');
    card.className = 'product-card' + (p.enabled===false ? ' disabled' : '');
    card.innerHTML = `
      ${state.settings.showProductImages && p.image ? `<div class="product-card-image-wrap"><img class="product-card-image" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"></div>` : ''}
      <h3>${escapeHtml(p.name)}</h3>
      <div class="price">${money(p.price)}</div>
      <div class="meta">${escapeHtml(p.category)}${moduleNames.length ? '・' + escapeHtml(moduleNames.join('/')) : ''}</div>
      ${p.enabled===false ? '<span class="badge off">已停售</span>' : ''}
      <button class="primary-btn full">${p.enabled===false ? '不可點選' : '加入'}</button>
    `;
    const btn = card.querySelector('button');
    if(p.enabled===false) btn.disabled = true;
    else btn.onclick = ()=> openProductConfigForNew(p.id);
    grid.appendChild(card);
  });
}

window.refreshPublicProducts = renderProducts;

export function renderCart(){
  const list = document.getElementById('cartList');
  list.innerHTML = '';
  if(!state.cart.length){
    list.className = 'cart-list empty';
    list.textContent = '尚未加入商品';
  } else {
    list.className = 'cart-list';
    state.cart.forEach(item=>{
      const desc = (item.selections||[]).map(s=> `${s.moduleName}:${s.optionName}`).join(' / ');
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div class="row between wrap">
          <div>
            <div class="name">${escapeHtml(item.name)}</div>
            ${desc ? `<div class="sub">${escapeHtml(desc)}</div>` : ''}
            ${item.note ? `<div class="sub">備註：${escapeHtml(item.note)}</div>` : ''}
          </div>
          <strong>${money((item.basePrice + item.extraPrice) * item.qty)}</strong>
        </div>
        <div class="row gap wrap" style="margin-top:10px">
          <button class="secondary-btn small-btn">-</button>
          <span>${item.qty}</span>
          <button class="secondary-btn small-btn">+</button>
          <button class="secondary-btn small-btn">編輯</button>
          <button class="danger-btn small-btn">刪除</button>
        </div>
      `;
      const [minus, plus, edit, del] = row.querySelectorAll('button');
      minus.onclick = ()=>{ item.qty = Math.max(1, item.qty-1); renderCart(); };
      plus.onclick = ()=>{ item.qty += 1; renderCart(); };
      edit.onclick = ()=> openProductConfigForEdit(item.rowId);
      del.onclick = ()=>{ state.cart = state.cart.filter(x=>x.rowId!==item.rowId); renderCart(); };
      list.appendChild(row);
    });
  }
  const subtotal = state.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);
  const {discountAmount, total} = getDiscountResult(subtotal);
  document.getElementById('subtotalText').textContent = money(subtotal);
  document.getElementById('totalText').textContent = money(total) + (discountAmount ? `（已折 ${money(discountAmount)}）` : '');
}

function finalizeOrder(paymentMethod){
  const mode = document.getElementById('paymentTargetMode').value || 'new';
  const targetOrderId = document.getElementById('paymentTargetOrderId').value || '';
  const printConfig = getPrintSettings();
  let order = null;

  if(mode === 'pending'){
    order = markPendingOrderPaid(targetOrderId, paymentMethod);
    document.getElementById('paymentModal').classList.add('hidden');
    persistAll();
    window.refreshAllViews();

    if(order && paymentMethod !== '待付款' && printConfig.autoPrintCheckout){
      printOrderReceipt(order, 'customer');
    }
    if(order && printConfig.autoPrintKitchen){
      printKitchenCopies(order);
    }

    alert(paymentMethod === '待付款' ? '仍維持待付款' : '已完成收款');
    return;
  }

  order = createOrUpdateOrder(paymentMethod);
  document.getElementById('paymentModal').classList.add('hidden');
  persistAll();
  window.refreshAllViews();

  if(order && paymentMethod !== '待付款' && printConfig.autoPrintCheckout){
    printOrderReceipt(order, 'customer');
  }
  if(order && printConfig.autoPrintKitchen){
    printKitchenCopies(order);
  }

  alert(paymentMethod === '待付款' ? '已加入待付款' : '結帳完成');
}

export function initPOSPage(){
  document.getElementById('productSearch').addEventListener('input', renderProducts);
  document.getElementById('itemQtyInput').addEventListener('input', ()=>{
    const p = state.products.find(x=>x.id===state.configTarget?.productId);
    if(p) updateItemPricePreview(p);
  });
  document.getElementById('saveProductConfigBtn').onclick = ()=>{
    const product = state.products.find(p=>p.id===state.configTarget?.productId);
    if(!product) return closeProductConfig();

    for(const att of product.modules || []){
      const mod = state.modules.find(m=>m.id===att.moduleId);
      if(!mod) continue;
      const required = att.requiredOverride === null ? mod.required : att.requiredOverride;
      const val = state.currentSelections[mod.id];
      if(required){
        const missing = Array.isArray(val) ? val.length === 0 : !val;
        if(missing) return alert(`請先選擇「${mod.name}」`);
      }
    }

    const selections = flattenSelections(product);
    const extra = selections.reduce((s,x)=>s + Number(x.price||0), 0);
    const payload = {
      rowId: state.configTarget.mode === 'edit' ? state.configTarget.rowId : id(),
      productId: product.id,
      name: product.name,
      basePrice: Number(product.price||0),
      qty: Math.max(1, Number(document.getElementById('itemQtyInput').value || 1)),
      note: document.getElementById('itemNoteInput').value.trim(),
      selections,
      extraPrice: extra,
    };
    if(state.configTarget.mode === 'edit'){
      const idx = state.cart.findIndex(x=>x.rowId===state.configTarget.rowId);
      if(idx>=0) state.cart[idx] = payload;
    } else {
      mergeOrPushCartItem(payload);
    }
    closeProductConfig();
    renderCart();
  };

  document.getElementById('closeProductConfigModal').onclick = closeProductConfig;
  document.getElementById('cancelProductConfigBtn').onclick = closeProductConfig;
  document.querySelector('#productConfigModal .modal-backdrop').onclick = closeProductConfig;

  document.getElementById('discountAmountBtn').onclick = ()=> { setDiscountType('amount'); persistAll(); document.getElementById('discountAmountBtn').classList.add('active'); document.getElementById('discountPercentBtn').classList.remove('active'); renderCart(); };
  document.getElementById('discountPercentBtn').onclick = ()=> { setDiscountType('percent'); persistAll(); document.getElementById('discountPercentBtn').classList.add('active'); document.getElementById('discountAmountBtn').classList.remove('active'); renderCart(); };
  document.getElementById('discountValue').addEventListener('input', ()=>{ handleDiscountInput(); renderCart(); });
  document.getElementById('clearCartBtn').onclick = ()=>{ state.cart=[]; state.editingOrderId=null; renderCart(); };
  document.getElementById('printCartReceiptBtn').onclick = ()=>{
    if(!state.cart.length) return alert('請先加入商品');
    printOrderReceipt(buildCartPreviewOrder(), 'customer');
  };
  document.getElementById('printCartLabelBtn').onclick = ()=>{
    if(!state.cart.length) return alert('請先加入商品');
    printOrderLabels(buildCartPreviewOrder());
  };
  document.getElementById('checkoutBtn').onclick = ()=>{
    if(!state.cart.length) return alert('請先加入商品');
    document.getElementById('paymentTargetMode').value = 'new';
    document.getElementById('paymentTargetOrderId').value = state.editingOrderId || '';
    document.getElementById('paymentModal').classList.remove('hidden');
  };
  document.getElementById('closePaymentModal').onclick = ()=> document.getElementById('paymentModal').classList.add('hidden');
  document.querySelector('#paymentModal .modal-backdrop').onclick = ()=> document.getElementById('paymentModal').classList.add('hidden');
  document.querySelectorAll('.pay-btn').forEach(btn=> btn.onclick = ()=> finalizeOrder(btn.dataset.payment));

  if(getDiscountType() === 'percent'){
    document.getElementById('discountPercentBtn').classList.add('active');
    document.getElementById('discountAmountBtn').classList.remove('active');
  }
}