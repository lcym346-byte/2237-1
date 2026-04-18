/* 中文備註：js/core/utils.js，此檔已加入中文說明，方便後續維護。 */
export function id(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }
export function deepCopy(v){ return JSON.parse(JSON.stringify(v)); }
export function money(v){ return '$' + Number(v || 0).toLocaleString('zh-TW'); }
export function todayStr(){ return new Date().toISOString().slice(0,10); }
export function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
export function escapeAttr(s=''){ return escapeHtml(s); }
export function downloadFile(name, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 500);
}