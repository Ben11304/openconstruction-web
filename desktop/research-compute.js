(() => {
  let panel, projectId='', snapshot=null, canEdit=false, busy=false, controller, generation=0, loaded=false;
  const field=name=>panel.querySelector(`[data-live-${name}]`);
  const choices=kind=>[...panel.querySelectorAll(`[data-live-picker="${kind}"] [role="menuitemradio"]`)];
  function closeMenus(focus=false) {
    for(const picker of panel.querySelectorAll('[data-live-picker]')) {
      const trigger=picker.querySelector('[aria-haspopup]');
      if(focus&&trigger.getAttribute('aria-expanded')==='true')trigger.focus();
      trigger.setAttribute('aria-expanded','false');picker.querySelector('[role="menu"]').hidden=true;
    }
  }
  function openMenu(kind,last=false) {
    closeMenus();
    const trigger=field(kind),menu=panel.querySelector(`[data-live-picker="${kind}"] [role="menu"]`);
    trigger.setAttribute('aria-expanded','true');menu.hidden=false;
    const items=choices(kind).filter(item=>!item.disabled);
    (items.find(item=>item.getAttribute('aria-checked')==='true')||items[last?items.length-1:0]||menu).focus();
  }
  function render() {
    if(!panel)return;
    const session=snapshot?.session, status=session?.status||'stopped';
    const live=loaded&&status==='active'&&snapshot.runtimeReady===true;
    field('status').textContent=!loaded?'Checking…':live?'Live':status==='waiting'?'Waiting':status==='draining'?'Stopping…':'Offline';
    field('status').dataset.state=live?'live':loaded?status:'unknown';
    const locked=busy||!loaded||!canEdit||status!=='stopped';
    for(const kind of ['ram','gpu']) {
      // Live sessions can inspect their selection; changes require a stopped session.
      field(kind).disabled=busy||!loaded;
      for(const item of choices(kind)) {
        item.setAttribute('aria-checked',String(item.value===field(kind).value));
        const unsupportedRam=kind==='ram'&&Array.isArray(snapshot?.capabilities?.ramGiB)&&!snapshot.capabilities.ramGiB.includes(Number(item.value));
        item.disabled=locked||unsupportedRam||(kind==='gpu'&&item.value==='true'&&!snapshot?.capabilities?.gpuAvailable);
      }
    }
    const gpuName=(snapshot?.capabilities?.gpuName||'GPU').replace(/^NVIDIA\s+(?:GeForce\s+)?/i,'');
    panel.querySelector('[data-live-gpu-name]').textContent=gpuName;
    field('action').textContent=busy?'Working…':status==='waiting'?'Cancel request':live?'Stop':'Go live';
    field('action').disabled=busy||!loaded||!canEdit||!snapshot?.enabled||status==='draining'||(status==='active'&&!live);
    field('refresh').disabled=busy;
    field('hint').textContent=!loaded||live?'':status==='waiting'?'Waiting for available RAM or GPU.':status==='draining'?'Finishing current work before releasing resources.':snapshot?.capabilities?.gpuAvailable?'':'GPU is unavailable on this host.';
  }
  async function request(suffix,options={}) {
    const response=await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/${suffix}`,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not update compute session.');return result;
  }
  async function refresh(action) {
    if(!panel||!projectId||busy)return;
    const version=generation;
    busy=true;controller=new AbortController();const pending=controller;const timer=setTimeout(()=>pending.abort(),30000);
    field('error').hidden=true;render();
    try {
      const access=await request('sharing');if(version!==generation)return;
      canEdit=access.access.canEdit;
      const options=action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='start'?{ramGiB:Number(field('ram').value),gpu:field('gpu').value==='true'}:{})}:{};
      const value=await request('compute'+(action?'/'+action:''),options);if(version!==generation)return;
      const initial=!snapshot;snapshot=value;loaded=true;
      if(initial||action||(value.session&&value.session.status!=='stopped')) {
        field('ram').value=String(value.session?.profile.sessionRamGiB||8);
        field('gpu').value=String(Boolean(value.session?.profile.gpu));
      }
    }catch(error){
      if(version!==generation)return;
      loaded=false;canEdit=false;
      field('status').textContent='Unavailable';
      field('error').textContent=error.name==='AbortError'?'Connection timed out. Refresh to check the session.':error.message;
      field('error').hidden=false;
    }finally{clearTimeout(timer);if(version===generation){busy=false;render();if(!loaded)field('status').textContent='Unavailable';}}
  }
  window.OCResearchCompute={
    select(id) {
      if(!id||projectId===id)return;
      controller?.abort();generation++;projectId=id;snapshot=null;canEdit=false;loaded=false;busy=false;
      if(panel){closeMenus();field('ram').value='8';field('gpu').value='false';render();void refresh();}
    },
    mount(header) {
      if(panel||window.OCDesktop?.platform!=='web')return;
      panel=document.createElement('section');panel.className='oc-live-compute';panel.setAttribute('aria-label','Project compute');
      const picker=(kind,label,value,items)=>`<div class="oc-live-picker" data-live-picker="${kind}"><button type="button" class="oc-live-picker-trigger" data-live-${kind} value="${value}" aria-label="Project ${kind==='ram'?'memory':'GPU'}" aria-haspopup="menu" aria-expanded="false" aria-controls="ocLive${label}Menu">${label}<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div class="oc-live-picker-menu" id="ocLive${label}Menu" role="menu" aria-label="${label}" tabindex="-1" hidden>${items.map(([option,text])=>`<button type="button" role="menuitemradio" aria-checked="${option===value}" value="${option}"><span class="oc-live-choice-check" aria-hidden="true">✓</span><span${kind==='gpu'&&option==='true'?' data-live-gpu-name':''}>${text}</span></button>`).join('')}</div></div>`;
      panel.innerHTML=`<div class="oc-live-options">${picker('ram','Memory','8',[['4','4 GB'],['8','8 GB'],['16','16 GB']])}${picker('gpu','GPU','false',[['false','No GPU'],['true','GPU']])}</div><div class="oc-live-actions"><span data-live-status role="status" aria-live="polite">Checking…</span><button type="button" data-live-refresh aria-label="Refresh compute status" title="Refresh status">↻</button><button type="button" data-live-action>Go live</button></div><p data-live-hint></p><p data-live-error role="alert" hidden></p>`;
      header.before(panel);
      for(const kind of ['ram','gpu']) {
        const trigger=field(kind);
        trigger.onclick=()=>trigger.getAttribute('aria-expanded')==='true'?closeMenus():openMenu(kind);
        trigger.onkeydown=event=>{
          if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openMenu(kind,event.key==='ArrowUp');}
        };
        for(const item of choices(kind))item.onclick=()=>{trigger.value=item.value;render();closeMenus();trigger.focus();};
      }
      panel.addEventListener('keydown',event=>{
        const menu=event.target.closest('[role="menu"]');
        if(event.key==='Escape'){event.stopPropagation();closeMenus(true);}
        else if(event.key==='Tab')closeMenus();
        else if(menu&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
          event.preventDefault();const items=[...menu.querySelectorAll('[role="menuitemradio"]')].filter(item=>!item.disabled);
          const index=items.indexOf(document.activeElement);
          const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
          items[next]?.focus();
        }
      });
      document.addEventListener('pointerdown',event=>{if(!event.target.closest('.oc-live-picker'))closeMenus();});
      document.addEventListener('focusin',event=>{if(!event.target.closest('.oc-live-picker'))closeMenus();});
      field('refresh').onclick=()=>void refresh();
      field('action').onclick=()=>{
        const stop=snapshot?.session&&snapshot.session.status!=='stopped';
        if(stop&&snapshot.session.status==='active'&&!window.confirm('Stop this project session after current work finishes? In-memory variables will be cleared. Files are kept.'))return;
        void refresh(stop?'stop':'start');
      };
      render();
      const id=window.OCDesktopLayout?.selection()?.projectId;
      if(projectId)void refresh();else if(id)window.OCResearchCompute.select(id);
      setInterval(()=>{if(!document.hidden)void refresh();},15000);
    }
  };
})();
