(() => {
  let panel, projectId='', snapshot=null, canEdit=false, busy=false, controller, generation=0, loaded=false;
  const field=name=>panel.querySelector(`[data-live-${name}]`);
  function render() {
    if(!panel)return;
    const session=snapshot?.session, status=session?.status||'stopped';
    const live=loaded&&status==='active'&&snapshot.runtimeReady===true;
    field('status').textContent=!loaded?'Checking…':live?'Live':status==='waiting'?'Waiting':status==='draining'?'Stopping…':'Offline';
    field('status').dataset.state=live?'live':loaded?status:'unknown';
    const locked=busy||!loaded||!canEdit||status!=='stopped';
    field('ram').disabled=locked;field('gpu').disabled=locked;
    field('gpu').querySelector('[value="true"]').disabled=!snapshot?.capabilities?.gpuAvailable;
    field('action').textContent=busy?'Working…':status==='waiting'?'Cancel request':live?'Stop':'Go live';
    field('action').disabled=busy||!loaded||!canEdit||!snapshot?.enabled||status==='draining'||(status==='active'&&!live);
    field('refresh').disabled=busy;
    field('hint').textContent=!loaded?'':status==='waiting'?'Waiting for available RAM or GPU.':status==='draining'?'Finishing current work before releasing resources.':live?'Stop the session to change resources.':snapshot?.capabilities?.gpuAvailable?'GPU: '+snapshot.capabilities.gpuName:'GPU is unavailable on this host.';
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
      if(panel){field('ram').value='8';field('gpu').value='false';render();void refresh();}
    },
    mount(identity) {
      if(panel||window.OCDesktop?.platform!=='web')return;
      panel=document.createElement('section');panel.className='oc-live-compute';panel.setAttribute('aria-label','Project compute');
      panel.innerHTML='<div class="oc-live-options"><label><span>Memory</span><select data-live-ram aria-label="Project memory"><option value="8">8 GB RAM</option><option value="16">16 GB RAM</option></select></label><label><span>GPU</span><select data-live-gpu aria-label="Project GPU"><option value="false">No GPU</option><option value="true">Use GPU</option></select></label></div><div class="oc-live-actions"><span data-live-status role="status" aria-live="polite">Checking…</span><button type="button" data-live-refresh aria-label="Refresh compute status" title="Refresh status">↻</button><button type="button" data-live-action>Go live</button></div><p data-live-hint></p><p data-live-error role="alert" hidden></p>';
      identity.append(panel);
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
