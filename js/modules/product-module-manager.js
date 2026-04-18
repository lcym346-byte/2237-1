import { state } from '../core/store.js';
import { escapeHtml } from '../core/utils.js';

export function openModuleManage(moduleId){
  state.moduleManageTarget = moduleId;
  state.moduleManageDraft = new Set(
    state.products.filter(p => (p.modules||[]).some(m => m.moduleId === moduleId)).map(p => p.id)
  );
  const mod = state.modules.find(m => m.id === moduleId);
  document.getElementById('moduleManageTitle').textContent = `模組套用商品：${mod?.name || ''}`;
  document.getElementById('moduleManageModal').classList.remove('hidden');
  document.getElementById('moduleManageSearch').value = '';
  renderModuleManage();
}

export function closeModuleManage(){
  document.getElementById('moduleManageModal').classList.add('hidden');
  state.moduleManageTarget = null;
}

export function renderModuleManage(){
  const body = document.getElementById('moduleManageBody');
  const search = document.getElementById('moduleManageSearch').value.trim();
  const list = state.products.filter(p => p.name.includes(search) || (p.aliases||[]).join(' ').includes(search));
  body.innerHTML = list.map(p => `
    <label class="checkbox-item">
      <input type="checkbox" data-product-id="${p.id}" ${state.moduleManageDraft.has(p.id) ? 'checked' : ''}>
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="muted">${escapeHtml(p.category || '未分類')}</div>
      </div>
    </label>
  `).join('') || '<div class="muted">沒有符合商品</div>';

  body.querySelectorAll('input[type="checkbox"]').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const pid = chk.dataset.productId;
      if(chk.checked) state.moduleManageDraft.add(pid);
      else state.moduleManageDraft.delete(pid);
    });
  });
}

export function saveModuleManage(){
  const moduleId = state.moduleManageTarget;
  if(!moduleId) return;
  state.products.forEach(p=>{
    const hasModule = (p.modules||[]).some(m => m.moduleId === moduleId);
    const shouldHave = state.moduleManageDraft.has(p.id);
    if(shouldHave && !hasModule){
      p.modules = [...(p.modules||[]), { moduleId, requiredOverride:null }];
    }
    if(!shouldHave && hasModule){
      p.modules = (p.modules||[]).filter(m => m.moduleId !== moduleId);
    }
  });
  closeModuleManage();
}