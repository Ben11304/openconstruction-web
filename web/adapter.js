(() => {
  // Restore before body paint, so changing pages cannot flash a different shell.
  document.documentElement.dataset.ocPlatform='web';
  let sidebarState;
  try{sidebarState=localStorage.getItem('oc.web.sidebar.v1');}catch{}
  document.documentElement.dataset.ocSidebar=sidebarState==='hidden'||(!sidebarState&&(location.pathname.endsWith('/openconstruction-web/research.html')||window.matchMedia('(max-width: 760px)').matches))?'hidden':'visible';
  const jsonHeaders = {'Content-Type':'application/json','X-OC-Workspace':'research'};
  const id = encodeURIComponent;
  const notesKey = 'oc.web.project-notes.v1';

  async function request(route, {method='GET', body, raw=false}={}) {
    const response = await fetch('/api/research/' + route, {
      method, cache:'no-store', headers:jsonHeaders,
      body:body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw new Error(value.detail || value.error || `OpenConstruction returned ${response.status}.`);
    }
    return raw ? response : response.status === 204 ? null : response.json();
  }

  async function host(route, {method='GET', body}={}) {
    const response = await fetch('/api/host/' + route, {
      method, cache:'no-store', headers:{'Content-Type':'application/json'},
      body:body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || `Host service returned ${response.status}.`);
    return value;
  }

  function notes() { try { return JSON.parse(localStorage.getItem(notesKey) || '{}'); } catch { return {}; } }
  function saveNotes(value) { localStorage.setItem(notesKey, JSON.stringify(value)); }
  const unsupported = message => async () => { throw new Error(message); };
  const modelUnsupported = unsupported('This provider must be configured on the host machine.');
  const binaryPreview=async value=>{
    const result=await host('datasets/preview',{method:'POST',body:value});
    if(result.encoding==='base64'&&typeof result.data==='string'){
      const raw=atob(result.data),bytes=new Uint8Array(raw.length);
      for(let index=0;index<raw.length;index++)bytes[index]=raw.charCodeAt(index);
      return {...result,data:bytes,encoding:undefined};
    }
    return result;
  };

  async function listProjects() {
    const saved = notes();
    return (await request('projects')).map(project => ({
      ...project,
      notes:saved[project.id]?.notes || '',
      updatedAt:saved[project.id]?.updatedAt || project.updatedAt || project.createdAt || new Date(0).toISOString(),
    }));
  }

  async function createProject(value={}) {
    const project = await request('projects',{method:'POST',body:{name:value.name}});
    const saved = notes(); saved[project.id] = {notes:'',updatedAt:new Date().toISOString()}; saveNotes(saved);
    return {...project,...saved[project.id]};
  }

  async function updateProject(value={}) {
    const project = await request(`projects/${id(value.id)}`,{method:'PATCH',body:{name:value.name}});
    const saved = notes(); saved[value.id] = {notes:String(value.notes || ''),updatedAt:new Date().toISOString()}; saveNotes(saved);
    return {...project,...saved[value.id]};
  }

  async function deleteProject(projectId) {
    if (!confirm('Delete this research project and its sessions?')) return false;
    await request(`projects/${id(projectId)}`,{method:'DELETE',body:{confirmationId:projectId}});
    const saved=notes();delete saved[projectId];saveNotes(saved);return true;
  }

  async function exportWorkspace() {
    const payload={format:'openconstruction-web-workspace',version:1,exportedAt:new Date().toISOString(),projects:await listProjects()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`OpenConstruction-web-${new Date().toISOString().slice(0,10)}.json`;anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  }

  async function importWorkspace() {
    const file = await new Promise(resolve => {
      const input=document.createElement('input');input.type='file';input.accept='application/json,.json';
      input.onchange=()=>resolve(input.files?.[0]||null);input.click();
    });
    if(!file)return null;
    const payload=JSON.parse(await file.text());
    if(payload?.format!=='openconstruction-web-workspace'||!Array.isArray(payload.projects))throw new Error('This is not an OpenConstruction web workspace backup.');
    let count=0;
    for(const item of payload.projects.slice(0,100)){if(!item?.name)continue;const created=await createProject({name:item.name});await updateProject({...created,notes:item.notes||''});count++;}
    return count;
  }

  async function workspaceDirectories({sessionId}) {
    const files=await request(`sessions/${id(sessionId)}/files`),directories=new Set();
    for(const file of files||[]){const parts=String(file.path||'').split('/');for(let index=1;index<parts.length;index++)directories.add(parts.slice(0,index).join('/'));}
    return [...directories].sort();
  }

  const api = {
    platform:'web',
    readWorkspaceText:value=>host('workspace/text',{method:'POST',body:value}),
    saveWorkspaceText:value=>host('workspace/save-text',{method:'POST',body:value}),
    info:async()=>({version:'web',platform:'web',arch:'host',dataPath:'Host-managed',catalogBuiltAt:new Date().toISOString()}),
    listProjects,createProject,updateProject,deleteProject,exportWorkspace,importWorkspace,
    researchStatus:async()=>{await request('projects');return{connected:true,runtime:{state:'ready',stage:'OcWorkspace is ready.',managed:false}};},
    codexStatus:()=>host('codex/status'),
    loginCodex:()=>host('codex/login',{method:'POST'}),
    cancelCodexLogin:()=>host('codex/cancel',{method:'POST'}),
    codexModels:()=>host('codex/models'),
    connectCodexModel:value=>host('codex/connect',{method:'POST',body:value}),
    logoutCodex:()=>host('codex/logout',{method:'POST'}),
    claudeStatus:async()=>({available:false,connected:false,pending:false,hasApiToken:false,error:'Configure Claude on the host machine.'}),
    loginClaude:modelUnsupported,cancelClaudeLogin:modelUnsupported,logoutClaude:modelUnsupported,
    claudeAccountModels:async()=>[],connectClaudeAccountModel:modelUnsupported,
    saveClaudeKey:modelUnsupported,claudeModels:async()=>[],connectClaudeModel:modelUnsupported,disconnectClaude:modelUnsupported,
    startResearch:unsupported('The research runtime is managed by the host machine.'),
    stopResearch:unsupported('The research runtime is managed by the host machine.'),
    openResearchSettings:async()=>{location.href='/openconstruction-web/research.html?view=models';},
    workspaceDirectories,
    mutateWorkspace:unsupported('Create and rename workspace files from the host app; browser upload remains available.'),
    workspaceMenu:async()=>null,
    revealWorkspacePath:unsupported('Finder access is available only on the host machine.'),
    copyWorkspacePath:async value=>navigator.clipboard.writeText(value?.path||''),
    reviewDataset:datasetId=>host(`datasets/review?id=${id(datasetId)}`),
    addDatasetToProjects:value=>host('datasets/add',{method:'POST',body:value}),
    datasetJobStatus:jobId=>host(`datasets/status?id=${id(jobId)}`),
    projectDatasets:projectId=>host(`datasets/project?projectId=${id(projectId)}`),
    removeProjectDataset:value=>host('datasets/remove',{method:'POST',body:value}),
    onDatasetsChanged:()=>()=>{},
    datasetEntries:value=>host('datasets/entries',{method:'POST',body:value}),
    datasetPreview:binaryPreview,
    showLocalData:unsupported('Local data is available only on the host machine.'),
    prepareSignIn:unsupported('Use the private web password to sign in.'),
    openSignIn:modelUnsupported,
    openExternal:async url=>{const target=new URL(url,location.href);if(target.protocol!=='https:')throw new Error('Only HTTPS links can be opened.');window.open(target.href,'_blank','noopener,noreferrer');},
    navigate:async page=>{const routes={home:'/openconstruction-web/index.html',research:'/openconstruction-web/research.html',datasets:'/openconstruction-web/dataset.html',models:'/openconstruction-web/models.html',admin:'/openconstruction-web/desktop/admin.html',account:'/openconstruction-web/account.html'};location.href=routes[page]||routes.home;},
    back:async()=>history.back(),forward:async()=>history.forward(),
  };
  window.OCDesktop=Object.freeze(api);

  document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.ocPlatform='web';});
})();
