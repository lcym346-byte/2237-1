/* 中文備註：js/pages/pos-page.js，此檔已加入中文說明，方便後續維護。 */
/* 中文備註：js/pages/pos-page.js，此檔已加入中文說明，方便後續維護。 */

import { state, persistAll } from '../core/store.js';
import { escapeHtml, money, id } from '../core/utils.js';
import { getDiscountResult, getDiscountType, setDiscountType, handleDiscountInput } from '../modules/cart-service.js';
import { createOrUpdateOrder, markPendingOrderPaid } from '../modules/order-service.js';
import { buildCartPreviewOrder, getPrintSettings, printOrderLabels, printOrderReceipt, printKitchenCopies, openCashDrawer, getReceiptHtml } from '../modules/print-service.js';
import { hasOpenSession } from '../modules/report-session.js';

// ── 預約功能（POS 端） ──
const POS_WEEKDAY_MAP = ['sun','mon','tue','wed','thu','fri','sat'];

function posGetBusinessHours(){
  const bh = (state.settings && state.settings.businessHours) || {};
  ['mon','tue','wed','thu','fri','sat','sun'].forEach(k => { if(!Array.isArray(bh[k])) bh[k] = []; });
  return bh;
}

function posPad2(n){ return String(n).padStart(2,'0'); }

function posCeilToQuarter(date){
  const d = new Date(date);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  const next = Math.ceil(m / 15) * 15;
  if(next === m){
    d.setMinutes(m + 15);
  } else if(next >= 60){
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  } else {
    d.setMinutes(next);
  }
  return d;
}

function posBuildReservationSlots(){
  const bh = posGetBusinessHours();
  const now = new Date();
  const earliest = new Date(now.getTime() + 60 * 60 * 1000);
  const start = posCeilToQuarter(earliest);
  const slots = [];
  for(let dayOffset = 0; dayOffset < 2; dayOffset++){
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const wkKey = POS_WEEKDAY_MAP[day.getDay()];
    const segments = bh[wkKey] || [];
    if(!segments.length) continue;
    segments.forEach(seg => {
      const [sH, sM] = seg.start.split(':').map(Number);
      const [eH, eM] = seg.end.split(':').map(Number);
      const segStart = new Date(day);
      segStart.setHours(sH, sM, 0, 0);
      const segEnd = new Date(day);
      segEnd.setHours(eH, eM, 0, 0);
      if(segEnd <= segStart) segEnd.setDate(segEnd.getDate() + 1);
      let cursor = new Date(segStart);
      while(cursor < segEnd){
        if(cursor >= start) slots.push(new Date(cursor));
        cursor.setMinutes(cursor.getMinutes() + 15);
      }
    });
  }
  return slots;
}

function posFormatSlotLabel(date){
  const today = new Date();
  const isToday = date.getFullYear()===today.getFullYear() && date.getMonth()===today.getMonth() && date.getDate()===today.getDate();
  const tmr = new Date(today);
  tmr.setDate(tmr.getDate()+1);
  const isTmr = date.getFullYear()===tmr.getFullYear() && date.getMonth()===tmr.getMonth() && date.getDate()===tmr.getDate();
  const prefix = isToday ? '今天' : (isTmr ? '明天' : `${date.getMonth()+1}/${date.getDate()}`);
  return `${prefix} ${posPad2(date.getHours())}:${posPad2(date.getMinutes())}`;
}

function posRenderReservationSlots(){
  const sel = document.getElementById('posReservationSlot');
  if(!sel) return;
  const slots = posBuildReservationSlots();
  sel.innerHTML = '';
  if(!slots.length){
    sel.innerHTML = '<option value="">目前無可預約時段</option>';
    return;
  }
  sel.innerHTML = '<option value="">請選擇預約時段</option>' + slots.map(d => {
    const iso = `${d.getFullYear()}-${posPad2(d.getMonth()+1)}-${posPad2(d.getDate())}T${posPad2(d.getHours())}:${posPad2(d.getMinutes())}:00`;
    return `<option value="${iso}">${posFormatSlotLabel(d)}</option>`;
  }).join('');
}

function posTogglePosReservationBlock(){
  const type = document.getElementById('orderType').value;
  const sel = document.getElementById('posReservationSlot');
  if(!sel) return;
  if(type === '預約'){
    sel.style.display = 'inline-block';
    posRenderReservationSlots();
  } else {
    sel.style.display = 'none';
    sel.value = '';
  }
}

