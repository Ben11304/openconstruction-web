// OC research workspace. Copyright (c) 2024-2026 OpenConstruction Open Science Initiative
// SPDX-License-Identifier: Apache-2.0

(() => {
  const API_ROOT = '/api/research';
  const ACTIVE_RUNS = new Set(['queued', 'running', 'blocked']);
  const state = {
    root: null,
    started: false,
    loading: false,
    projects: [],
    projectId: '',
    sessions: [],
    sessionId: '',
    session: null,
    runs: [],
    permissions: [],
    papers: [],
    artifacts: [],
    selectedArtifact: null,
    view: 'conversation',
    pollTimer: null,
    polling: false,
    selectionVersion: 0
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const urlId = value => encodeURIComponent(String(value || ''));

  async function request(path, options = {}){
    const headers = { 'X-OC-Workspace': 'research' };
    if (options.body !== undefined || options.rawBody !== undefined) {
      headers['Content-Type'] = options.rawBody !== undefined ? options.contentType : 'application/json';
    }
    const response = await fetch(`${API_ROOT}/${path}`, {
      method: options.method || 'GET',
      headers,
      cache: 'no-store',
      body: options.rawBody !== undefined ? options.rawBody : options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || payload.error || `Research service returned ${response.status}`);
    }
    return options.raw ? response : response.json();
  }

  function element(selector){ return state.root?.querySelector(selector); }
  function message(text, isError = false){
    const box = element('[data-research-message]');
    if (!box) return;
    box.textContent = text || '';
    box.hidden = !text;
    box.classList.toggle('is-error', isError);
  }
  function date(value){
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
  }
  function latestRun(){ return state.runs[0] || null; }
  function activeRun(){ return state.runs.find(run => ACTIVE_RUNS.has(run.status)) || null; }

  function renderProjects(){
    const list = element('[data-research-projects]');
    if (!list) return;
    list.innerHTML = state.projects.length ? state.projects.map(project => `
      <button type="button" class="oc-research-list-item${project.id === state.projectId ? ' is-active' : ''}"
        data-research-project="${escapeHtml(project.id)}" aria-pressed="${project.id === state.projectId}">
        <span class="oc-research-project-dot" aria-hidden="true"></span>
        <span class="oc-research-list-copy"><strong>${escapeHtml(project.name)}</strong><small>${date(project.createdAt)}</small></span>
      </button>`).join('') : '<p class="oc-research-empty-small">No projects yet. Create one to begin.</p>';
  }

  function renderSessions(){
    const list = element('[data-research-sessions]');
    const create = element('[data-research-new-session]');
    if (create) create.disabled = !state.projectId;
    if (!list) return;
    list.innerHTML = state.sessions.length ? state.sessions.map(session => `
      <button type="button" class="oc-research-list-item${session.id === state.sessionId ? ' is-active' : ''}"
        data-research-session="${escapeHtml(session.id)}" aria-pressed="${session.id === state.sessionId}">
        <span class="oc-research-session-mark" aria-hidden="true">▤</span>
        <span class="oc-research-list-copy"><strong>${escapeHtml(session.title || 'Untitled session')}</strong><small>${date(session.updatedAt || session.createdAt)}</small></span>
      </button>`).join('') : '<p class="oc-research-empty-small">No sessions in this project.</p>';
  }

  function renderConversation(){
    window.OCDesktopAgents?.update({sessionId:state.sessionId,messages:state.session?.messages||[]});
    window.OCDesktopLayout?.rememberSelection(state.projectId, state.sessionId, state.projects.find(project=>project.id===state.projectId));
    window.OCDesktopWorkspace?.select({projectId:state.projectId,sessionId:state.sessionId,projectName:state.projects.find(project=>project.id===state.projectId)?.name});
    window.OCDesktopSkills?.sync({sessionId:state.sessionId,projectId:state.projectId});
    window.OCDesktopTrace?.sync({session:state.session,sessionId:state.sessionId,projectId:state.projectId});
    const title = element('[data-research-session-title]');
    const subtitle = element('[data-research-session-subtitle]');
    const transcript = element('[data-research-transcript]');
    const composer = element('[data-research-composer]');
    const cancel = element('[data-research-cancel-run]');
    const run = activeRun();
    if (title) title.textContent = state.session?.title || (state.projectId ? 'Select a session' : 'Select a project');
    if (subtitle) {
      subtitle.hidden = !run;
      subtitle.textContent = run ? `Research run ${run.status} · ${date(run.createdAt)}` : '';
    }
    if (composer) {
      composer.hidden = !state.sessionId;
      composer.querySelector('button[type="submit"]').disabled = Boolean(run);
    }
    if (cancel) cancel.hidden = !run;
    if (!transcript) return;
    const messages = state.session?.messages || [];
    const chat = window.OCResearchChat;
    const renderedRuns = new Set();
    const activity = (item, before) => { const matches = state.runs.slice().reverse().filter(candidate =>
      !renderedRuns.has(candidate.id) && (before
        ? candidate.assistantMessageId === item.id
        : !messages.some(m => m.id === candidate.assistantMessageId) && candidate.userMessageId === item.id)
    ); matches.forEach(candidate => renderedRuns.add(candidate.id)); return chat.renderRuns(matches, before ? item.content || '' : ''); };
    let html = messages.length ? messages.map(item => `
      ${activity(item, true)}
      <article class="oc-research-message oc-research-message-${item.role === 'user' ? 'user' : 'assistant'}">
        <div class="oc-research-message-meta"><strong>${item.role === 'user' ? 'You' : 'Research agent'}</strong><time>${date(item.createdAt)}</time></div>
        <div class="oc-research-message-content oc-chat-markdown">${chat.markdown(item.content || '')}</div>
        ${chat.renderReferences(item)}
        ${item.content ? `<button type="button" class="oc-memory-save-message" data-memory-message="${escapeHtml(item.id)}">Save to memory</button>` : ''}
      </article>${activity(item, false)}`).join('') : `<div class="oc-research-empty">
        <span class="oc-research-empty-icon" aria-hidden="true">✦</span>
        <h4>What would you like to work on?</h4>
        <p>Describe a task or attach a document to begin.</p>
      </div>`;
    const remaining = state.runs.slice().reverse().filter(candidate => !renderedRuns.has(candidate.id));
    html += chat.renderRuns(remaining.filter(candidate => !ACTIVE_RUNS.has(candidate.status)));
    html += remaining.filter(candidate => ACTIVE_RUNS.has(candidate.status)).map(candidate => chat.renderRun(candidate)).join('');
    if (state.sessionId) html += chat.renderSessionFiles();
    if (transcript._renderedHtml !== html) {
      const scrollTop = transcript.scrollTop;
      const follow = transcript.scrollHeight - transcript.clientHeight - scrollTop < 80;
      transcript.innerHTML = html;
      transcript._renderedHtml = html;
      transcript.scrollTop = follow ? transcript.scrollHeight : scrollTop;
    }
    renderPermissions();
    window.OCDesktopChatControls?.sync({session:state.session,sessionId:state.sessionId,projectId:state.projectId,run:activeRun(),runCount:state.runs.length});
    window.OCDesktopSlash?.sync({session:state.session,sessionId:state.sessionId,projectId:state.projectId,run:activeRun(),runCount:state.runs.length});
  }

  function renderPermissions(){
    const panel = element('[data-research-permissions]');
    if (!panel) return;
    const pending = state.permissions.filter(item => item.state === 'pending' &&
      !state.runs.some(run => run.id === item.executionId && !ACTIVE_RUNS.has(run.status)));
    panel.hidden = !pending.length;
    panel.innerHTML = pending.map(item => `
      <article class="oc-research-permission">
        <div><strong>Permission needed: ${escapeHtml(item.action)}</strong><p>${escapeHtml(item.summary || item.resource)}</p><small>${escapeHtml(item.resource)}</small></div>
        <div class="oc-research-permission-actions">
          <button type="button" data-research-permission="${escapeHtml(item.id)}" data-research-decision="allow_once">Allow once</button>
          <button type="button" data-research-permission="${escapeHtml(item.id)}" data-research-decision="deny">Deny</button><button type="button" data-research-permission="${escapeHtml(item.id)}" data-research-decision="allow_matching" title="Allow matching actions for this session">Allow similar in this session</button>
        </div>
      </article>`).join('');
  }

  function renderArtifacts(){
    const list = element('[data-research-artifacts]');
    if (!list) return;
    list.innerHTML = state.artifacts.length ? state.artifacts.map(artifact => `
      <button type="button" class="oc-research-artifact${artifact.id === state.selectedArtifact?.id ? ' is-active' : ''}"
        data-research-artifact="${escapeHtml(artifact.id)}">
        <span class="oc-research-artifact-kind">${escapeHtml(artifact.kind || 'file')}</span>
        <strong>${escapeHtml(artifact.title || artifact.name || artifact.logicalName || 'Artifact')}</strong>
        <small>Version ${escapeHtml(artifact.currentVersion || 1)} · ${date(artifact.updatedAt || artifact.createdAt)}</small>
      </button>`).join('') : '<div class="oc-research-empty"><h4>No artifacts yet</h4><p>Reports, datasets and figures produced by the agent will appear here.</p></div>';
  }

  function renderPapers(){
    const list = element('[data-research-papers]');
    if (!list) return;
    list.innerHTML = state.papers.length ? state.papers.map(paper => `
      <article class="oc-research-paper">
        <span>PDF SOURCE</span><strong>${escapeHtml(paper.title || paper.identifier || 'Paper')}</strong>
        <small>${date(paper.createdAt)} · ${Number(paper.extraction?.textCharacters || 0).toLocaleString()} extracted characters</small>
        ${paper.extraction?.warnings?.length ? `<p>${escapeHtml(paper.extraction.warnings.join(' · '))}</p>` : ''}
      </article>`).join('') : '<div class="oc-research-empty"><h4>No source papers yet</h4><p>Upload a PDF to make it available to the research agent.</p></div>';
  }

  function setView(view){
    state.view = view;
    state.root?.querySelectorAll('[data-research-view]').forEach(button => {
      const active = button.dataset.researchView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    state.root?.querySelectorAll('[data-research-panel]').forEach(panel => {
      panel.hidden = panel.dataset.researchPanel !== 'conversation' && panel.dataset.researchPanel !== view;
    });
    window.OCDesktopLayout?.showInspector(view === 'conversation' ? null : view);
    if (view === 'artifacts' && state.sessionId) void loadArtifacts();
    if (view === 'papers' && state.sessionId) void loadPapers();
    if (view === 'ideas' && state.sessionId) void loadIdeas();
  }

  function syncResearchTools(){
    void window.OCResearchLab?.syncSelection?.({
      projectId: state.projectId, sessionId: state.sessionId,
      projectName: state.projects.find(item => item.id === state.projectId)?.name || '',
      sessionTitle: state.sessions.find(item => item.id === state.sessionId)?.title || ''
    });
  }
  function showTools(show){
    if (window.OCDesktopLayout?.ready) { window.OCDesktopLayout.showInspector(show ? 'workspace' : null); return; }
    const panel = element('[data-research-tools-panel]');
    if (!panel) return;
    panel.hidden = !show;
    element('.oc-research-layout').classList.toggle('is-tools-collapsed', !show);
    const toggle = element('[data-research-tools-toggle]');
    toggle.setAttribute('aria-expanded', String(show));
    toggle.textContent = show ? 'Hide OC tools' : 'OC tools';
    if (show) syncResearchTools();
  }

  async function loadProjects(preferredProjectId, preferredSessionId){
    state.projects = await request('projects');
    const chosen = preferredProjectId || state.projectId;
    state.projectId = state.projects.some(project => project.id === chosen) ? chosen : (state.projects[0]?.id || '');
    renderProjects();
    if (state.projectId) await loadProject(state.projectId, preferredSessionId);
    else {
      stopPolling();
      state.sessions = [];
      state.sessionId = '';
      window.OCResearchChat.setSession('');
      state.session = null;
      state.runs = [];
      state.permissions = [];
      state.papers = [];
      state.artifacts = [];
      renderSessions();
      renderConversation();
      renderArtifacts();
      syncResearchTools();
    }
  }

  async function loadProject(projectId, preferredSessionId){
    const version = ++state.selectionVersion;
    stopPolling();
    state.projectId = projectId;
    state.sessionId = '';
    window.OCResearchChat.setSession('');
    state.session = null;
    state.runs = [];
    state.permissions = [];
    state.papers = [];
    renderProjects();
    renderConversation();
    syncResearchTools();
    const sessions = await request(`projects/${urlId(projectId)}/sessions`);
    if (version !== state.selectionVersion) return;
    state.sessions = sessions;
    renderSessions();
    const chosen = sessions.some(session => session.id === preferredSessionId) ? preferredSessionId : sessions[0]?.id;
    if (chosen) await loadSession(chosen);
  }

  async function loadSession(sessionId){
    const version = ++state.selectionVersion;
    stopPolling();
    state.sessionId = sessionId;
    window.OCResearchChat.setSession(sessionId);
    state.session = null;
    state.runs = [];
    state.permissions = [];
    state.papers = [];
    state.artifacts = [];
    state.selectedArtifact = null;
    renderSessions();
    renderConversation();
    syncResearchTools();
    const [session, runs, permissions] = await Promise.all([
      request(`sessions/${urlId(sessionId)}`),
      request(`sessions/${urlId(sessionId)}/runs`),
      request(`permission-requests?sessionId=${urlId(sessionId)}`)
    ]);
    if (version !== state.selectionVersion) return;
    state.session = session;
    state.runs = runs.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    state.permissions = permissions;
    renderConversation();
    if (state.view === 'artifacts') await loadArtifacts();
    if (state.view === 'papers') await loadPapers();
    if (state.view === 'ideas') await loadIdeas();
    if (activeRun()) startPolling();
    else stopPolling();
    await window.OCResearchChat.sync(sessionId, state.runs);
  }

  async function refreshSession(){
    if (!state.sessionId) return;
    const sessionId = state.sessionId;
    const [session, runs, permissions] = await Promise.all([
      request(`sessions/${urlId(sessionId)}`),
      request(`sessions/${urlId(sessionId)}/runs`),
      request(`permission-requests?sessionId=${urlId(sessionId)}`)
    ]);
    if (sessionId !== state.sessionId) return;
    state.session = session;
    state.runs = runs.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    state.permissions = permissions;
    renderConversation();
    await window.OCResearchChat.sync(sessionId, state.runs);
    if (sessionId !== state.sessionId) return;
    if (!activeRun()) {
      stopPolling();
      if (state.view === 'artifacts') void loadArtifacts();
      if (state.view === 'papers') void loadPapers();
      if (state.view === 'ideas') void loadIdeas();
    }
  }

  function startPolling(){
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(async () => {
      if (state.polling) return;
      state.polling = true;
      try { await refreshSession(); }
      catch (error) { message(error.message, true); stopPolling(); }
      finally { state.polling = false; }
    }, 1500);
  }
  function stopPolling(){
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function loadArtifacts(){
    const sessionId = state.sessionId;
    if (!sessionId) return;
    const artifacts = await request(`sessions/${urlId(sessionId)}/artifacts`);
    if (sessionId !== state.sessionId) return;
    state.artifacts = artifacts.filter(item => !item.deletedAt);
    renderArtifacts();
  }

  async function loadPapers(){
    const sessionId = state.sessionId;
    if (!sessionId) return;
    const papers = await request(`sessions/${urlId(sessionId)}/papers`);
    if (sessionId !== state.sessionId) return;
    state.papers = papers;
    renderPapers();
  }

  async function uploadPaper(form){
    if (!state.sessionId) return;
    const file = form.querySelector('input[type="file"]')?.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('Choose a PDF file.');
    }
    if (file.size > 30 * 1024 * 1024) throw new Error('PDF must be smaller than 30 MB.');
    message('Uploading and extracting PDF…');
    await request(`sessions/${urlId(state.sessionId)}/papers/upload?title=${encodeURIComponent(file.name)}`, {
      method: 'POST', rawBody: file, contentType: 'application/pdf'
    });
    form.reset();
    await loadPapers();
    await loadArtifacts();
    message('Paper uploaded and extracted.');
  }

  async function loadArtifact(artifactId){
    const artifact = state.artifacts.find(item => item.id === artifactId);
    if (!artifact || !state.sessionId) return;
    state.selectedArtifact = artifact;
    renderArtifacts();
    const preview = element('[data-research-artifact-preview]');
    preview.innerHTML = '<p class="text-muted small">Loading artifact…</p>';
    const sessionId = state.sessionId;
    const versions = await request(`sessions/${urlId(sessionId)}/artifacts/${urlId(artifactId)}/versions`);
    const version = versions.find(item => item.version === artifact.currentVersion) || versions[versions.length - 1];
    if (!version || sessionId !== state.sessionId || state.selectedArtifact?.id !== artifactId) return;
    const response = await request(`sessions/${urlId(sessionId)}/artifact-versions/${urlId(version.id)}/content`, { raw: true });
    const contentType = response.headers.get('content-type') || '';
    if (sessionId !== state.sessionId || state.selectedArtifact?.id !== artifactId) return;
    if (/^(text\/|application\/(json|xml|javascript))/.test(contentType)) {
      const body = await response.text();
      preview.innerHTML = `<div class="oc-research-preview-head"><strong>${escapeHtml(artifact.title || artifact.name)}</strong><span>${escapeHtml(contentType)}</span></div><pre>${escapeHtml(body.slice(0, 150000))}</pre>`;
    } else {
      preview.innerHTML = `<div class="oc-research-preview-head"><strong>${escapeHtml(artifact.title || artifact.name)}</strong><span>${escapeHtml(contentType || 'Binary file')}</span></div><p class="text-muted small">Preview is available for text artifacts. Download this file to inspect it.</p><button type="button" class="btn btn-outline-primary btn-sm" data-research-download="${escapeHtml(version.id)}">Download artifact</button>`;
    }
  }

  async function downloadArtifact(versionId){
    if (!state.sessionId) return;
    const response = await request(`sessions/${urlId(state.sessionId)}/artifact-versions/${urlId(versionId)}/content`, { raw: true });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.selectedArtifact?.name || 'research-artifact';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadIdeas(){
    const panel = element('[data-research-ideas]');
    if (!panel || !state.sessionId) return;
    const sessionId = state.sessionId;
    panel.innerHTML = '<p class="text-muted small">Loading ideas…</p>';
    const result = await request(`sessions/${urlId(sessionId)}/idea-tree/graph`);
    if (sessionId !== state.sessionId) return;
    const graph = result.graph || result;
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    panel.innerHTML = nodes.length ? `
      <div class="oc-research-idea-list"><p class="oc-research-idea-objective">${escapeHtml(graph.objective || '')}</p>${nodes.map(node => `
        <article class="oc-research-idea">
          <span>${escapeHtml(node.kind || 'idea')} · ${escapeHtml(node.status || node.searchStatus || 'new')}${Number.isFinite(node.score) ? ` · score ${escapeHtml(node.score)}` : ''}</span>
          <strong>${escapeHtml(node.hypothesis || node.id)}</strong>
          ${node.insight ? `<p>${escapeHtml(node.insight)}</p>` : ''}
        </article>`).join('')}</div>`
      : '<div class="oc-research-empty"><h4>No ideas yet</h4><p>Ask the agent to develop and compare research ideas in this session.</p></div>';
  }

  async function createProject(form){
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) return;
    const created = await request('projects', { method: 'POST', body: { name } });
    form.reset();
    form.hidden = true;
    await loadProjects(created.project?.id || created.id, created.firstSession?.id);
    message('Project created.');
  }

  async function createSession(form){
    if (!state.projectId) return;
    const title = String(new FormData(form).get('title') || '').trim();
    if (!title) return;
    const created = await request(`projects/${urlId(state.projectId)}/sessions`, { method: 'POST', body: { title } });
    form.reset();
    form.hidden = true;
    await loadProject(state.projectId, created.id);
    message('Session created.');
  }

  async function runResearch(form){
    if (window.OCDesktopSlash && !await window.OCDesktopSlash.beforeSubmit()) return;
    if (!state.sessionId || activeRun()) return;
    if (window.OCDesktopChatControls && !await window.OCDesktopChatControls.beforeRun()) return;
    const composer = form.querySelector('textarea[name="prompt"]');
    if (window.OCResearchChat.isUploading()) throw new Error('Wait for the file upload to finish before sending.');
    const prompt = composer?.value.trim() || '';
    const references = [...window.OCResearchChat.attachedReferences(), ...(window.OCDesktopSlash?.references() || [])];
    if (!prompt && !references.length) return;
    const sessionId = state.sessionId;
    const content = (prompt || "Analyze the attached image(s).") + window.OCResearchChat.attachedContent();
    await request(`sessions/${urlId(sessionId)}/runs`, { method: 'POST', body: { content, ...(references.length ? { references } : {}) } });
    window.OCResearchChat.clearAttachments(sessionId);
    window.OCDesktopSlash?.sent(sessionId);
    if (sessionId !== state.sessionId) return;
    composer.value = '';
    await refreshSession();
    startPolling();
    message('Research run started.');
  }

  function bindEvents(){
    state.root.addEventListener('click', async event => {
      const target = event.target.closest('button');
      if (!target) return;
      try {
        if (target.dataset.researchProject) await loadProject(target.dataset.researchProject);
        else if (target.dataset.researchSession) await loadSession(target.dataset.researchSession);
        else if (target.dataset.researchView) setView(target.dataset.researchView);
        else if (target.dataset.researchArtifact) await loadArtifact(target.dataset.researchArtifact);
        else if (target.dataset.researchPermission) {
          await request(`permission-requests/${urlId(target.dataset.researchPermission)}/decision`, {
            method: 'POST', body: { decision: target.dataset.researchDecision }
          });
          await refreshSession();
          message('Permission decision saved.');
        }
        else if (target.dataset.researchDownload) await downloadArtifact(target.dataset.researchDownload);
        else if (target.hasAttribute('data-research-new-project')) element('[data-research-create-project]').hidden = false;
        else if (target.hasAttribute('data-research-new-session')) element('[data-research-create-session]').hidden = false;
        else if (target.hasAttribute('data-research-cancel-form')) target.closest('form').hidden = true;
        else if (target.hasAttribute('data-research-refresh')) await loadProjects(state.projectId, state.sessionId);
        else if (target.hasAttribute('data-research-cancel-run')) {
          await request(`sessions/${urlId(state.sessionId)}/runs/current/cancel`, { method: 'POST', body: {} });
          await refreshSession();
          message('Run stopped.');
        }
      } catch (error) { message(error.message, true); }
    });
    state.root.addEventListener('submit', async event => {
      const form = event.target;
      if (!form.matches('[data-research-create-project], [data-research-create-session], [data-research-composer], [data-research-upload-paper]')) return;
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        if (form.matches('[data-research-create-project]')) await createProject(form);
        else if (form.matches('[data-research-create-session]')) await createSession(form);
        else if (form.matches('[data-research-upload-paper]')) await uploadPaper(form);
        else await runResearch(form);
      } catch (error) { message(error.message, true); }
      finally { if (button) button.disabled = form.matches('[data-research-composer]') && Boolean(activeRun()); }
    });
  }

  function mount(root){
    if (!root || state.root === root) return;
    state.root = root;
    root.innerHTML = `
      <header class="oc-research-header">
        <div><p class="oc-research-eyebrow">OPENCONSTRUCTION WORKSPACE</p><h2>Research</h2><p>Investigate questions, follow agent work, and review outputs in one place.</p></div>
        <div class="oc-research-header-actions"><button type="button" class="btn btn-outline-secondary btn-sm" data-research-tools-toggle aria-expanded="true" aria-controls="ocResearchToolsPanel">Hide OC tools</button><button type="button" class="btn btn-outline-secondary btn-sm" data-research-refresh>Refresh</button></div>
      </header>
      <p data-research-message class="oc-research-notice" role="status" aria-live="polite" hidden></p>
      <div class="oc-research-layout oc-research-with-tools">
        <aside class="oc-research-rail">
          <div class="oc-research-rail-head"><h3>Projects</h3><button type="button" data-research-new-project aria-label="New project" title="New project">+</button></div>
          <form data-research-create-project class="oc-research-inline-form" hidden>
            <label for="ocResearchProjectName">Project name</label><input id="ocResearchProjectName" name="name" maxlength="120" required placeholder="e.g. Concrete carbon study">
            <div><button type="submit">Create</button><button type="button" data-research-cancel-form>Cancel</button></div>
          </form>
          <div data-research-projects class="oc-research-list"></div>
          <div class="oc-research-rail-head oc-research-sessions-head"><h3>Sessions</h3><button type="button" data-research-new-session aria-label="New session" title="New session">+</button></div>
          <form data-research-create-session class="oc-research-inline-form" hidden>
            <label for="ocResearchSessionTitle">Session title</label><input id="ocResearchSessionTitle" name="title" maxlength="80" required placeholder="Research question">
            <div><button type="submit">Create</button><button type="button" data-research-cancel-form>Cancel</button></div>
          </form>
          <div data-research-sessions class="oc-research-list"></div>
        </aside>
        <section class="oc-research-stage">
          <div class="oc-research-stage-head"><div><h3 data-research-session-title>Select a project</h3><p data-research-session-subtitle>Create a project and session to start researching.</p></div></div>
          <div class="oc-research-tabs" role="tablist" aria-label="Research views">
            <button type="button" data-research-view="conversation" class="is-active" role="tab" aria-selected="true">Conversation</button>
            <button type="button" data-research-view="artifacts" role="tab" aria-selected="false">Artifacts</button>
            <button type="button" data-research-view="papers" role="tab" aria-selected="false">Papers</button>
            <button type="button" data-research-view="ideas" role="tab" aria-selected="false">Ideas</button>
          </div>
          <section data-research-panel="conversation" class="oc-research-panel">
            <div data-research-transcript class="oc-research-transcript"></div>
            <div data-research-permissions class="oc-research-permissions" hidden></div>
            <form data-research-composer class="oc-research-composer" hidden>
              <label for="ocResearchPrompt">Ask the research agent</label>
              <textarea id="ocResearchPrompt" name="prompt" rows="4" placeholder="Describe the research question or task…" required></textarea>
              <div data-chat-attachments class="oc-chat-attachments" aria-live="polite"></div>
              <input type="file" data-chat-upload multiple hidden aria-label="Attach files to this session">
              <div><button type="button" data-chat-browse class="btn btn-outline-secondary btn-sm">Attach files</button><small class="oc-chat-upload-hint">Up to 30 MiB per upload</small><button type="button" data-research-cancel-run class="btn btn-outline-secondary btn-sm" hidden>Stop run</button><button type="submit" class="btn btn-primary btn-sm">Run research</button></div>
            </form>
          </section>
          <section data-research-panel="artifacts" class="oc-research-panel" hidden>
            <div class="oc-research-artifact-layout"><div data-research-artifacts class="oc-research-artifact-list"></div><div data-research-artifact-preview class="oc-research-artifact-preview"><p class="text-muted small">Select an artifact to preview.</p></div></div>
          </section>
          <section data-research-panel="papers" class="oc-research-panel" hidden>
            <form data-research-upload-paper class="oc-research-upload-form">
              <div><strong>Add a source paper</strong><p>Save a PDF to this project. Its extracted text is available across the project's sessions.</p></div>
              <input type="file" accept="application/pdf,.pdf" aria-label="PDF paper" required>
              <button type="submit" class="btn btn-primary btn-sm">Upload PDF</button>
            </form>
            <div data-research-papers class="oc-research-paper-list"></div>
          </section>
          <section data-research-panel="ideas" data-research-ideas class="oc-research-panel" hidden></section>
        </section>
        <aside id="ocResearchToolsPanel" data-research-tools-panel class="oc-research-tools-panel" aria-label="OC tools for the current chat">
          <div class="oc-research-tools-heading"><h3>OC tools</h3><button type="button" data-research-tools-close aria-label="Close OC tools">×</button></div>
          <div id="ocResearchLabRoot" class="oc-research-lab"></div>
        </aside>
      </div>`;
    window.OCResearchChat.mount(root, { render: renderConversation, notice: message });
    window.OCResearchLab?.mount?.(element('#ocResearchLabRoot'));
    element('[data-research-tools-toggle]').addEventListener('click', () => showTools(!window.OCDesktopLayout.isInspectorOpen()));
    element('[data-research-tools-close]').addEventListener('click', () => { showTools(false); element('[data-research-tools-toggle]').focus(); });
    if (window.matchMedia('(max-width: 899.98px)').matches) showTools(false);
    element('[data-research-tools-panel]').addEventListener('keydown', event => { if (event.key === 'Escape') { showTools(false); element('[data-research-tools-toggle]').focus(); } });
    bindEvents();
    renderProjects();
    renderSessions();
    renderConversation();
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-memory-message]');
    if (!button || !window.OCResearchMemory || !state.projectId || !state.sessionId) return;
    button.disabled = true;
    try { const saved = await window.OCResearchMemory.saveMessage(state.projectId, state.sessionId, button.dataset.memoryMessage); message(saved.status === 'proposed' ? 'Saved as a proposal. Confirm it in Project memory to include it in context.' : 'Saved to Project memory.'); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });

  async function activate(){
    if (!state.root || state.loading) return;
    state.loading = true;
    message('Loading research workspace…');
    try {
      await loadProjects(state.projectId || window.OCDesktopLayout?.selection()?.projectId, state.sessionId || window.OCDesktopLayout?.selection()?.sessionId);
      state.started = true;
      message('');
    } catch (error) { message(error.message, true); }
    finally { state.loading = false; }
  }

  window.OCResearchWorkspace = {
    mount,
    activate,
    showTools,
    openSession: async (projectId, sessionId) => { await loadProjects(projectId, sessionId); },
    refreshSession,
    getSelection: () => ({ projectId: state.projectId, sessionId: state.sessionId })
  };
})();
