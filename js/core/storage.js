/* 中文備註：js/core/storage.js，此檔已加入中文說明，方便後續維護。 */
export const KEYS = {
  PRODUCTS:'pos_products_v2111',
  CATEGORIES:'pos_categories_v2111',
  ORDERS:'pos_orders_v2111',
  SETTINGS:'pos_settings_v2111',
  MODULES:'pos_modules_v2111',
  REPORTS:'pos_reports_v2111'
};

export function load(key, fallback){
  try{
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  }catch(e){ return fallback; }
}
export function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}