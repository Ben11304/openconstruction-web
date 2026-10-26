// Dataset-specific discovery uses only the anonymous public projection.
(() => {
  const root=document.getElementById('detailRoot');
  const datasetId=new URLSearchParams(location.search).get('id');
  if(!root||!datasetId||!/^https?:$/.test(location.protocol))return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let section;
  async function refresh(){
    const list=section.querySelector('[data-dataset-projects]');
    list.textContent='Loading shared projects…';
    try{
      const response=await fetch('/api/public/projects?dataset='+encodeURIComponent(datasetId),{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Community projects are unavailable. Try refreshing.');
      const {projects}=await response.json();
      list.innerHTML=projects.map(p=>`<article class="border rounded p-3 mb-2" data-community-project="${esc(p.id)}"><h3 class="h6"><a href="/projects/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3><small>${esc(p.ownerName)} · ${p.shareScope==='workspace_and_agents'?'Workspace + agents':'Workspace only'}${p.version?' · v'+esc(p.version):''}</small></article>`).join('')||'<p class="text-muted mb-0">No published projects using this dataset yet.</p>';
    }catch(error){list.textContent=error.message;}
  }
  function mount(){
    if(root.querySelector('[data-dataset-community]'))return;
    if(!root.querySelector('h2'))return;
    section=document.createElement('section');section.className='card p-3 mt-3';section.dataset.datasetCommunity='';
    section.innerHTML='<div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Community</h2><button type="button" class="btn btn-sm btn-outline-secondary" data-community-refresh aria-label="Refresh community" title="Refresh community">↻</button></div><div data-dataset-projects aria-live="polite"></div>';
    root.append(section);section.querySelector('button').onclick=refresh;void refresh();
  }
  const observer=new MutationObserver(mount);observer.observe(root,{childList:true});mount();
  window.addEventListener('pagehide',()=>observer.disconnect());
})();
