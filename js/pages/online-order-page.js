/* 中文備註：線上點餐頁邏輯（多店分流版）。
 * 變更：
 *   - 進站讀 URL ?storeId=TWxxx 存到 onlineState.storeCode
 *   - 沒帶 storeId 顯示提示頁，禁止下單
 *   - submitOnlineOrder() / watchCustomerOrder() 都帶 storeCode
 */
import { state } from '../core/store.js';
import { escapeHtml, id, money, fmtLocalDateTime} from '../core/utils.js';
import { getRealtimeConfig, pushOnlineOrder, watchCustomerOrder, fetchMenuFromFirebase, startMenuAutoWatch } from '../modules/realtime-order-service.js';
import { lookupOrdersByCustomer } from '../modules/customer-service.js';
import { mountPromotionOnlineUI, refreshPromotionDisplay, getCurrentPromotionResult } from '../modules/promotion-ui.js';
import { pullPromotionsFromCloud } from '../modules/promotion-service.js';

const onlineState = {
  selectedCategory: '全部',
  cart: [],
  currentSelections: {},
  configTarget: null,
  storeCode: ''      // ← 多店分流：從 URL 取得
};

// ============================================================
// 從 URL 取 storeId
// ============================================================
function readStoreCodeFromUrl(){
  try{
    const params = new URLSearchParams(window.location.search);
    const code = String(params.get('storeId') || '').trim();
    if(!code) return '';
    if(/[.#$\/\[\]]/.test(code)) return '';
    return code;
  }catch(e){
    return '';
  }
}

function showMissingStoreCodePage(){
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;padding:24px;font-family:-apple-system,'Microsoft JhengHei',sans-serif">
      <div style="max-width:420px;background:#1e293b;border-radius:16px;padding:32px;text-align:center;border:2px solid #ef4444">
        <div style="font-size:48px;margin-bottom:16px">🚫</div>
        <h1 style="font-size:22px;margin:0 0 12px">無法直接下單</h1>
        <p style="color:#94a3b8;margin:0 0 16px;line-height:1.7">
          此連結缺少店家代碼。請從<br>
          <strong style="color:#fbbf24">店家提供的 QR code</strong><br>
          掃描進入點餐頁面。
        </p>
        <div style="background:rgba(239,68,68,0.1);border:1px solid #ef4444;border-radius:8px;padding:12px;font-size:13px;color:#fca5a5;margin-top:16px">
          正確的網址應該長這樣：<br>
          <code style="color:#fbbf24">online-order.html?storeId=TWxxx</code>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// 共用 UI
// ============================================================
function showOnlineToast(message){
  let toast = document.getElementById('onlineToast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'onlineToast';
    toast.className = 'online-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showOnlineToast._timer);
  showOnlineToast._timer = setTimeout(()=> toast.classList.remove('show'), 1600);
}

function getStoreName(){
  return state.settings?.realtimeOrder?.onlineStoreTitle || state.settings?.printConfig?.storeName || '立即點餐';
}

function getStoreMeta(){
  return state.settings?.realtimeOrder?.onlineStoreSubtitle || '內用 / 外帶皆可';
}

function createConfigState(product){
  const selections = {};
  for(const att of product.modules || []){
    const mod = state.modules.find(m => m.id === att.moduleId);
    if(mod) selections[mod.id] = mod.selection === 'multi' ? [] : null;
  }
  return selections;
}

function flattenSelections(product){
  const rows = [];
  for(const att of product.modules || []){
    const mod = state.modules.find(m => m.id === att.moduleId);
    if(!mod) continue;
    const val = onlineState.currentSelections[mod.id];
    if(Array.isArray(val)){
      val.forEach(idv=>{
        const opt = mod.options.find(o=>o.id===idv);
        if(opt) rows.push({moduleId:mod.id, moduleName:mod.name, optionId:opt.id, optionName:opt.name, price:opt.price});
      });
    }else if(val){
      const opt = mod.options.find(o=>o.id===val);
      if(opt) rows.push({moduleId:mod.id, moduleName:mod.name, optionId:opt.id, optionName:opt.name, price:opt.price});
    }
  }
  return rows;
}

function sameSelections(a=[], b=[]){
  if(a.length !== b.length) return false;
  const format = rows => rows.map(x=>`${x.moduleId}:${x.optionId}`).sort().join('|');
  return format(a) === format(b);
}

function mergeOrPushCartItem(payload){
  const existing = onlineState.cart.find(item =>
    item.productId === payload.productId &&
    String(item.note || '') === String(payload.note || '') &&
    Number(item.basePrice || 0) === Number(payload.basePrice || 0) &&
    Number(item.extraPrice || 0) === Number(payload.extraPrice || 0) &&
    sameSelections(item.selections || [], payload.selections || [])
  );
  if(existing) existing.qty += payload.qty;
  else onlineState.cart.push(payload);
}

function renderCategoryTabs(){
  const wrap = document.getElementById('onlineCategoryTabs');
  const cats = Array.isArray(state.categories) ? state.categories : [];
  const categories = [...cats.filter(c => c && c !== '全部'), '全部'];
  wrap.innerHTML = categories.map(c => `<button class="online-category-chip ${onlineState.selectedCategory===c ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  wrap.querySelectorAll('button').forEach(btn=>{
    btn.onclick = ()=>{
      onlineState.selectedCategory = btn.dataset.category;
      renderCategoryTabs();
      renderProducts();
    };
  });
}

function renderProducts(){
  const keyword = document.getElementById('onlineSearchInput').value.trim();
  const grid = document.getElementById('onlineProductGrid');
  const prods = Array.isArray(state.products) ? state.products : [];
  const list = [...prods].sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).filter(p=>{
    if(p.enabled === false) return false;
    const catOk = onlineState.selectedCategory === '全部' || p.category === onlineState.selectedCategory;
    const kwOk = !keyword || [p.name, p.category, ...(p.aliases||[])].join(' ').includes(keyword);
    return catOk && kwOk;
  });
  if(!list.length){
    grid.innerHTML = '<div class="online-empty card">目前沒有符合的商品</div>';
    return;
  }
  grid.innerHTML = '';
  list.forEach(p=>{
    const moduleNames = (p.modules||[]).map(att=> state.modules.find(m=>m.id===att.moduleId)?.name).filter(Boolean);
    const card = document.createElement('div');
    card.className = 'online-product-card';
    card.innerHTML = `
      ${p.image ? `<div class="online-product-image"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"></div>` : '<div class="online-product-image"></div>'}
      <div class="online-product-body">
        <div class="online-product-title-row">
          <div class="online-product-name">${escapeHtml(p.name)}</div>
          <div class="online-product-price">${money(p.price)}</div>
        </div>
        ${p.description ? `<div class="online-product-desc">${escapeHtml(p.description)}</div>` : ''}
        <div class="online-product-footer"><button class="primary-btn full">加入購物車</button></div>
      </div>
    `;
    card.querySelector('button').onclick = ()=> openProductConfigForNew(p.id);
    grid.appendChild(card);
  });
}

function updateItemPricePreview(product){
  let add = 0;
  const selections = flattenSelections(product);
  selections.forEach(s=> add += Number(s.price || 0));
  const qty = Math.max(1, Number(document.getElementById('onlineItemQtyInput').value || 1));
  document.getElementById('onlineItemPricePreview').textContent = '小計：' + money((Number(product.price||0) + add) * qty);
}

function renderProductConfig(product){
  document.getElementById('onlineModalTitle').textContent = product.name;
  const imageWrap = document.getElementById('onlineModalImageWrap');
  imageWrap.innerHTML = '';
  imageWrap.classList.add('hidden');

  const wrap = document.getElementById('onlineModalModules');
  wrap.innerHTML = '';
  (product.modules || []).forEach(att=>{
    const mod = state.modules.find(m=>m.id===att.moduleId);
    if(!mod) return;
// 注意：requiredOverride 不能用 === null，因為 Firebase 會把 null 吃掉，
//       同步回顧客端時會變 undefined（不是 null）。用 == null 同時涵蓋兩者。
const required = (att.requiredOverride == null) ? mod.required : att.requiredOverride;
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
      const active = Array.isArray(onlineState.currentSelections[mod.id])
        ? onlineState.currentSelections[mod.id].includes(opt.id)
        : onlineState.currentSelections[mod.id] === opt.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-chip' + (active ? ' active' : '');
      btn.innerHTML = `<span>${escapeHtml(opt.name)}</span><strong>${opt.price ? '+' + money(opt.price) : money(0)}</strong>`;
      btn.onclick = ()=>{
        if(mod.selection === 'multi'){
          const arr = onlineState.currentSelections[mod.id] || [];
          if(arr.includes(opt.id)) onlineState.currentSelections[mod.id] = arr.filter(x=>x!==opt.id);
          else onlineState.currentSelections[mod.id] = [...arr, opt.id];
        } else {
          onlineState.currentSelections[mod.id] = onlineState.currentSelections[mod.id] === opt.id ? null : opt.id;
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
  const product = state.products.find(p=>p.id===productId && p.enabled!==false);
  if(!product) return;
  onlineState.configTarget = { mode:'new', productId };
  onlineState.currentSelections = createConfigState(product);
  document.getElementById('onlineItemNoteInput').value = '';
  document.getElementById('onlineItemQtyInput').value = 1;
  renderProductConfig(product);
  document.getElementById('onlineProductModal').classList.remove('hidden');
}

function openProductConfigForEdit(rowId){
  const item = onlineState.cart.find(x=>x.rowId===rowId);
  if(!item) return;
  const product = state.products.find(p=>p.id===item.productId && p.enabled!==false);
  if(!product) return;
  onlineState.configTarget = { mode:'edit', rowId, productId:item.productId };
  onlineState.currentSelections = createConfigState(product);
  (item.selections || []).forEach(sel=>{
    if(Array.isArray(onlineState.currentSelections[sel.moduleId])) onlineState.currentSelections[sel.moduleId].push(sel.optionId);
    else onlineState.currentSelections[sel.moduleId] = sel.optionId;
  });
  document.getElementById('onlineItemNoteInput').value = item.note || '';
  document.getElementById('onlineItemQtyInput').value = item.qty || 1;
  renderProductConfig(product);
  document.getElementById('onlineProductModal').classList.remove('hidden');
}

function closeProductConfig(){
  document.getElementById('onlineProductModal').classList.add('hidden');
  onlineState.configTarget = null;
  onlineState.currentSelections = {};
}

function renderCart(){
  const list = document.getElementById('onlineCartList');
  list.innerHTML = '';
  if(!onlineState.cart.length){
    list.innerHTML = '<div class="online-empty">尚未加入商品</div>';
  }else{
    onlineState.cart.forEach(item=>{
      const desc = (item.selections||[]).map(s=> `${s.moduleName}:${s.optionName}`).join(' / ');
      const row = document.createElement('div');
      row.className = 'online-cart-item';
      row.innerHTML = `
        <div class="row between wrap">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            ${desc ? `<div class="muted">${escapeHtml(desc)}</div>` : ''}
            ${item.note ? `<div class="muted">備註：${escapeHtml(item.note)}</div>` : ''}
          </div>
          <strong>${money((item.basePrice + item.extraPrice) * item.qty)}</strong>
        </div>
        <div class="row gap wrap" style="margin-top:10px">
          <button class="secondary-btn small-btn minus-btn">-</button>
          <span>${item.qty}</span>
          <button class="secondary-btn small-btn plus-btn">+</button>
          <button class="secondary-btn small-btn edit-btn">編輯</button>
          <button class="danger-btn small-btn delete-btn">刪除</button>
        </div>
      `;
      row.querySelector('.minus-btn').onclick = ()=>{ item.qty = Math.max(1, item.qty - 1); renderCart(); };
      row.querySelector('.plus-btn').onclick = ()=>{ item.qty += 1; renderCart(); };
      row.querySelector('.edit-btn').onclick = ()=> openProductConfigForEdit(item.rowId);
      row.querySelector('.delete-btn').onclick = ()=>{ onlineState.cart = onlineState.cart.filter(x => x.rowId !== item.rowId); renderCart(); };
      list.appendChild(row);
    });
  }
  const subtotal = onlineState.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);
  const totalQty = onlineState.cart.reduce((s,x)=>s + x.qty, 0);
  document.getElementById('onlineSubtotalText').textContent = money(subtotal);
  document.getElementById('onlineTotalQtyText').textContent = String(totalQty);
  document.getElementById('openCartBtn').innerHTML = `購物車 <span id="cartQtyBadge">${totalQty}</span>`;
  updateFloatingCartBadge();

    if(typeof window.__refreshOnlinePromotion === 'function') window.__refreshOnlinePromotion();

}

function openCartDrawer(){ document.getElementById('onlineCartDrawer').classList.remove('hidden'); }
function closeCartDrawer(){ document.getElementById('onlineCartDrawer').classList.add('hidden'); }

function openStatusOverlay(title, text, closable = false){
  document.getElementById('onlineOrderStatusTitle').textContent = title;
  document.getElementById('onlineOrderStatusText').textContent = text;
  document.getElementById('closeOnlineStatusBtn').classList.toggle('hidden', !closable);
  document.getElementById('onlineOrderStatusOverlay').classList.remove('hidden');
}
function closeStatusOverlay(){ document.getElementById('onlineOrderStatusOverlay').classList.add('hidden'); }

function formatDateTimeText(isoString){
  if(!isoString) return '';
  const date = new Date(isoString);
  if(Number.isNaN(date.getTime())) return String(isoString).replace('T',' ').slice(0,16);
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function buildConfirmedMessage(remote, orderId){
  const parts = [`訂單編號：${remote.orderNo || orderId}`];
  if(remote.prepTimeMinutes) parts.push(`預估備餐 ${remote.prepTimeMinutes} 分鐘`);
  if(remote.estimatedReadyAt) parts.push(`預計完成時間：${formatDateTimeText(remote.estimatedReadyAt)}`);
  if(remote.replyMessage) parts.push(remote.replyMessage);
  return parts.join('，');
}

// ── 預約功能 ──
const WEEKDAY_MAP = ['sun','mon','tue','wed','thu','fri','sat'];

function getBusinessHoursConfig(){
  const bh = (state.settings && state.settings.businessHours) || {};
  ['mon','tue','wed','thu','fri','sat','sun'].forEach(k => { if(!Array.isArray(bh[k])) bh[k] = []; });
  return bh;
}

function pad2(n){ return String(n).padStart(2,'0'); }

function ceilToQuarter(date){
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

function buildReservationSlots(){
  const bh = getBusinessHoursConfig();
  const now = new Date();
  const earliest = new Date(now.getTime() + 60 * 60 * 1000);
  const start = ceilToQuarter(earliest);

  const slots = [];
  for(let dayOffset = 0; dayOffset < 2; dayOffset++){
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const wkKey = WEEKDAY_MAP[day.getDay()];
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
        if(cursor >= start){
          slots.push(new Date(cursor));
        }
        cursor.setMinutes(cursor.getMinutes() + 15);
      }
    });
  }
  return slots;
}

function formatSlotLabel(date){
  const today = new Date();
  const isToday = date.getFullYear()===today.getFullYear() && date.getMonth()===today.getMonth() && date.getDate()===today.getDate();
  const tmr = new Date(today);
  tmr.setDate(tmr.getDate()+1);
  const isTmr = date.getFullYear()===tmr.getFullYear() && date.getMonth()===tmr.getMonth() && date.getDate()===tmr.getDate();
  const prefix = isToday ? '今天' : (isTmr ? '明天' : `${date.getMonth()+1}/${date.getDate()}`);
  return `${prefix} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function renderReservationSlots(){
  const sel = document.getElementById('onlineReservationSlot');
  if(!sel) return;
  const slots = buildReservationSlots();
  sel.innerHTML = '';
  if(!slots.length){
    sel.innerHTML = '<option value="">目前無可預約時段（公休或已過營業時間）</option>';
    return;
  }
  sel.innerHTML = '<option value="">請選擇時段</option>' + slots.map(d => {
    const iso = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
    return `<option value="${iso}">${formatSlotLabel(d)}</option>`;
  }).join('');
}

function toggleReservationBlock(){
  const type = document.getElementById('onlineOrderType').value;
  const block = document.getElementById('onlineReservationBlock');
  if(!block) return;
  if(type === '預約'){
    block.style.display = 'block';
    renderReservationSlots();
  } else {
    block.style.display = 'none';
  }
}

// ============================================================
// 送單（帶 storeCode）
// ============================================================
async function submitOnlineOrder(){
  if(!onlineState.cart.length) return alert('請先加入商品');
  if(!onlineState.storeCode) return alert('缺少店家代碼，請從店家提供的 QR code 重新進入');

  const name = document.getElementById('onlineCustomerName').value.trim();
  const phone = document.getElementById('onlineCustomerPhone').value.trim();
  const customerNote = document.getElementById('onlineCustomerNote').value.trim();
  const orderType = document.getElementById('onlineOrderType').value || '外帶';
  if(!name) return alert('請輸入姓名');
  if(!phone) return alert('請輸入電話');

 let reservationAt = '';
  if(orderType === '預約'){
    reservationAt = document.getElementById('onlineReservationSlot').value;
    if(!reservationAt) return alert('請選擇預約取餐時段');
  } else {
    // 非營業時間禁止外帶/內用下單，只允許改用「預約」並挑選營業時段
    // 注意：營業時間判斷沿用「預約」用的 getBusinessHoursConfig() 與 WEEKDAY_MAP，
    // 兩邊永遠同一份設定，未來改預約規則這裡會跟著對。
    const _bh = getBusinessHoursConfig();
    const _now = new Date();
    const _todayKey = WEEKDAY_MAP[_now.getDay()];
    const _todaySegs = Array.isArray(_bh[_todayKey]) ? _bh[_todayKey] : [];
    let _isOpen = false;
    for(const seg of _todaySegs){
      if(!seg || !seg.start || !seg.end) continue;
      const [sH, sM] = String(seg.start).split(':').map(Number);
      const [eH, eM] = String(seg.end).split(':').map(Number);
      if(Number.isNaN(sH) || Number.isNaN(eH)) continue;
      const segStart = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), sH, sM, 0, 0);
      const segEnd   = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), eH, eM, 0, 0);
      if(segEnd <= segStart) segEnd.setDate(segEnd.getDate() + 1); // 跨日（同預約寫法）
      if(_now >= segStart && _now < segEnd){ _isOpen = true; break; }
    }
    if(!_isOpen){
      // 再檢查「前一天的跨日時段」尾巴（例：昨天 14:00–今天 03:00，現在是凌晨 02:00）
      const _yest = new Date(_now); _yest.setDate(_yest.getDate() - 1);
      const _yestKey = WEEKDAY_MAP[_yest.getDay()];
      const _yestSegs = Array.isArray(_bh[_yestKey]) ? _bh[_yestKey] : [];
      for(const seg of _yestSegs){
        if(!seg || !seg.start || !seg.end) continue;
        const [sH, sM] = String(seg.start).split(':').map(Number);
        const [eH, eM] = String(seg.end).split(':').map(Number);
        if(Number.isNaN(sH) || Number.isNaN(eH)) continue;
        const segStart = new Date(_yest.getFullYear(), _yest.getMonth(), _yest.getDate(), sH, sM, 0, 0);
        const segEnd   = new Date(_yest.getFullYear(), _yest.getMonth(), _yest.getDate(), eH, eM, 0, 0);
        if(segEnd <= segStart){
          segEnd.setDate(segEnd.getDate() + 1);
          if(_now >= segStart && _now < segEnd){ _isOpen = true; break; }
        }
      }
    }
    if(!_isOpen){
      alert('目前為非營業時間，外帶／內用暫停接單。\n請改選「預約」並挑選店家營業時段內的取餐時間。');
      document.getElementById('onlineOrderType').value = '預約';
      toggleReservationBlock();
      return;
    }
  }



  const realtimeCfg = getRealtimeConfig();
  if(!realtimeCfg.enabled) return alert('店家尚未啟用即時接單');

    const subtotal = onlineState.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);

  // ===== 套用優惠碼／促銷 =====
  // 從 promotion-ui 取得目前套用結果；若沒有或無效就視為無折扣
  let promoCode = '';
  let promoDiscount = 0;
  let promoMessage = '';
  try{
    const promo = getCurrentPromotionResult();
    if(promo && promo.ok && Number(promo.discount) > 0){
      promoCode = String(promo.code || '').toUpperCase();
      promoDiscount = Math.min(Number(promo.discount) || 0, subtotal); // 折扣不超過小計
      promoMessage = String(promo.message || '');
    }
  }catch(e){
    console.warn('[online-order] 取得促銷結果失敗', e);
  }
  const grandTotal = Math.max(0, subtotal - promoDiscount);

  const payload = {
    orderNo: 'ON' + Date.now(),
    customerName: name,
    customerPhone: phone,
    customerNote,
    orderType: '線上點餐-' + orderType,
    reservationAt,
    reservationReminded: false,
    items: JSON.parse(JSON.stringify(onlineState.cart)),
    subtotal,
    discount: promoDiscount,
    couponCode: promoCode,
    couponMessage: promoMessage,
    total: grandTotal
  };


  try{
    openStatusOverlay('等待店家確認訂單', '送出後請稍候，店家確認後才算完成訂購。');
    const orderId = await pushOnlineOrder(payload, onlineState.storeCode);
    localStorage.setItem('online_customer_name', name);
    localStorage.setItem('online_customer_phone', phone);

    const { signInCustomerAnonymously } = await import('../modules/realtime-order-service.js');
        await signInCustomerAnonymously();
    const stopWatch = await watchCustomerOrder(orderId, (remote)=>{
      if(!remote) return;
      if(remote.status === 'confirmed'){
        onlineState.cart = [];
        renderCart();
        closeCartDrawer();
        document.getElementById('onlineCustomerNote').value = '';
        openStatusOverlay('店家已確認訂單', buildConfirmedMessage(remote, orderId), true);
        try{ stopWatch(); }catch(e){}
        window.removeEventListener('beforeunload', onlineState._cleanupWatch);
        onlineState._cleanupWatch = null;
      }else if(remote.status === 'rejected'){
        openStatusOverlay('店家已拒絕訂單', remote.replyMessage || '很抱歉，店家目前無法接單，請稍後再試。', true);
        try{ stopWatch(); }catch(e){}
        window.removeEventListener('beforeunload', onlineState._cleanupWatch);
        onlineState._cleanupWatch = null;
      }else{
        const pendingText = remote.replyMessage || '訂單已送出，請稍候店家確認。';
        openStatusOverlay('等待店家確認訂單', pendingText);
      }
    }, onlineState.storeCode);
    // 頁面關閉時自動解除監聽，避免記憶體洩漏
    onlineState._cleanupWatch = ()=>{ try{ stopWatch(); }catch(e){} };
    window.addEventListener('beforeunload', onlineState._cleanupWatch);
  }catch(err){

    closeStatusOverlay();
    alert(err.message || '送出訂單失敗');
  }
}

// ============================================================
// 初始化
// ============================================================
async function init(){
  // 步驟 1：先檢查 storeId
  const code = readStoreCodeFromUrl();
  if(!code){
    showMissingStoreCodePage();
    return;
  }
  onlineState.storeCode = code;

  // 顧客端不需做雲端備份（那是 POS 主機的功能），關掉避免每 10 秒噴 PERMISSION_DENIED
  try{
    if(state.settings && state.settings.cloudBackup){
      state.settings.cloudBackup.enabled = false;
    }
  }catch(e){}

  onlineState.storeCode = code;

  // 步驟 2：頁首顯示店名（先用 URL 帶的 storeName，否則顯示 storeCode）
  try{
    const params = new URLSearchParams(window.location.search);
    const urlStoreName = params.get('storeName');
    document.getElementById('onlineStoreName').textContent = urlStoreName || getStoreName();
    document.getElementById('onlineStoreMeta').textContent = `${getStoreMeta()}（${code}）`;
  }catch(e){
    document.getElementById('onlineStoreName').textContent = getStoreName();
    document.getElementById('onlineStoreMeta').textContent = getStoreMeta();
  }

    // 步驟 3：讀雲端菜單（手機可能因網路或 Firebase CDN 慢失敗，給重試機制）
  const grid = document.getElementById('onlineProductGrid');
  grid.innerHTML = '<div class="online-empty card">📡 載入店家菜單中…</div>';

  let menuLoaded = false;
  for(let attempt = 1; attempt <= 3 && !menuLoaded; attempt++){
    try{
      await fetchMenuFromFirebase();
      menuLoaded = true;
    }catch(err){
      console.warn(`讀取雲端菜單失敗（第 ${attempt} 次）：`, err);
      if(attempt < 3){
        grid.innerHTML = `<div class="online-empty card">📡 載入中…（重試 ${attempt}/3）</div>`;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }

  if(!menuLoaded){
    grid.innerHTML = `
      <div class="online-empty card" style="text-align:center;padding:32px">
        <div style="font-size:40px;margin-bottom:12px">⚠️</div>
        <div style="font-size:16px;margin-bottom:8px">無法載入店家菜單</div>
        <div class="muted" style="font-size:13px;margin-bottom:16px">請檢查網路連線後重新整理頁面</div>
        <button class="primary-btn" onclick="location.reload()">🔄 重新載入</button>
      </div>
    `;
    return;
  }

  try{
    await startMenuAutoWatch(() => {
      renderCategoryTabs();
      renderProducts();
    });
  }catch(err){
    console.warn('啟動菜單監聽失敗（不影響顯示）：', err);
  }

  renderCategoryTabs();
  renderProducts();
  renderCart();


  const _savedName = localStorage.getItem('online_customer_name') || '';
  const _savedPhone = localStorage.getItem('online_customer_phone') || '';
  const _nameEl = document.getElementById('onlineCustomerName');
  const _phoneEl = document.getElementById('onlineCustomerPhone');
  if(_nameEl && _savedName) _nameEl.value = _savedName;
  if(_phoneEl && _savedPhone) _phoneEl.value = _savedPhone;

  // 浮動購物車按鈕
  let floatBtn = document.getElementById('floatingCartBtn');
  if (!floatBtn) {
    floatBtn = document.createElement('button');
    floatBtn.id = 'floatingCartBtn';
    floatBtn.innerHTML = '🛒<span id="floatingCartBadge" style="display:none;">0</span>';
    floatBtn.onclick = () => {
      const drawer = document.getElementById('onlineCartDrawer');
      if (drawer) drawer.classList.remove('hidden');
    };
    document.body.appendChild(floatBtn);
  }
  updateFloatingCartBadge();

  document.getElementById('onlineOrderType').addEventListener('change', toggleReservationBlock);
  toggleReservationBlock();

  document.getElementById('onlineSearchInput').addEventListener('input', renderProducts);
  document.getElementById('onlineItemQtyInput').addEventListener('input', ()=>{
    const p = state.products.find(x=>x.id===onlineState.configTarget?.productId);
    if(p) updateItemPricePreview(p);
  });

  document.getElementById('openCartBtn').onclick = openCartDrawer;
  document.getElementById('closeCartBtn').onclick = closeCartDrawer;
  document.querySelector('.online-drawer-backdrop').onclick = closeCartDrawer;
  document.getElementById('closeOnlineProductModal').onclick = closeProductConfig;
  document.getElementById('cancelOnlineProductBtn').onclick = closeProductConfig;
  document.querySelector('#onlineProductModal .modal-backdrop').onclick = closeProductConfig;

  document.getElementById('saveOnlineProductBtn').onclick = ()=>{
    const product = state.products.find(p=>p.id===onlineState.configTarget?.productId);
    if(!product) return closeProductConfig();
    for(const att of product.modules || []){
      const mod = state.modules.find(m=>m.id===att.moduleId);
      if(!mod) continue;
      const required = att.requiredOverride == null ? mod.required : att.requiredOverride;
      const val = onlineState.currentSelections[mod.id];
      const missing = Array.isArray(val) ? val.length === 0 : !val;
      if(required && missing) return alert(`請先選擇「${mod.name}」`);
    // 複選時檢查「至少／最多」數量規則（POS 主機 pos-page.js 同款邏輯）
    if(mod.selection === 'multi' && Array.isArray(val)){
      const cnt = val.length;
      const minSel = (typeof mod.minSelect === 'number') ? mod.minSelect : (mod.required ? 1 : 0);
      const maxSel = (typeof mod.maxSelect === 'number') ? mod.maxSelect : null;
      if(required && cnt < Math.max(1, minSel)){
        return alert(`「${mod.name}」為必選，至少需選 ${Math.max(1, minSel)} 項（目前已選 ${cnt} 項）`);
      }
      if(minSel > 0 && cnt > 0 && cnt < minSel){
        return alert(`「${mod.name}」若要選擇，至少需選 ${minSel} 項（目前已選 ${cnt} 項）`);
      }
      if(maxSel != null && cnt > maxSel){
        return alert(`「${mod.name}」最多只能選 ${maxSel} 項（目前已選 ${cnt} 項）`);
      }
    }

    }
    const selections = flattenSelections(product);
    const extra = selections.reduce((s,x)=>s + Number(x.price||0), 0);
    const payload = {
      rowId: onlineState.configTarget?.mode === 'edit' ? onlineState.configTarget.rowId : id(),
      productId: product.id,
      name: product.name,
      basePrice: Number(product.price||0),
      qty: Math.max(1, Number(document.getElementById('onlineItemQtyInput').value || 1)),
      note: document.getElementById('onlineItemNoteInput').value.trim(),
      selections,
      extraPrice: extra
    };
    if(onlineState.configTarget?.mode === 'edit'){
      const idx = onlineState.cart.findIndex(x=>x.rowId===onlineState.configTarget.rowId);
      if(idx >= 0) onlineState.cart[idx] = payload;
      showOnlineToast('已更新購物車商品');
    }else{
      mergeOrPushCartItem(payload);
      showOnlineToast('已加入購物車');
    }
    closeProductConfig();
    renderCart();
  };

  document.getElementById('submitOnlineOrderBtn').onclick = submitOnlineOrder;
  document.getElementById('closeOnlineStatusBtn').onclick = closeStatusOverlay;

  // 我的訂單查詢
  const myOrdersBtn = document.getElementById('openMyOrdersBtn');
  if(myOrdersBtn){
    myOrdersBtn.onclick = ()=>{
      const modal = document.getElementById('myOrdersModal');
      try{
        document.getElementById('myOrdersNameInput').value = localStorage.getItem('online_customer_name') || '';
        document.getElementById('myOrdersPhoneInput').value = localStorage.getItem('online_customer_phone') || '';
      }catch(e){}
      document.getElementById('myOrdersResult').innerHTML = '';
      modal.classList.remove('hidden');
    };
  }
  const closeMyBtn = document.getElementById('closeMyOrdersBtn');
  if(closeMyBtn){
    closeMyBtn.onclick = ()=> document.getElementById('myOrdersModal').classList.add('hidden');
  }
  const searchMyBtn = document.getElementById('myOrdersSearchBtn');
  if(searchMyBtn){
    searchMyBtn.onclick = handleMyOrdersSearch;
  }
}

async function handleMyOrdersSearch(){
  const btn = document.getElementById('myOrdersSearchBtn');
  const name = document.getElementById('myOrdersNameInput').value.trim();
  const phone = document.getElementById('myOrdersPhoneInput').value.trim();
  const result = document.getElementById('myOrdersResult');
  if(!name || !phone){
    result.innerHTML = '<div style="color:#ef4444">請輸入完整姓名與電話</div>';
    return;
  }
  btn.disabled = true;
  btn.textContent = '查詢中…';
  result.innerHTML = '<div class="muted">查詢中，請稍候…</div>';
   try{
    const list = await lookupOrdersByCustomer(phone, name, onlineState.storeCode);
    renderMyOrdersList(list);

    try{
      localStorage.setItem('online_customer_name', name);
      localStorage.setItem('online_customer_phone', phone);
    }catch(e){}
  }catch(err){
    result.innerHTML = `<div style="color:#ef4444">${err.message || '查詢失敗'}</div>`;
  }finally{
    btn.disabled = false;
    btn.textContent = '查詢我的訂單';
  }
}

function updateFloatingCartBadge() {
  const badge = document.getElementById('floatingCartBadge');
  if (!badge) return;
  const count = onlineState.cart.reduce((s, i) => s + i.qty, 0);
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderMyOrdersList(list){
  const result = document.getElementById('myOrdersResult');
  if(!Array.isArray(list) || !list.length){
    result.innerHTML = '<div class="muted">查無訂單。請確認姓名與電話與當時送單時填寫的一致。</div>';
    return;
  }
  const statusMap = {
    pending_confirm: { text: '待店家確認', color: '#f59e0b' },
    confirmed:       { text: '已確認',     color: '#10b981' },
    rejected:        { text: '已拒絕',     color: '#ef4444' },
    completed:       { text: '已完成',     color: '#3b82f6' }
  };
  result.innerHTML = list.map(o => {
    const s = statusMap[o.status] || { text: o.status || '處理中', color: '#64748b' };
    const created = o.createdAt ? fmtLocalDateTime(o.createdAt) : '';
    const resv = o.reservationAt ? `<div style="color:#10b981;font-size:13px">📅 預約取餐：${fmtLocalDateTime(o.reservationAt)}</div>` : '';
    const itemsText = Array.isArray(o.items)
      ? o.items.map(it => `${it.name} x${it.qty}`).join('、')
      : '';
    const reply = o.replyMessage ? `<div style="font-size:12px;color:#475569;margin-top:4px">店家訊息：${o.replyMessage}</div>` : '';
    return `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="font-size:14px">${o.orderNo || o.id}</strong>
          <span style="background:${s.color};color:#fff;font-size:12px;padding:2px 10px;border-radius:12px">${s.text}</span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-bottom:4px">${created} · ${o.orderType || '線上點餐'}</div>
        ${resv}
        <div style="font-size:13px;color:#334155;margin-top:6px">${itemsText}</div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px">
          <span class="muted">小計</span>
          <strong style="color:#ef4444">$${o.total || o.subtotal || 0}</strong>
        </div>
        ${reply}
      </div>
    `;
  }).join('');
}

init();

// === 載入時從雲端拉取本店促銷設定 ===
(function pullPromoOnReady(){
  function doPull(){
    var code = onlineState.storeCode || '';
    if(!code){
      try{
        const params = new URLSearchParams(window.location.search);
        code = String(params.get('storeId') || '').trim();
      }catch(e){}
    }
    if(!code) return;
    pullPromotionsFromCloud(code).then(function(r){
      if(r && r.ok){
        console.log('[online-order] 雲端促銷已套用');
        if(typeof window.__refreshOnlinePromotion === 'function'){
          window.__refreshOnlinePromotion();
        }
        // 強制重繪 banner
        setTimeout(function(){
          try{
            const ui = window.__getPromoUI;
            if(typeof refreshPromotionDisplay === 'function') refreshPromotionDisplay();
            // 重新觸發 banner 渲染
            var area = document.getElementById('onlinePromotionArea');
            if(area){
              area.remove();  // 移除舊的
              import('../modules/promotion-ui.js').then(function(m){
                m.mountPromotionOnlineUI({
                  getCart: function(){ return onlineState.cart; }
                });
              });
            }
          }catch(e){ console.warn(e); }
        }, 200);
      } else {
        console.log('[online-order] 雲端無促銷或讀取失敗：', r && r.reason);
      }
    }).catch(function(e){ console.warn('[online-order] pull 例外：', e); });
  }
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(doPull, 800);  // 等 Firebase 模組載入
  } else {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(doPull, 800); });
  }
})();

// === 促銷 UI 自動掛載（線上點餐頁）===
(function mountPromoOnline(){
  function tryMount(){
    try {
      mountPromotionOnlineUI({
        getCart: function(){ return (typeof onlineState !== 'undefined' && Array.isArray(onlineState.cart)) ? onlineState.cart : []; }
      });
      // 提供全域 hook 給購物車變動時呼叫
      window.__refreshOnlinePromotion = refreshPromotionDisplay;
      window.__getOnlinePromotionResult = getCurrentPromotionResult;
    } catch(e){
      console.warn('線上促銷 UI 掛載失敗', e);
    }
  }
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(tryMount, 200);
  } else {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(tryMount, 200); });
  }
})();