window.posTogglePosReservationBlock = posTogglePosReservationBlock;

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
    const isMulti = mod.selection === 'multi';
    const minSel = isMulti ? (Number(mod.minSelect) || 0) : 0;
    const maxSel = isMulti ? (mod.maxSelect == null ? null : Number(mod.maxSelect)) : null;

    // 規則提示文字
    let ruleHint = isMulti ? '多選' : '單選';
    if(isMulti){
      if(minSel > 0 && maxSel != null && minSel === maxSel) ruleHint = `多選（須選 ${minSel} 項）`;
      else if(minSel > 0 && maxSel != null) ruleHint = `多選（${minSel}〜${maxSel} 項）`;
      else if(maxSel != null) ruleHint = `多選（最多 ${maxSel} 項）`;
      else if(minSel > 0) ruleHint = `多選（至少 ${minSel} 項）`;
    }

    const block = document.createElement('div');
    block.className = 'module-block';
    block.innerHTML = `
      <div class="module-header">
        <div>
          <strong>${escapeHtml(mod.name)}</strong>
          <div class="muted">${required ? '必選' : '非必選'}・${ruleHint}</div>
        </div>
      </div>
      <div class="option-list"></div>
    `;
    const list = block.querySelector('.option-list');
    const curSelArr = Array.isArray(state.currentSelections[mod.id]) ? state.currentSelections[mod.id] : [];
    const atMax = isMulti && maxSel != null && curSelArr.length >= maxSel;

    mod.options.filter(o=>o.enabled!==false).forEach(opt=>{
      const active = Array.isArray(state.currentSelections[mod.id]) ?
        state.currentSelections[mod.id].includes(opt.id) :
        state.currentSelections[mod.id] === opt.id;
      const disabled = isMulti && atMax && !active;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-chip' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
      if(disabled){
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
      }
      btn.innerHTML = `<span>${escapeHtml(opt.name)}</span><strong>${opt.price ? '+' + money(opt.price) : money(0)}</strong>`;
      btn.onclick = ()=>{
        if(isMulti){
          const arr = state.currentSelections[mod.id] || [];
          if(arr.includes(opt.id)){
            state.currentSelections[mod.id] = arr.filter(x=>x!==opt.id);
          } else {
            if(maxSel != null && arr.length >= maxSel) return; // 達上限不再加入
            state.currentSelections[mod.id] = [...arr, opt.id];
          }
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
    [...state.categories.filter(c => c !== '全部'), '全部'].forEach(cat=>{
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
    const kwOk = !keyword || [p.name, p.category].join(' ').includes(keyword);
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
  const listModal = document.getElementById('cartListModal');
   list.innerHTML = '';

  // 右側面板：只顯示品項、數量、金額
  if(!state.cart.length){
    list.className = 'cart-list empty';
    list.textContent = '尚未加入商品';
  } else {
    list.className = 'cart-list';
    state.cart.forEach(item=>{
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid #f1f5f9';
      row.innerHTML = `<span>${escapeHtml(item.name)} x${item.qty}</span><strong>${money((item.basePrice + item.extraPrice) * item.qty)}</strong>`;
      list.appendChild(row);
    });
  }

  // 浮動視窗：完整功能
  if(listModal) listModal.innerHTML = '';
  if(listModal && !state.cart.length){
    listModal.className = 'cart-list empty';
    listModal.textContent = '尚未加入商品';
  } else if(listModal){
    listModal.className = 'cart-list';
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
          ${item.productId !== '_discount_' ? '<button class="secondary-btn small-btn">編輯</button>' : ''}
          <button class="danger-btn small-btn">刪除</button>
        </div>
      `;
      const buttons = row.querySelectorAll('button');
      let btnIdx = 0;
      buttons[btnIdx++].onclick = ()=>{ item.qty = Math.max(1, item.qty-1); renderCart(); };
      buttons[btnIdx++].onclick = ()=>{ item.qty += 1; renderCart(); };
      if(item.productId !== '_discount_'){
        buttons[btnIdx++].onclick = ()=> openProductConfigForEdit(item.rowId);
      }
      buttons[btnIdx].onclick = ()=>{ state.cart = state.cart.filter(x=>x.rowId!==item.rowId); renderCart(); };
      listModal.appendChild(row);
    });
  }


  const subtotal = state.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);
  const total = Math.max(0, subtotal);

  document.getElementById('subtotalText').textContent = money(subtotal);
  document.getElementById('totalText').textContent = money(total);

  if(document.getElementById('subtotalTextModal'))
    document.getElementById('subtotalTextModal').textContent = money(subtotal);
  if(document.getElementById('totalTextModal'))
    document.getElementById('totalTextModal').textContent = money(total);

  const badge = document.getElementById('cartBadge');
  if(badge) badge.textContent = state.cart.reduce((s,x)=> s + x.qty, 0);
}

function finalizeOrder(paymentMethod){
    var mode = document.getElementById('paymentTargetMode').value || 'new';
    var targetOrderId = document.getElementById('paymentTargetOrderId').value || '';
    var printConfig = getPrintSettings();

    var order = null;

    if(mode === 'pending'){
        order = markPendingOrderPaid(targetOrderId, paymentMethod);
        document.getElementById('paymentModal').classList.add('hidden');
        persistAll();
        window.refreshAllViews();

        // 開錢箱（依設定 openDrawer，且僅結帳時）
     if(order && paymentMethod === '現金'){
    openCashDrawer().catch(function(e){ console.error('開錢箱失敗:', e); });
}


// 列印顧客單（路由內部會自動選 Sunmi/藍牙/網路/瀏覽器）
if(order && paymentMethod !== '待付款' && printConfig.autoPrintCheckout){
    try { printOrderReceipt(order, 'customer'); }
    catch(e) { console.error('列印顧客單失敗:', e); }
}

// 列印廚房單
if(order && printConfig.autoPrintKitchen){
    try { printKitchenCopies(order); }
    catch(e) { console.error('列印廚房單失敗:', e); }
}


        alert(paymentMethod === '待付款' ? '仍維持待付款' : '已完成收款');
        return;
    }

    order = createOrUpdateOrder(paymentMethod);
    document.getElementById('paymentModal').classList.add('hidden');
    persistAll();
    window.refreshAllViews();

    // 開錢箱（僅現金付款）
if(order && paymentMethod === '現金'){
    openCashDrawer().catch(function(e){ console.error('開錢箱失敗:', e); });
}
// 列印顧客單（路由內部會自動選 Sunmi/藍牙/網路/瀏覽器）
if(order && paymentMethod !== '待付款' && printConfig.autoPrintCheckout){
    try { printOrderReceipt(order, 'customer'); }
    catch(e) { console.error('列印顧客單失敗:', e); }
}

// 列印廚房單
if(order && printConfig.autoPrintKitchen){
    try { printKitchenCopies(order); }
    catch(e) { console.error('列印廚房單失敗:', e); }
}

    alert(paymentMethod === '待付款' ? '已加入待付款' : '結帳完成');
}


export function initPOSPage(){
    // 預約：訂單類型切換時切換時段選擇器
  const _otSel = document.getElementById('orderType');
  if(_otSel) _otSel.addEventListener('change', posTogglePosReservationBlock);
  posTogglePosReservationBlock();

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
      const isMulti = mod.selection === 'multi';

      if(required){
        const missing = Array.isArray(val) ? val.length === 0 : !val;
        if(missing) return alert(`請先選擇「${mod.name}」`);
      }

      // 複選數量驗證
      if(isMulti){
        const cnt = Array.isArray(val) ? val.length : 0;
        const minSel = Number(mod.minSelect) || 0;
        const maxSel = mod.maxSelect == null ? null : Number(mod.maxSelect);
        if(required && cnt < Math.max(1, minSel)){
          return alert(`「${mod.name}」至少需選 ${Math.max(1, minSel)} 項`);
        }
        if(!required && minSel > 0 && cnt > 0 && cnt < minSel){
          return alert(`「${mod.name}」若要選擇，至少需選 ${minSel} 項`);
        }
        if(maxSel != null && cnt > maxSel){
          return alert(`「${mod.name}」最多只能選 ${maxSel} 項`);
        }
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

      document.getElementById('checkoutBtn').onclick = ()=>{
    if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
    if(!state.cart.length) return alert('請先加入商品');
    // 預約：必須選時段
    const _ot = document.getElementById('orderType').value;
    if(_ot === '預約'){
      const _slot = document.getElementById('posReservationSlot').value;
      if(!_slot) return alert('請選擇預約取餐時段');
    }
    document.getElementById('paymentTargetMode').value = 'new';
    document.getElementById('paymentTargetOrderId').value = state.editingOrderId || '';
    document.getElementById('paymentModal').classList.remove('hidden');
  };


  document.getElementById('closePaymentModal').onclick = ()=> document.getElementById('paymentModal').classList.add('hidden');
  document.querySelector('#paymentModal .modal-backdrop').onclick = ()=> document.getElementById('paymentModal').classList.add('hidden');
  document.querySelectorAll('.pay-btn').forEach(btn=> btn.onclick = ()=> finalizeOrder(btn.dataset.payment));
  if(document.getElementById('cartModalBtn')){
    document.getElementById('cartModalBtn').onclick = ()=>{
      document.getElementById('cartModal').style.display = 'flex';
    };
  }
  if(document.getElementById('closeCartModal')){
    document.getElementById('closeCartModal').onclick = ()=>{
      document.getElementById('cartModal').style.display = 'none';
    };
  }
  if(document.getElementById('cartModal')){
    document.getElementById('cartModal').onclick = (e)=>{
      if(e.target.id === 'cartModal') document.getElementById('cartModal').style.display = 'none';
    };
  }

  if(document.getElementById('checkoutBtnModal')){
    document.getElementById('checkoutBtnModal').onclick = ()=>{
      document.getElementById('cartModal').style.display = 'none';
      document.getElementById('checkoutBtn').click();
    };
  }
  if(document.getElementById('clearCartBtnModal')){
    document.getElementById('clearCartBtnModal').onclick = ()=>{
      state.cart = [];
      state.editingOrderId = null;
      renderCart();
    };
  }
  document.getElementById('discountAmountBtn').onclick = ()=>{
    const val = prompt('請輸入折扣金額（正數）');
    if(!val) return;
    const amount = Math.abs(Number(val));
    if(!amount || amount <= 0) return alert('請輸入正確金額');
    mergeOrPushCartItem({
      rowId: id(),
      productId: '_discount_',
      name: '折扣 -$' + amount,
      basePrice: -amount,
      qty: 1,
      note: '',
      selections: [],
      extraPrice: 0
    });
    renderCart();
  };
  document.getElementById('discountPercentBtn').onclick = ()=>{
    const val = prompt('請輸入折扣百分比（例如：10 表示打9折）');
    if(!val) return;
    const percent = Math.abs(Number(val));
    if(!percent || percent <= 0 || percent >= 100) return alert('請輸入 1～99 之間的數字');
    const subtotal = state.cart.reduce((s,x)=> s + (x.basePrice + x.extraPrice) * x.qty, 0);
    const discountAmount = Math.round(subtotal * percent / 100);
    if(discountAmount <= 0) return alert('目前購物車金額為 0，無法計算折扣');
    mergeOrPushCartItem({
      rowId: id(),
      productId: '_discount_',
      name: '折扣 ' + percent + '% (-$' + discountAmount + ')',
      basePrice: -discountAmount,
      qty: 1,
      note: '',
      selections: [],
      extraPrice: 0
    });
    renderCart();
  };
  // ── 06.16/5：未開班鎖定 POS 頁 ──
  refreshPosLockState();
  // 切換到 POS 頁時刷新鎖定狀態
  const posNavBtn = document.querySelector('[data-view="posView"]');
  if(posNavBtn){
    posNavBtn.addEventListener('click', refreshPosLockState);
  }
    // 首頁側邊「開啟錢箱」按鈕
  const _drawerBtn = document.getElementById('openCashDrawerBtn');
  if(_drawerBtn){
    _drawerBtn.addEventListener('click', async ()=>{
      try{
        const ok = await openCashDrawer();
        if(!ok) alert('開啟錢箱失敗：未偵測到可用印表機，請確認 Sunmi 服務是否運行');
      }catch(e){
        alert('開啟錢箱失敗：' + (e.message || e));
      }
    });
  }

  // 開/結班後可呼叫 window.refreshPosLockState 以即時更新
  window.refreshPosLockState = refreshPosLockState;

}
// ── 06.16/5：依班次狀態決定是否鎖定 POS 頁 ──
function refreshPosLockState(){
  const lock = document.getElementById('posLockOverlay');
  if(!lock) return;
  if(hasOpenSession()){
    lock.style.display = 'none';
  } else {
    lock.style.display = 'flex';
  }
}

