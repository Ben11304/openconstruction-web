(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const enc = encodeURIComponent;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const list = value => Array.isArray(value) ? value : [];
  const activeStates = new Set(['queued','starting','running','blocked','waiting','waiting_for_input','cancelling','cancel_requested']);
  const state = {me:null,workspaceId:'',tasks:[],task:null,runs:[],members:[],publications:[],section:'tasks',polling:false,loading:false,revision:0};
  const runKeys = new Map();
  if(window.OCDesktop?.platform === 'web') {
    const projectsLink = document.createElement('a'); projectsLink.href = '/openconstruction-web/desktop/projects.html'; projectsLink.className = 'oc-platform-button'; projectsLink.textContent = 'Projects & sharing';
    document.querySelector('.oc-platform-toolbar')?.append(projectsLink);
  }
  const workspace = () => list(state.me?.workspaces).find(item => item.id === state.workspaceId);
  const isAdmin = () => state.me?.user?.role === 'admin' || list(state.me?.user?.roles).includes('admin');
  const role = () => workspace()?.role || workspace()?.membershipRole || workspace()?.membership?.role || (isAdmin() ? 'admin' : 'viewer');
  const canWrite = () => !!workspace() && (isAdmin() || ['owner','admin','member'].includes(role()));
  const canManageTeam = () => !!workspace() && (isAdmin() || ['owner','admin'].includes(role()));
  const date = (value,full=false) => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString(undefined,full ? {dateStyle:'medium',timeStyle:'short'} : {month:'short',day:'numeric'}) : '—'; };
  const badge = value => `<span class="oc-platform-status ${activeStates.has(value) ? 'is-active' : ['completed','succeeded','published'].includes(value) ? 'is-success' : ['failed','error'].includes(value) ? 'is-error' : ''}">${esc(String(value || 'draft').replaceAll('_',' '))}</span>`;

  async function request(path,{method='GET',body}={}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),60000);
    try {
      const response = await fetch(path.startsWith('/auth/') ? path : `/api/platform${path}`,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)});
      const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (response.status === 401) { location.assign('/openconstruction-web/web/login.html'); throw new Error('Your session ended. Sign in to continue.'); }
      if (!response.ok) throw new Error(payload.error || payload.detail || `Request failed (${response.status}).`);
      return payload;
    } catch(error) { if (error.name === 'AbortError') throw new Error('This request is taking longer than expected. Refresh to check its status before trying again.'); throw error; }
    finally { clearTimeout(timer); }
  }
  function notice(message,kind='info') { const element = $('#platformNotice'); element.textContent = message; element.className = `oc-platform-notice${kind === 'info' ? '' : ` is-${kind}`}`; element.hidden = !message; }
  async function action(button,work,{dialog,success}={}) {
    if(button?.disabled) return;
    const label = button?.textContent;
    if(button) { button.disabled = true; button.textContent = 'Working…'; }
    const errorBox = dialog?.querySelector('[data-dialog-error]'); if(errorBox) errorBox.hidden = true;
    try { await work(); if(success) notice(success,'success'); }
    catch(error) { if(errorBox && dialog.open) { errorBox.textContent = error.message; errorBox.hidden = false; } else notice(error.message || String(error),'error'); }
    finally { if(button?.isConnected) { button.disabled = false; button.textContent = label; } }
  }
  function showDialog(id) { const dialog = $(id); const error = dialog.querySelector('[data-dialog-error]'); if(error) error.hidden = true; dialog.showModal(); }
  function configureTaskForm(task=null) {
    const form = $('#taskForm');
    form.reset();
    if(task) { form.dataset.taskId = task.id; form.elements.title.value = task.title || ''; form.elements.objective.value = task.objective || ''; form.elements.successCriteria.value = task.successCriteria || ''; }
    else delete form.dataset.taskId;
    $('#taskDialogTitle').textContent = task ? 'Edit research task' : 'New research task';
    form.querySelector('button[type="submit"]').textContent = task ? 'Save changes' : 'Create task';
    form.querySelector('p.oc-platform-muted').textContent = task ? 'Your next run will use this updated brief. Existing run history and publications are preserved.' : 'Creating a task saves your brief. Start the agent when you are ready.';
  }
  function openSection(name) {
    const valid = ['tasks','team','community','account']; state.section = valid.includes(name) ? name : 'tasks';
    if (window.OCDesktop?.platform === 'web' && state.section === 'account') {
      $('.oc-platform-toolbar').hidden = true;
      $('.oc-platform-tabs').hidden = true;
      $('.oc-platform-header h1').textContent = 'My account';
      $('.oc-platform-header p:not(.oc-platform-eyebrow)').textContent = 'Manage your OC account and password.';
    }
    $$('[data-section]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.section === state.section)));
    $$('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== state.section; });
    history.replaceState(null,'',`#${state.section}`);
    if(state.section === 'team') loadMembers().catch(error => notice(error.message,'error'));
    if(state.section === 'community') loadPublications().catch(error => notice(error.message,'error'));
  }
  function renderShell() {
    const user = state.me.user;
    $('#currentUser').textContent = user.displayName || user.email || 'Your account';
    $('#platformAdminLink').hidden = !isAdmin();
    $('#workspaceSelect').innerHTML = list(state.me.workspaces).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('') || '<option value="">No workspace yet</option>';
    $('#workspaceSelect').value = state.workspaceId;
    $('#workspaceSelect').disabled = !state.me.workspaces.length;
    $('#workspaceTitle').textContent = workspace()?.name || 'Your next research workspace';
    $('#workspaceDescription').textContent = workspace()?.description || (workspace() ? 'A clear objective, a traceable run and results you can build on.' : 'Create a workspace to bring your team and research tasks together.');
    $('#workspaceRole').textContent = workspace() ? `${role().charAt(0).toUpperCase()}${role().slice(1)} access` : '';
    $('#newTaskButton').disabled = !canWrite();
    $('#newWorkspaceButton').hidden = state.me.capabilities?.createWorkspace === false || state.me.capabilities?.canCreateWorkspace === false;
    $('#memberForm').hidden = !canManageTeam();
    $('#teamHelp').textContent = canManageTeam() ? 'A platform administrator creates accounts in Admin → Users. Add an existing account to this workspace here.' : 'Your workspace owner or administrator manages team membership.';
    const identities = list(user.identities).map(identity => identity.provider).filter(Boolean);
    $('#accountInfo').innerHTML = [['Name',user.displayName || '—'],['Email',user.email],['Account role',user.role || list(user.roles).join(', ') || 'member'],['Sign-in',identities.join(', ') || user.authProvider || 'local'],['Account ID',user.id]].map(([key,value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('');
  }
  function renderTasks() {
    const query = $('#taskSearch').value.toLowerCase().trim();
    const tasks = state.tasks.filter(task => `${task.title} ${task.objective}`.toLowerCase().includes(query));
    $('#taskList').innerHTML = tasks.length ? tasks.map(task => `<button class="oc-platform-task-item" type="button" data-task="${esc(task.id)}" aria-current="${task.id === state.task?.id}"><strong>${esc(task.title)}</strong><p>${esc(task.objective)}</p><span class="oc-platform-task-meta">${badge(task.status)}<span>${esc(date(task.updatedAt || task.createdAt))}</span></span></button>`).join('') : `<div class="oc-platform-empty"><p>${query ? 'No tasks match your search.' : workspace() ? 'No research tasks yet. Start with a question you want to investigate.' : 'Create or join a workspace to get started.'}</p></div>`;
  }
  function renderTaskDetail() {
    const task = state.task;
    if(!task) { $('#taskDetail').innerHTML = '<div class="oc-platform-empty"><h3>Start with a research question</h3><p>Create a task or choose one from the list. Your objective, run history and publication will stay together here.</p></div>'; return; }
    const running = activeStates.has(task.status) || state.runs.some(run => activeStates.has(run.status));
    const runs = state.runs.length ? `<div class="oc-platform-table-wrap"><table class="oc-platform-table"><thead><tr><th>Run</th><th>Status</th><th>Started</th></tr></thead><tbody>${state.runs.map((run,index) => `<tr><td><strong>Run ${state.runs.length-index}</strong><small>${esc(run.id)}</small>${run.error ? `<small class="oc-platform-run-error">${esc(typeof run.error === 'string' ? run.error : run.error.message || JSON.stringify(run.error))}</small>` : ''}</td><td>${badge(run.status)}</td><td>${esc(date(run.createdAt,true))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="oc-platform-muted">No runs yet. Starting the agent creates a research session for this task.</p>';
    $('#taskDetail').innerHTML = `<div class="oc-platform-task-meta">${badge(task.status)}<span>Created ${esc(date(task.createdAt,true))}</span></div><h2>${esc(task.title)}</h2><h3>Research objective</h3><p class="oc-platform-prose">${esc(task.objective)}</p>${task.successCriteria ? `<h3>Success criteria</h3><p class="oc-platform-prose">${esc(task.successCriteria)}</p>` : ''}${task.forkedFrom || task.forkedFromPublicationId || task.sourcePublicationId ? '<p class="oc-platform-muted">Forked from a community publication. This task is private to your workspace.</p>' : ''}<div class="oc-platform-actions"><button type="button" class="oc-platform-button oc-platform-primary" id="runTask" ${!canWrite() || running ? 'disabled' : ''}>${state.runs.length ? 'Run again' : 'Start agent'}</button>${running ? `<button type="button" class="oc-platform-button oc-platform-danger" id="cancelTask" ${!canWrite() ? 'disabled' : ''}>Cancel run</button>` : ''}<button type="button" class="oc-platform-button" id="openResearch" ${!task.sessionId || !task.projectId ? 'disabled' : ''}>Open in research ↗</button><button type="button" class="oc-platform-button oc-platform-quiet" id="publishTask" ${!canWrite() ? 'disabled' : ''}>Publish report</button></div>${running ? '<p class="oc-platform-progress-note">Agent activity updates automatically. Open research to see tools, messages and outputs.</p>' : ''}${!canWrite() ? '<p class="oc-platform-muted">You have read-only access to this workspace.</p>' : ''}<div class="oc-platform-detail-note"><h3>Run history</h3>${runs}</div>`;
    if(canWrite() && !running) { const edit = document.createElement('button'); edit.type = 'button'; edit.id = 'editTask'; edit.className = 'oc-platform-button oc-platform-quiet'; edit.textContent = 'Edit task'; $('#taskDetail .oc-platform-actions').append(edit); }
    if(task.access?.canEdit === false) {
      for (const id of ['runTask','cancelTask','publishTask']) { const button = document.getElementById(id); if(button) button.disabled = true; }
      $('#editTask')?.remove();
    }
    if(task.access?.canManage === false) $('#publishTask').disabled = true;
  }
  async function loadTasks({preserve=true}={}) {
    const revision = state.revision, workspaceId = state.workspaceId;
    if(!workspaceId) { state.tasks = []; state.task = null; state.runs = []; renderTasks(); renderTaskDetail(); return; }
    const {tasks} = await request(`/tasks?workspaceId=${enc(workspaceId)}`);
    if(revision !== state.revision || workspaceId !== state.workspaceId) return;
    state.tasks = list(tasks); renderTasks();
    const taskId = preserve && state.tasks.some(item => item.id === state.task?.id) ? state.task.id : state.tasks[0]?.id;
    if(taskId) await selectTask(taskId); else { state.task = null; state.runs = []; renderTaskDetail(); }
  }
  async function selectTask(id) {
    const revision = state.revision, workspaceId = state.workspaceId;
    state.selectedTaskId = id;
    const result = await request(`/tasks/${enc(id)}`);
    if(revision !== state.revision || workspaceId !== state.workspaceId || state.selectedTaskId !== id) return;
    state.task = result.task; state.runs = list(result.runs);
    state.tasks = state.tasks.map(task => task.id === id ? result.task : task); renderTasks(); renderTaskDetail();
  }
  async function loadMembers() {
    if(!state.workspaceId) { $('#memberList').innerHTML = '<p class="oc-platform-empty">Choose a workspace to see your team.</p>'; return; }
    const revision = state.revision;
    const {members} = await request(`/workspaces/${enc(state.workspaceId)}/members`);
    if(revision !== state.revision) return;
    state.members = list(members);
    $('#memberList').innerHTML = state.members.length ? `<table class="oc-platform-table"><thead><tr><th>Member</th><th>Workspace role</th><th>Actions</th></tr></thead><tbody>${state.members.map(member => { const user = member.user || member, id = member.userId || user.id, editable = canManageTeam(); return `<tr data-member-row="${esc(id)}"><td><strong>${esc(user.displayName || user.email)}</strong><small>${esc(user.email)}${id === state.me.user.id ? ' · You' : ''}</small></td><td>${editable ? `<select data-member-role aria-label="Role for ${esc(user.displayName || user.email)}">${['owner','admin','member','viewer'].map(value => `<option value="${value}" ${member.role === value ? 'selected' : ''}>${value.charAt(0).toUpperCase()+value.slice(1)}</option>`).join('')}</select>` : esc(member.role)}</td><td>${editable ? `<button type="button" class="oc-platform-button" data-save-member="${esc(id)}">Save</button> <button type="button" class="oc-platform-button oc-platform-quiet" data-remove-member="${esc(id)}">Remove</button>` : '—'}</td></tr>`; }).join('')}</tbody></table>` : '<p class="oc-platform-empty">No members to show.</p>';
  }
  async function loadPublications() {
    const {publications} = await request('/publications'); state.publications = list(publications);
    $('#publicationList').innerHTML = state.publications.length ? state.publications.map(publication => `<article class="oc-platform-card oc-platform-publication"><span class="oc-platform-status">${esc(publication.license || 'Research report')}</span><h3>${esc(publication.title)}</h3><p>${esc(publication.summary)}</p><div class="oc-platform-actions"><span class="oc-platform-muted">${esc(publication.authorName || 'OC researcher')}<br>${esc(date(publication.createdAt))} · Version ${esc(publication.version || 1)}</span><button type="button" class="oc-platform-button" data-publication="${esc(publication.id)}">Read report</button></div></article>`).join('') : '<article class="oc-platform-card oc-platform-empty"><h3>The commons starts with one discovery</h3><p>Publish a report from a research task to share a method, finding or useful starting point.</p></article>';
  }
  async function showPublication(id) {
    const {publication} = await request(`/publications/${enc(id)}`);
    const mine = (publication.createdBy || publication.authorId || publication.authorUserId) === state.me.user.id;
    $('#publicationDetail').innerHTML = `<h2 id="publicationTitle">${esc(publication.title)}</h2><p class="oc-platform-muted">${esc(publication.authorName || 'OC researcher')} · ${esc(date(publication.createdAt,true))} · Version ${esc(publication.version || 1)} · ${esc(publication.license)}</p><p class="oc-platform-publication-summary">${esc(publication.summary)}</p><div class="oc-platform-publication-body oc-platform-prose">${esc(publication.body)}</div><div class="oc-platform-actions"><button type="button" class="oc-platform-button oc-platform-primary" data-fork-publication="${esc(publication.id)}" ${canWrite() ? '' : 'disabled'}>Fork into ${esc(workspace()?.name || 'a workspace')}</button>${mine || isAdmin() ? `<button type="button" class="oc-platform-button oc-platform-danger" data-withdraw-publication="${esc(publication.id)}">Withdraw report</button>` : ''}</div><p class="oc-platform-muted">Forking creates a private task from this published brief. It does not copy the author’s files, credentials or live session.</p>`;
    showDialog('#publicationDialog');
  }
  async function selectWorkspace(id) {
    await request(`/workspaces/${enc(id)}/select`,{method:'POST'});
    state.revision++; state.workspaceId = id; state.task = null; state.runs = []; state.tasks = [];
    try { localStorage.removeItem('oc.desktop.selection'); } catch {}
    renderShell(); renderTasks(); renderTaskDetail();
    await loadTasks({preserve:false}); if(state.section === 'team') await loadMembers();
  }
  async function refresh() {
    if(state.loading) return; state.loading = true; $('#refreshPlatform').disabled = true;
    try {
      state.me = await request('/me');
      state.workspaceId = state.me.activeWorkspaceId || list(state.me.workspaces)[0]?.id || '';
      renderShell(); await loadTasks(); if(state.section === 'team') await loadMembers(); if(state.section === 'community') await loadPublications();
    } finally { state.loading = false; $('#refreshPlatform').disabled = false; }
  }
  function bindEvents() {
    $$('[data-section]').forEach(button => button.addEventListener('click',() => openSection(button.dataset.section)));
    $$('[data-close-dialog]').forEach(button => button.addEventListener('click',() => button.closest('dialog').close()));
    $('#newWorkspaceButton').addEventListener('click',() => showDialog('#workspaceDialog'));
    $('#newTaskButton').addEventListener('click',() => { configureTaskForm(); showDialog('#taskDialog'); });
    $('#taskDialog').addEventListener('close',() => configureTaskForm());
    $('#refreshPlatform').addEventListener('click',() => refresh().catch(error => notice(error.message,'error')));
    $('#workspaceSelect').addEventListener('change',event => { const element = event.currentTarget, id = element.value; element.disabled = true; selectWorkspace(id).catch(error => { element.value = state.workspaceId; notice(error.message,'error'); }).finally(() => { element.disabled = false; }); });
    $('#taskSearch').addEventListener('input',renderTasks);
    $('#workspaceForm').addEventListener('submit',event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); action(event.submitter,async () => { const {workspace:created} = await request('/workspaces',{method:'POST',body:{name:data.get('name'),description:data.get('description')}}); state.me = await request('/me'); await selectWorkspace(created.id); form.reset(); $('#workspaceDialog').close(); openSection('tasks'); },{dialog:$('#workspaceDialog'),success:'Workspace created. Invite your team or start a research task.'}); });
    $('#taskForm').addEventListener('submit',event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form), taskId = form.dataset.taskId; action(event.submitter,async () => { const body = {title:data.get('title'),objective:data.get('objective'),successCriteria:data.get('successCriteria')}; if(!taskId) body.workspaceId = state.workspaceId; const {task} = await request(taskId ? `/tasks/${enc(taskId)}` : '/tasks',{method:taskId ? 'PATCH' : 'POST',body}); state.task = task; await loadTasks(); $('#taskDialog').close(); },{dialog:$('#taskDialog'),success:taskId ? 'Research brief updated. Your next run will use these changes.' : 'Research task saved. Start the agent when you are ready.'}); });
    $('#memberForm').addEventListener('submit',event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); action(event.submitter,async () => { await request(`/workspaces/${enc(state.workspaceId)}/members`,{method:'POST',body:{email:data.get('email'),role:data.get('role')}}); form.reset(); await loadMembers(); },{success:'Member added to this workspace.'}); });
    $('#publishForm').addEventListener('submit',event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form), taskId = form.dataset.taskId; action(event.submitter,async () => { await request(`/tasks/${enc(taskId)}/publish`,{method:'POST',body:{title:data.get('title'),summary:data.get('summary'),body:data.get('body'),license:data.get('license')}}); form.reset(); $('#publishDialog').close(); await loadPublications(); openSection('community'); },{dialog:$('#publishDialog'),success:'Your report is now visible in the community.'}); });
    $('#passwordForm').addEventListener('submit',event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); if(data.get('newPassword') !== data.get('confirmPassword')) { notice('The new passwords do not match.','error'); form.elements.confirmPassword.focus(); return; } action(event.submitter,async () => { await request('/auth/password',{method:'POST',body:{currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword')}}); form.reset(); notice('Password updated. Sign in again with your new password.','success'); location.assign('/openconstruction-web/web/login.html?password_changed=1'); }); });
    document.addEventListener('click',event => {
      const button = event.target.closest('button'); if(!button || button.disabled) return;
      if(button.dataset.task) return action(button,() => selectTask(button.dataset.task));
      if(button.dataset.publication) return action(button,() => showPublication(button.dataset.publication));
      if(button.id === 'openResearch' && state.task?.projectId && state.task?.sessionId) { try { localStorage.setItem('oc.desktop.selection',JSON.stringify({projectId:state.task.projectId,sessionId:state.task.sessionId})); } catch {} location.assign('/openconstruction-web/research.html'); return; }
      if(button.id === 'runTask') {
        const id = state.task.id; if(!runKeys.has(id)) runKeys.set(id,crypto.randomUUID());
        return action(button,async () => { const result = await request(`/tasks/${enc(id)}/run`,{method:'POST',body:{idempotencyKey:runKeys.get(id)}}); runKeys.delete(id); if(state.task?.id === id) state.task = result.task; await loadTasks(); },{success:'Agent run started. Open research to follow its work.'});
      }
      if(button.id === 'cancelTask') { const id = state.task.id; return action(button,async () => { await request(`/tasks/${enc(id)}/cancel`,{method:'POST'}); await selectTask(id); },{success:'Cancellation requested. Run status will update as the engine stops.'}); }
      if(button.id === 'editTask' && canWrite() && !activeStates.has(state.task?.status) && !state.runs.some(run => activeStates.has(run.status))) { configureTaskForm(state.task); showDialog('#taskDialog'); return; }
      if(button.id === 'publishTask') { const form = $('#publishForm'); if(form.dataset.taskId !== state.task.id) form.reset(); form.dataset.taskId = state.task.id; form.elements.title.value = state.task.title; showDialog('#publishDialog'); return; }
      if(button.dataset.saveMember) { const row = button.closest('[data-member-row]'), memberId = button.dataset.saveMember; return action(button,async () => { await request(`/workspaces/${enc(state.workspaceId)}/members/${enc(memberId)}`,{method:'PATCH',body:{role:row.querySelector('[data-member-role]').value}}); await refresh(); await loadMembers(); },{success:'Workspace membership updated.'}); }
      if(button.dataset.removeMember) { const memberId = button.dataset.removeMember; if(!confirm(memberId === state.me.user.id ? 'Leave this workspace? Your research will remain with the team.' : 'Remove this member from the workspace? Their research will remain with the team.')) return; return action(button,async () => { await request(`/workspaces/${enc(state.workspaceId)}/members/${enc(memberId)}`,{method:'DELETE'}); await refresh(); await loadMembers(); },{success:'Workspace membership removed.'}); }
      if(button.dataset.forkPublication) return action(button,async () => { const {task} = await request(`/publications/${enc(button.dataset.forkPublication)}/fork`,{method:'POST',body:{workspaceId:state.workspaceId}}); state.task = task; $('#publicationDialog').close(); await loadTasks(); openSection('tasks'); },{success:'Research brief forked into your workspace. Review the objective before starting the agent.'});
      if(button.dataset.withdrawPublication) { if(!confirm('Withdraw this report from the community? Existing forks will remain.')) return; return action(button,async () => { await request(`/publications/${enc(button.dataset.withdrawPublication)}`,{method:'DELETE'}); $('#publicationDialog').close(); await loadPublications(); },{success:'Report withdrawn from the community.'}); }
    });
  }
  async function init() {
    if (window.OCDesktop?.platform === 'web' && !location.hash && !new URLSearchParams(location.search).has('legacy')) { location.replace('/openconstruction-web/desktop/projects.html'); return; }
    if(window.OCDesktop?.platform && window.OCDesktop.platform !== 'web' && !document.querySelector('meta[name="oc-auth-mode"][content="gateway"]')) {
      $('#currentUser').textContent = 'Desktop host'; $('#platformUnavailable').hidden = false;
      if(window.OCDesktop.openPlatformWorkspace) { const button = document.createElement('button'); button.type = 'button'; button.className = 'oc-platform-button oc-platform-primary'; button.textContent = 'Open hosted workspace'; button.style.marginRight = '10px'; button.onclick = () => action(button,() => window.OCDesktop.openPlatformWorkspace()); $('#platformUnavailable').insertBefore(button,$('#platformUnavailable a')); }
      return;
    }
    bindEvents();
    try { await refresh(); $('#platformContent').hidden = false; openSection(location.hash.slice(1)); }
    catch(error) { notice(error.message,'error'); $('#currentUser').textContent = 'Connection unavailable'; const button = document.createElement('button'); button.type = 'button'; button.className = 'oc-platform-button'; button.textContent = 'Try again'; button.onclick = () => location.reload(); $('#platformNotice').after(button); return; }
    const timer = setInterval(async () => { if(document.hidden || state.polling || state.loading || $$('dialog[open]').length || state.section !== 'tasks' || !state.tasks.some(task => activeStates.has(task.status))) return; state.polling = true; try { await loadTasks(); } catch(error) { notice(`Could not refresh run status: ${error.message}`,'error'); } finally { state.polling = false; } },5000);
    window.addEventListener('pagehide',() => clearInterval(timer),{once:true});
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
