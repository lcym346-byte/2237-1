/* 中文備註：訂單服務。建立訂單後會回傳訂單資料，供列印功能使用。 */
import { state } from '../core/store.js';
import { deepCopy, id } from '../core/utils.js';
//import { getDiscountResult, getDiscountType } from './cart-service.js';
import { getCurrentSession } from './report-session.js';


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
  return order;

}
