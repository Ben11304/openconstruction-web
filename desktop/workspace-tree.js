(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const encode = encodeURIComponent;
  const folderIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5h5l2 2h8v9h-15z"/></svg>';
  const fileIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4"/></svg>';
  const state = {panel:null,project:'',session:'',name:'',serial:0,visible:false,loading:false,query:'',hidden:false,sessions:[],files:new Map(),records:new Map(),sharedDatasets:[],datasetDirty:false,open:new Map(),error:'',lastLoad:0,selected:null,directories:[],edit:null,busy:false,view:'project',team:null,agentsLoading:false,agentsError:'',lastAgentsLoad:0};
  const sharedPages=new Map(),agentDetails=new Map();let sharedGeneration=0;
  const sharedKey=(id,path)=>'shared:'+encode(id)+':'+encode(path);
  function clearShared(){sharedGeneration++;sharedPages.clear();}
  async function loadShared(datasetId,path='',more=false){
    const key=sharedKey(datasetId,path),previous=sharedPages.get(key);
    if(previous?.loading||previous&&!more)return;
    if(more&&previous?.nextOffset===null)return;
    const generation=sharedGeneration,serial=state.serial,projectId=state.project;
    sharedPages.set(key,{...previous,loading:true,error:''});render();
    try{
      const result=await window.OCDesktop.datasetEntries({projectId,datasetId,path,includeHidden:state.hidden,offset:more?previous?.nextOffset||0:0});
      if(serial!==state.serial||generation!==sharedGeneration)return;
      sharedPages.set(key,{...result,entries:[...(more?previous?.entries||[]:[]),...result.entries]});
    }catch(error){if(serial===state.serial&&generation===sharedGeneration)sharedPages.set(key,{...previous,loading:false,error:error.message});}
    if(serial===state.serial&&generation===sharedGeneration)render();
  }
  function sharedFolder(shared,path='',label=shared.datasetId){
    const key=sharedKey(shared.datasetId,path),page=sharedPages.get(key),query=state.query.toLocaleLowerCase();
    const attrs=`data-ws-dataset="${escape(shared.datasetId)}" data-ws-path="${escape(path)}"`;
    const matchesDataset=`${shared.name} ${shared.datasetId}`.toLocaleLowerCase().includes(query);
    let children=(page?.entries||[]).filter(file=>file.directory||!query||matchesDataset||file.path.toLocaleLowerCase().includes(query)).map(file=>file.directory
      ?sharedFolder(shared,file.path,file.name)
      :`<li><button type="button" class="oc-ws-file" data-ws-shared-file data-ws-dataset="${escape(shared.datasetId)}" data-ws-path="${escape(file.path)}" data-ws-row="${escape(sharedKey(shared.datasetId,file.path))}" title="${escape(file.path)} · Read-only">${fileIcon}<span class="oc-ws-name">${escape(file.name)}</span><small>${escape(size(file.size))}</small></button></li>`).join('');
    if(page?.error)children+=`<li class="oc-ws-empty">${escape(page.error)} <button type="button" data-ws-shared-retry ${attrs}>Retry</button></li>`;
    else if(page?.loading)children+='<li class="oc-ws-empty" role="status">Loading files…</li>';
    else if(page?.nextOffset!=null)children+=`<li><button type="button" class="oc-ws-more" data-ws-shared-more ${attrs}>Show more files (${page.entries.length} of ${page.total})</button></li>`;
    if(!children)children=`<li class="oc-ws-empty">${page?query?'No matching files in this folder.':'Empty folder.':'Expand to load files.'}</li>`;
    return `<li><details data-ws-folder="${escape(key)}" data-ws-shared-folder ${attrs} ${state.open.get(key)?'open':''}><summary ${attrs} data-ws-row="${escape(key)}" title="${escape(path||shared.name||shared.datasetId)} · Shared dataset, read-only"><span class="oc-ws-chevron" aria-hidden="true">›</span>${folderIcon}<span class="oc-ws-name">${escape(label)}</span>${path?'':'<small class="oc-ws-readonly">Shared · Read-only</small>'}</summary><ul>${children}</ul></details></li>`;
  }
  const safePath = path => typeof path === 'string' && path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => !part || part === '..' || part === '.') && !/^[a-z][a-z0-9+.-]*:/i.test(path);
  const datasetPath = path => /^oc-research\/datasets\/([^/]+)(?:\/(.*))?$/.exec(path);
  const visibleFile = file => safePath(file.path) && (state.hidden || !file.path.split('/').some(part => part.startsWith('.')));
  async function request(route, label='workspace') {
    const response = await fetch('/api/research/'+route, {cache:'no-store',headers:{'X-OC-Workspace':'research'}});
    if (!response.ok) throw new Error(`Could not load ${label} (${response.status}).`);
    return response.json();
  }
  function tree(files, prefix='', directories=[]) {
    const root = {children:new Map()};
    for(const name of directories) root.children.set(name,{name,directory:true,children:new Map()});
    for (const file of files) {
      const relative = prefix ? file.path.slice(prefix.length) : file.path;
      if (!relative) continue;
      const parts = relative.split('/'); let node = root;
      parts.forEach((name,index) => {
        if (!node.children.has(name)) node.children.set(name,{name,children:new Map()});
        node = node.children.get(name); if (index === parts.length-1) {node.file=file;if(file.directory)node.directory=true;}
      });
    }
    return root;
  }
  function folder(key, label, content, meta='', defaultOpen=false, path='', sessionId='') {
    return `<li><details data-ws-folder="${escape(key)}" ${state.query || (state.open.get(key) ?? defaultOpen) ? 'open' : ''}><summary data-ws-path="${escape(path)}" data-ws-session="${escape(sessionId)}" data-ws-row="${escape(key)}" title="${escape(label)}"><span class="oc-ws-chevron" aria-hidden="true">›</span>${folderIcon}<span class="oc-ws-name">${escape(label)}</span>${meta?`<small>${escape(meta)}</small>`:''}</summary><ul>${content || '<li class="oc-ws-empty">No files yet</li>'}</ul></details></li>`;
  }
  function nodes(node, sessionId, base='') {
    return [...node.children.values()].sort((a,b)=>Number(!(a.directory||a.children.size))-Number(!(b.directory||b.children.size))||a.name.localeCompare(b.name,undefined,{numeric:true})).map(child => {
      const path = base+child.name;
      if (child.directory || child.children.size) return folder(sessionId+':'+path,child.name,nodes(child,sessionId,path+'/'),'',false,path,sessionId);
      const file=child.file;
      return `<li><button type="button" class="oc-ws-file" data-ws-path="${escape(file.path)}" data-ws-session="${escape(sessionId)}" data-ws-row="${escape(sessionId+':'+file.path)}" data-chat-file="${escape(file.path)}" data-chat-session="${escape(sessionId)}" title="${escape(file.path)}">${fileIcon}<span class="oc-ws-name">${escape(child.name)}</span><small>${file.size!=null?escape(size(file.size)):''}</small></button></li>`;
    }).join('');
  }
  function size(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1024*1024 ? `${Math.round(bytes/1024)} KB` : `${(bytes/1024/1024).toFixed(1)} MB`; }
  function savedAgentContent(agent){
    const key='agent-data:'+state.project+':'+agent.id;
    const text=value=>`<li><pre class="oc-ws-agent-text">${escape(value)}</pre></li>`;
    const role=folder(key+':role','Role',text(agent.role||agent.design?.fields?.mission||'No role instructions saved.'),'Configured');
    const current=agentDetails.get(agent.id);
    if(!current?.data)return role+`<li class="oc-ws-empty" ${current?.loading?'role="status"':''}>${current?.loading?'Loading saved agent state…':current?.error?escape(current.error):'Expand this agent to load its saved state.'}${current?.error?` <button type="button" class="oc-ws-agent-retry" data-ws-agent-retry="${escape(agent.id)}">Retry</button>`:''}</li>`;
    const {memory,latestResult}=current.data;
    let memoryBody='';
    if(memory.status==='available'){
      if(memory.notes?.content)memoryBody+=folder(key+':notes','Working notes',text(memory.notes.content),'Revision '+memory.notes.revision);
      for(const record of memory.records||[])memoryBody+=folder(key+':run:'+record.key,'Run '+record.key.slice(0,8),text(record.request+'\n\n'+record.answer),record.outcome);
      if(!memoryBody)memoryBody='<li class="oc-ws-empty">No long-term notes saved yet. Past work is available under Latest result and in the conversation.</li>';
      else memoryBody='<li class="oc-ws-agent-note">Private working memory; reports are not automatically verified project facts.</li>'+memoryBody;
    }else memoryBody=`<li class="oc-ws-empty">${memory.status==='not_configured'?'Long-term memory is not configured on this host.':'Saved memory is temporarily unavailable.'}${memory.status==='unavailable'?` <button type="button" class="oc-ws-agent-retry" data-ws-agent-retry="${escape(agent.id)}">Retry</button>`:''}</li>`;
    const saved=folder(key+':memory','Saved memory',memoryBody,memory.status==='available'?(memory.notes?.content?'Working notes':memory.records?.length?`${memory.records.length} recent`:'Empty'):'Unavailable');
    const stale=current.error?`<li class="oc-ws-empty">${escape(current.error)} Showing the last loaded state. <button type="button" class="oc-ws-agent-retry" data-ws-agent-retry="${escape(agent.id)}">Retry</button></li>`:'';
    let result='<li class="oc-ws-empty">This agent has no saved run yet.</li>';
    if(latestResult){
      const date=Date.parse(latestResult.finishedAt);
      result=`<li class="oc-ws-agent-note">Run ${escape(latestResult.runId.slice(0,8))}${Number.isFinite(date)?' · '+escape(new Date(date).toLocaleString()):''}</li>`+text(latestResult.answer||latestResult.error||'This run has no final answer yet.');
      if(latestResult.truncated)result+='<li class="oc-ws-agent-note">Preview shortened. Open the conversation for the full result.</li>';
    }
    return role+stale+saved+folder(key+':latest','Latest result',result,latestResult?.status||'');
  }
  async function loadAgentDetails(id,force=false){
    if(!state.visible||state.view!=='agents'||!state.team?.agents.some(a=>a.id===id))return;
    const previous=agentDetails.get(id);
    if(previous?.loading||(!force&&previous&&Date.now()-previous.loadedAt<30000))return;
    const serial=state.serial,project=state.project;
    agentDetails.set(id,{...previous,loading:true,error:''});render();
    try{
      const data=await request(`projects/${encode(project)}/team/${encode(id)}/details`,'saved agent state');
      if(serial!==state.serial)return;
      if(data.projectId!==project||data.agentId!==id||!data.memory)throw new Error('Invalid agent state response.');
      agentDetails.set(id,{data,loading:false,loadedAt:Date.now()});
    }catch(error){if(serial===state.serial)agentDetails.set(id,{...previous,loading:false,error:error.message,loadedAt:Date.now()});}
    if(serial===state.serial)render();
  }
  function refreshAgentDetails(force=false){
    for(const details of state.panel.querySelectorAll('details[data-ws-agent-folder][open]'))void loadAgentDetails(details.dataset.wsAgentFolder,force);
  }
  function agentTree() {
    if(!state.project)return '<li class="oc-ws-empty">Select a project to view its agents.</li>';
    if(!state.team)return `<li class="oc-ws-empty">${state.agentsLoading?'Loading project agents…':state.agentsError?'Agent list unavailable.':'Open this tab to load project agents.'}</li>`;
    const agents=new Map((state.team.agents||[]).filter(a=>/^[A-Z][A-Z0-9_]{0,47}$/.test(a.id)&&/^[A-Za-z0-9_-]+$/.test(a.sessionId)).map(a=>[a.id,a]));
    if(!agents.size)return '<li class="oc-ws-empty">No agents registered for this project. Add members in Project team.</li>';
    const children=new Map([['',[]]]);
    const parentOf=a=>Array.isArray(a?.parents)?a.parents.find(id=>id!==a.id&&agents.has(id))||'':'';
    for(const agent of agents.values()){
      let parent=parentOf(agent),cursor=parent;const seen=new Set([agent.id]);
      while(cursor){if(seen.has(cursor)){parent='';break;}seen.add(cursor);cursor=parentOf(agents.get(cursor));}
      if(!children.has(parent))children.set(parent,[]);children.get(parent).push(agent);
    }
    const files=[...state.directories.map(path=>({path,directory:true})),...(state.files.get(state.session)||state.files.values().next().value||[])].filter(file=>safePath(file.path));
    const query=state.query.toLocaleLowerCase();
    const statuses={running:'Working',queued:'Queued',blocked:'Needs approval',completed:'Ready',idle:'Ready',failed:'Failed',interrupted:'Interrupted',cancelled:'Stopped',archived:'Archived',unavailable:'Unavailable'};
    function branch(agent,ancestorMatch=false){
      const ownMatch=ancestorMatch||!query||`${agent.id} ${agent.name}`.toLocaleLowerCase().includes(query);
      const descendants=(children.get(agent.id)||[]).map(a=>branch(a,ownMatch)).join('');
      const prefix=`.oc-agents/${agent.id}/`;
      const notes=files.filter(f=>f.path.startsWith(prefix)&& (ownMatch||f.path.toLocaleLowerCase().includes(query)));
      if(!ownMatch&&!descendants&&!notes.length)return '';
      const key='agent:'+state.project+':'+agent.id;
      const status=statuses[agent.status]||'Unknown';
      const others=Array.isArray(agent.parents)?agent.parents.filter(id=>agents.has(id)):[];
      const info=`<li class="oc-ws-agent-info">${agent.name&&agent.name!==agent.id?`<p>${escape(agent.name)}</p>`:''}${others.length>1?`<p>Reports to ${escape(others.join(', '))}</p>`:''}<button type="button" data-ws-open-agent="${escape(agent.id)}">Open conversation <span aria-hidden="true">↗</span></button></li>`;
      const noteTree=notes.length?folder('agent-notes:'+state.project+':'+agent.id,'Workspace notes',nodes(tree(notes,prefix),agent.sessionId,prefix),`${notes.filter(f=>!f.directory).length} files`,false,prefix.slice(0,-1),agent.sessionId):'<li class="oc-ws-agent-no-files">No workspace note files yet.</li>';
      return `<li><details data-ws-folder="${escape(key)}" data-ws-agent-folder="${escape(agent.id)}" ${query||(state.open.get(key)??(!!children.get(agent.id)?.length||agent.isBoss===true))?'open':''}><summary data-ws-agent="${escape(agent.id)}" data-ws-row="${escape(key)}" title="${escape(agent.name||agent.id)}"><span class="oc-ws-chevron" aria-hidden="true">›</span>${folderIcon}<span class="oc-ws-name">${escape(agent.id)}</span><small class="oc-ws-agent-status" data-status="${escape(Object.hasOwn(statuses,agent.status)?agent.status:'unavailable')}">${escape(status)}</small></summary><ul>${info}${savedAgentContent(agent)}${noteTree}${descendants}</ul></details></li>`;
    }
    return (children.get('')||[]).map(a=>branch(a)).join('')||'<li class="oc-ws-empty">No matching agents or files.</li>';
  }
  async function loadAgents(force=false){
    if(!state.project||!state.visible||state.view!=='agents'||state.agentsLoading||(!force&&Date.now()-state.lastAgentsLoad<10000))return;
    const serial=state.serial,project=state.project;state.agentsLoading=true;state.agentsError='';render();
    try{
      const team=await request(`projects/${encode(project)}/team`,'project agents');
      if(serial!==state.serial)return;
      if(!Array.isArray(team.agents)||team.projectId!==project)throw new Error('Invalid project agent list.');
      state.team=team;state.lastAgentsLoad=Date.now();
    }catch(error){if(serial===state.serial)state.agentsError=error.message;}
    finally{if(serial===state.serial){state.agentsLoading=false;render();refreshAgentDetails();}}
  }
  function setView(view,focus=false){
    if(!['project','agents'].includes(view))return;
    state.view=view;state.selected=null;closeEditor();render();
    if(focus)state.panel.querySelector(`[data-ws-view="${view}"]`).focus();
    if(view==='agents'){void loadAgents();void refresh();refreshAgentDetails();}
  }
  function render() {
    if (!state.panel) return;
    let inputs='',project='',datasetCount=0,fileCount=0;
    const query=state.query.toLocaleLowerCase();
    const session=state.sessions.find(item=>item.id===state.session)||state.sessions[0];
    if(session) {
      const files=[...state.directories.map(path=>({path,directory:true})),...(state.files.get(session.id)||state.files.values().next().value||[])].filter(visibleFile);
      const datasets=new Map();
      for(const file of files){const match=datasetPath(file.path);if(match&&!datasets.has(match[1]))datasets.set(match[1],{name:match[1],prefix:`oc-research/datasets/${match[1]}/`});}
      for(const record of [...state.records.values()].flat()){
        if(record.kind!=='resource'||!record.active||record.resource?.type!=='dataset')continue;
        const id=record.resource.id;
        const existing=datasets.get(id);if(existing)existing.name=record.resource.title||id;
        else if(id)datasets.set(id,{name:record.resource.title||id,prefix:`oc-research/datasets/${id}/`});
      }
      for(const [id,dataset] of datasets){
        const members=files.filter(file=>file.path.startsWith(dataset.prefix));
        const matching=members.filter(file=>!query||file.path.toLocaleLowerCase().includes(query)||dataset.name.toLocaleLowerCase().includes(query));
        if(query&&!matching.length&&!dataset.name.toLocaleLowerCase().includes(query))continue;
        datasetCount++;
        inputs+=folder('input:'+state.project+':'+id,dataset.name,members.length?nodes(tree(matching,dataset.prefix),session.id,dataset.prefix):'<li class="oc-ws-empty">Not downloaded yet</li>',`${members.filter(f=>!f.directory).length} files`,false,dataset.prefix.slice(0,-1),session.id);
      }
      const working=files.filter(file=>!datasetPath(file.path)&&file.path!=='oc-research/datasets'&&!(file.path==='inputs'&&file.directory&&!files.some(f=>f.path.startsWith('inputs/'))));
      const matching=working.filter(file=>!query||file.path.toLocaleLowerCase().includes(query));
      fileCount+=matching.filter(f=>!f.directory).length;
      project=nodes(tree(matching,'',query?[]:['work','outputs','papers']),session.id);
    }
    for(const shared of state.sharedDatasets){
      datasetCount++;
      inputs+=sharedFolder(shared);
    }
    const message=!state.project?'Select a project to browse files.':state.loading&&!state.sessions.length?'Loading workspace…':query?'No matching files.':'No datasets linked to this project.';
    const updates=[['input',inputs||`<li class="oc-ws-empty">${escape(message)}</li>`],['project',project||`<li class="oc-ws-empty">${escape(!state.project?message:query?'No matching files.':'No sessions in this project.')}</li>`],['agents',agentTree()]];
    for(const [name,html] of updates){const target=state.panel.querySelector(`[data-ws-tree=${name}]`);if(target._html!==html){const scroll=target.scrollTop;const focus=document.activeElement?.dataset.wsRow;target.innerHTML=html;target._html=html;target.scrollTop=scroll;if(focus)[...target.querySelectorAll('[data-ws-row]')].find(row=>row.dataset.wsRow===focus)?.focus({preventScroll:true});}}
    state.panel.querySelector('[data-ws-project-name]').textContent=state.name||'Working files';
    state.panel.querySelector('[data-ws-input-count]').textContent=datasetCount||'';
    state.panel.querySelector('[data-ws-input-project]').textContent=state.name?'Linked to '+state.name:'';
    state.panel.querySelector('[data-ws-project-count]').textContent=fileCount?`${fileCount} files`:'';
    state.panel.querySelector('[data-ws-project-count]').hidden=state.view!=='project';
    const count=state.panel.querySelector('[data-ws-agents-count]');count.textContent=state.team?`${state.team.agents.length} agents`:'';count.hidden=state.view!=='agents';
    for(const button of state.panel.querySelectorAll('[data-ws-view]')){const selected=button.dataset.wsView===state.view;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    for(const pane of state.panel.querySelectorAll('[data-ws-pane]'))pane.hidden=pane.dataset.wsPane!==state.view;
    const agentError=state.panel.querySelector('[data-ws-agents-error]');agentError.hidden=!state.agentsError;agentError.querySelector('span').textContent=state.agentsError+(state.team?' Showing the last loaded list.':'');
    state.panel.querySelector('[data-ws-tree=agents]').setAttribute('aria-busy',String(state.agentsLoading));
    state.panel.querySelector('[data-ws-search]').placeholder=state.view==='agents'?'Find an agent or file…':'Find a file…';
    const status=state.panel.querySelector('[data-ws-status]');status.textContent=state.error||(state.loading?'Refreshing…':'');status.hidden=!status.textContent;
    markSelection();
    state.panel.querySelector('[data-ws-refresh]').disabled=state.loading||!state.project;
  }
  function markSelection(){
    for(const row of state.panel.querySelectorAll('[data-ws-row]'))row.classList.toggle('is-selected',!!state.selected&&row.dataset.wsPath===state.selected.path&&(row.dataset.wsDataset||'')===(state.selected.datasetId||''));
    state.panel.querySelector('[data-ws-copy]').disabled=!state.selected;
    for(const button of state.panel.querySelectorAll('[data-ws-action]'))button.disabled=state.busy||!state.session||state.view==='agents'||state.selected?.section==='input'||!!state.selected?.datasetId||(button.dataset.wsAction==='rename'&&!state.selected);
  }
  async function copyPath(){
    if(!state.selected)return;
    const status=state.panel.querySelector('[data-ws-status]');
    try{await window.OCDesktop.copyWorkspacePath(state.selected);status.textContent='Path copied';}
    catch(error){status.textContent=error.message;}
    status.hidden=false;
  }
  function notify(text){const status=state.panel.querySelector('[data-ws-status]');status.textContent=text;status.hidden=!text;}
  function closeEditor(){state.edit=null;state.panel.querySelector('[data-ws-editor]').hidden=true;}
  async function action(name,selection=state.selected,base=null,section=null){
    if(state.busy||!name)return;
    if(['new-file','new-folder'].includes(name)&&section!=='project')return;
    const sessionId=state.session,serial=state.serial;
    if(name==='copy'||name==='copy-relative'||name==='reveal'){
      if(!selection)return;
      try{if(name==='reveal')await window.OCDesktop.revealWorkspacePath(selection);else {await window.OCDesktop.copyWorkspacePath({...selection,relative:name==='copy-relative'});notify('Path copied');}}catch(error){notify(error.message);}return;
    }
    if(name==='remove-dataset'&&selection?.datasetId){
      try{
        await window.OCDesktop.removeProjectDataset(selection);
        if(serial!==state.serial)return;
        window.OCDesktopDatasetPreview?.close();state.selected=null;clearShared();state.lastLoad=0;await refresh(true);
        notify('Removed from '+state.name+'. Shared library files were kept.');
      }catch(error){if(serial===state.serial)notify(error.message);}return;
    }
    if(selection?.datasetId||selection?.section==='input'||selection?.section==='agents'||state.view==='agents'||!state.session)return;
    if(name==='rename'&&!selection)return;
    const target=name==='rename'?selection.path:base??(selection?(selection.directory?selection.path:selection.path.split('/').slice(0,-1).join('/')):'');
    state.edit={action:name,path:target,sessionId,serial};
    const editor=state.panel.querySelector('[data-ws-editor]'),input=editor.querySelector('input');
    editor.hidden=false;editor.querySelector('[data-ws-editor-title]').textContent=name==='rename'?'Rename':name==='new-folder'?'New folder':'New file';
    editor.querySelector('[data-ws-editor-parent]').textContent=name==='rename'?target:target||'Project root';
    editor.querySelector('[data-ws-editor-error]').textContent='';input.value=name==='rename'?target.split('/').pop():'';
    input.focus();input.setSelectionRange(0,name==='rename'&&!selection.directory&&input.value.lastIndexOf('.')>0?input.value.lastIndexOf('.'):input.value.length);
  }
  async function saveEntry(event){
    event.preventDefault();const edit=state.edit;if(!edit||state.busy)return;
    const editor=state.panel.querySelector('[data-ws-editor]'),name=editor.querySelector('input').value;
    state.busy=true;markSelection();editor.querySelector('button[type=submit]').disabled=true;editor.querySelector('[data-ws-cancel]').disabled=true;editor.querySelector('input').disabled=true;
    try{
      const result=await window.OCDesktop.mutateWorkspace({...edit,name});
      if(edit.serial!==state.serial)return;
      if(edit.action==='rename'){
        const remap=path=>path===edit.path||path.startsWith(edit.path+'/')?result.path+path.slice(edit.path.length):path;
        state.directories=state.directories.map(remap);
        for(const [id,files] of state.files)state.files.set(id,files.map(file=>({...file,path:remap(file.path)})));
        window.dispatchEvent(new CustomEvent('oc-workspace-renamed',{detail:{sessionIds:state.sessions.map(s=>s.id),from:edit.path,to:result.path}}));
      }else if(result.directory)state.directories.push(result.path);
      else{const files=state.files.get(edit.sessionId)||[];state.files.set(edit.sessionId,[...files,{path:result.path,size:0}]);}
      state.query='';state.panel.querySelector('[data-ws-search]').value='';
      if(result.path.split('/').some(p=>p.startsWith('.'))){state.hidden=true;state.panel.querySelector('[data-ws-hidden]').setAttribute('aria-pressed','true');}
      const parts=result.path.split('/');for(let i=1;i<parts.length;i++)state.open.set(edit.sessionId+':'+parts.slice(0,i).join('/'),true);
      const dataset=datasetPath(result.path);if(dataset)state.open.set('input:'+state.project+':'+dataset[1],true);
      state.selected={path:result.path,sessionId:edit.sessionId,directory:result.directory};closeEditor();render();
      const row=[...state.panel.querySelectorAll('[data-ws-path]')].find(node=>node.dataset.wsPath===result.path);row?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
      notify(edit.action==='rename'?'Renamed':'Created');state.lastLoad=0;
    }catch(error){if(edit.serial===state.serial)editor.querySelector('[data-ws-editor-error]').textContent=error.message;}
    finally{state.busy=false;editor.querySelector('button[type=submit]').disabled=false;editor.querySelector('[data-ws-cancel]').disabled=false;editor.querySelector('input').disabled=false;markSelection();}
  }
  async function refresh(force=false) {
    if(!state.project||!state.visible||state.loading||(!force&&Date.now()-state.lastLoad<10000))return;
    const project=state.project,serial=state.serial;state.loading=true;state.datasetDirty=false;state.error='';render();
    try{
      const [sessions,sharedDatasets]=await Promise.all([request(`projects/${encode(project)}/sessions`),window.OCDesktop.projectDatasets(project)]);
      if(serial!==state.serial)return;
      if(JSON.stringify(sharedDatasets)!==JSON.stringify(state.sharedDatasets))clearShared();
      state.sessions=sessions;state.sharedDatasets=sharedDatasets;
      const sessionId=state.session||sessions[0]?.id;
      if(sessionId){
        const [files,directories]=await Promise.all([request(`sessions/${encode(sessionId)}/files`),window.OCDesktop.workspaceDirectories({sessionId})]);
        if(serial!==state.serial)return;
        state.files.clear();state.files.set(sessionId,files);state.directories=directories;
      }
      // Keep requests bounded for projects with many sessions.
      let partial=false;
      for(let offset=0;offset<sessions.length;offset+=3){
        await Promise.all(sessions.slice(offset,offset+3).map(async session=>{
          const results=await Promise.allSettled([request(`sessions/${encode(session.id)}/oc`)]);
          if(serial!==state.serial)return;
          if(results[0].status==='fulfilled')state.records.set(session.id,results[0].value.records||[]);else partial=true;
        }));
        if(serial!==state.serial)return;
      }
      state.error=partial?'Some input details could not be loaded. Refresh to retry.':'';
      state.lastLoad=Date.now();
    }catch(error){if(serial===state.serial)state.error=error.message;}
    finally{if(serial===state.serial){state.loading=false;render();if(state.datasetDirty)void refresh(true);}}
  }
  window.OCDesktopWorkspace={
    filesImported(sessionId,directory){
      if(sessionId!==state.session||!directory)return;
      const parts=directory.split('/');for(let i=1;i<=parts.length;i++)state.open.set(sessionId+':'+parts.slice(0,i).join('/'),true);
      render();
    },
    dropDirectory(target){
      if(state.view!=='project'||!state.session||!target.closest?.('.oc-ws-project')||target.closest('[data-ws-editor]'))return null;
      const row=target.closest('[data-ws-row]')||target.closest('details[data-ws-folder]')?.querySelector(':scope > summary');
      if(row?.dataset.wsDataset)return null;
      if(!row)return '';
      const path=row.dataset.wsPath||'';
      return row.tagName==='SUMMARY'?path:path.split('/').slice(0,-1).join('/');
    },
    mount(panel){
      state.panel=panel;
      panel.innerHTML=`<div class="oc-ws-toolbar"><input type="search" data-ws-search placeholder="Find a file…" aria-label="Find a workspace file"><button type="button" data-ws-copy disabled aria-label="Copy path" title="Copy path">⧉</button><button type="button" data-ws-refresh aria-label="Refresh workspace" title="Refresh workspace">↻</button><button type="button" data-ws-hidden aria-pressed="false" aria-label="Show hidden files" title="Show hidden files">···</button></div><div class="oc-ws-actions"><button type="button" data-ws-action="rename" title="Rename selected item · F2">Rename</button></div><form data-ws-editor class="oc-ws-editor" hidden><strong data-ws-editor-title></strong><span data-ws-editor-parent></span><label>Name<input data-ws-name required autocomplete="off" spellcheck="false" maxlength="255"></label><p data-ws-editor-error role="alert"></p><div><button type="button" data-ws-cancel>Cancel</button><button type="submit">Save</button></div></form><p data-ws-status role="status" hidden></p><section class="oc-ws-section oc-ws-input"><header><div><h3>Input</h3><p data-ws-input-project></p></div><span data-ws-input-count></span></header><ul data-ws-tree="input" aria-label="Project inputs"></ul></section><section class="oc-ws-section oc-ws-project"><header><div><div class="oc-ws-project-tabs" role="tablist" aria-label="Project explorer"><button type="button" id="ocWsProjectTab" role="tab" data-ws-view="project" aria-selected="true" aria-controls="ocWsProjectPane">Project</button><button type="button" id="ocWsAgentsTab" role="tab" data-ws-view="agents" aria-selected="false" aria-controls="ocWsAgentsPane" tabindex="-1">Agents</button></div><p data-ws-project-name></p></div><span data-ws-project-count></span><span data-ws-agents-count hidden></span></header><div class="oc-ws-pane" id="ocWsProjectPane" role="tabpanel" aria-labelledby="ocWsProjectTab" data-ws-pane="project"><p class="oc-ws-drop-hint">Drop files here or onto a folder</p><ul data-ws-tree="project" aria-label="Shared project files"></ul></div><div class="oc-ws-pane" id="ocWsAgentsPane" role="tabpanel" aria-labelledby="ocWsAgentsTab" data-ws-pane="agents" hidden><p class="oc-ws-drop-hint">Project team and agent workspace notes</p><p class="oc-ws-agents-error" data-ws-agents-error role="alert" hidden><span></span> <button type="button" data-ws-agents-retry>Retry</button></p><ul data-ws-tree="agents" aria-label="Project agent structure"></ul></div></section>`;
      const select=event=>{const row=event.target.closest('[data-ws-row]');if(row&&!row.dataset.wsPath&&!row.dataset.wsDataset){state.selected=null;markSelection();return;}if(!row||(!row.dataset.wsPath&&!row.dataset.wsDataset))return;state.selected={path:row.dataset.wsPath,sessionId:row.dataset.wsSession,section:row.closest('[data-ws-pane="agents"]')?'agents':row.closest('.oc-ws-input')?'input':'project',directory:row.tagName==='SUMMARY',...(row.dataset.wsDataset?{projectId:state.project,projectName:state.name,datasetId:row.dataset.wsDataset,linkToken:state.sharedDatasets.find(item=>item.datasetId===row.dataset.wsDataset)?.linkToken}:{})};if(state.selected.datasetId)closeEditor();markSelection();};
      panel.addEventListener('click',event=>{select(event);if(event.detail===0&&event.target.closest('[data-ws-shared-file]')){event.preventDefault();event.stopPropagation();void window.OCDesktopDatasetPreview.open({...state.selected});}else if(event.detail===1&&event.target.closest('.oc-ws-file')){event.preventDefault();event.stopPropagation();}},true);panel.addEventListener('focusin',select);
      panel.addEventListener('dblclick',event=>{if(event.target.closest('[data-ws-shared-file]')){event.preventDefault();event.stopPropagation();select(event);void window.OCDesktopDatasetPreview.open({...state.selected});}});
      panel.addEventListener('click',event=>{const button=event.target.closest('[data-ws-shared-more],[data-ws-shared-retry]');if(!button)return;event.preventDefault();event.stopPropagation();if(button.hasAttribute('data-ws-shared-retry'))sharedPages.delete(sharedKey(button.dataset.wsDataset,button.dataset.wsPath));void loadShared(button.dataset.wsDataset,button.dataset.wsPath,button.hasAttribute('data-ws-shared-more'));});
      panel.querySelector('[data-ws-copy]').onclick=()=>void copyPath();
      panel.querySelectorAll('[data-ws-action]').forEach(button=>button.onclick=()=>void action(button.dataset.wsAction));
      panel.querySelector('[data-ws-editor]').onsubmit=saveEntry;
      panel.querySelector('[data-ws-cancel]').onclick=closeEditor;
      panel.querySelector('[data-ws-editor]').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeEditor();}});
      panel.addEventListener('contextmenu',async event=>{
        if(event.target.closest('input,[data-ws-editor]'))return;
        if(event.target.closest('[data-ws-pane="agents"]')){event.preventDefault();return;}
        const section=event.target.closest('.oc-ws-project')?'project':event.target.closest('.oc-ws-input')?'input':null;
        if(!section){event.preventDefault();return;}
        const row=event.target.closest('[data-ws-row]');if(!state.session&&!row?.dataset.wsDataset)return;
        event.preventDefault();select(event);const selection=row?{...state.selected}:null;
        const base=row?null:event.target.closest('.oc-ws-input')?'inputs':'';const serial=state.serial;
        const chosen=await window.OCDesktop.workspaceMenu({...selection,section});if(serial===state.serial)void action(chosen,selection,base,section);
      });
      panel.addEventListener('keydown',event=>{if(event.key==='F2'&&event.target.matches('[data-ws-row]')){event.preventDefault();void action('rename');}});

      document.addEventListener('keydown',event=>{
        const commandKey=/Mac/.test(navigator.platform)?event.metaKey&&!event.ctrlKey:event.ctrlKey&&!event.metaKey;
        if(event.code!=='KeyC'||!commandKey||!event.altKey||event.shiftKey||event.target.closest('input,textarea,[contenteditable=true]'))return;
        if(!state.visible||!state.selected)return;event.preventDefault();void copyPath();
      });
      panel.querySelector('[data-ws-search]').addEventListener('input',event=>{state.query=event.target.value.trim();render();});
      panel.querySelector('[data-ws-refresh]').onclick=()=>{clearShared();void refresh(true);void loadAgents(true);refreshAgentDetails(true);};
      panel.querySelectorAll('[data-ws-view]').forEach(button=>{
        button.onclick=()=>setView(button.dataset.wsView);
        button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();setView(event.key==='Home'?'project':event.key==='End'?'agents':state.view==='project'?'agents':'project',true);});
      });
      panel.querySelector('[data-ws-agents-retry]').onclick=()=>void loadAgents(true);
      panel.addEventListener('click',event=>{const retry=event.target.closest('[data-ws-agent-retry]');if(retry){void loadAgentDetails(retry.dataset.wsAgentRetry,true);return;}const button=event.target.closest('[data-ws-open-agent]');if(!button)return;const agent=state.team?.agents.find(a=>a.id===button.dataset.wsOpenAgent);if(agent&&state.project)void Promise.resolve(window.OCResearchWorkspace?.openSession?.(state.project,agent.sessionId)).catch(error=>notify(error.message));});
      panel.querySelector('[data-ws-hidden]').onclick=event=>{state.hidden=!state.hidden;clearShared();event.currentTarget.setAttribute('aria-pressed',String(state.hidden));render();};
      panel.addEventListener('toggle',event=>{const node=event.target;if(!node.matches('[data-ws-folder]')||!node.isConnected)return;if(node.hasAttribute('data-ws-shared-folder')){state.open.set(node.dataset.wsFolder,node.open);if(node.open)void loadShared(node.dataset.wsDataset,node.dataset.wsPath);return;}if(!state.query)state.open.set(node.dataset.wsFolder,node.open);if(node.dataset.wsAgentFolder&&node.open)void loadAgentDetails(node.dataset.wsAgentFolder);},true);
      panel.addEventListener('keydown',event=>{
        if(!event.target.matches('[data-ws-row]')||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const rows=[...panel.querySelectorAll('[data-ws-row]')].filter(row=>row.getClientRects().length);const index=rows.indexOf(event.target),details=event.target.closest('details');
        if(event.key==='ArrowLeft'){if(event.target.tagName==='SUMMARY'&&details.open)details.open=false;else (event.target.tagName==='SUMMARY'?details?.parentElement.closest('details'):details)?.querySelector('summary')?.focus();}
        else if(event.key==='ArrowRight'&&event.target.tagName==='SUMMARY'&&!details.open)details.open=true;
        else rows[event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowUp'?-1:1)))]?.focus();
      });
      const unsubscribe=window.OCDesktop.onDatasetsChanged?.(event=>{if(event.projectId===state.project){state.datasetDirty=true;if(state.selected?.datasetId)state.selected=null;clearShared();window.OCDesktopDatasetPreview?.close();state.lastLoad=0;void refresh(true);}});
      window.addEventListener('pagehide',()=>unsubscribe?.());
      const timer=setInterval(()=>{void refresh();void loadAgents();},10000);window.addEventListener('pagehide',()=>clearInterval(timer));render();
    },
    select({projectId,sessionId,projectName}){
      if(state.project!==projectId){state.serial++;clearShared();window.OCDesktopDatasetPreview?.close();state.selected=null;state.directories=[];closeEditor();state.project=projectId||'';state.sessions=[];state.files.clear();state.records.clear();state.sharedDatasets=[];state.open.clear();state.loading=false;state.lastLoad=0;state.error='';state.team=null;agentDetails.clear();state.agentsLoading=false;state.agentsError='';state.lastAgentsLoad=0;}
      state.session=sessionId||'';state.name=projectName||'';render();void refresh();void loadAgents();
    },
    show(visible){state.visible=visible;if(visible){render();void refresh(true);void loadAgents(true);}},
    updateFiles(sessionId,files){if(state.sessions.some(session=>session.id===sessionId)){state.files.clear();state.files.set(sessionId,files);render();}}
  };
})();
