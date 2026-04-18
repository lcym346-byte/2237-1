import { state } from '../core/store.js';

export function getDiscountType(){
  return state.settings.discountType || 'amount';
}

export function setDiscountType(type){
  state.settings.discountType = type;
}

export function getDiscountResult(subtotal){
  const input = document.getElementById('discountValue');
  const value = Number(input?.value || 0);
  let discountAmount = 0;
  if(getDiscountType() === 'percent'){
    const pct = Math.min(100, Math.max(0, value));
    discountAmount = Math.round(subtotal * (pct / 100));
  } else {
    discountAmount = Math.min(subtotal, Math.max(0, value));
  }
  return { discountAmount, total: Math.max(0, subtotal - discountAmount) };
}

export function handleDiscountInput(){
  const input = document.getElementById('discountValue');
  if(!input) return;
  let value = Number(input.value || 0);
  const subtotal = state.cart.reduce((s,x)=> s + (x.basePrice + x.extraPrice) * x.qty, 0);
  if(getDiscountType() === 'percent') value = Math.min(100, Math.max(0, value));
  else value = Math.min(subtotal, Math.max(0, value));
  input.value = value;
}