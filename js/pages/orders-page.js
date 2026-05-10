/* 中文備註：js/pages/orders-page.js，此檔已加入中文說明，方便後續維護。 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, deepCopy, money, fmtLocalDateTime } from '../core/utils.js';
import { buildRealtimeOrderForPOS, confirmOnlineOrder, getRealtimeConfig, rejectOnlineOrder } from '../modules/realtime-order-service.js';
import { printKitchenCopies, printOrderLabels, printOrderReceipt, getReceiptHtml, getLabelHtml, previewInModal } from '../modules/print-service.js';
import { hasOpenSession } from '../modules/report-session.js';


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
    const isReservation = !!o.reservationAt;
    const reservationText = isReservation ? fmtLocalDateTime(o.reservationAt) : '';
    const row = document.createElement('div');
    row.className = 'order-card pending' + (isReservation ? ' reservation' : '');
    row.innerHTML = `
      <div class="row between wrap">
        <div>
          <strong>${escapeHtml(o.orderNo || o.id)}</strong>
          <span class="badge pending">${isReservation ? '預約待確認' : '待確認'}</span>
          <div class="muted">${escapeHtml(fmtLocalDateTime(o.createdAt))} ・ ${escapeHtml(o.orderType || '線上點餐')}</div>
          ${isReservation ? `<div style="color:#b45309;font-weight:600;margin-top:4px">📅 預約取餐：${escapeHtml(reservationText)}</div>` : ''}
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
        <label>備餐時間（分鐘）<input class="prep-minutes-input" type="number" min="1" max="240" value="${isReservation ? 30 : 20}"></label>
        <label>回覆顧客訊息<input class="reply-message-input" placeholder="${isReservation ? '例如：已收到預約，將於時段前備餐' : '例如：大約 20 分鐘後可取餐'}"></label>
      </div>
      <div class="row gap wrap" style="margin-top:12px">
        <button class="primary-btn small-btn accept-btn">${isReservation ? '✓ 確認預約' : '確認接單'}</button>
        ${isReservation ? '' : '<button class="danger-btn small-btn reject-btn">拒絕訂單</button>'}
      </div>
    `;
    row.querySelector('.accept-btn').onclick = async ()=>{
      if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
      try{
        const prepMinutes = Math.max(0, Number(row.querySelector('.prep-minutes-input').value || 0));
        if(!prepMinutes) return alert('請先輸入備餐時間');
        const defaultReply = isReservation
          ? `已收到您的預約（${reservationText}），將於時段前備餐`
          : `預估 ${prepMinutes} 分鐘完成備餐`;
        const replyMessage = row.querySelector('.reply-message-input').value.trim() || defaultReply;
        const confirmedRemote = await confirmOnlineOrder(o.id, prepMinutes, replyMessage);
        const posOrder = buildRealtimeOrderForPOS({ id: o.id, ...confirmedRemote });
        if(!state.orders.some(x => x.id === posOrder.id)){
          state.orders.unshift(posOrder);
        }
        persistAll();
        const realtimeCfg = getRealtimeConfig();
        // 預約單接單時不立即列印（要等 30 分鐘前再列印），一般單才立即列印
        if(!isReservation){
          if(realtimeCfg.autoPrintKitchenOnConfirm) printKitchenCopies(posOrder);
          if(realtimeCfg.autoPrintReceiptOnConfirm) printOrderReceipt(posOrder, 'customer');
        }
        window.refreshAllViews();
        alert(isReservation
          ? `已確認預約，30 分鐘前會再次提醒`
          : `已確認接單，已回覆顧客備餐 ${prepMinutes} 分鐘`);
      }catch(err){
        alert(err.message || '確認接單失敗');
      }
    };
    const rejectBtn = row.querySelector('.reject-btn');
    if(rejectBtn){
      rejectBtn.onclick = async ()=>{
        if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
        try{
          const replyMessage = row.querySelector('.reply-message-input').value.trim() || '店家目前無法接單，請稍後再試。';
          await rejectOnlineOrder(o.id, replyMessage);
          window.refreshAllViews();
          alert('已拒絕訂單');
        }catch(err){
          alert(err.message || '拒絕訂單失敗');
        }
      };
    }
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
    const d = fmtLocalDateTime(o.createdAt).slice(0,10);
    const dateOk = (!from || d >= from) && (!to || d <= to);
    const amtOk = o.total >= min && (max === null || o.total <= max);
    const paymentOk = !paymentMethod || o.paymentMethod === paymentMethod;
    return kwOk && dateOk && amtOk && paymentOk;
  }).sort((a,b)=> new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function loadOrderToCart(orderId){
  if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
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
    const readyMeta = o.estimatedReadyAt ? ` ・ 預計完成 ${escapeHtml(fmtLocalDateTime(o.estimatedReadyAt))}` : '';
    const replyMeta = o.merchantReplyMessage ? `<div class="muted">店家回覆：${escapeHtml(o.merchantReplyMessage)}</div>` : '';
    row.innerHTML = `
      <div class="row between wrap">
        <div>
          <strong>${escapeHtml(o.orderNo)}</strong>
          <span class="badge ${isPending ? 'pending' : 'done'}">${isPending ? '待付款' : '已完成'}</span>
          <div class="muted">${escapeHtml(fmtLocalDateTime(o.createdAt))} ・ ${escapeHtml(o.orderType)} ${o.tableNo ? '・' + escapeHtml(o.tableNo) : ''}${!isPending && o.paymentMethod ? ' ・ 付款：' + escapeHtml(o.paymentMethod) : ''}${prepMeta}${readyMeta}</div>
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
  if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
  if(!confirm(`確定刪除訂單「${o.orderNo}」？`)) return;

      state.orders = state.orders.filter(x=>x.id!==o.id);
      persistAll();
      window.refreshAllViews();
    };
        btns[2].onclick = ()=>{
      printOrderReceipt(o, 'customer');
    };
    btns[3].onclick = ()=>{
      printKitchenCopies(o);
    };
    btns[4].onclick = ()=>{
      printOrderLabels(o);
    };

    if(isPending && btns[5]){
      btns[5].onclick = ()=>{
        if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
  document.getElementById('paymentTargetMode').value='pending';
        document.getElementById('paymentTargetOrderId').value = o.id;
        document.getElementById('paymentModal').classList.remove('hidden');
      };
    }
    wrap.appendChild(row);
  });
}

export function renderOrders(){
  renderSessionBanner();           // ← 新增
  renderIncomingOnlineOrders();
  const filtered = getFilteredOrders();
  renderOrdersSection(document.getElementById('pendingOrdersList'),
                      filtered.filter(o=>o.status==='pending'), true);
  renderOrdersSection(document.getElementById('completedOrdersList'),
                      filtered.filter(o=>o.status==='completed'), false);
}
function renderSessionBanner(){
  let banner = document.getElementById('ordersSessionBanner');
  const view = document.getElementById('ordersView');
  if(!view) return;
  if(hasOpenSession()){
    if(banner) banner.remove();
    return;
  }
  if(!banner){
    banner = document.createElement('div');
    banner.id = 'ordersSessionBanner';
    banner.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:10px 14px;border-radius:8px;margin:8px 0;font-size:14px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;';
    banner.innerHTML = `
      <span>⚠️ 尚未開班，僅能檢視/列印訂單，無法修改、刪除或處理線上單。</span>
      <button class="primary-btn small-btn" id="ordersBannerGoReports">📊 前往報表頁開班</button>
    `;
    view.insertBefore(banner, view.firstChild);
    document.getElementById('ordersBannerGoReports').onclick = ()=>{
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      document.querySelector('.nav-btn[data-view="reportsView"]')?.classList.add('active');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.getElementById('reportsView')?.classList.add('active');
    };
  }
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
