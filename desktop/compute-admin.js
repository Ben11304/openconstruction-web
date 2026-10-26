(() => {
  'use strict';
  const $=id=>document.getElementById(id), enc=encodeURIComponent;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>v?new Date(v).toLocaleString():'—';
  const labels={enabled:'Enable admission control',admissionPaused:'Pause new admissions',poolRamGiB:'Session pool · GiB RAM',poolCpu:'Session pool · CPU units',sessionRamGiB:'RAM budget per session · GiB',sessionCpu:'CPU budget per session',perUser:'Sessions per project owner',idleMinutes:'Idle timeout · minutes',maxHours:'Session drain deadline · hours'};
  const limits={poolRamGiB:[1,4096],poolCpu:[1,1024],sessionRamGiB:[1,4096],sessionCpu:[1,1024],perUser:[1,100],idleMinutes:[5,1440],maxHours:[1,168]};
  let snapshot, baseVersion, reviewed, busy=false, projects=[], loaded=false;
  const form=$('computeConfig'), dialog=$('computeReview');
  if(!form)return;
  if(window.OCDesktop?.platform&&window.OCDesktop.platform!=='web'&&!document.querySelector('meta[name="oc-auth-mode"][content="gateway"]')) {document.querySelector('[data-admin-tab="compute"]').hidden=true;return;}
  async function api(path='',body) {
    const url=path.startsWith('/api/')?path:`/api/platform/admin/compute${path}`;
    const response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||`Request failed (${response.status})`);return value;
  }
  function notice(text,error=false) {$('computeNotice').hidden=!text;$('computeNotice').textContent=text;$('computeNotice').className=`oc-admin-notice ${error?'is-error':'is-success'}`;}
  async function act(work) {
    if(busy)return;busy=true;const controls=[...document.querySelectorAll('[data-admin-panel="compute"] button, #computeReview button')].filter(b=>!b.disabled);controls.forEach(b=>b.disabled=true);
    try{await work();}catch(e){notice(e.message,true);if(dialog.open){$('computeReviewError').hidden=false;$('computeReviewError').textContent=e.message;}}
    finally{busy=false;controls.forEach(b=>{if(b.isConnected)b.disabled=false;});}
  }
  function draft(config,reason='') {
    reviewed=null;baseVersion=snapshot.current.version;
    form.innerHTML=Object.entries(labels).map(([key,label])=>typeof config[key]==='boolean'?`<label class="oc-admin-toggle"><input name="${key}" type="checkbox" ${config[key]?'checked':''}><span>${esc(label)}</span></label>`:`<label><span>${esc(label)}</span><input name="${key}" type="number" min="${limits[key][0]}" max="${limits[key][1]}" step="1" value="${config[key]}" required></label>`).join('')+`<label class="oc-admin-wide">Reason for change<textarea name="reason" maxlength="500" required>${esc(reason)}</textarea></label><p class="oc-admin-wide oc-admin-subtle" id="computeDraftImpact"></p><div class="oc-admin-form-actions"><button type="button" id="computeReset" class="oc-admin-button">Load latest policy</button><button type="submit" class="oc-admin-button oc-admin-button-primary">Review changes</button></div>`;
    impact();
  }
  function value() {return Object.fromEntries(Object.keys(labels).map(key=>[key,typeof snapshot.current.config[key]==='boolean'?form.elements[key].checked:Number(form.elements[key].value)]));}
  function impact() {
    const c=value(),capacity=Math.min(Math.floor(c.poolRamGiB/c.sessionRamGiB),Math.floor(c.poolCpu/c.sessionCpu));
    $('computeDraftImpact').textContent=`Draft based on v${baseVersion} · Capacity: ${Number.isFinite(capacity)?capacity:'—'} sessions of ${c.sessionRamGiB} GiB / ${c.sessionCpu} CPU. Outside pool: ${(snapshot.host.totalBytes/1024**3-c.poolRamGiB).toFixed(1)} GiB for macOS, model server and other applications. These are budgets, not measured model usage.`;
  }
  function table(headers,rows) {return `<table class="oc-admin-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;}
  function render() {
    const {current,host,usage,sessions}=snapshot,c=current.config;
    $('computeVersion').textContent=`Applied v${current.version} · ${c.enabled?'Enabled':'Disabled'}${c.admissionPaused?' · Admissions paused':''}`;
    $('computeMetrics').innerHTML=[['Host RAM',`${(host.totalBytes/1024**3).toFixed(0)} GiB`,'Physical memory, not VM capacity'],['Session budget',`${usage.ramGiB} / ${c.poolRamGiB} GiB`,'Reserved, not actual consumption'],['CPU budget',`${usage.cpu} / ${c.poolCpu}`,`${host.cpuCores} logical host cores`],['Compute sessions',`${usage.count} active / draining`,`${sessions.filter(s=>s.status==='waiting').length} waiting · no prompts queued`]].map(([title,value,help])=>`<article class="oc-admin-card"><p class="oc-admin-eyebrow">${esc(title)}</p><h2>${esc(value)}</h2><p>${esc(help)}</p></article>`).join('');
    $('computeHealth').textContent=`Last controller check: ${date(snapshot.lastCheck)}. ${snapshot.lastError||'Host free RAM: '+(host.freeBytes/1024**3).toFixed(2)+' GiB (excludes reclaimable memory; not a memory-pressure reading). Per-session RAM/CPU usage is not available.'}`;
    $('computeSessions').innerHTML=sessions.length?table(['Project / owner','State','Reservation','Profile','Last activity','Control'],sessions.map(s=>`<tr><td><strong>${esc(projects.find(p=>p.id===s.projectId)?.name||s.projectId)}</strong><small>${esc(s.ownerEmail)}</small></td><td>${esc(s.status)}${s.pendingDispatches?`<small>${s.pendingDispatches} unresolved dispatch — budget retained</small>`:''}<small>${esc(s.reason)}</small></td><td>${s.profile.sessionRamGiB} GiB / ${s.profile.sessionCpu} CPU<small>Actual usage: unavailable</small></td><td>v${s.configVersion}<small>${s.profile.idleMinutes} min idle · ${s.profile.maxHours} h</small></td><td>${esc(date(s.lastActivityAt))}</td><td><button type="button" class="oc-admin-button" data-compute-action="${s.status==='stopped'?'start':'stop'}" data-project="${esc(s.projectId)}" ${s.status==='draining'?'disabled':''}>${s.status==='stopped'?'Start':s.status==='waiting'?'Withdraw':'Drain & release'}</button></td></tr>`)):'<p class="oc-admin-empty">No compute reservations. Projects and files remain available without a session.</p>';
    $('computeHistory').innerHTML=table(['Version','Applied','Reason','Profile','Action'],snapshot.history.map(h=>`<tr><td>v${h.version}</td><td>${esc(date(h.createdAt))}</td><td>${esc(h.reason)}</td><td>${h.config.sessionRamGiB} GiB / ${h.config.sessionCpu} CPU</td><td><button type="button" class="oc-admin-button" data-compute-restore="${h.version}">Load as draft</button></td></tr>`));
  }
  async function refresh(reloadDraft=false) {
    snapshot=await api();render();
    if(!loaded||reloadDraft){draft(snapshot.current.config);loaded=true;}
  }
  form.addEventListener('input',()=>{reviewed=null;impact();});
  form.addEventListener('submit',event=>{event.preventDefault();void act(async()=>{
    const input={config:value(),baseVersion,reason:form.elements.reason.value.trim()};
    reviewed={...input,...await api('/review',input)};
    $('computeReviewContent').innerHTML=`<p>New-session capacity: <strong>${reviewed.capacity}</strong>. Already reserved: ${reviewed.usage.ramGiB} GiB / ${reviewed.usage.cpu} CPU. Running profiles will not change.</p>${table(['Setting','Current','Draft'],reviewed.changes.map(d=>`<tr><td>${esc(labels[d.key])}</td><td>${esc(d.from)}</td><td>${esc(d.to)}</td></tr>`))}<p>${esc(reviewed.reason)}</p><p>Capacity and version will be checked again when you apply.</p>`;
    $('computeReviewError').hidden=true;dialog.showModal();
  });});
  $('computeBack').onclick=()=>dialog.close();
  $('computeApply').onclick=()=>void act(async()=>{if(!reviewed)throw new Error('Review the draft again.');await api('/apply',reviewed);dialog.close();await refresh(true);notice('Configuration applied and audited. Existing sessions retain their previous profiles.');});
  $('computeRefresh').onclick=()=>void act(()=>refresh());
  $('adminRefresh').addEventListener('click',()=>void act(()=>refresh()));
  document.querySelector('[data-admin-panel="compute"]').addEventListener('click',event=>{
    if(event.target.closest('#computeReset'))void act(()=>refresh(true));
    const restore=event.target.closest('[data-compute-restore]');if(restore){draft(snapshot.history.find(h=>h.version===Number(restore.dataset.computeRestore)).config,`Restore configuration v${restore.dataset.computeRestore}`);form.scrollIntoView({behavior:'smooth',block:'center'});notice('Version loaded as a draft only. Review before applying.');}
    const control=event.target.closest('[data-compute-action]');if(control)void act(async()=>{if(control.dataset.computeAction==='stop'&&!confirm('Drain this project session? Current work may continue; new submissions will be blocked. Persistent variables will be cleared when idle. Files are kept.'))return;await api(`/api/platform/projects/${enc(control.dataset.project)}/compute/${control.dataset.computeAction}`,{});await refresh();notice('Compute request saved. The controller retains the reservation until release is confirmed.');});
  });
  $('computeStart').onsubmit=event=>{event.preventDefault();void act(async()=>{await api(`/api/platform/projects/${enc(event.target.elements.projectId.value)}/compute/start`,{});await refresh();notice('Session requested. No agent run was submitted.');});};
  void act(async()=>{await refresh();projects=await api('/api/research/projects?scope=all');$('computeStart').elements.projectId.innerHTML='<option value="">Choose a project</option>'+projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');render();});
  setInterval(()=>{if(!document.hidden&&!document.querySelector('[data-admin-panel="compute"]').hidden&&!busy)void act(()=>refresh());},20000);
})();
