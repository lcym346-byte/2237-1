/* 中文備註：js/pages/orders-page.js
 * v20260608 變更（作廢機制）：
 *  - 「刪除」改為「作廢」按鈕，要求輸入作廢原因（必填）
 *  - 作廢單不從 state.orders 移除，改寫 status='void' 並記錄 voidedAt/voidedReason/voidedBy
 *  - 狀態字串與 dashboard-publish.js 既有過濾規則一致（'void'）
 *  - 新增「已作廢」摺疊區塊（在已完成下方）
 *  - 作廢單不可再修改，但可重新列印（追溯用）
 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, deepCopy, money, fmtLocalDateTime } from '../core/utils.js';
import { buildRealtimeOrderForPOS, confirmOnlineOrder, getRealtimeConfig, rejectOnlineOrder } from '../modules/realtime-order-service.js';
import { printKitchenCopies, printOrderLabels, printOrderReceipt, getReceiptHtml, getLabelHtml, previewInModal } from '../modules/print-service.js';
import { hasOpenSession, getCurrentSession } from '../modules/report-session.js';


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

// v20260613：「修改」改為「加到購物車」，原訂單保持原樣，要修改請另外按作廢
function addOrderToCart(orderId){
  if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
  const o = state.orders.find(x=>x.id===orderId);
  if(!o) return;
  if(o.status === 'void') return alert('此訂單已作廢，無法加到購物車');

  // B 選項：直接覆蓋購物車（不詢問）
  state.cart = deepCopy(o.items);

  // 不再設 editingOrderId — 結帳會產生新訂單，原訂單不變
  // v20260515-d：移除對已不存在的 #discountValue 欄位的設定
  // （新版折扣以「負金額品項」存在 cart 內，已隨上面 deepCopy(o.items) 一併帶過去）
  document.getElementById('orderType').value = o.orderType || '內用';
  document.getElementById('tableNo').value = o.tableNo || '';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="posView"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('posView').classList.add('active');
  window.refreshAllViews();
  alert('已將訂單 ' + (o.orderNo || '') + ' 的品項加到購物車。\n\n⚠️ 此為「重新建單」流程，原訂單仍存在；如需取代，請另外作廢原訂單。');
}


// ── 作廢訂單（取代刪除）──
// 狀態字串使用 'void'，與 dashboard-publish.js calcTodayStats 既有過濾規則一致
function voidOrder(orderId){
  if(!hasOpenSession()) return alert('🔒 尚未開始值班，請先到報表頁開班');
  const o = state.orders.find(x=>x.id===orderId);
  if(!o) return;
  if(o.status === 'void') return alert('此訂單已作廢');

  const reason = prompt(`作廢訂單「${o.orderNo}」\n\n金額：${money(o.total)}\n\n請輸入作廢原因（必填）：`);
  if(reason === null) return; // 使用者取消
  const trimmed = String(reason).trim();
  if(!trimmed){
    alert('必須輸入作廢原因');
    return;
  }

  const currentSession = getCurrentSession();
  const staffId = currentSession ? currentSession.staffId : '';

  // 記錄原始狀態，方便日後追溯
  o.statusBeforeVoid = o.status || '';
  o.status = 'void';
  o.voidedAt = new Date().toISOString();
  o.voidedReason = trimmed;
  o.voidedBy = staffId;
  o.updatedAt = new Date().toISOString();

  persistAll();
  window.refreshAllViews();
  alert(`已作廢訂單「${o.orderNo}」\n原因：${trimmed}`);
}

function renderOrdersSection(wrap, orders, mode){
  // mode: 'pending' | 'completed' | 'void'
  wrap.innerHTML = '';
  if(!orders.length){
    wrap.innerHTML = '<div class="muted">沒有資料</div>';
    return;
  }
  const isPending = mode === 'pending';
  const isVoid = mode === 'void';
  orders.forEach(o=>{
    const row = document.createElement('div');
    row.className = 'order-card' + (isPending ? ' pending' : '') + (isVoid ? ' voided' : '');
    if(isVoid){
      row.style.cssText = 'opacity:0.7;background:#fef2f2;border-left:4px solid #ef4444;';
    }
    const prepMeta = o.prepTimeMinutes ? ` ・ 備餐 ${escapeHtml(String(o.prepTimeMinutes))} 分鐘` : '';
    const readyMeta = o.estimatedReadyAt ? ` ・ 預計完成 ${escapeHtml(fmtLocalDateTime(o.estimatedReadyAt))}` : '';
    const replyMeta = o.merchantReplyMessage ? `<div class="muted">店家回覆：${escapeHtml(o.merchantReplyMessage)}</div>` : '';
    const voidMeta = isVoid
      ? `<div style="color:#dc2626;font-weight:600;margin-top:6px;font-size:13px">⚠️ 已作廢：${escapeHtml(o.voidedReason || '無原因')}<br><span class="muted" style="font-weight:normal">作廢時間：${escapeHtml(fmtLocalDateTime(o.voidedAt))}${o.voidedBy ? ' ・ 作廢人：' + escapeHtml(o.voidedBy) : ''}</span></div>`
      : '';
    const badgeText = isVoid ? '已作廢' : (isPending ? '待付款' : '已完成');
    const badgeClass = isVoid ? 'voided' : (isPending ? 'pending' : 'done');
    row.innerHTML = `
      <div class="row between wrap">
        <div>
          <strong style="${isVoid ? 'text-decoration:line-through;color:#94a3b8' : ''}">${escapeHtml(o.orderNo)}</strong>
          <span class="badge ${badgeClass}" style="${isVoid ? 'background:#fecaca;color:#991b1b' : ''}">${badgeText}</span>
          <div class="muted">${escapeHtml(fmtLocalDateTime(o.createdAt))} ・ ${escapeHtml(o.orderType)} ${o.tableNo ? '・' + escapeHtml(o.tableNo) : ''}${!isPending && !isVoid && o.paymentMethod ? ' ・ 付款：' + escapeHtml(o.paymentMethod) : ''}${prepMeta}${readyMeta}</div>
          ${replyMeta}
          ${voidMeta}
        </div>
        <div><strong style="${isVoid ? 'text-decoration:line-through;color:#94a3b8' : ''}">${money(o.total)}</strong></div>
      </div>
      <div class="stack small" style="margin-top:12px">
        ${o.items.map(i=>{
          const desc = (i.selections||[]).map(s=>`${s.moduleName}:${s.optionName}`).join(' / ');
          return `<div>${escapeHtml(i.name)}${desc ? ' / ' + escapeHtml(desc) : ''} x ${i.qty}${i.note ? '（' + escapeHtml(i.note) + '）' : ''}</div>`;
        }).join('')}
      </div>
      <div class="row gap wrap" style="margin-top:12px">
        ${isVoid ? '' : '<button class="secondary-btn small-btn">加到購物車</button>'}
        ${isVoid ? '' : '<button class="danger-btn small-btn">作廢</button>'}
        <button class="secondary-btn small-btn">列印顧客單</button>
        <button class="secondary-btn small-btn">列印廚房單</button>
        <button class="secondary-btn small-btn">列印標籤</button>
        ${isPending ? '<button class="primary-btn small-btn">改為已付款</button>' : ''}
      </div>
    `;
    const btns = Array.from(row.querySelectorAll('button'));
    let idx = 0;
        if(!isVoid){
      btns[idx++].onclick = ()=> addOrderToCart(o.id);
      btns[idx++].onclick = ()=> voidOrder(o.id);
    }
    btns[idx++].onclick = ()=> printOrderReceipt(o, 'customer');
    btns[idx++].onclick = ()=> printKitchenCopies(o);
    btns[idx++].onclick = ()=> printOrderLabels(o);

    if(isPending && btns[idx]){
      btns[idx].onclick = ()=>{
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
  renderSessionBanner();
  renderIncomingOnlineOrders();
  const filtered = getFilteredOrders();

  // 分三類：待付款、已完成、已作廢
  const pending = filtered.filter(o => o.status === 'pending');
  const completed = filtered.filter(o => o.status === 'completed');
  const voided = filtered.filter(o => o.status === 'void');

  renderOrdersSection(document.getElementById('pendingOrdersList'), pending, 'pending');
  renderOrdersSection(document.getElementById('completedOrdersList'), completed, 'completed');

  // 已作廢區塊（動態插入到 completedOrdersList 後面）
  renderVoidedSection(voided);
}

function renderVoidedSection(voidedOrders){
  let wrap = document.getElementById('voidedOrdersWrap');
  const view = document.getElementById('ordersView');
  if(!view) return;

  // 若無作廢訂單則隱藏整個區塊
  if(!voidedOrders.length){
    if(wrap) wrap.style.display = 'none';
    return;
  }

  // 建立區塊
  if(!wrap){
    wrap = document.createElement('div');
    wrap.id = 'voidedOrdersWrap';
    wrap.style.cssText = 'margin-top:16px;';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px;cursor:pointer" id="voidedToggle">
        <h3 style="margin:0;color:#dc2626">⚠️ 已作廢訂單 <span id="voidedCount" style="font-size:14px;color:#94a3b8;font-weight:normal"></span></h3>
        <button class="secondary-btn small-btn" id="voidedToggleBtn">展開 ▼</button>
      </div>
      <div id="voidedOrdersList" style="display:none"></div>
    `;
    const completedWrap = document.getElementById('completedOrdersList');
    if(completedWrap && completedWrap.parentNode){
      completedWrap.parentNode.appendChild(wrap);
    } else {
      view.appendChild(wrap);
    }
    const toggleBtn = wrap.querySelector('#voidedToggleBtn');
    const listEl = wrap.querySelector('#voidedOrdersList');
    const toggleHeader = wrap.querySelector('#voidedToggle');
    const toggle = ()=>{
      const open = listEl.style.display === 'none';
      listEl.style.display = open ? 'block' : 'none';
      toggleBtn.textContent = open ? '收合 ▲' : '展開 ▼';
    };
    toggleBtn.onclick = (e)=>{ e.stopPropagation(); toggle(); };
    toggleHeader.onclick = toggle;
  }

  wrap.style.display = 'block';
  const countEl = wrap.querySelector('#voidedCount');
  if(countEl){
    const totalVoided = voidedOrders.reduce((s,o)=> s + Number(o.total||0), 0);
    countEl.textContent = `（${voidedOrders.length} 筆，合計 ${money(totalVoided)}，已從營業額扣除）`;
  }
  renderOrdersSection(wrap.querySelector('#voidedOrdersList'), voidedOrders, 'void');
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
      <span>⚠️ 尚未開班，僅能檢視/列印訂單，無法修改、作廢或處理線上單。</span>
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
