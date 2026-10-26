(() => {
  'use strict';
  const $=id=>document.getElementById(id),dialog=$('projectComputeDialog');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let projectId='',busy=false,canEdit=false;
  async function load(action) {
    if(busy)return;busy=true;$('projectComputeError').hidden=true;
    for(const id of ['projectComputeStart','projectComputeStop','projectComputeRefresh'])$(id).disabled=true;
    try {
      const root=`/api/platform/projects/${encodeURIComponent(projectId)}`;
      const access=await fetch(root+'/sharing',{credentials:'same-origin',cache:'no-store'}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v.access;});canEdit=access.canEdit;
      const r=await fetch(root+'/compute'+(action?'/'+action:''),{method:action?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:action?'{}':undefined,signal:AbortSignal.timeout(60000)}),value=await r.json();if(!r.ok)throw new Error(value.error);
      const s=value.session,p=s?.profile||value.profile;
      $('projectComputeDetail').innerHTML=`<p><strong>${esc(s?.status||'Not started')}</strong> · ${p.sessionRamGiB} GiB RAM / ${p.sessionCpu} CPU budget${s?' · v'+s.configVersion:''}</p><p>${value.enabled?'Admission control enabled.':'Admission control is disabled; ask an administrator to enable it.'}</p><p>Budget reservation, not a hard memory limit. Actual per-session usage is unavailable. All agents in this project share this reservation.</p><p>${esc(s?.reason||'Closing this dialog or browser tab does not stop the session.')}</p><p>Drain blocks new runs, waits for active work, clears kernel variables and releases the reservation. Files are kept. A waiting session does not queue or replay your prompt.</p>`;
      $('projectComputeStart').disabled=!canEdit||!value.enabled||!!s&&s.status!=='stopped';
      $('projectComputeStop').disabled=!canEdit||!s||['stopped','draining'].includes(s.status);
    }catch(e){$('projectComputeError').textContent=e.message;$('projectComputeError').hidden=false;}
    finally{busy=false;$('projectComputeRefresh').disabled=false;}
  }
  function decorate(){for(const card of $('projectsList').querySelectorAll('[data-project-id]')){
    if(!card.querySelector('[data-open]')||card.querySelector('[data-project-compute]'))continue;
    const button=document.createElement('button');button.type='button';button.className='oc-platform-button';button.dataset.projectCompute=card.dataset.projectId;button.textContent='Compute';card.querySelector('.oc-platform-actions').append(button);
  }}
  new MutationObserver(decorate).observe($('projectsList'),{childList:true,subtree:true});decorate();
  $('projectsList').addEventListener('click',e=>{const b=e.target.closest('[data-project-compute]');if(!b||busy)return;projectId=b.dataset.projectCompute;$('projectComputeDetail').textContent='Loading…';dialog.showModal();void load();});
  $('projectComputeStart').onclick=()=>void load('start');
  $('projectComputeStop').onclick=()=>{if(confirm('Drain this session? Persistent in-memory variables will be lost after current work finishes. Project files remain.'))void load('stop');};
  $('projectComputeRefresh').onclick=()=>void load();$('projectComputeClose').onclick=()=>dialog.close();
})();
