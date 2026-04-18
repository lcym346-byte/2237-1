/* 中文備註：訂單服務。建立訂單後會回傳訂單資料，供列印功能使用。 */
import { state } from '../core/store.js';
import { deepCopy, id } from '../core/utils.js';
import { getDiscountResult, getDiscountType } from './cart-service.js';

export function createOrUpdateOrder(paymentMethod){
  const subtotal = state.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);
  const { discountAmount, total } = getDiscountResult(subtotal);
  const existing = state.editingOrderId ? state.orders.find(o=>o.id===state.editingOrderId) : null;
  const order = {
    id: existing?.id || id(),
    orderNo: existing?.orderNo || ('OD' + Date.now()),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: paymentMethod === '待付款' ? 'pending' : 'completed',
    paymentMethod,
    orderType: document.getElementById('orderType').value,
    tableNo: document.getElementById('tableNo').value.trim(),
    discountType: getDiscountType(),
    discountValue: Number(document.getElementById('discountValue').value || 0),
    discountAmount,
    subtotal,
    total,
    items: deepCopy(state.cart),
  };
  if(existing){
    const idx = state.orders.findIndex(o=>o.id===existing.id);
    if(idx>=0) state.orders[idx] = order;
  } else {
    state.orders.unshift(order);
  }
  state.cart = [];
  state.editingOrderId = null;
  return order;
}

export function markPendingOrderPaid(orderId, paymentMethod){
  const order = state.orders.find(o=>o.id===orderId);
  if(!order) return;
  order.status = paymentMethod === '待付款' ? 'pending' : 'completed';
  order.paymentMethod = paymentMethod;
  order.updatedAt = new Date().toISOString();
  return order;
}