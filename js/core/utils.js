/* 中文備註：js/core/utils.js，此檔已加入中文說明，方便後續維護。 */
export function id(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }
export function deepCopy(v){ return JSON.parse(JSON.stringify(v)); }
export function money(v){ return '$' + Number(v || 0).toLocaleString('zh-TW'); }
export function todayStr(){
  // 06.16/dbg-1：用本地時區算「今天」字串，避免 toISOString 拿到 UTC 跨日
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
export function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
export function escapeAttr(s=''){ return escapeHtml(s); }
export function downloadFile(name, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 500);
}

// 06.16/dbg-1：把 ISO 字串轉本地時區「YYYY-MM-DD HH:mm」
export function fmtLocalDateTime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

// 06.16/dbg-1：本地時區「YYYY-MM-DD」
export function fmtLocalDate(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
