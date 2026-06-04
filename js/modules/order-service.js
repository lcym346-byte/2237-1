/* 中文備註：訂單服務。建立訂單後會回傳訂單資料，供列印功能使用。 */
import { state, persistAll } from '../core/store.js';
import { deepCopy, id } from '../core/utils.js';
//import { getDiscountResult, getDiscountType } from './cart-service.js';
import { getCurrentSession } from './report-session.js';
// v20260525 新增：付款完成後同步到客顯
import { displayPaid } from './customer-display-service.js';


export function createOrUpdateOrder(paymentMethod){
  const subtotal = state.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);
  const discountAmount = 0;
  const total = subtotal;
  // ─── v20260613：移除就地修改邏輯，每次結帳都是新訂單（避免營業額漏洞） ───
  // 「修改」流程改為「加到購物車 → 作廢原單 → 重新結帳」，留下完整審計軌跡
  const order = {
    id: id(),
    orderNo: 'OD' + Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: paymentMethod === '待付款' ? 'pending' : 'completed',
    paymentMethod,
    orderType: document.getElementById('orderType').value,
    reservationAt: (document.getElementById('orderType').value === '預約' && document.getElementById('posReservationSlot')) ? document.getElementById('posReservationSlot').value : '',
    reservationReminded: false,
    sessionId: getCurrentSession()?.id || null,

    tableNo: document.getElementById('tableNo').value.trim(),
    discountType: 'amount',
    discountValue: 0,
    discountAmount: 0,

    subtotal,
    total,
    items: deepCopy(state.cart),
  };
  state.orders.unshift(order);
  state.cart = [];

  // v20260525 新增：付款完成（非待付款）推送客顯
  if (paymentMethod !== '待付款') {
    displayPaid(order).catch(() => {});
  }

  return order;
}


export function markPendingOrderPaid(orderId, paymentMethod){
  const order = state.orders.find(o=>o.id===orderId);
  if(!order) return;
  order.status = paymentMethod === '待付款' ? 'pending' : 'completed';
  order.paymentMethod = paymentMethod;
  order.updatedAt = new Date().toISOString();
  // 06.16/4：補登當前班次
  if(!order.sessionId){
    const cur = getCurrentSession();
    if(cur) order.sessionId = cur.id;
  }

    // v20260525 新增：待付款改為完成時也推送客顯
  if (paymentMethod !== '待付款') {
    displayPaid(order).catch(() => {});
    // v20260603-v2：線上單結帳完成 → 依「付款別 + 本機促銷設定」重算付款回饋點數，
    //   再轉成會員點數（防重複 settle）。不信任顧客端送上來的數字。
    //   只有線上單(有 customerPhone)且回饋點數 > 0 才賺點；直接折現金的優惠碼不再賺點。
    if (order.status === 'completed' && !order.pointsSettled && String(order.customerPhone || '').replace(/\D/g, '')) {
      // 判斷付款別（寬鬆比對 POS 結帳字串）
      let payKind = '';
      const pm = String(paymentMethod || '');
      if (pm.indexOf('現金') >= 0) payKind = '現金';
      else if (pm.indexOf('電子') >= 0 || pm.indexOf('電支') >= 0 || pm.indexOf('電') >= 0) payKind = '電子支付';

      Promise.all([
        import('./promotion-service.js'),
        import('./customer-service.js')
      ]).then(([promo, cust]) => {
        let reward = 0;
        try {
          if (payKind) {
            const r = promo.getPaymentRewardPoints(order.items || [], payKind);
            reward = Math.max(0, Math.round(Number(r && r.points || 0) * 10) / 10);
          }
        } catch (e) { console.warn('重算付款回饋點數失敗：', e); }
        order.pointsEarnReward = reward;
        if (reward > 0) {
          cust.earnPointsOnComplete(order).then(() => { persistAll(); }).catch(() => {});
        } else {
          // 沒有回饋仍標記已結算，避免之後誤判重複賺點
          order.pointsSettled = true;
          order.pointsEarned = 0;
          persistAll();
        }
      }).catch(() => {});
    }
  }

  return order;
}


