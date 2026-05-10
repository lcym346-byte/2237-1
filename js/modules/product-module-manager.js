/* 中文備註：模組管理動態彈窗（Batch 06.13/B - product.modules 是 [{moduleId, requiredOverride}] 物件陣列）。
 * 對齊 store.js 預設、pos-page.js、products-page.js 的實作。
 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml } from '../core/utils.js';

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

        <div style="margin:10px 0 6px;font-weight:600;">子選項</div>
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
  el.querySelector(`#${MODAL_ID}_rule`).addEventListener('change', e=>{ if(draft) draft.selection = e.target.value; });
  el.querySelector(`#${MODAL_ID}_required`).addEventListener('change', e=>{ if(draft) draft.required = e.target.checked; });

  return el;
}

function addOption(){
  if (!draft) return;
  draft.options = draft.options || [];
  draft.options.push({ id: rid(), name:'', price:0, enabled:true });
  renderOptions();
}

function renderOptions(){
  const wrap = document.getElementById(`${MODAL_ID}_options`);
  if (!wrap || !draft) return;
  const len = (draft.options||[]).length;
  wrap.innerHTML = (draft.options||[]).map((opt, i) => `
    <div class="sub-option-row">
      <button type="button" class="btn small" data-act="optUp" data-i="${i}" ${i===0?'disabled':''} style="min-width:32px">▲</button>
      <button type="button" class="btn small" data-act="optDown" data-i="${i}" ${i===len-1?'disabled':''} style="min-width:32px">▼</button>
      <input class="input" data-fld="name" data-i="${i}" placeholder="子選項名稱" value="${escapeHtml(opt.name||'')}">
      <input class="input" data-fld="price" data-i="${i}" type="number" step="1" placeholder="加價" value="${Number(opt.price||0)}" style="max-width:90px;">
      <button type="button" class="btn small" data-act="rmOpt" data-i="${i}">移除</button>
    </div>`).join('');
  wrap.querySelectorAll('input[data-fld]').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const i = parseInt(e.target.getAttribute('data-i'),10);
      const fld = e.target.getAttribute('data-fld');
      if (isNaN(i) || !draft.options[i]) return;
      if (fld === 'price') draft.options[i].price = Number(e.target.value)||0;
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
  el.querySelector(`#${MODAL_ID}_search`).value = '';
  el.style.display = 'flex';
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
  mod.name = newName;
  mod.selection = draft.selection === 'multi' ? 'multi' : 'single';
  mod.required = !!draft.required;
  mod.options = cleanOpts;

  // 套用至商品：勾選=加入物件 {moduleId, requiredOverride:null}；未勾選=移除
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
  try { window.refreshPublicProducts && window.refreshPublicProducts(); } catch(e){}
  try { window.refreshAllViews && window.refreshAllViews(); } catch(e){}
  closeModuleManage();
}
