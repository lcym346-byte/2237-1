export function enableDragSort(container, onUpdate){
  let draggingEl = null;

  function getY(e){
    return e.touches ? e.touches[0].clientY : e.clientY;
  }

  function getElementBelow(y){
    const els = [...container.querySelectorAll('.draggable')];
    return els.find(el=>{
      if(el === draggingEl) return false;
      const r = el.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
  }

  function endDrag(moveHandler, endHandler){
    if(!draggingEl) return;
    onUpdate([...container.querySelectorAll('.draggable')].map((el,i)=>({
      id: el.dataset.id,
      sortOrder: i
    })));
    draggingEl.classList.remove('dragging');
    draggingEl = null;
    document.removeEventListener('mousemove', moveHandler);
    document.removeEventListener('touchmove', moveHandler);
    document.removeEventListener('mouseup', endHandler);
    document.removeEventListener('touchend', endHandler);
  }

  container.querySelectorAll('.draggable').forEach(el=>{
    const startDrag = (e)=>{
      draggingEl = el;
      draggingEl.classList.add('dragging');

      const move = (evt)=>{
        if(!draggingEl) return;
        evt.preventDefault();
        const y = getY(evt);
        const target = getElementBelow(y);
        if(target){
          const rect = target.getBoundingClientRect();
          const middle = rect.top + rect.height / 2;
          if(y < middle) container.insertBefore(draggingEl, target);
          else container.insertBefore(draggingEl, target.nextSibling);
        }
      };

      const end = ()=> endDrag(move, end);

      document.addEventListener('mousemove', move);
      document.addEventListener('touchmove', move, {passive:false});
      document.addEventListener('mouseup', end);
      document.addEventListener('touchend', end);
    };

    const handle = el.querySelector('.drag-handle') || el;
    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, {passive:true});
  });
}