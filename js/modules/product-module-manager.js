/* 中文備註：模組管理動態彈窗（Batch 06.13/B - product.modules 是 [{moduleId, requiredOverride}] 物件陣列）。
 * v20260513：複選新增 minSelect / maxSelect 數量規則
 * v20260515-b：儲存/刪除後自動推送雲端（主機才推）
 * v20260515-c：子選項加入「啟用/停售」開關（單獨關閉某選項，模組規則與其他選項不受影響）
 *   - POS 與線上點餐原本就用 .filter(o=>o.enabled!==false) 過濾，邏輯層不用改
 *   - 停售的選項在編輯列以半透明灰底顯示，視覺即時反映
 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml } from '../core/utils.js';
import { syncMenuToFirebase, getRealtimeConfig } from './realtime-order-service.js';

// 主機自動推送雲端（從機略過、不丟錯）
function autoPushIfMaster(){
  try{
    const cfg = getRealtimeConfig();
    if(cfg.deviceRole !== 'master') return;
    if(!cfg.enabled) return;
    syncMenuToFirebase().catch(err => console.warn('[module] autoPush 失敗：', err.message));
  }catch(e){ console.warn('[module] autoPush exception:', e); }
}

function rid(){ return Math.random().toString(36).slice(2,10); }

const MODAL_ID = '__moduleManageDynamicModal';
let targetModId = null;
let draft = null;
let draftSelected = new Set();

function ensureModal(){
  let el = document.getElementById(MODAL_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = MODAL_ID;
  el.className = 'dyn-modal-backdrop';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="dyn-modal">
      <div class="dyn-head">
        <h3 id="${MODAL_ID}_title">模組設定</h3>
        <button class="btn small" data-act="close">✕</button>
      </div>
      <div class="dyn-body">
        <div class="form-row">
          <label>模組名稱</label>
          <input type="text" class="input" id="${MODAL_ID}_name">
        </div>
        <div class="form-row">
          <label>選擇規則</label>
          <select id="${MODAL_ID}_rule">
            <option value="single">單選</option>
            <option value="multi">複選</option>
          </select>
          <label style="min-width:auto"><input type="checkbox" id="${MODAL_ID}_required"> 必選</label>
        </div>
        <div class="form-row" id="${MODAL_ID}_multiRow" style="display:none;flex-wrap:wrap;align-items:center;gap:8px">
          <label style="width:100%;margin-bottom:2px">複選數量</label>
          <span>至少</span>
          <input type="number" id="${MODAL_ID}_minSel" min="0" step="1" value="1"
                 style="width:144px !important;min-width:144px;max-width:144px;flex:0 0 144px;height:36px;padding:6px 10px;font-size:16px;text-align:center;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box">
          <span>最多</span>
          <input type="number" id="${MODAL_ID}_maxSel" min="1" step="1" placeholder="不限"
                 style="width:144px !important;min-width:144px;max-width:144px;flex:0 0 144px;height:36px;padding:6px 10px;font-size:16px;text-align:center;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box">
        </div>

        <div style="margin:10px 0 6px;font-weight:600;">子選項（取消「啟用」勾選＝該選項停售，POS／線上點餐都不會顯示）</div>
        <div id="${MODAL_ID}_options"></div>
        <button class="btn small" data-act="addOpt">＋ 新增子選項</button>

        <hr style="margin:14px 0;border:none;border-top:1px solid #e5e7eb;">
        <div style="margin-bottom:6px;font-weight:600;">套用至商品</div>
        <div class="form-row">
          <label>搜尋商品</label>
          <input type="search" class="input" id="${MODAL_ID}_search" placeholder="輸入商品名…">
        </div>
        <div class="pick-tools">
          <button class="btn small" data-act="all">全選</button>
          <button class="btn small" data-act="none">全不選</button>
          <span class="muted" id="${MODAL_ID}_count"></span>
        </div>
        <div class="product-pick-list" id="${MODAL_ID}_list"></div>
      </div>
      <div class="dyn-foot">
        <button class="btn danger" data-act="delete">刪除模組</button>
        <span style="flex:1"></span>
        <button class="btn" data-act="close">取消</button>
        <button class="btn primary" data-act="save">儲存</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (e)=>{
    if (e.target === el){ closeModuleManage(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'close') closeModuleManage();
    else if (act === 'save') saveModuleManage();
    else if (act === 'delete') deleteModuleManage();
    else if (act === 'addOpt') addOption();
    else if (act === 'all') selectAll(true);
    else if (act === 'none') selectAll(false);
    else if (act === 'optUp'){
      const i = parseInt(btn.getAttribute('data-i'),10);
      if (!isNaN(i) && i>0 && draft && draft.options){
        const arr = draft.options;
        [arr[i-1], arr[i]] = [arr[i], arr[i-1]];
        renderOptions();
      }
    }
    else if (act === 'optDown'){
      const i = parseInt(btn.getAttribute('data-i'),10);
      if (!isNaN(i) && draft && draft.options && i < draft.options.length - 1){
        const arr = draft.options;
        [arr[i+1], arr[i]] = [arr[i], arr[i+1]];
        renderOptions();
      }
    }
    else if (act === 'rmOpt'){
      const i = parseInt(btn.getAttribute('data-i'),10);
      if (!isNaN(i) && draft && draft.options){
        draft.options.splice(i,1);
        renderOptions();
      }
    }
  });

  el.querySelector(`#${MODAL_ID}_search`).addEventListener('input', renderModuleProductList);
  el.querySelector(`#${MODAL_ID}_name`).addEventListener('input', e=>{ if(draft) draft.name = e.target.value; });
  el.querySelector(`#${MODAL_ID}_rule`).addEventListener('change', e=>{
    if(draft) draft.selection = e.target.value;
    updateMultiRowVisibility();
  });
  el.querySelector(`#${MODAL_ID}_required`).addEventListener('change', e=>{ if(draft) draft.required = e.target.checked; });
  el.querySelector(`#${MODAL_ID}_minSel`).addEventListener('input', e=>{
    if(draft) draft.minSelect = Math.max(0, parseInt(e.target.value, 10) || 0);
  });
  el.querySelector(`#${MODAL_ID}_maxSel`).addEventListener('input', e=>{
    if(!draft) return;
    const v = e.target.value.trim();
    draft.maxSelect = v === '' ? null : Math.max(1, parseInt(v, 10) || 1);
  });

  return el;
}

function updateMultiRowVisibility(){
  const row = document.getElementById(`${MODAL_ID}_multiRow`);
  if (!row || !draft) return;
  row.style.display = (draft.selection === 'multi') ? '' : 'none';
}

function addOption(){
  if (!draft) return;
  draft.options = draft.options || [];
  draft.options.push({ id: rid(), name:'', price:0, enabled:true });
  renderOptions();
}

// v20260515-c：每列加入「啟用/停售」checkbox；停售列半透明灰底；勾選即時重繪
function renderOptions(){
  const wrap = document.getElementById(`${MODAL_ID}_options`);
  if (!wrap || !draft) return;
  const len = (draft.options||[]).length;
  wrap.innerHTML = (draft.options||[]).map((opt, i) => {
    const isEnabled = opt.enabled !== false;
    const rowStyle = isEnabled ? '' : 'opacity:0.55;background:#f1f5f9;';
    const statusColor = isEnabled ? '#16a34a' : '#b91c1c';
    const statusText = isEnabled ? '啟用' : '停售';
    return `
    <div class="sub-option-row" style="${rowStyle}">
      <button type="button" class="btn small" data-act="optUp" data-i="${i}" ${i===0?'disabled':''} style="min-width:32px">▲</button>
      <button type="button" class="btn small" data-act="optDown" data-i="${i}" ${i===len-1?'disabled':''} style="min-width:32px">▼</button>
      <label style="display:inline-flex;align-items:center;gap:4px;min-width:auto;cursor:pointer;user-select:none;white-space:nowrap;padding:0 4px;" title="取消勾選＝停售此選項，POS／線上點餐都不顯示">
        <input type="checkbox" data-fld="enabled" data-i="${i}" ${isEnabled ? 'checked' : ''}>
        <span style="font-size:12px;font-weight:600;color:${statusColor}">${statusText}</span>
      </label>
      <input class="input" data-fld="name" data-i="${i}" placeholder="子選項名稱" value="${escapeHtml(opt.name||'')}">
      <input class="input" data-fld="price" data-i="${i}" type="number" step="1" placeholder="加價" value="${Number(opt.price||0)}" style="max-width:90px;">
      <button type="button" class="btn small" data-act="rmOpt" data-i="${i}">移除</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('input[data-fld]').forEach(inp=>{
    const evtName = inp.type === 'checkbox' ? 'change' : 'input';
    inp.addEventListener(evtName, (e)=>{
      const i = parseInt(e.target.getAttribute('data-i'),10);
      const fld = e.target.getAttribute('data-fld');
      if (isNaN(i) || !draft.options[i]) return;
      if (fld === 'price') draft.options[i].price = Number(e.target.value)||0;
      else if (fld === 'enabled'){
        draft.options[i].enabled = e.target.checked;
        renderOptions();  // 即時重繪該列灰階樣式
      }
      else draft.options[i][fld] = e.target.value;
    });
  });
}

function selectAll(flag){
  const term = (document.getElementById(`${MODAL_ID}_search`)?.value || '').trim().toLowerCase();
  (state.products||[]).forEach(p=>{
    if (term && !(p.name||'').toLowerCase().includes(term)) return;
    if (flag) draftSelected.add(p.id);
    else draftSelected.delete(p.id);
  });
  renderModuleProductList();
}

export function openModuleManage(moduleId){
  const mod = (state.modules||[]).find(m=>m.id===moduleId);
  if (!mod){ alert('找不到模組'); return; }
  targetModId = moduleId;
  draft = {
    name: mod.name||'',
    selection: mod.selection || (mod.multi ? 'multi' : 'single'),
    required: !!mod.required,
    minSelect: (typeof mod.minSelect === 'number') ? mod.minSelect : (mod.required ? 1 : 0),
    maxSelect: (typeof mod.maxSelect === 'number') ? mod.maxSelect : null,
    options: JSON.parse(JSON.stringify(mod.options||[]))
  };
  draftSelected = new Set(
    (state.products||[]).filter(p =>
      Array.isArray(p.modules) && p.modules.some(a => a && a.moduleId === moduleId)
    ).map(p=>p.id)
  );
  const el = ensureModal();
  el.querySelector(`#${MODAL_ID}_title`).textContent = `模組設定：${mod.name}`;
  el.querySelector(`#${MODAL_ID}_name`).value = draft.name;
  el.querySelector(`#${MODAL_ID}_rule`).value = draft.selection;
  el.querySelector(`#${MODAL_ID}_required`).checked = draft.required;
  el.querySelector(`#${MODAL_ID}_minSel`).value = draft.minSelect;
  el.querySelector(`#${MODAL_ID}_maxSel`).value = draft.maxSelect == null ? '' : draft.maxSelect;
  el.querySelector(`#${MODAL_ID}_search`).value = '';
  el.style.display = 'flex';
  updateMultiRowVisibility();
  renderOptions();
  renderModuleProductList();
}

export function closeModuleManage(){
  const el = document.getElementById(MODAL_ID);
  if (el) el.style.display = 'none';
  targetModId = null; draft = null;
}

export function renderModuleManage(){ renderModuleProductList(); }

function renderModuleProductList(){
  const el = document.getElementById(MODAL_ID);
  if (!el) return;
  const term = (el.querySelector(`#${MODAL_ID}_search`).value || '').trim().toLowerCase();
  const list = el.querySelector(`#${MODAL_ID}_list`);
  const products = (state.products||[]).filter(p => !term || (p.name||'').toLowerCase().includes(term));
  list.innerHTML = products.length ? products.map(p => `
    <label class="product-pick-row">
      <input type="checkbox" data-pid="${p.id}" ${draftSelected.has(p.id)?'checked':''}>
      <span>${escapeHtml(p.name||'(未命名)')} <span class="muted">(${escapeHtml(p.category||'未分類')})</span></span>
    </label>`).join('') : '<div class="muted" style="padding:12px;text-align:center;">沒有符合的商品</div>';

  list.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change', (e)=>{
      const pid = e.target.getAttribute('data-pid');
      if (e.target.checked) draftSelected.add(pid);
      else draftSelected.delete(pid);
      el.querySelector(`#${MODAL_ID}_count`).textContent = `已選 ${draftSelected.size} 項`;
    });
  });
  el.querySelector(`#${MODAL_ID}_count`).textContent = `已選 ${draftSelected.size} 項`;
}

export function saveModuleManage(){
  if (!targetModId || !draft) return;
  const mod = (state.modules||[]).find(m=>m.id===targetModId);
  if (!mod) return;
  const newName = (draft.name||'').trim();
  if (!newName){ alert('模組名稱不可空白'); return; }
  if (newName !== mod.name && (state.modules||[]).some(m=>m.name===newName && m.id!==targetModId)){
    alert('已存在相同名稱的模組'); return;
  }
  const cleanOpts = (draft.options||[])
    .map(o => ({ id: o.id || rid(), name:(o.name||'').trim(), price:Number(o.price)||0, enabled:o.enabled!==false }))
    .filter(o => o.name);

  const isMulti = draft.selection === 'multi';
  let minSel = isMulti ? Math.max(0, parseInt(draft.minSelect, 10) || 0) : 0;
  let maxSel = isMulti ? (draft.maxSelect == null ? null : Math.max(1, parseInt(draft.maxSelect, 10) || 1)) : null;
  if (isMulti && maxSel != null && minSel > maxSel){
    alert('「至少」不可大於「最多」'); return;
  }
  if (isMulti && maxSel != null && maxSel > cleanOpts.length){
    alert(`「最多」(${maxSel}) 不可超過子選項數量(${cleanOpts.length})`); return;
  }
  if (isMulti && draft.required && minSel < 1){
    minSel = 1;
  }

  mod.name = newName;
  mod.selection = isMulti ? 'multi' : 'single';
  mod.required = !!draft.required;
  mod.minSelect = isMulti ? minSel : 0;
  mod.maxSelect = isMulti ? maxSel : null;
  mod.options = cleanOpts;

  (state.products||[]).forEach(p=>{
    p.modules = Array.isArray(p.modules) ? p.modules.slice() : [];
    p.modules = p.modules.filter(a => a && typeof a === 'object' && a.moduleId);
    const has = p.modules.some(a => a.moduleId === targetModId);
    if (draftSelected.has(p.id) && !has){
      p.modules.push({ moduleId: targetModId, requiredOverride: null });
    } else if (!draftSelected.has(p.id) && has){
      p.modules = p.modules.filter(a => a.moduleId !== targetModId);
    }
  });

  persistAll();
  autoPushIfMaster();
  try { window.refreshPublicProducts && window.refreshPublicProducts(); } catch(e){}
  try { window.refreshAllViews && window.refreshAllViews(); } catch(e){}
  closeModuleManage();
}

export function deleteModuleManage(){
  if (!targetModId) return;
  const mod = (state.modules||[]).find(m=>m.id===targetModId);
  if (!mod) return;
  if (!confirm(`確定刪除模組「${mod.name}」？所有商品身上的此模組將被移除。`)) return;
  const delId = targetModId;
  (state.products||[]).forEach(p=>{
    if (Array.isArray(p.modules)){
      p.modules = p.modules.filter(a => !(a && typeof a === 'object' && a.moduleId === delId));
    }
  });
  state.modules = (state.modules||[]).filter(m => m.id !== delId);
  persistAll();
  autoPushIfMaster();
  try { window.refreshPublicProducts && window.refreshPublicProducts(); } catch(e){}
  try { window.refreshAllViews && window.refreshAllViews(); } catch(e){}
  closeModuleManage();
}
