/* 中文備註：分類管理動態彈窗（Batch 06.10/3-fix - 字串陣列版）。
 * state.categories 是 ["未分類","主餐",...] 字串陣列，用 name 當 key。
 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml } from '../core/utils.js';

const MODAL_ID = '__categoryManageDynamicModal';
let targetCatName = null;
let draftName = '';
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
        <h3 id="${MODAL_ID}_title">分類設定</h3>
        <button class="btn small" data-act="close">✕</button>
      </div>
      <div class="dyn-body">
        <div class="form-row">
          <label>分類名稱</label>
          <input type="text" class="input" id="${MODAL_ID}_name">
        </div>
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
        <button class="btn danger" data-act="delete">刪除分類</button>
        <span style="flex:1"></span>
        <button class="btn" data-act="close">取消</button>
        <button class="btn primary" data-act="save">儲存</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (e)=>{
    if (e.target === el){ closeCategoryManage(); return; }
    const act = e.target.getAttribute('data-act');
    if (!act) return;
    if (act === 'close') closeCategoryManage();
    else if (act === 'save') saveCategoryManage();
    else if (act === 'delete') deleteCategoryManage();
    else if (act === 'all') selectAll(true);
    else if (act === 'none') selectAll(false);
  });

  el.querySelector(`#${MODAL_ID}_search`).addEventListener('input', renderCategoryManage);
  el.querySelector(`#${MODAL_ID}_name`).addEventListener('input', (e)=>{ draftName = e.target.value; });

  return el;
}

function selectAll(flag){
  const term = (document.getElementById(`${MODAL_ID}_search`)?.value || '').trim().toLowerCase();
  (state.products||[]).forEach(p=>{
    if (term && !(p.name||'').toLowerCase().includes(term)) return;
    if (flag) draftSelected.add(p.id);
    else draftSelected.delete(p.id);
  });
  renderCategoryManage();
}

export function openCategoryManage(categoryName){
  if (!(state.categories||[]).includes(categoryName)){ alert('找不到分類'); return; }
  targetCatName = categoryName;
  draftName = categoryName;
  draftSelected = new Set(
    (state.products||[]).filter(p => p.category === categoryName).map(p=>p.id)
  );
  const el = ensureModal();
  el.querySelector(`#${MODAL_ID}_title`).textContent = `分類設定：${categoryName}`;
  el.querySelector(`#${MODAL_ID}_name`).value = draftName;
  el.querySelector(`#${MODAL_ID}_search`).value = '';
  const isProtected = categoryName === '未分類';
  el.querySelector(`#${MODAL_ID}_name`).disabled = isProtected;
  el.querySelector('[data-act="delete"]').style.display = isProtected ? 'none' : '';
  el.style.display = 'flex';
  renderCategoryManage();
}

export function closeCategoryManage(){
  const el = document.getElementById(MODAL_ID);
  if (el) el.style.display = 'none';
  targetCatName = null;
}

export function renderCategoryManage(){
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

export function saveCategoryManage(){
  if (!targetCatName) return;
  const oldName = targetCatName;
  const newName = (draftName || '').trim();
  if (oldName !== '未分類'){
    if (!newName){ alert('分類名稱不可空白'); return; }
    if (newName !== oldName && (state.categories||[]).includes(newName)){
      alert('已存在相同名稱的分類'); return;
    }
    // 重新命名：陣列中替換
    const idx = state.categories.indexOf(oldName);
    if (idx >= 0) state.categories[idx] = newName;
  }
  const finalName = oldName === '未分類' ? '未分類' : newName;
  // 套用商品歸屬：選中=屬於此分類；未選且原本屬於此分類=改為「未分類」
  (state.products||[]).forEach(p=>{
    if (draftSelected.has(p.id)) p.category = finalName;
    else if (p.category === oldName) p.category = '未分類';
  });
  persistAll();
  try { window.refreshPublicProducts && window.refreshPublicProducts(); } catch(e){}
  try { window.refreshProductsPage && window.refreshProductsPage(); } catch(e){}
  closeCategoryManage();
}

export function deleteCategoryManage(){
  if (!targetCatName) return;
  if (targetCatName === '未分類'){ alert('「未分類」為系統分類，無法刪除'); return; }
  if (!confirm(`確定刪除分類「${targetCatName}」？此分類下所有商品將改為「未分類」。`)) return;
  (state.products||[]).forEach(p=>{ if (p.category === targetCatName) p.category = '未分類'; });
  state.categories = (state.categories||[]).filter(name => name !== targetCatName);
  persistAll();
  try { window.refreshPublicProducts && window.refreshPublicProducts(); } catch(e){}
  try { window.refreshProductsPage && window.refreshProductsPage(); } catch(e){}
  closeCategoryManage();
}
