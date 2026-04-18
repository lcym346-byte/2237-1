import { state } from '../core/store.js';
import { escapeHtml } from '../core/utils.js';

export function openCategoryManage(category){
  state.categoryManageTarget = category;
  state.categoryManageDraft = new Set(
    state.products.filter(p => p.category === category).map(p => p.id)
  );
  document.getElementById('categoryManageTitle').textContent = `分類商品管理：${category}`;
  document.getElementById('categoryManageModal').classList.remove('hidden');
  document.getElementById('categoryManageSearch').value = '';
  renderCategoryManage();
}

export function closeCategoryManage(){
  document.getElementById('categoryManageModal').classList.add('hidden');
  state.categoryManageTarget = null;
}

export function renderCategoryManage(){
  const body = document.getElementById('categoryManageBody');
  const search = document.getElementById('categoryManageSearch').value.trim();
  const list = state.products.filter(p => p.name.includes(search) || (p.aliases||[]).join(' ').includes(search));
  body.innerHTML = list.map(p => `
    <label class="checkbox-item">
      <input type="checkbox" data-product-id="${p.id}" ${state.categoryManageDraft.has(p.id) ? 'checked' : ''}>
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="muted">${escapeHtml(p.category || '未分類')}</div>
      </div>
    </label>
  `).join('') || '<div class="muted">沒有符合商品</div>';

  body.querySelectorAll('input[type="checkbox"]').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const pid = chk.dataset.productId;
      if(chk.checked) state.categoryManageDraft.add(pid);
      else state.categoryManageDraft.delete(pid);
    });
  });
}

export function saveCategoryManage(){
  const category = state.categoryManageTarget;
  if(!category) return;
  state.products.forEach(p=>{
    if(state.categoryManageDraft.has(p.id)) p.category = category;
    else if(p.category === category) p.category = '未分類';
  });
  closeCategoryManage();
}