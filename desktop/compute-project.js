(() => {
  'use strict';
  const $=id=>document.getElementById(id),dialog=$('projectComputeDialog');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let projectId='',busy=false,canEdit=false,snapshot=null;
  function updateButtons() {
    const s=snapshot?.session;
    $('projectComputeStart').disabled=busy||!canEdit||!snapshot?.enabled||!!s&&s.status!=='stopped';
    $('projectComputeStop').disabled=busy||!canEdit||!s||['stopped','draining'].includes(s.status);
    $('projectComputeRefresh').disabled=busy;
  }
  async function load(action) {
    if(busy)return;busy=true;canEdit=false;$('projectComputeError').hidden=true;
    updateButtons();
    try {
      const root=`/api/platform/projects/${encodeURIComponent(projectId)}`;
      const access=await fetch(root+'/sharing',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(60000)}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v.access;});canEdit=access.canEdit;
      const r=await fetch(root+'/compute'+(action?'/'+action:''),{method:action?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:action?'{}':undefined,signal:AbortSignal.timeout(60000)}),value=await r.json();if(!r.ok)throw new Error(value.error);
      snapshot=value;
      const s=value.session,p=s?.profile||value.profile;
      $('projectComputeDetail').innerHTML=`<p><strong>${esc(s?.status||'Not started')}</strong> · ${p.sessionRamGiB} GiB RAM / ${p.sessionCpu} CPU budget${s?' · v'+s.configVersion:''}</p><p>${value.enabled?'Admission control enabled.':'Admission control is disabled; ask an administrator to enable it.'}</p><p>${value.hardMemoryLimit?"Linux enforces these limits across local Python/R/shell workers in this project. Shared model services and GPU memory are outside this limit.":"Admission budget only; no hard memory limit."} ${value.actualUsage?.available?`RAM in use: ${(value.actualUsage.memoryBytes/1024**2).toFixed(0)} MiB.`:"No live worker measurement."}</p><p>${esc(s?.reason||'Closing this dialog or browser tab does not stop the session.')}</p><p>Drain blocks new runs, waits for active work, clears kernel variables and releases the reservation. Files are kept. A waiting session does not queue or replay your prompt.</p>`;
    }catch(e){$('projectComputeError').textContent=e.message;$('projectComputeError').hidden=false;}
    finally{busy=false;updateButtons();}
  }
  function decorate(){for(const card of $('projectsList').querySelectorAll('[data-project-id]')){
    if(!card.querySelector('[data-open]')||card.querySelector('[data-project-compute]'))continue;
    const button=document.createElement('button');button.type='button';button.className='oc-platform-button';button.dataset.projectCompute=card.dataset.projectId;button.textContent='Compute';card.querySelector('.oc-platform-actions').append(button);
  }}
  new MutationObserver(decorate).observe($('projectsList'),{childList:true,subtree:true});decorate();
  $('projectsList').addEventListener('click',e=>{const b=e.target.closest('[data-project-compute]');if(!b||busy)return;projectId=b.dataset.projectCompute;snapshot=null;canEdit=false;$('projectComputeDetail').textContent='Loading…';dialog.showModal();void load();});
  $('projectComputeStart').onclick=()=>void load('start');
  $('projectComputeStop').onclick=()=>{if(confirm('Drain this session? Persistent in-memory variables will be lost after current work finishes. Project files remain.'))void load('stop');};
  $('projectComputeRefresh').onclick=()=>void load();$('projectComputeClose').onclick=()=>dialog.close();
})();
