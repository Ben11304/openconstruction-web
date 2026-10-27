(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const enc = encodeURIComponent;
  let me, projects = [], sharingId = '', busy = false, scope = 'mine', generation = 0;
  let collections = {mine:[], shared:[], public:[]}, details = new Map(), detailsLoading = false;
  const projectPages = window.OCProjectPages.create({request,esc,enc,dateLabel:value=>dateLabel(value),dateValue:value=>dateValue(value),onChange:()=>renderProjectOverview()});
  let view = 'grid';
  try { if (localStorage.getItem('oc.projects.view') === 'list') view = 'list'; } catch {}
  const allProjects = () => [...new Map([...collections.mine, ...collections.shared].map(p => [p.id,p])).values()];
  const dateValue = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const latest = p => Math.max(dateValue(p.updatedAt || p.createdAt), ...(details.get(p.id)?.tasks || []).map(t => dateValue(t.updatedAt)));
  const dateLabel = value => value ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)) : 'Date unavailable';
  const folderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg>';
  async function request(path, method = 'GET', body) {
    const response = await fetch(`/api/${path}`, {method, credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(30000), headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }
  function notice(message) { $('projectsNotice').textContent = message; $('projectsNotice').hidden = !message; }
  async function act(work, dialog) {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll('button,select,input')].filter(el => !el.disabled);
    controls.forEach(el => { el.disabled = true; });
    const error = dialog?.querySelector('[data-error]'); if (error) error.hidden = true;
    try { await work(); }
    catch (e) { if (error && dialog.open) { error.textContent = e.message; error.hidden = false; } else notice(e.message); }
    finally { busy = false; controls.forEach(el => { if(el.isConnected) el.disabled = false; }); configure(); }
  }
  function configure() {
    $('createProjectButton').disabled = busy || !me || me.user.role === 'viewer';
    document.querySelectorAll('[data-new-project]').forEach(button => { button.disabled = busy || !me || me.user.role === 'viewer'; });
    $('publishReleaseButton').disabled = !releaseReviewed;
    document.querySelectorAll('[data-project-scope]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.projectScope===scope)));
  }
  function projectStatus(p, isPublic) {
    if (isPublic) return {label:'Published',tone:'ready'};
    const info = details.get(p.id);
    if (!info) return {label:detailsLoading ? 'Loading activity…' : 'Activity unavailable',tone:'neutral'};
    if (!info.tasks) return {label:'Activity unavailable',tone:'neutral'};
    const tasks = info.tasks;
    if (tasks.some(t => t.status === 'running')) return {label:'Running',tone:'running'};
    if (tasks.some(t => ['queued','waiting','blocked'].includes(t.status))) return {label:'Waiting',tone:'waiting'};
    const last = [...tasks].sort((a,b) => dateValue(b.updatedAt)-dateValue(a.updatedAt))[0];
    if (last?.status === 'failed') return {label:'Needs attention',tone:'failed'};
    if (last?.status === 'completed') return {label:'Completed',tone:'ready'};
    return {label:'Ready',tone:'neutral'};
  }
  function card(p, isPublic = false) {
    const state = projectStatus(p,isPublic), data = details.get(p.id);
    const access = isPublic ? `By ${p.ownerName || 'OC researcher'}` : p.access?.role === 'owner' ? 'Owner' : p.access?.canEdit ? 'Can edit' : 'Can view';
    const visibility = isPublic || p.access?.visibility === 'public' ? 'Public' : p.access?.visibility === 'workspace' ? 'Team' : 'Private';
    const time = isPublic ? dateValue(p.updatedAt || p.createdAt) : latest(p), updated = p.updatedAt || time > dateValue(p.createdAt);
    return `<article class="oc-project-card" data-project-id="${esc(p.id)}"><div class="oc-project-card-top"><span class="oc-project-folder">${folderIcon}</span><span class="oc-project-state is-${state.tone}">${esc(state.label)}</span></div><div class="oc-project-card-copy"><h3><a class="oc-project-overview-link" ${isPublic ? '' : `data-overview="${esc(p.id)}"`} href="${isPublic ? `/projects/${enc(p.id)}` : `/openconstruction-web/desktop/projects.html?project=${enc(p.id)}`}">${esc(p.name)}</a></h3><p class="oc-project-access">${esc(access)} <span aria-hidden="true">·</span> ${visibility}</p></div><div class="oc-project-card-meta"><span>${isPublic ? 'Published project' : data?.datasets ? `${data.datasets.length} dataset${data.datasets.length === 1 ? '' : 's'}` : 'Datasets —'}</span><span>${updated ? 'Updated' : 'Created'} ${esc(dateLabel(time))}</span></div><div class="oc-platform-actions">${isPublic ? `<a class="oc-platform-button oc-platform-primary" href="/projects/${enc(p.id)}">View project ↗</a>` : `<button class="oc-platform-button oc-platform-primary" data-open="${esc(p.id)}">View overview</button><button class="oc-platform-button" data-share="${esc(p.id)}">Sharing</button>`}</div></article>`;
  }
  function sorted(items) {
    const query = $('projectSearch').value.trim().toLocaleLowerCase(), sort = $('projectSort').value;
    return items.filter(p => p.name.toLocaleLowerCase().includes(query)).sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : (sort === 'created' ? dateValue(b.createdAt)-dateValue(a.createdAt) : latest(b)-latest(a)) || a.name.localeCompare(b.name));
  }
  function render() {
    projects = collections[scope];
    const visible = sorted(projects), filtering = Boolean($('projectSearch').value.trim());
    const title = scope === 'shared' ? 'Shared with me' : scope === 'public' ? 'Explore public projects' : 'Recent projects';
    const empty = filtering ? 'No projects match your search.' : scope === 'shared' ? 'No projects shared with you yet.' : scope === 'public' ? 'No public projects yet.' : 'Your next research project starts here.';
    const hint = filtering ? 'Try another project name or clear the search.' : scope === 'shared' ? 'A project owner can add your OC account from Sharing.' : scope === 'public' ? 'Explore research when its owners publish a version.' : 'Create a project to keep your data, conversations and results together.';
    const grid = items => `<div class="oc-projects-grid${view === 'list' ? ' is-list' : ''}">${items.map(p => card(p,scope === 'public')).join('')}</div>`;
    $('projectsList').innerHTML = `<section><div class="oc-projects-section-head"><h2>${title}</h2><span>${visible.length} project${visible.length === 1 ? '' : 's'}</span></div>${visible.length ? grid(visible) : `<div class="oc-projects-empty"><span class="oc-project-folder">${folderIcon}</span><h3>${empty}</h3><p>${hint}</p>${scope === 'mine' && !filtering ? '<button class="oc-platform-button oc-platform-primary" data-new-project>Create your first project</button>' : ''}</div>`}</section>`;
    if (scope === 'mine' && collections.shared.length) {
      const shared = sorted(collections.shared);
      $('projectsList').insertAdjacentHTML('beforeend',`<section class="oc-projects-shared"><div class="oc-projects-section-head"><h2>Shared with me</h2><button class="oc-projects-text-button" data-show-shared>View all ${collections.shared.length} →</button></div>${shared.length ? grid(shared.slice(0,3)) : '<p class="oc-platform-muted">No shared projects match your search.</p>'}</section>`);
    }
    $('projectsList').setAttribute('aria-busy','false');
    $('projectGettingStarted').hidden = allProjects().length > 0 || scope !== 'mine';
    document.querySelectorAll('[data-project-view]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.projectView === view)));
    configure();
  }
  function renderOverview() {
    const all = allProjects(), infos = all.map(p => details.get(p.id));
    $('myProjectsCount').textContent = collections.mine.length;
    $('sharedProjectsCount').textContent = collections.shared.length;
    const tasksKnown = infos.every(info => info?.tasks), datasetsKnown = infos.every(info => info?.datasets);
    $('runningTasksCount').textContent = tasksKnown ? infos.reduce((n,info) => n+info.tasks.filter(t => t.status === 'running').length,0) : '—';
    $('runningTasksNote').textContent = tasksKnown ? 'Across your projects' : detailsLoading ? 'Loading task activity…' : 'Activity temporarily unavailable';
    $('projectDatasetsCount').textContent = datasetsKnown ? new Set(infos.flatMap(info => info.datasets.map(d => d.datasetId))).size : '—';
    $('projectDatasetsNote').textContent = datasetsKnown ? 'Unique linked datasets' : detailsLoading ? 'Loading linked datasets…' : 'Dataset count unavailable';
    const events = all.flatMap(p => [{project:p,title:'Project created',time:dateValue(p.createdAt)},...(details.get(p.id)?.tasks || []).map(t => ({project:p,title:`${t.title} · ${t.status}`,time:dateValue(t.updatedAt || t.createdAt)}))]).filter(e => e.time).sort((a,b) => b.time-a.time).slice(0,5);
    $('projectActivity').innerHTML = events.length ? `<ul>${events.map(e => `<li><span class="oc-activity-dot" aria-hidden="true"></span><div><strong>${esc(e.title)}</strong><button class="oc-projects-text-button" data-open="${esc(e.project.id)}">${esc(e.project.name)}</button></div><time datetime="${new Date(e.time).toISOString()}">${esc(dateLabel(e.time))}</time></li>`).join('')}</ul>${!tasksKnown ? `<p class="oc-platform-muted">${detailsLoading ? 'Loading task activity…' : 'Some task activity is unavailable. Refresh to try again.'}</p>` : ''}` : `<p class="oc-platform-muted">${detailsLoading ? 'Loading activity…' : 'Your project activity will appear here.'}</p>`;
  }
  async function loadDetails(version) {
    if (window.OCWebDashboard) {
      try {
        const result = await request('platform/project-dashboard?details=1');
        if (version !== generation) return;
        details = new Map(Object.entries(result.details));
      } catch {
        if (version !== generation) return;
        details = new Map();
      }
      detailsLoading = false; renderOverview(); render(); renderProjectOverview();
      return;
    }
    const queue = allProjects();
    await Promise.all(Array.from({length:Math.min(3,queue.length)},async () => {
      while (queue.length && version === generation) {
        const p = queue.shift();
        const [tasks,datasets] = await Promise.allSettled([request(`platform/tasks?projectId=${enc(p.id)}`),request(`host/datasets/project?projectId=${enc(p.id)}`)]);
        if (version !== generation) return;
        details.set(p.id,{tasks:tasks.status === 'fulfilled' && Array.isArray(tasks.value.tasks) ? tasks.value.tasks : null,datasets:datasets.status === 'fulfilled' && Array.isArray(datasets.value) ? datasets.value : null});
      }
    }));
    if (version !== generation) return;
    detailsLoading = false; renderOverview(); render(); renderProjectOverview();
  }
  async function refresh() {
    const version = ++generation;
    let profile, mine, shared, published;
    try {
      if (window.OCWebDashboard) {
        const [dashboard, publicProjects] = await Promise.all([window.OCWebDashboard(Boolean(me)),scope === 'public' ? request('public/projects') : null]);
        ({profile,mine,shared} = dashboard); published = publicProjects;
      } else {
        [profile,mine,shared,published] = await Promise.all([request('platform/me'),request('research/projects?scope=mine'),request('research/projects?scope=shared'),scope === 'public' ? request('public/projects') : null]);
      }
    } catch(error) { detailsLoading=false; if(me)renderOverview(); throw error; }
    projectPages.reset();
    me = profile;
    collections = {mine,shared,public:published?.projects || collections.public};
    $('projectsGreeting').textContent = me.user.displayName ? `Welcome, ${me.user.displayName}!` : 'Welcome back.';
    details = new Map(); detailsLoading = allProjects().length > 0;
    renderOverview(); render(); renderProjectOverview();
    void loadDetails(version);
  }
  function navigateOverview(projectId, tab = 'overview', item = '') {
    const url = new URL(location.href);
    url.searchParams.delete('action');
    url.searchParams.delete('tab'); url.searchParams.delete('item');
    if (projectId && tab !== 'overview') url.searchParams.set('tab',tab);
    if (projectId && item) url.searchParams.set('item',item);
    if (projectId) url.searchParams.set('project',projectId); else url.searchParams.delete('project');
    history.pushState(null,'',url);
    notice(''); renderProjectOverview(); window.scrollTo(0,0);
    const target = projectId ? ($('projectPageTitle') || $('projectOverviewTitle')) : $('projectsGreeting');
    target?.setAttribute('tabindex','-1'); target?.focus({preventScroll:true});
  }
  function renderProjectOverview() {
    const params = new URLSearchParams(location.search), projectId = params.get('project');
    const tabs = {overview:'Overview',tasks:'Tasks',datasets:'Datasets',results:'Results',agents:'Agents'};
    const tab = Object.hasOwn(tabs,params.get('tab')) ? params.get('tab') : 'overview', item = params.get('item') || '';
    const focusedHref = $('projectOverview').contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
    $('projectsDashboard').hidden = Boolean(projectId);
    $('projectOverview').hidden = !projectId;
    if (!projectId) { document.title='My project · OpenConstruction'; return; }
    const project = allProjects().find(p => p.id === projectId);
    const back = '<a class="oc-projects-text-button" href="/openconstruction-web/desktop/projects.html" data-back-projects>← My projects</a>';
    if (!project) {
      document.title='Project unavailable · OpenConstruction';
      $('projectOverview').innerHTML=`${back}<h1 id="projectOverviewTitle">Project unavailable</h1><p>This project could not be found among your projects. It may have been removed or your access may have changed.</p><button class="oc-platform-button" data-refresh-overview>Retry</button>`;
      return;
    }
    document.title=`${tabs[tab]} · ${project.name} · OpenConstruction`;
    const info = details.get(project.id), status = projectStatus(project,false);
    const access = project.access?.role === 'owner' ? 'Owner' : project.access?.canEdit ? 'Can edit' : 'Can view';
    const visibility = project.access?.visibility === 'public' ? 'Public' : project.access?.visibility === 'workspace' ? 'Team' : 'Private';
    const tasks = info?.tasks, datasets = info?.datasets;
    const unavailable = label => detailsLoading ? `Loading ${label}…` : `${label} temporarily unavailable. Use Refresh to try again.`;
    const taskRows = tasks ? [...tasks].sort((a,b)=>dateValue(b.updatedAt || b.createdAt)-dateValue(a.updatedAt || a.createdAt)).slice(0,8) : [];
    $('projectOverview').innerHTML=`${back}
      <header class="oc-project-overview-header"><div><p class="oc-projects-eyebrow">PROJECT OVERVIEW</p><h1 id="projectOverviewTitle">${esc(project.name)}</h1><p class="oc-project-access">${esc(access)} · ${visibility} <span class="oc-project-state is-${status.tone}">${esc(status.label)}</span></p></div><button class="oc-platform-button oc-platform-primary" data-enter="${esc(project.id)}">${project.access?.canEdit ? 'Open workspace' : 'View workspace'} ↗</button></header>
      <div class="oc-project-overview-actions"><button class="oc-platform-button" data-share="${esc(project.id)}">Sharing</button><button class="oc-platform-button" data-refresh-overview>Refresh</button></div>
      <nav class="oc-project-page-nav" aria-label="Project pages">${Object.entries(tabs).map(([key,label])=>`<a href="${projectPages.url(project,key)}" data-project-tab="${key}" ${key===tab?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
      <section id="projectPageContent" class="oc-project-page-content" aria-label="${tabs[tab]}">${tab==='overview' ? `
      <dl class="oc-project-overview-facts"><div><dt>Created</dt><dd>${esc(dateLabel(dateValue(project.createdAt)))}</dd></div><div><dt>Last activity</dt><dd>${esc(dateLabel(latest(project)))}</dd></div><div><dt>Linked datasets</dt><dd>${datasets ? datasets.length : '—'}</dd></div><div><dt>Running tasks</dt><dd>${tasks ? tasks.filter(t=>t.status==='running').length : '—'}</dd></div></dl>
      <div class="oc-project-overview-columns"><section><h2>Datasets</h2>${datasets ? datasets.length ? `<ul class="oc-project-overview-list">${datasets.map(d=>`<li><a href="/datasets/detail.html?id=${enc(d.datasetId)}">${esc(d.title || d.name || d.datasetId)}</a></li>`).join('')}</ul>` : '<p class="oc-platform-muted">No datasets linked yet.</p>' : `<p class="oc-platform-muted">${unavailable('Datasets')}</p>`}</section>
      <section><h2>Recent tasks</h2>${tasks ? taskRows.length ? `<ul class="oc-project-overview-list">${taskRows.map(t=>`<li>${projectPages.link(project,'tasks',t.id,t.title || 'Untitled task')}<span>${esc(t.status)} · ${esc(dateLabel(dateValue(t.updatedAt || t.createdAt)))}</span></li>`).join('')}</ul>` : '<p class="oc-platform-muted">No tasks yet.</p>' : `<p class="oc-platform-muted">${unavailable('Tasks')}</p>`}</section></div>` : projectPages.render(project,tab,item,info,detailsLoading)}</section>`;
    if (focusedHref) [...$('projectOverview').querySelectorAll('a[href]')].find(a=>a.getAttribute('href')===focusedHref)?.focus({preventScroll:true});
  }
  const sharingPath = () => `platform/projects/${enc(sharingId)}/sharing`;
  async function loadSharing() {
    const {access, collaborators} = await request(sharingPath());
    $('shareProjectRole').textContent = `Your access: ${access.role === 'owner' ? 'Owner' : access.canEdit ? 'Can edit' : 'Can view'}`;
    $('visibilityForm').hidden = !access.canManage;
    $('collaboratorForm').hidden = !access.canManage;
    $('releaseControls').hidden = !access.canManage;
    $('publishReleaseForm').reset();
    $('releaseFileChoices').replaceChildren();
    $('releaseAgentSummary').textContent='';
    $('publishReleaseButton').disabled=true;
    releaseReviewed=false;
    $('visibilityForm').elements.visibility.value = access.visibility;
    $('visibilityForm').elements.shareScope.value = access.shareScope || 'workspace_only';
    $('visibilityForm').querySelector('option[value=workspace]').hidden = access.visibility !== 'workspace';
    $('visibilityForm').elements.confirmPublic.checked = false;
    updateConfirmation($('visibilityForm'));
    $('publicProjectLink').hidden = access.visibility !== 'public';
    $('publicProjectLink').querySelector('a').href = `/projects/${enc(sharingId)}`;
    $('projectCollaborators').innerHTML = collaborators.length ? collaborators.map(c => `<div class="oc-project-collaborator"><span>${esc(c.displayName)}<br><small>${esc(c.email)}</small></span>${access.canManage ? `<select aria-label="Permission for ${esc(c.email)}" data-role="${esc(c.userId)}"><option value="viewer" ${c.role === 'viewer' ? 'selected' : ''}>Can view</option><option value="editor" ${c.role === 'editor' ? 'selected' : ''}>Can edit</option></select><button class="oc-platform-button" data-remove="${esc(c.userId)}">Remove</button>` : `<small>${c.role === 'editor' ? 'Can edit' : 'Can view'}</small>`}</div>`).join('') : '<p class="oc-platform-muted">No individual collaborators. The owner and platform administrators retain access.</p>';
    for (const key of ['mine','shared']) collections[key] = collections[key].map(p => p.id === sharingId ? {...p,access} : p); render();
  }
  function updateConfirmation(form) { const visible=form.elements.visibility.value==='public'; form.querySelector('[data-public-confirm]').hidden=!visible; form.elements.confirmPublic.required=visible;const scope=form.querySelector('[data-share-scope]');if(scope)scope.hidden=!visible; }
  $('visibilityForm').elements.visibility.onchange=()=>updateConfirmation($('visibilityForm'));
  async function createBlankProject() {
    if (!me || me.user.role === 'viewer') return;
    // Consume the shortcut before creating so Back/reload cannot repeat it.
    const url = new URL(location.href); url.searchParams.delete('action');
    history.replaceState(null,'',url);
    notice('Opening your blank project…');
    const created = await request('research/projects','POST',{name:'Untitled project',visibility:'private'});
    const projectId = created.id || created.project?.id;
    if (!projectId) throw new Error('The project response did not include an ID. Refresh projects to check whether it was created.');
    url.searchParams.set('project',projectId); history.replaceState(null,'',url);
    const sessionId = created.firstSession?.id || (await request(`research/projects/${enc(projectId)}/sessions`))[0]?.id || '';
    localStorage.setItem('oc.desktop.selection',JSON.stringify({projectId,sessionId}));
    location.assign('/openconstruction-web/research.html');
  }
  const startBlankProject = () => act(createBlankProject);
  $('createProjectButton').onclick = startBlankProject;
  $('projectSearch').addEventListener('input',render);
  $('projectSort').onchange=render;
  document.querySelectorAll('[data-project-view]').forEach(button => { button.onclick=()=>{view=button.dataset.projectView;try{localStorage.setItem('oc.projects.view',view);}catch{}render();}; });
  $('mainContent').addEventListener('click',event=>{if(event.target.closest('[data-new-project]')&&me&&me.user.role!=='viewer')void startBlankProject();if(event.target.closest('[data-show-shared]'))void act(async()=>{scope='shared';await refresh();});});
  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
  $('refreshProjects').onclick = () => { notice(''); return act(refresh); };
  document.querySelectorAll('[data-project-scope]').forEach(button=>{button.onclick=()=>act(async()=>{scope=button.dataset.projectScope;await refresh();});});
  const projectAction = event => {
    const share = event.target.closest('[data-share]'), open = event.target.closest('[data-open]'), overview = event.target.closest('[data-overview]'), enter = event.target.closest('[data-enter]');
    if (overview && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateOverview(overview.dataset.overview); }
    if (open) navigateOverview(open.dataset.open);
    if (share) void act(async () => { sharingId = share.dataset.share; $('shareProjectName').textContent = allProjects().find(p=>p.id===sharingId)?.name; $('shareProjectDialog').querySelector('[data-error]').hidden = true; await loadSharing(); $('shareProjectDialog').showModal(); });
    if (enter) void act(async () => {
      const projectId = enter.dataset.enter;
      if (!allProjects().some(p => p.id === projectId)) throw new Error('Project is no longer available.');
      const sessions = await request(`research/projects/${enc(projectId)}/sessions`);
      localStorage.setItem('oc.desktop.selection',JSON.stringify({projectId,sessionId:sessions[0]?.id || ''})); location.assign('/openconstruction-web/research.html');
    });
  };
  $('projectsList').onclick=projectAction; $('projectActivity').onclick=projectAction;
  $('projectOverview').onclick=event=>{
    const page = event.target.closest('[data-project-tab]');
    if (page && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateOverview(new URLSearchParams(location.search).get('project'),page.dataset.projectTab,page.dataset.projectItem || ''); return; }
    if (event.target.closest('[data-back-projects]') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateOverview(''); }
    if (event.target.closest('[data-refresh-overview]')) void act(refresh);
    projectAction(event);
  };
  window.addEventListener('popstate',()=>{renderProjectOverview();});
  $('visibilityForm').elements.shareScope.onchange=()=>{$('visibilityForm').elements.confirmPublic.checked=false;};
  let releaseReviewed=false;
  function clearReleaseReview(){releaseReviewed=false;$('releaseFileChoices').replaceChildren();$('releaseAgentSummary').textContent='';$('publishReleaseButton').disabled=true;$('publishReleaseForm').elements.confirmPublic.checked=false;}
  $('publishReleaseForm').elements.shareScope.onchange=clearReleaseReview;
  $('reviewReleaseFiles').onclick=()=>void act(async()=>{
    clearReleaseReview();
    const {draft}=await request(`platform/projects/${enc(sharingId)}/release-preview?scope=${enc($('publishReleaseForm').elements.shareScope.value)}`);
    $('releaseFileChoices').innerHTML=draft.files.map(f=>`<label class="oc-platform-check"><input type="checkbox" name="file" value="${esc(f.path)}" checked><span>${esc(f.path)} <small>(${f.size} bytes)</small></span></label>`).join('')||'No eligible files.';
    $('releaseAgentSummary').textContent=draft.agents.length?`Includes ${draft.agents.length} agent roles: ${draft.agents.map(a=>a.name).join(', ')}. No chats, credentials or execution grants.`:'No agents included.';
    releaseReviewed=draft.files.length>0;
  },$('shareProjectDialog')).finally(()=>{$('publishReleaseButton').disabled=!releaseReviewed;});
  $('publishReleaseForm').onsubmit=event=>{
    event.preventDefault();if(!releaseReviewed)return;
    void act(async()=>{
      const form=event.target,files=[...form.querySelectorAll('input[name=file]:checked')].map(el=>el.value);
      const {release}=await request(`platform/projects/${enc(sharingId)}/releases`,'POST',{shareScope:form.elements.shareScope.value,confirmPublic:form.elements.confirmPublic.checked,files});
      await loadSharing();clearReleaseReview();
      notice(`Published version ${release.version}. Draft changes will not alter this version.`);
    },$('shareProjectDialog'));
  };
  $('visibilityForm').onsubmit = event => { event.preventDefault(); const visibility = event.target.elements.visibility.value,confirmPublic=event.target.elements.confirmPublic.checked,shareScope=event.target.elements.shareScope.value; void act(async () => { await request(sharingPath(),'PATCH',{visibility,confirmPublic,shareScope}); await loadSharing(); },$('shareProjectDialog')); };
  $('collaboratorForm').onsubmit = event => { event.preventDefault(); const form = event.target; void act(async () => { await request(sharingPath(),'POST',{email:form.elements.email.value,role:form.elements.role.value}); form.reset(); await loadSharing(); },$('shareProjectDialog')); };
  $('projectCollaborators').onchange = event => { const select = event.target.closest('[data-role]'); if(select) void act(async () => { await request(`${sharingPath()}/${enc(select.dataset.role)}`,'PATCH',{role:select.value}); await loadSharing(); },$('shareProjectDialog')); };
  $('projectCollaborators').onclick = event => { const remove = event.target.closest('[data-remove]'); if(remove) void act(async () => { await request(`${sharingPath()}/${enc(remove.dataset.remove)}`,'DELETE',{}); await loadSharing(); },$('shareProjectDialog')); };
  if (window.OCDesktop?.platform !== 'web') { notice('Project collaboration is available on your hosted OC workspace. Local research remains available from Research.'); return; }
  void act(async () => { try { await refresh(); } catch(error) { $('projectsList').innerHTML='<div class="oc-projects-empty"><h2>Projects could not be loaded.</h2><p>Use Refresh to try again.</p></div>'; $('projectsList').setAttribute('aria-busy','false'); $('projectActivity').textContent='Activity unavailable.'; $('runningTasksNote').textContent='Activity unavailable'; $('projectDatasetsNote').textContent='Dataset count unavailable'; throw error; } if(new URLSearchParams(location.search).get('action') === 'new') await createBlankProject(); });
})();
