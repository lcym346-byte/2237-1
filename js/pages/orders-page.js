/* 中文備註：js/pages/orders-page.js，此檔已加入中文說明，方便後續維護。 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, deepCopy, money } from '../core/utils.js';
import { buildRealtimeOrderForPOS, confirmOnlineOrder, getRealtimeConfig, rejectOnlineOrder } from '../modules/realtime-order-service.js';
import { printKitchenCopies, printOrderLabels, printOrderReceipt } from '../modules/print-service.js';

function renderIncomingOnlineOrders(){
  const wrap = document.getElementById('incomingOnlineOrdersList');
  if(!wrap) return;
  const list = (state.onlineIncomingOrders || []).filter(o => o.status === 'pending_confirm');
  wrap.innerHTML = '';
  if(!list.length){
    wrap.innerHTML = '<div class="muted">目前沒有線上待確認訂單</div>';
    return;
  }
  list.forEach(o=>{
    const row = document.createElement('div');
    row.className = 'order-card pending';
    row.innerHTML = `
      <div class="row between wrap">
        <div>
          <strong>${escapeHtml(o.orderNo || o.id)}</strong>
          <span class="badge pending">待確認</span>
          <div class="muted">${String(o.createdAt || '').replace('T',' ').slice(0,16)} ・ ${escapeHtml(o.orderType || '線上點餐')}</div>
          <div class="muted">${escapeHtml(o.customerName || '')}${o.customerPhone ? ' / ' + escapeHtml(o.customerPhone) : ''}</div>
          ${o.customerNote ? `<div class="muted">顧客備註：${escapeHtml(o.customerNote)}</div>` : ''}
        </div>
        <div><strong>${money((o.items || []).reduce((s,x)=>s + ((Number(x.basePrice||0)+Number(x.extraPrice||0))*Number(x.qty||0)), 0))}</strong></div>
      </div>
      <div class="stack small" style="margin-top:12px">
        ${(o.items || []).map(i=>{
          const desc = (i.selections||[]).map(s=>`${s.moduleName}:${s.optionName}`).join(' / ');
          return `<div>${escapeHtml(i.name)}${desc ? ' / ' + escapeHtml(desc) : ''} x ${i.qty}${i.note ? '（' + escapeHtml(i.note) + '）' : ''}</div>`;
        }).join('')}
      </div>
      <div class="stack small" style="margin-top:12px">
        <label>備餐時間（分鐘）<input class="prep-minutes-input" type="number" min="1" max="240" value="20"></label>
        <label>回覆顧客訊息<input class="reply-message-input" placeholder="例如：大約 20 分鐘後可取餐"></label>
      </div>
      <div class="row gap wrap" style="margin-top:12px">
        <button class="primary-btn small-btn accept-btn">確認接單</button>
        <button class="danger-btn small-btn reject-btn">拒絕訂單</button>
      </div>
    `;
    row.querySelector('.accept-btn').onclick = async ()=>{
      try{
        const prepMinutes = Math.max(0, Number(row.querySelector('.prep-minutes-input').value || 0));
        if(!prepMinutes) return alert('請先輸入備餐時間');
        const replyMessage = row.querySelector('.reply-message-input').value.trim() || `預估 ${prepMinutes} 分鐘完成備餐`;
        const confirmedRemote = await confirmOnlineOrder(o.id, prepMinutes, replyMessage);
        const posOrder = buildRealtimeOrderForPOS({ id: o.id, ...confirmedRemote });
        if(!state.orders.some(x => x.id === posOrder.id)){
          state.orders.unshift(posOrder);
        }
        persistAll();
        const realtimeCfg = getRealtimeConfig();
        if(realtimeCfg.autoPrintKitchenOnConfirm) printKitchenCopies(posOrder);
        if(realtimeCfg.autoPrintReceiptOnConfirm) printOrderReceipt(posOrder, 'customer');
        window.refreshAllViews();
        alert(`已確認接單，已回覆顧客備餐 ${prepMinutes} 分鐘`);
      }catch(err){
        alert(err.message || '確認接單失敗');
      }
    };
    row.querySelector('.reject-btn').onclick = async ()=>{
      try{
        const replyMessage = row.querySelector('.reply-message-input').value.trim() || '店家目前無法接單，請稍後再試。';
        await rejectOnlineOrder(o.id, replyMessage);
        window.refreshAllViews();
        alert('已拒絕訂單');
      }catch(err){
        alert(err.message || '拒絕訂單失敗');
      }
    };
    wrap.appendChild(row);
  });
}

export function getFilteredOrders(){
  const kw = document.getElementById('orderItemSearch').value.trim();
  const from = document.getElementById('orderDateFrom').value;
  const to = document.getElementById('orderDateTo').value;
  const min = Number(document.getElementById('orderMinAmount').value || 0);
  const maxInput = document.getElementById('orderMaxAmount').value;
  const max = maxInput === '' ? null : Number(maxInput);
  const paymentMethod = document.getElementById('orderPaymentMethodFilter').value;

  return state.orders.filter(o=>{
    const itemText = o.items.map(i=> [i.name, ...(i.selections||[]).map(s=>s.optionName), i.note||''].join(' ')).join(' ');
    const kwOk = !kw || itemText.includes(kw);
    const d = o.createdAt.slice(0,10);
    const dateOk = (!from || d >= from) && (!to || d <= to);
    const amtOk = o.total >= min && (max === null || o.total <= max);
    const paymentOk = !paymentMethod || o.paymentMethod === paymentMethod;
    return kwOk && dateOk && amtOk && paymentOk;
  }).sort((a,b)=> new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function loadOrderToCart(orderId){
  const o = state.orders.find(x=>x.id===orderId);
  if(!o) return;
  state.cart = deepCopy(o.items);
  state.editingOrderId = o.id;
  document.getElementById('orderType').value = o.orderType || '內用';
  document.getElementById('tableNo').value = o.tableNo || '';
  document.getElementById('discountValue').value = o.discountValue || 0;
  state.settings.discountType = o.discountType || 'amount';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="posView"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('posView').classList.add('active');
  window.refreshAllViews();
  alert('已載回點餐頁，可修改後重新結帳');
}

function renderOrdersSection(wrap, orders, isPending){
  wrap.innerHTML = '';
  if(!orders.length){
    wrap.innerHTML = '<div class="muted">沒有資料</div>';
    return;
  }
  orders.forEach(o=>{
    const row = document.createElement('div');
    row.className = 'order-card' + (isPending ? ' pending' : '');
    const prepMeta = o.prepTimeMinutes ? ` ・ 備餐 ${escapeHtml(String(o.prepTimeMinutes))} 分鐘` : '';
    const readyMeta = o.estimatedReadyAt ? ` ・ 預計完成 ${escapeHtml(String(o.estimatedReadyAt).replace('T',' ').slice(0,16))}` : '';
    const replyMeta = o.merchantReplyMessage ? `<div class="muted">店家回覆：${escapeHtml(o.merchantReplyMessage)}</div>` : '';
    row.innerHTML = `
      <div class="row between wrap">
        <div>
          <strong>${escapeHtml(o.orderNo)}</strong>
          <span class="badge ${isPending ? 'pending' : 'done'}">${isPending ? '待付款' : '已完成'}</span>
          <div class="muted">${o.createdAt.replace('T',' ').slice(0,16)} ・ ${escapeHtml(o.orderType)} ${o.tableNo ? '・' + escapeHtml(o.tableNo) : ''}${!isPending && o.paymentMethod ? ' ・ 付款：' + escapeHtml(o.paymentMethod) : ''}${prepMeta}${readyMeta}</div>
          ${replyMeta}
        </div>
        <div><strong>${money(o.total)}</strong></div>
      </div>
      <div class="stack small" style="margin-top:12px">
        ${o.items.map(i=>{
          const desc = (i.selections||[]).map(s=>`${s.moduleName}:${s.optionName}`).join(' / ');
          return `<div>${escapeHtml(i.name)}${desc ? ' / ' + escapeHtml(desc) : ''} x ${i.qty}${i.note ? '（' + escapeHtml(i.note) + '）' : ''}</div>`;
        }).join('')}
      </div>
      <div class="row gap wrap" style="margin-top:12px">
        <button class="secondary-btn small-btn">修改</button>
        <button class="danger-btn small-btn">刪除</button>
        <button class="secondary-btn small-btn">列印顧客單</button>
        <button class="secondary-btn small-btn">列印廚房單</button>
        <button class="secondary-btn small-btn">列印標籤</button>
        ${isPending ? '<button class="primary-btn small-btn">改為已付款</button>' : ''}
      </div>
    `;
    const btns = row.querySelectorAll('button');
    btns[0].onclick = ()=> loadOrderToCart(o.id);
    btns[1].onclick = ()=>{
      if(!confirm(`確定刪除訂單「${o.orderNo}」？`)) return;
      state.orders = state.orders.filter(x=>x.id!==o.id);
      persistAll();
      window.refreshAllViews();
    };
    btns[2].onclick = ()=> printOrderReceipt(o, 'customer');
    btns[3].onclick = ()=> printKitchenCopies(o);
    btns[4].onclick = ()=> printOrderLabels(o);
    if(isPending && btns[5]){
      btns[5].onclick = ()=>{
        document.getElementById('paymentTargetMode').value = 'pending';
        document.getElementById('paymentTargetOrderId').value = o.id;
        document.getElementById('paymentModal').classList.remove('hidden');
      };
    }
    wrap.appendChild(row);
  });
}

export function renderOrders(){
  renderIncomingOnlineOrders();
  const list = getFilteredOrders();
  renderOrdersSection(document.getElementById('pendingOrdersList'), list.filter(o=>o.status==='pending'), true);
  renderOrdersSection(document.getElementById('completedOrdersList'), list.filter(o=>o.status!=='pending'), false);
}

export function initOrdersPage(){
  ['orderItemSearch','orderDateFrom','orderDateTo','orderMinAmount','orderMaxAmount'].forEach(idv=>{
    document.getElementById(idv).addEventListener('input', renderOrders);
  });
  document.getElementById('orderPaymentMethodFilter').addEventListener('change', renderOrders);
  document.getElementById('clearOrderFiltersBtn').onclick = ()=>{
    ['orderItemSearch','orderDateFrom','orderDateTo','orderMinAmount','orderMaxAmount','orderPaymentMethodFilter'].forEach(idv=> document.getElementById(idv).value = '');
    renderOrders();
  };
}
