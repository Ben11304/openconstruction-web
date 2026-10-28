/* Persistent project team. Execution and conversation stay in the OC runtime. */
(() => {
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active = s => ['queued','running','blocked'].includes(s);
  const EFFORTS=['low','medium','high','xhigh','max'];
  function effortOptions(info){return info?.efforts?.length?EFFORTS.filter(e=>info.efforts.includes(e)):EFFORTS;}
  function runtimeChange(settings,field,value,info){
    const next={...settings.overrides};
    if(field==='model'){
      if(value)next.modelId=value;else delete next.modelId;
      // A model switch must not carry an unsupported explicit effort to the new model.
      if(next.thinkingMode==='enabled'&&next.thinkingEffort&&!effortOptions(info).includes(next.thinkingEffort)){
        next.thinkingMode='auto';delete next.thinkingEffort;
      }
      if(next.thinkingMode==='disabled'&&info?.efforts?.length&&!info.efforts.includes('none')){
        next.thinkingMode='auto';delete next.thinkingEffort;
      }
    }else if(field==='effort'){
      if(value==='inherit'){delete next.thinkingMode;delete next.thinkingEffort;}
      else if(value==='auto'||value==='off'){next.thinkingMode=value==='off'?'disabled':'auto';delete next.thinkingEffort;}
      else if(effortOptions(info).includes(value)){next.thinkingMode='enabled';next.thinkingEffort=value;}
      else throw Error('This model does not support that effort.');
    }else throw Error('Unknown runtime setting.');
    return next;
  }
  function agentSettings(host,{sessionId,role,isActive,onBusy=()=>{},composer}){
    const route=`sessions/${encodeURIComponent(sessionId)}`;
    let details,session,inheritedModelId,models=[],catalog=[],profiles={},pending=false,loading=false,disposed=false;
    const q=s=>host.querySelector(s);
    async function request(path,method='GET',body){
      const response=await fetch('/api/research/'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},signal:AbortSignal.timeout(15000),...(body===undefined?{}:{body:JSON.stringify(body)})});
      const data=await response.json();if(!response.ok)throw Error(data.detail||data.error?.message||data.error||'Could not update agent settings.');return data;
    }
    const info=id=>catalog.find(m=>m.id===profiles[id]);
    function lock(){if(disposed)return;host.querySelectorAll('select').forEach(el=>el.disabled=loading||pending||!details||isActive());q('[data-settings-reload]').disabled=loading||pending;if(composer){composer.querySelectorAll('select').forEach(el=>el.disabled=loading||pending||!details);const permissions=composer.querySelector('[data-composer-permissions]');permissions.disabled=loading||pending||!details||isActive();permissions.title=isActive()?'Finish or stop active and queued tasks before changing permissions':'Tool approval for this agent only';}}
    function notice(text,error=false){if(disposed)return;q('[data-settings-notice]').textContent=text;q('[data-settings-notice]').classList.toggle('is-error',error);}
    function options(select,items,value){select.innerHTML=items.map(i=>`<option value="${esc(i.value)}"${i.disabled?' disabled':''}>${esc(i.label)}</option>`).join('');select.value=value;}
    function render(){
      if(disposed||!details)return;
      const model=models.find(m=>m.id===details.effective.modelId),overrides=details.overrides;
      const available=catalog.filter(m=>!models.some(p=>profiles[p.id]===m.id));
      const items=[{value:'',label:'Use project default'},...models.map(m=>({value:m.id,label:m.name||m.model||m.id})),...available.map(m=>({value:'codex:'+m.id,label:'Codex · '+(m.name||m.id)}))];
      if(overrides.modelId&&!models.some(m=>m.id===overrides.modelId))items.push({value:overrides.modelId,label:'Model unavailable',disabled:true});
      options(q('[data-agent-model]'),items,overrides.modelId||'');
      q('[data-effective-model]').textContent='Current: '+(model?.name||model?.model||'No available model');
      const choices=[{value:'inherit',label:'Use inherited setting'},{value:'auto',label:'Auto'}];
      const selectedInfo=info(details.effective.modelId);
      if(!selectedInfo||selectedInfo.efforts?.includes('none'))choices.push({value:'off',label:'Off'});
      choices.push(...effortOptions(selectedInfo).map(value=>({value,label:{low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'}[value]})));
      const mode=overrides.thinkingMode;
      const effort=mode==='disabled'?'off':mode==='auto'?'auto':mode==='enabled'?(overrides.thinkingEffort||details.effective.thinkingEffort||model?.thinkingEffort||'auto'):'inherit';
      if(!choices.some(c=>c.value===effort))choices.push({value:effort,label:effort+' (unsupported)',disabled:true});
      options(q('[data-agent-effort]'),choices,effort);
      const effectiveMode=details.effective.thinkingMode||model?.thinkingMode||'auto';
      const effectiveEffort=effectiveMode==='disabled'?'Off':effectiveMode==='auto'?'Auto':details.effective.thinkingEffort||model?.thinkingEffort||'Model default';
      if(composer){
        const short=m=>(m?.name||m?.model||'No model').replace(/^Codex\s*[·:]\s*/, '');
        const inheritedModel=models.find(m=>m.id===inheritedModelId)||(!overrides.modelId?model:undefined);
        options(composer.querySelector('[data-composer-model]'),[{value:'',label:inheritedModel?'Default: '+short(inheritedModel):'Project default'},...items.slice(1).map(i=>({...i,label:i.label.replace(/^Codex\s*[·:]\s*/, '')}))],overrides.modelId||'');
        options(composer.querySelector('[data-composer-effort]'),choices.map(c=>({...c,label:c.value==='inherit'?(overrides.thinkingMode?'Default':'Default: '+effectiveEffort):c.value==='auto'?'Auto':c.label})),effort);
        composer.querySelector('[data-composer-model]').title='Model for the next message: '+(model?.name||model?.model||'Project default');
        composer.querySelector('[data-composer-effort]').title='Thinking effort for the next message';
      }
      q('[data-effective-effort]').textContent='Current: '+effectiveEffort;
      q('[data-agent-permissions]').value=session.approvalMode||'ask_for_dangerous';
      if(composer)composer.querySelector('[data-composer-permissions]').value=session.approvalMode||'ask_for_dangerous';lock();
    }
    async function load(){
      if(pending||loading||disposed)return;loading=true;onBusy(true);lock();notice('Loading settings…');
      try{
        const result=await Promise.all([request(route+'/settings'),request(route),request('models'),
          window.OCDesktop?.codexStatus?.().catch(()=>({}))||{},window.OCDesktop?.codexModels?.().catch(()=>[])||[]]);
        if(disposed)return;
        [details,session,models]=result;profiles=result[3].profiles||(result[3].modelId?{[result[3].modelId]:result[3].model}:{});catalog=result[4];
        if(composer&&session.projectId){const project=await request(`projects/${encodeURIComponent(session.projectId)}/settings`).catch(()=>null);if(disposed)return;inheritedModelId=project?.effective?.modelId;}
        render();notice('Changes apply to new tasks, including assignments from the parent.');
      }catch(e){details=null;notice(e.message,true);}finally{loading=false;lock();onBusy(false);}
    }
    async function save(field,value,{forNextTask=false}={}){
      const nextTask=forNextTask&&['model','effort'].includes(field);
      if(pending||loading||!details||(!nextTask&&isActive())||disposed){render();return false;}
      if(field==='permissions'&&value==='always_allow'&&!window.confirm('Automatically approve tool requests for this agent? Existing sandbox and resource limits still apply.')){render();return false;}
      pending=true;onBusy(true);lock();notice('Saving…');let saved=false;
      try{
        if(!nextTask){const runs=await request(route+'/runs');if(runs.some(r=>active(r.status)))throw Error('Wait for this agent’s active or queued tasks to finish before changing settings.');}
        if(field==='permissions'){
          if(!['always_allow','ask_for_dangerous'].includes(value))throw Error('Unknown permission mode.');
          await request(route,'PATCH',{approvalMode:value});session.approvalMode=value;
        }else{
          if(field==='model'&&value.startsWith('codex:')){
            const chosen=catalog.find(m=>'codex:'+m.id===value);
            if(!chosen)throw Error('Choose an available Codex model.');
            // Register the profile only; apply settings once below, to this agent.
            const result=await window.OCDesktop.connectCodexModel({model:chosen.id,useAsDefault:false});
            value=result.modelId;profiles[value]=result.model;
            models=await request('models');
          }
          const latest=await request(route+'/settings');
          if(field==='model'&&value&&!models.some(m=>m.id===value))throw Error('Choose a connected model.');
          const chosenInfo=info(field==='model'?value:latest.effective.modelId);
          if(field==='effort'&&value==='off'&&chosenInfo?.efforts?.length&&!chosenInfo.efforts.includes('none'))throw Error('This model does not support disabling thinking.');
          await request(route+'/settings','PUT',runtimeChange(latest,field,value,chosenInfo));
          details=await request(route+'/settings');
        }
        saved=true;notice('Saved for this agent. Applies to new tasks.');
      }catch(e){notice(e.message,true);}finally{pending=false;onBusy(false);render();lock();}
      return saved;
    }
    host.innerHTML=`<p class="oc-node-settings-help">Settings for this agent only</p><label>Model<select data-agent-model aria-label="Agent model"><option>Loading…</option></select><small data-effective-model></small></label><label>Thinking effort<select data-agent-effort aria-label="Agent thinking effort"><option>Loading…</option></select><small data-effective-effort></small></label><label>Tool approval<select data-agent-permissions aria-label="Agent tool approval"><option value="ask_for_dangerous">Ask before actions requiring approval</option><option value="always_allow">Automatically approve</option></select></label><p class="oc-node-settings-help" data-settings-lock hidden>Finish or stop active tasks before changing settings.</p><p data-settings-notice role="status" aria-live="polite"></p><button type="button" data-settings-reload>Refresh settings</button><details><summary>Role &amp; responsibilities (read-only)</summary><p class="oc-node-role">${esc(role)}</p></details>`;
    for(const field of ['model','effort','permissions'])q(`[data-agent-${field}]`).onchange=e=>{void save(field,e.target.value);};
    if(composer)for(const field of ['model','effort','permissions'])composer.querySelector(`[data-composer-${field}]`).onchange=async e=>{const saved=await save(field,e.target.value,{forNextTask:field!=='permissions'});const notice=composer.querySelector('[data-composer-notice]');notice.textContent=saved?'':q('[data-settings-notice]').textContent;notice.hidden=saved||!notice.textContent;};
    q('[data-settings-reload]').onclick=load;lock();
    return {load,save,get busy(){return pending||loading;},sync(){lock();q('[data-settings-lock]').hidden=!isActive();},dispose(){disposed=true;}};
  }
  const COMPOSER_ICONS={send:'<path d="M12 19V5m-6 6 6-6 6 6"/>',queue:'<path d="M4 6h12M4 11h8M4 16h8m4-5 4 4-4 4m-3-4h7"/>',stop:'<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>'};
  function composerState({status,draft='',sending=false,busy=false,stopping=false,queued=0}){const running=active(status);return {mode:running?'queue':'send',stopVisible:running,sendDisabled:!draft.trim()||sending||busy||stopping,stopDisabled:stopping,queued};}
  function messageBox(entry){
    const kind=['user','assistant','progress','queued','error'].includes(entry.kind)?entry.kind:'assistant';
    const markdown=['assistant','progress'].includes(kind)&&window.OCResearchChat?.markdown;
    const body=markdown?`<div class="oc-chat-markdown">${window.OCResearchChat.markdown(entry.content)}</div>`:`<p>${esc(entry.content)}</p>`;
    if(kind==='progress'){
      const latest=String(entry.content??'').trim().split(/\n\s*\n/).filter(Boolean).at(-1)||'Working on your request…';
      const preview=latest.length>160?latest.slice(0,157)+'…':latest;
      return `<article class="oc-agent-message is-progress"><details class="oc-agent-progress"><summary><span class="oc-agent-activity-dot" aria-hidden="true"></span><strong class="oc-agent-message-sender">${esc(entry.role)}</strong><span class="oc-agent-progress-preview">${esc(preview)}</span></summary>${body}</details></article>`;
    }
    return `<article class="oc-agent-message is-${kind}"><strong class="oc-agent-message-sender">${esc(entry.role)}</strong>${body}</article>`;
  }
  const MIN_ZOOM=.2,MAX_ZOOM=2.5;
  function zoomAt(view,scale,point){
    scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,scale));
    const ratio=scale/view.scale;
    return {scale,x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio};
  }
  function fitView(nodes,positions,width,height){
    const points=nodes.map(n=>positions[n.id]||n);
    if(!points.length||width<=0||height<=0)return {scale:1,x:0,y:0};
    const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));
    const w=Math.max(...points.map(p=>p.x+240))-left,h=Math.max(...points.map(p=>p.y+128))-top;
    const scale=Math.max(MIN_ZOOM,Math.min(1,(width-48)/w,(height-48)/h));
    return {scale,x:(width-w*scale)/2-left*scale,y:(height-h*scale)/2-top*scale};
  }
  function validView(v){return !!v&&[v.x,v.y,v.scale].every(Number.isFinite)&&v.scale>=MIN_ZOOM&&v.scale<=MAX_ZOOM;}
  function graph(snapshot) {
    const depth=new Map(),agents=snapshot.agents||[];
    function level(a,seen=new Set()){if(depth.has(a.id))return depth.get(a.id);if(seen.has(a.id))return 0;seen.add(a.id);const n=Math.max(0,...a.parents.map(id=>{const p=agents.find(a=>a.id===id);return p?level(p,new Set(seen))+1:0;}));depth.set(a.id,n);return n;}
    const rows=new Map();for(const a of agents){const d=level(a);if(!rows.has(d))rows.set(d,[]);rows.get(d).push(a);}
    const width=Math.max(760,...[...rows.values()].map(row=>row.length*280+50));
    const nodes=agents.map(a=>{const row=rows.get(depth.get(a.id));return {...a,x:(width-row.length*280)/2+row.indexOf(a)*280+20,y:35+depth.get(a.id)*190};});
    const edges=agents.flatMap(a=>a.parents.map(parent=>{const records=(snapshot.dispatches||[]).filter(d=>d.sourceId===parent&&d.targetId===a.id);const latest=records.findLast(d=>active(d.status))||records.at(-1);return {from:parent,to:a.id,status:latest?.status||'idle',active:!!latest&&active(latest.status)};}));
    return {nodes,edges,width,height:Math.max(400,(Math.max(0,...depth.values())+1)*190+60)};
  }
  function mount(host){
    let projectId='',snapshot={agents:[],dispatches:[]},models=[],error='',loading=false,visible=false,z=1,positions={},scale=1,graphKey='',model;
    let view={scale:1,x:0,y:0},viewReady=false,gesture=false,space=false,suppressClick=false,cancelGesture;
    const chats=new Map();host.innerHTML='<div class="oc-team-toolbar"><details class="oc-team-controls"><summary>Graph controls</summary><div class="oc-team-controls-menu"><button type="button" data-team-fit>Fit graph</button><button type="button" data-team-layout-reset>Reset layout</button></div></details><button type="button" data-team-add>Add agent</button><small data-team-engine></small></div><p class="oc-team-error" role="status" hidden></p><div class="oc-team-graph"></div><div class="oc-team-chats"></div>';
    const controls=host.querySelector('.oc-team-controls');
    host.addEventListener('keydown',e=>{if(e.key==='Escape'&&controls.open){controls.open=false;controls.querySelector('summary').focus();e.stopPropagation();}});
    window.addEventListener('pointerdown',e=>{if(!e.target.closest('.oc-team-controls'))controls.open=false;});
    const canvas=host.querySelector('.oc-team-graph'),layer=host.querySelector('.oc-team-chats');
    canvas.tabIndex=0;canvas.setAttribute('aria-label','Agent graph. Drag background to pan. Use plus or minus to zoom, arrows to pan, and 0 to fit.');
    const zoomControls=document.createElement('div');zoomControls.className='oc-team-zoom';zoomControls.setAttribute('role','group');zoomControls.setAttribute('aria-label','Graph zoom');
    zoomControls.innerHTML='<button type="button" data-team-zoom-out aria-label="Zoom out">−</button><button type="button" data-team-zoom-reset aria-label="Reset zoom to 100 percent">100%</button><button type="button" data-team-zoom-in aria-label="Zoom in">+</button>';
    host.querySelector('[data-team-fit]').before(zoomControls);
    const storageKey=()=>`oc-project-team-layout:${projectId}`;
    const resetButton=host.querySelector('[data-team-layout-reset]');resetButton.onclick=()=>{positions={};save();graphKey='';viewReady=false;draw();controls.open=false;};
    const save=()=>{try{localStorage.setItem(storageKey(),JSON.stringify(positions));}catch{}};
    async function api(path='',options={}){const response=await fetch(`/api/research/projects/${encodeURIComponent(projectId)}/team${path}`,{...options,headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error?.message||data.error||`Request failed (${response.status})`);return data;}
    async function availableModels(){try{const response=await fetch('/api/research/models',{cache:'no-store',headers:{'X-OC-Workspace':'research'},signal:AbortSignal.timeout(15000)});if(!response.ok)return models;const data=await response.json();return Array.isArray(data)?data:models;}catch{return models;}}
    function edges(){if(!model)return '';const nodes=new Map(model.nodes.map(n=>[n.id,{...n,...positions[n.id]}]));return '<defs><marker id="team-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#617286"/></marker></defs>'+model.edges.map(e=>{const a=nodes.get(e.from),b=nodes.get(e.to);if(!a||!b)return '';const x=a.x+120,y=a.y+112,tx=b.x+120,ty=b.y-6,mid=(y+ty)/2;return `<g class="oc-flow-edge is-${e.active?'active':['failed','cancelled','interrupted'].includes(e.status)?'failed':e.status==='completed'?'returned':'assigned'}"><path d="M${x} ${y} C${x} ${mid} ${tx} ${mid} ${tx} ${ty}" marker-end="url(#team-arrow)"/>${e.active?`<text x="${(x+tx)/2}" y="${mid-6}" text-anchor="middle">${esc(e.status==='queued'?'Queued':'Dispatch active')}</text>`:''}</g>`;}).join('');}
    const viewKey=()=>`oc-project-team-viewport:${projectId}`;
    function applyView(persist=false){
      scale=view.scale;
      canvas.querySelector('.oc-team-world')?.style.setProperty('transform',`translate(${view.x}px,${view.y}px) scale(${scale})`);
      canvas.style.backgroundPosition=`${view.x}px ${view.y}px`;
      canvas.style.backgroundSize=`${20*scale}px ${20*scale}px`;
      zoomControls.querySelector('[data-team-zoom-reset]').textContent=Math.round(scale*100)+'%';
      zoomControls.querySelector('[data-team-zoom-out]').disabled=scale<=MIN_ZOOM;
      zoomControls.querySelector('[data-team-zoom-in]').disabled=scale>=MAX_ZOOM;
      if(persist&&projectId)try{localStorage.setItem(viewKey(),JSON.stringify(view));}catch{}
    }
    function fit(){if(!model||!canvas.clientWidth)return;view=fitView(model.nodes,positions,canvas.clientWidth,canvas.clientHeight);viewReady=true;applyView(true);}
    function zoom(next,point={x:canvas.clientWidth/2,y:canvas.clientHeight/2}){
      if(!model||gesture)return;view=zoomAt(view,next,point);viewReady=true;applyView(true);
    }
    function draw(){
      if(gesture)return;
      host.querySelector('[data-team-engine]').textContent=snapshot.orchestrationEngine==='langgraph-v1'?'LangGraph':'';
      host.querySelector('.oc-team-error').hidden=!error;host.querySelector('.oc-team-error').textContent=error;
      host.querySelector('[data-team-add]').disabled=!projectId;
      if(!snapshot.agents.length){canvas.innerHTML=`<div class="oc-agents-empty"><h3>${projectId?'Build your project team':'Select a project'}</h3><p>${projectId?'Add an agent directly, or a coordinator when you need a team. Agents stay here between tasks. Existing run workers remain in the session record.':'Choose a project to view its persistent agents.'}</p>${projectId?'<button type="button" data-team-add>Add agent</button>':''}</div>`;graphKey='';return;}
      const key=JSON.stringify([snapshot,models]);model=graph(snapshot);
      if(key!==graphKey){graphKey=key;canvas.innerHTML=`<div class="oc-team-world" style="width:${model.width}px;height:${model.height}px"><svg class="oc-graph-edges" width="${model.width}" height="${model.height}" aria-hidden="true">${edges()}</svg>${model.nodes.map(n=>{const p=positions[n.id]||n,m=models.find(m=>m.id===n.modelId),fullName=m?.name||m?.model||(n.modelId?'Model unavailable':'No model selected'),label=fullName.replace(/^Codex\s*[·:]\s*/,'');return `<button type="button" class="oc-agent-node" data-team-node="${esc(n.id)}" data-status="${esc(n.status)}" style="left:${p.x}px;top:${p.y}px" aria-label="Open ${esc(n.name)} chat"><strong>${esc(n.name)}</strong><small class="oc-agent-node-model" title="${esc(fullName)}">${esc(label)}</small></button>`;}).join('')}</div>`;if(!viewReady)fit();else applyView();}
    }
    async function refresh(){if(!visible||!projectId||loading)return;loading=true;const requested=projectId;try{const [data,catalog]=await Promise.all([api(),availableModels()]);if(requested!==projectId)return;snapshot=data;models=catalog;error='';draw();await Promise.all([...chats.values()].map(refreshChat));}catch(e){if(requested===projectId){error=`Team connection unavailable: ${e.message}`;draw();}}finally{loading=false;}}
    function chatNotice(chat,message=''){const notice=chat.el.querySelector('[data-team-chat-status]');notice.textContent=message;notice.hidden=!message;}
    function syncComposer(chat){
      const state=composerState({status:chat.run?.status,draft:chat.el.querySelector('textarea').value,sending:chat.sending,busy:chat.settingsBusy,stopping:chat.stopping,queued:chat.queued||0});
      const send=chat.el.querySelector('[type=submit]'),stop=chat.el.querySelector('[data-team-stop]'),queue=chat.el.querySelector('[data-team-queue-count]');
      const label=state.mode==='queue'?'Queue message':'Send message';send.disabled=state.sendDisabled;send.title=label;send.setAttribute('aria-label',label);send.dataset.mode=state.mode;send.querySelector('svg').innerHTML=COMPOSER_ICONS[state.mode];
      stop.hidden=!state.stopVisible;stop.disabled=state.stopDisabled;stop.title=chat.run?.status==='queued'?'Cancel queued task':'Stop current task';stop.setAttribute('aria-label',stop.title);
      queue.hidden=!state.queued;queue.textContent=state.queued?`${state.queued} queued`:'';
      const presence=chat.el.querySelector('[data-team-presence]'),status=chat.run?.status;
      presence.textContent=status==='blocked'?'Needs your approval':status==='running'?'Working on your request':status==='queued'?'Message queued':'Ready to help';
      presence.dataset.state=active(status)?status:'idle';
      const sessionButton=chat.el.querySelector('[data-team-open-session]');
      sessionButton?.classList.toggle('needs-approval',status==='blocked');
      if(sessionButton){sessionButton.title=status==='blocked'?'Review pending approvals':'Open full conversation and approvals';sessionButton.setAttribute('aria-label',sessionButton.title);}
      chat.el.querySelector('[data-team-approval]').hidden=status!=='blocked';
      chat.el.querySelector('[data-composer-hint]').textContent=state.mode==='queue'?'New messages will be queued.':'Enter to send · Shift+Enter for a new line';
    }
    async function refreshChat(chat){
      const requested=projectId;try{const data=await api(`/${chat.id}/chat`);if(requested!==projectId||!chats.has(chat.id))return;
        const runs=[...data.runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const run=runs.find(r=>['running','blocked'].includes(r.status))||runs.find(r=>r.status==='queued')||runs[0];
        chatNotice(chat,chat.error);
        chat.run=run;chat.queued=runs.filter(r=>r.status==='queued').length;chat.settings?.sync();syncComposer(chat);
        const entries=data.messages.map(m=>({id:m.id,kind:m.role==='user'?'user':'assistant',role:m.role==='user'?'You':chat.name,content:m.content}));
        if(data.progress)entries.push({id:'live-progress',kind:'progress',role:'Working',content:data.progress});
        if(data.response)entries.push({id:'live-response',kind:'assistant',role:chat.name,content:data.response});
        const recorded=new Set(data.runs.filter(r=>r.userMessageId).map(r=>r.id));
        for(const queued of runs.filter(r=>r.status==='queued'&&!recorded.has(r.id)))entries.push({id:queued.id,kind:'queued',role:'Queued',content:queued.prompt});
        if(run?.error)entries.push({id:run.id+':error',kind:'error',role:'Error',content:run.error});
        const key=JSON.stringify(entries);if(chat.key!==key){chat.key=key;const messages=chat.el.querySelector('[data-team-messages]'),bottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<80,top=messages.scrollTop,expanded=messages.querySelector('.oc-agent-progress')?.open;messages.innerHTML=entries.length?entries.map(messageBox).join(''):`<div class="oc-agent-chat-empty"><span aria-hidden="true">✦</span><h3>What would you like to work on?</h3><p>Ask ${esc(chat.name)} a question, explore your data, or share an idea.</p></div>`;if(expanded&&messages.querySelector('.oc-agent-progress'))messages.querySelector('.oc-agent-progress').open=true;messages.scrollTop=bottom?messages.scrollHeight:top;}
      }catch(e){chatNotice(chat,e.message);}
    }
    function open(id){const old=chats.get(id);if(old){old.el.hidden=false;old.el.classList.remove('is-minimized');old.el.style.zIndex=++z;old.el.querySelector('textarea').focus();return;}const agent=snapshot.agents.find(a=>a.id===id);if(!agent)return;
      const el=document.createElement('section');el.className='oc-agent-chat';el.setAttribute('aria-label',agent.name+' chat');el.style.cssText=`left:${20+chats.size*24}px;top:${100+chats.size*24}px;z-index:${++z}`;
      el.innerHTML=`<header class="oc-agent-chat-title" tabindex="0"><span class="oc-agent-chat-avatar" aria-hidden="true">${esc(agent.name.slice(0,1).toUpperCase())}</span><div class="oc-agent-chat-identity"><strong>${esc(agent.name)}</strong><small data-team-presence>Ready to help</small></div><div class="oc-agent-chat-actions"></div><button type="button" data-min aria-label="Minimize chat" title="Minimize chat">−</button><button type="button" data-close aria-label="Close chat" title="Close chat">×</button></header><div class="oc-agent-chat-content"><p class="oc-agent-chat-status" data-team-chat-status role="status">Loading conversation…</p><div class="oc-agent-chat-approval" data-team-approval role="status" hidden><span>A step needs your approval.</span><button type="button" data-team-review>Review request</button></div><div class="oc-agent-chat-messages" data-team-messages role="log" aria-label="${esc(id)} conversation"></div>
        <form class="oc-agent-composer"><div class="oc-composer-frame"><textarea rows="1" aria-label="Message ${esc(id)}" placeholder="Ask ${esc(agent.name)} anything…"></textarea>
          <p class="oc-composer-notice" data-composer-notice role="status" hidden></p>
          <div class="oc-composer-footer"><div class="oc-composer-selectors"><select data-composer-model aria-label="Message model" disabled><option>Model…</option></select><details class="oc-composer-options"><summary title="Thinking effort and action approvals">Options</summary><div><label>Thinking effort<select data-composer-effort aria-label="Message thinking effort" disabled><option>Effort…</option></select></label><label>Action approvals<select data-composer-permissions aria-label="Message permissions" disabled><option value="ask_for_dangerous">Permissions: Ask</option><option value="always_allow">Always allow</option></select></label></div></details><span data-team-queue-count class="oc-composer-queue-count" aria-live="polite" hidden></span></div>
            <div class="oc-composer-buttons"><button type="button" class="oc-composer-button oc-composer-stop" data-team-stop aria-label="Stop current task" title="Stop current task" hidden><svg viewBox="0 0 24 24" aria-hidden="true">${COMPOSER_ICONS.stop}</svg></button><button type="submit" class="oc-composer-button oc-composer-send" aria-label="Send message" title="Send message" disabled><svg viewBox="0 0 24 24" aria-hidden="true">${COMPOSER_ICONS.send}</svg></button></div>
          </div></div><p class="oc-agent-composer-hint" data-composer-hint></p></form></div>`;
      const chat={id,name:agent.name,el,key:'',sessionId:agent.sessionId,projectId,error:'',sending:false,stopping:false,settingsBusy:false,queued:0};chats.set(id,chat);layer.append(el);
      el.onpointerdown=()=>el.style.zIndex=++z;el.querySelector('[data-close]').onclick=()=>{chat.settings?.dispose();el.remove();chats.delete(id);};el.querySelector('[data-min]').onclick=()=>el.classList.toggle('is-minimized');
      const settingsHost=document.createElement('section');settingsHost.className='oc-node-settings';settingsHost.hidden=true;settingsHost.setAttribute('aria-label',agent.name+' settings');el.querySelector('.oc-agent-chat-content').append(settingsHost);
      chat.settings=agentSettings(settingsHost,{sessionId:chat.sessionId,role:agent.role,isActive:()=>chat.sending||active(chat.run?.status),composer:el.querySelector('form'),onBusy:busy=>{chat.settingsBusy=busy;syncComposer(chat);}});
      const settingsButton=document.createElement('button');settingsButton.type='button';settingsButton.className='oc-node-settings-toggle';settingsButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6m8 4v6"/></svg>';settingsButton.title='Chat settings';settingsButton.setAttribute('aria-label','Chat settings');settingsButton.setAttribute('aria-expanded','false');el.querySelector('.oc-agent-chat-actions').append(settingsButton);
      settingsButton.onclick=()=>{const show=settingsHost.hidden;settingsHost.hidden=!show;el.querySelector('[data-team-messages]').hidden=show;el.querySelector('form').hidden=show;settingsButton.title=show?'Back to chat':'Chat settings';settingsButton.setAttribute('aria-label',settingsButton.title);settingsButton.setAttribute('aria-expanded',String(show));if(show)void chat.settings.load();else el.querySelector('textarea').focus();};
      movable(el.querySelector('header'),el,false);
      const sessionButton=document.createElement('button');sessionButton.type='button';sessionButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6L10 14M10 5H5v14h14v-5"/></svg>';sessionButton.className='oc-agent-chat-action';sessionButton.dataset.teamOpenSession='';sessionButton.title='Open full conversation and approvals';sessionButton.setAttribute('aria-label','Open full conversation and approvals');el.querySelector('.oc-agent-chat-actions').prepend(sessionButton);sessionButton.onclick=async()=>{await window.OCResearchWorkspace.openSession(chat.projectId,chat.sessionId);document.querySelector('[data-agent-view="chat"]')?.click();};
      el.querySelector('[data-team-review]').onclick=sessionButton.onclick;
      el.querySelector('form').onsubmit=async e=>{e.preventDefault();if(chat.sending||chat.stopping||chat.settings?.busy||chat.projectId!==projectId)return;const input=el.querySelector('textarea'),content=input.value.trim();if(!content)return;chat.sending=true;syncComposer(chat);try{const run=await api(`/${id}/chat`,{method:'POST',body:JSON.stringify({content})});if(!active(chat.run?.status))chat.run=run;if(run.status==='queued')chat.queued++;if(input.value.trim()===content){input.value='';input.style.height='';}chat.error='';await refresh();}catch(e){chat.error=e.message;chatNotice(chat,chat.error);}finally{chat.sending=false;chat.settings?.sync();syncComposer(chat);}};
      el.querySelector('textarea').oninput=e=>{e.target.style.height='auto';e.target.style.height=Math.min(150,e.target.scrollHeight)+'px';syncComposer(chat);};
      el.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();el.querySelector('form').requestSubmit();}};
      el.querySelector('form').addEventListener('keydown',e=>{const options=el.querySelector('.oc-composer-options');if(e.key==='Escape'&&options.open){options.open=false;options.querySelector('summary').focus();e.stopPropagation();}});
      el.querySelector('[data-team-stop]').onclick=async()=>{if(!chat.run||chat.stopping||!active(chat.run.status))return;const runId=chat.run.id;chat.stopping=true;syncComposer(chat);try{const r=await fetch(`/api/research/sessions/${chat.sessionId}/runs/${runId}/cancel`,{method:'POST',headers:{'X-OC-Workspace':'research'}});if(!r.ok)throw Error('Could not stop task');await refresh();}catch(e){chatNotice(chat,e.message);}finally{chat.stopping=false;syncComposer(chat);}};
      refreshChat(chat);void chat.settings.load();syncComposer(chat);el.querySelector('textarea').focus();
    }
    function movable(handle,element,node){
      handle.style.touchAction='none';
      handle.onpointerdown=e=>{
        if(e.button!==0||e.target.closest('header button')||(node&&(space||gesture)))return;
        e.preventDefault();
        if(node)gesture=true;
        const x=e.clientX,y=e.clientY,left=element.offsetLeft,top=element.offsetTop;
        let moved=false;
        handle.setPointerCapture(e.pointerId);
        const move=event=>{
          if(event.pointerId!==e.pointerId)return;
          const dx=(event.clientX-x)/(node?scale:1),dy=(event.clientY-y)/(node?scale:1);
          if(Math.hypot(event.clientX-x,event.clientY-y)<6&&!moved)return;
          moved=true;
          element.style.left=(node?left+dx:Math.max(0,left+dx))+'px';element.style.top=(node?top+dy:Math.max(0,top+dy))+'px';
          if(node){positions[element.dataset.teamNode]={x:left+dx,y:top+dy};canvas.querySelector('svg').innerHTML=edges();}
        };
        const end=event=>{
          if(event?.type==='pointerup')move(event);
          handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);
          handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);
          window.removeEventListener('blur',end);
          if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
          if(moved){element.dataset.dragged='true';setTimeout(()=>delete element.dataset.dragged,0);if(node)save();}
          if(node){gesture=false;cancelGesture=undefined;if(moved)suppressClick=true;setTimeout(()=>{suppressClick=false;draw();},0);}
        };
        handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);
        handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
        window.addEventListener('blur',end);
        if(node)cancelGesture=end;
      };
    }
    async function add(){
      if(window.OCAgentDesigner&&projectId)return window.OCAgentDesigner.open({host,projectId,agents:snapshot.agents,onCreated:refresh});
      if(!projectId||host.querySelector('dialog'))return;const requested=projectId,dialog=document.createElement('dialog');dialog.className='oc-team-dialog';
      dialog.innerHTML=`<form><h3>Add project agent</h3><label>Agent ID<input name="id" required pattern="[A-Z][A-Z0-9_]*" maxlength="48" value="${snapshot.agents.length?'':'BOSS'}" placeholder="BIM_REVIEWER"></label><label>Name<input name="name" required maxlength="100" value="${snapshot.agents.length?'':'BOSS'}"></label><label>Role and responsibilities<textarea name="role" required maxlength="8000" rows="4" placeholder="Describe this member’s scope and expected outputs"></textarea></label><label>Parent agents<select name="parents" multiple>${snapshot.agents.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.id)})</option>`).join('')}</select><small>No parent makes this a top-level agent.</small></label><label>Model<select name="modelId"><option value="">Use project default</option></select></label><p>Skills, connectors and permissions use the existing OC project/session settings. Adding an agent does not grant extra access.</p><p data-form-error role="alert"></p><div><button type="button" data-cancel>Cancel</button><button type="submit">Create agent</button></div></form>`;
      host.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').onclick=()=>dialog.remove();dialog.oncancel=()=>dialog.remove();
      try{const r=await fetch('/api/research/models',{headers:{'X-OC-Workspace':'research'}});if(r.ok){const models=await r.json();for(const m of Array.isArray(models)?models:[]){const o=document.createElement('option');o.value=m.id;o.textContent=m.name||m.id;dialog.querySelector('[name=modelId]').append(o);}}}catch{}
      dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(requested!==projectId){dialog.remove();return;}const form=e.target,data=new FormData(form),button=form.querySelector('[type=submit]');button.disabled=true;try{await api('',{method:'POST',body:JSON.stringify({id:data.get('id'),name:data.get('name'),role:data.get('role'),parents:data.getAll('parents'),...(data.get('modelId')?{modelId:data.get('modelId')}:{})})});dialog.remove();await refresh();}catch(e){form.querySelector('[data-form-error]').textContent=e.message;button.disabled=false;}};
    }
    host.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||suppressClick)return;if(b.hasAttribute('data-team-add'))add();if(b.hasAttribute('data-team-fit')){fit();controls.open=false;}if(b.hasAttribute('data-team-zoom-in'))zoom(scale*1.2);if(b.hasAttribute('data-team-zoom-out'))zoom(scale/1.2);if(b.hasAttribute('data-team-zoom-reset'))zoom(1);if(b.dataset.teamNode&&!b.dataset.dragged)open(b.dataset.teamNode);});
    canvas.addEventListener('wheel',e=>{
      if(!model||gesture)return;e.preventDefault();
      const unit=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;
      if(e.ctrlKey||e.metaKey){const rect=canvas.getBoundingClientRect();zoom(scale*Math.exp(-e.deltaY*unit*.008),{x:e.clientX-rect.left,y:e.clientY-rect.top});}
      else{view={...view,x:view.x-e.deltaX*unit,y:view.y-e.deltaY*unit};viewReady=true;applyView(true);}
    },{passive:false});
    canvas.addEventListener('keydown',e=>{
      if(e.target.closest('input,textarea,select'))return;
      if(e.key===' '){e.preventDefault();space=true;canvas.classList.add('is-pan-ready');return;}
      if(e.key==='+'||e.key==='='){e.preventDefault();zoom(scale*1.2);}
      else if(e.key==='-'){e.preventDefault();zoom(scale/1.2);}
      else if(e.key==='0'){e.preventDefault();fit();}
      else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!gesture){e.preventDefault();view={...view,x:view.x+(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0),y:view.y+(e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0)};viewReady=true;applyView(true);}
    });
    const clearSpace=()=>{space=false;canvas.classList.remove('is-pan-ready');};
    canvas.addEventListener('keyup',e=>{if(e.key===' ')clearSpace();});canvas.addEventListener('focusout',clearSpace);window.addEventListener('blur',clearSpace);
    canvas.addEventListener('pointerdown',e=>{
      const node=e.target.closest('[data-team-node]');
      if(!model||gesture||e.target.closest('.oc-agents-empty')||!(e.button===1||(e.button===0&&(!node||space))))return;
      e.preventDefault();e.stopPropagation();canvas.focus({preventScroll:true});gesture=true;canvas.classList.add('is-panning');
      const origin={...view},x=e.clientX,y=e.clientY;let moved=false;
      canvas.setPointerCapture(e.pointerId);
      const move=event=>{if(event.pointerId!==e.pointerId)return;const dx=event.clientX-x,dy=event.clientY-y;if(Math.hypot(dx,dy)<4&&!moved)return;moved=true;view={...origin,x:origin.x+dx,y:origin.y+dy};viewReady=true;applyView();};
      const end=event=>{
        if(event?.type==='pointerup')move(event);
        canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',end);canvas.removeEventListener('pointercancel',end);canvas.removeEventListener('lostpointercapture',end);window.removeEventListener('blur',end);
        if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
        gesture=false;cancelGesture=undefined;canvas.classList.remove('is-panning');if(moved){suppressClick=true;applyView(true);}
        setTimeout(()=>{suppressClick=false;draw();},0);
      };
      cancelGesture=end;canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);window.addEventListener('blur',end);
    },true);
    canvas.addEventListener('pointerdown',e=>{const node=e.target.closest('[data-team-node]');if(node&&!node.onpointerdown){movable(node,node,true);node.onpointerdown(e);}});
    new ResizeObserver(()=>{if(!viewReady)fit();else applyView();}).observe(canvas);
    return {update(next){const id=next.projectId||window.OCResearchWorkspace?.getSelection()?.projectId||'';if(id!==projectId){cancelGesture?.();projectId=id;model=undefined;viewReady=false;view={scale:1,x:0,y:0};try{const saved=JSON.parse(localStorage.getItem(viewKey())||'null');if(validView(saved)){view=saved;viewReady=true;}}catch{}applyView();snapshot={agents:[],dispatches:[]};error='';graphKey='';positions={};try{positions=JSON.parse(localStorage.getItem(storageKey())||'{}');}catch{}for(const c of chats.values())c.el.remove();chats.clear();host.querySelector('dialog')?.remove();draw();void refresh();}},show(value){visible=value;host.hidden=!value;if(value){draw();void refresh();}},refresh};
  }
  window.OCProjectTeam={mount,graph,zoomAt,fitView,validView,messageBox,agentSettings,runtimeChange,effortOptions,composerState};
})();
