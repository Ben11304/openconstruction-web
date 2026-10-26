// OC research settings. Copyright (c) 2024-2026 OpenConstruction Open Science Initiative
// SPDX-License-Identifier: Apache-2.0

(() => {
  const API_ROOT = '/api/research';
  const state = {
    root: null, workspace: null, view: 'workspace', loaded: false, busy: false,
    projects: [], sessions: [], models: [], connectors: [], skills: [], specialists: [], mcpServers: [],
    projectId: '', sessionId: '', scope: 'session', details: null, session: null,
    editModelId: '', editSpecialistId: '', notice: '', noticeError: false, version: 0
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const id = value => encodeURIComponent(String(value || ''));

  async function request(path, options = {}){
    const response = await fetch(`${API_ROOT}/${path}`, {
      method: options.method || 'GET',
      headers: { 'X-OC-Workspace': 'research', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || payload.error || `Research service returned ${response.status}`);
    }
    return response.json();
  }

  function notify(value, isError = false){
    state.notice = value;
    state.noticeError = isError;
    const box = state.root?.querySelector('[data-research-settings-notice]');
    if (box) {
      box.textContent = value;
      box.hidden = !value;
      box.classList.toggle('is-error', isError);
    }
  }
  function modelName(model){ return model?.name || model?.model || model?.id || 'Unknown model'; }
  function modelOptions(selected, includeInherited = false, effectiveId = ''){
    const inherited = includeInherited ? `<option value="">Inherit (${escapeHtml(modelName(state.models.find(item => item.id === effectiveId)))})</option>` : '<option value="">No default model</option>';
    return inherited + state.models.map(model => `<option value="${escapeHtml(model.id)}"${model.id === selected ? ' selected' : ''}>${escapeHtml(modelName(model))}${model.hasApiToken ? '' : ' · needs API key'}</option>`).join('');
  }
  function selected(value, expected){ return value === expected ? ' selected' : ''; }
  function checked(value){ return value ? ' checked' : ''; }
  function scopePath(){
    if (state.scope === 'global') return 'settings';
    if (state.scope === 'project' && state.projectId) return `projects/${id(state.projectId)}/settings`;
    if (state.scope === 'session' && state.sessionId) return `sessions/${id(state.sessionId)}/settings`;
    return '';
  }

  async function loadCatalog(){
    const [projects, models, connectors, skills, specialists] = await Promise.all([
      request('projects'), request('models'), request('connectors'), request('skills'), request('specialists')
    ]);
    state.projects = projects;
    state.models = models;
    state.connectors = connectors;
    state.skills = skills;
    state.specialists = specialists;
    const selection = window.OCResearchWorkspace?.getSelection?.() || {};
    const preferred = selection.projectId || state.projectId;
    state.projectId = projects.some(project => project.id === preferred) ? preferred : projects[0]?.id || '';
    if (state.projectId) await loadSessions(selection.sessionId || state.sessionId);
    else { state.sessions = []; state.sessionId = ''; }
    state.loaded = true;
  }
  async function loadSessions(preferredSessionId){
    state.sessions = state.projectId ? await request(`projects/${id(state.projectId)}/sessions?state=active`) : [];
    state.sessionId = state.sessions.some(session => session.id === preferredSessionId) ? preferredSessionId : state.sessions[0]?.id || '';
  }
  async function loadScope(){
    const version = ++state.version;
    const path = scopePath();
    const [details, session] = await Promise.all([
      path ? request(path) : Promise.resolve(null),
      state.sessionId ? request(`sessions/${id(state.sessionId)}`) : Promise.resolve(null)
    ]);
    if (version !== state.version) return;
    state.details = details;
    state.session = session;
  }

  function selectorCard(){
    return `<div class="oc-research-config-selectors">
      <label>Settings scope<select name="researchScope">
        <option value="global"${selected(state.scope, 'global')}>Global default</option>
        <option value="project"${selected(state.scope, 'project')}>Project</option>
        <option value="session"${selected(state.scope, 'session')}>Session</option>
      </select></label>
      <label>Project<select name="researchProject"${state.projects.length ? '' : ' disabled'}>
        ${state.projects.length ? state.projects.map(project => `<option value="${escapeHtml(project.id)}"${selected(state.projectId, project.id)}>${escapeHtml(project.name)}</option>`).join('') : '<option>No projects yet</option>'}
      </select></label>
      <label>Session<select name="researchSession"${state.sessions.length ? '' : ' disabled'}>
        ${state.sessions.length ? state.sessions.map(session => `<option value="${escapeHtml(session.id)}"${selected(state.sessionId, session.id)}>${escapeHtml(session.title || 'Untitled session')}</option>`).join('') : '<option>No sessions yet</option>'}
      </select></label>
    </div>`;
  }
  function checkboxList(items, selectedIds, name, label){
    return `<div class="oc-research-check-grid" aria-label="${escapeHtml(label)}">${items.map(item => {
      const itemId = item.id;
      const title = item.displayName || item.name || itemId;
      return `<label class="oc-research-check"><input type="checkbox" name="${name}" value="${escapeHtml(itemId)}"${checked(selectedIds.includes(itemId))}><span><strong>${escapeHtml(title)}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}</span></label>`;
    }).join('')}</div>`;
  }
  function connectorList(items, selectedIds, name='connectorId'){
    const descriptions={
      arxiv:'Search scientific preprints and prepare paper PDFs through the governed download workflow.',
      crossref:'Search publication metadata and look up DOIs. Metadata only, not full text.',
      'semantic-scholar':'Search papers, abstracts, citation counts and open-access links. Public access may be rate-limited.',
      pubmed:'Search biomedical literature metadata and abstracts.',
      'europe-pmc':'Search biomedical literature and open-access records.',
      biorxiv:'Search biology preprints; these are not peer reviewed.',
      medrxiv:'Search medical preprints; these are not peer reviewed.',
      github:'Search public repositories and read metadata or READMEs. No push, clone or code execution.',
      huggingface:'Search public models, datasets and Spaces; read card metadata and file names. No weight downloads or inference.',
    };
    const groups=[['Papers',['openconstruction','arxiv','crossref','semantic-scholar','pubmed','europe-pmc','biorxiv','medrxiv']],['Code, models & datasets',['github','huggingface']],['Other sources',null]];
    const known=new Set(groups.flatMap(([,ids])=>ids||[]));
    return '<p class="oc-research-config-help">New connectors are off by default. Select sources and save to make them available on the next run. Project and session settings can inherit the selection above them. GitHub, Hugging Face, Crossref and Semantic Scholar use public access only, without connected-account credentials.</p>'+groups.map(([label,ids])=>{
      const rows=items.filter(item=>ids?ids.includes(item.id):!known.has(item.id)).map(item=>({...item,description:descriptions[item.id]||item.description}));
      if(ids)rows.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
      return rows.length?`<section class="oc-connector-group"><h5>${escapeHtml(label)}</h5>${checkboxList(rows,selectedIds,name,label)}</section>`:'';
    }).join('');
  }
  window.OCResearchConnectorPresentation={render:connectorList};
  function renderAgent(){
    const details = state.details;
    const overrides = details?.overrides || {};
    const effective = details?.effective || {};
    const inherited = state.scope !== 'global';
    const overrideConnectors = !inherited || Object.hasOwn(overrides, 'enabledConnectorIds');
    const skillMode = overrides.skillSelectionMode || (state.scope === 'project' ? 'all' : 'inherit');
    return `<header class="oc-research-config-head"><div><h2>Agent &amp; tools</h2><p>Configure the model and tools used when a research run starts.</p></div><button type="button" class="btn btn-outline-secondary btn-sm" data-research-config-refresh>Refresh</button></header>
      ${selectorCard()}
      ${!details ? '<div class="oc-research-config-card"><p>Create a project and session in Research to configure this scope.</p></div>' : `
      <form data-research-runtime-form class="oc-research-config-card">
        <h3>Runtime settings</h3>
        <p class="oc-research-config-help">Changes apply to new runs. Existing project and session overrides take priority over global defaults.</p>
        <div class="oc-research-config-fields">
          <label>Task model<select name="modelId">${modelOptions(overrides.modelId || '', inherited, effective.modelId)}</select><small>Effective: ${escapeHtml(modelName(state.models.find(item => item.id === effective.modelId)))}</small></label>
          <label>Thinking mode<select name="thinkingMode"><option value="">${inherited ? 'Inherit' : 'Model default'}</option>${['auto','enabled','disabled'].map(value => `<option value="${value}"${selected(overrides.thinkingMode, value)}>${value}</option>`).join('')}</select></label>
          <label>Thinking effort<select name="thinkingEffort"><option value="">${inherited ? 'Inherit' : 'Model default'}</option>${['low','medium','high','xhigh','max'].map(value => `<option value="${value}"${selected(overrides.thinkingEffort, value)}>${value}</option>`).join('')}</select></label>
        </div>
        <div class="oc-research-config-group"><div class="oc-research-config-group-head"><h4>Research connectors</h4><label><input type="checkbox" name="overrideConnectors"${checked(overrideConnectors)}${inherited ? '' : ' disabled'}> Customize selection</label></div>
          ${connectorList(state.connectors, overrides.enabledConnectorIds || effective.enabledConnectorIds || [])}</div>
<p class="oc-research-config-help">Manage project skills through <a href="/openconstruction-web/desktop/skills.html">Catalog → Skills</a>. The project panel shows usage in the current session.</p>
        <button type="submit" class="btn btn-primary btn-sm">Save runtime settings</button>
      </form>`}
      ${state.session ? `<form data-research-session-agent-form class="oc-research-config-card">
        <h3>Session agent</h3><p class="oc-research-config-help">Choose the specialist and permission behavior for this session.</p>
        <div class="oc-research-config-fields">
          <label>Specialist<select name="specialistId"><option value="">Coordinator</option>${state.specialists.filter(item => item.enabled !== false).map(item => `<option value="${escapeHtml(item.id)}"${selected(state.session.specialistId, item.id)}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
          <label>Tool approval<select name="approvalMode"><option value="ask_for_dangerous"${selected(state.session.approvalMode, 'ask_for_dangerous')}>Ask for dangerous actions</option><option value="always_allow"${selected(state.session.approvalMode, 'always_allow')}>Always allow</option></select></label>
        </div><button type="submit" class="btn btn-primary btn-sm">Save session agent</button>
      </form>` : ''}
      ${renderSpecialists()}`;
  }

  function renderSpecialists(){
    const editing = state.specialists.find(item => item.id === state.editSpecialistId && !item.builtIn);
    return `<section class="oc-research-config-card"><h3>Specialists</h3><p class="oc-research-config-help">Specialists give the agent focused instructions and a set of connectors and skills.</p>
      <div class="oc-research-model-list">${state.specialists.map(item => `<article class="oc-research-model-card"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || (item.builtIn ? 'Built-in specialist' : 'Custom specialist'))}</small></div><div class="oc-research-card-actions">${item.builtIn ? `<button type="button" class="btn btn-outline-secondary btn-sm" data-research-toggle-specialist="${escapeHtml(item.id)}">${item.enabled === false ? 'Enable' : 'Disable'}</button>` : `<button type="button" class="btn btn-outline-secondary btn-sm" data-research-edit-specialist="${escapeHtml(item.id)}">Edit</button>`}</div></article>`).join('')}</div>
      <details class="oc-research-config-details"${editing ? ' open' : ''}><summary>${editing ? `Edit ${escapeHtml(editing.name)}` : 'Add a specialist'}</summary>
        <form data-research-specialist-form class="oc-research-config-form"><input type="hidden" name="specialistId" value="${escapeHtml(editing?.id || '')}">
          <div class="oc-research-config-fields"><label>Name<input name="name" value="${escapeHtml(editing?.name || '')}" required maxlength="100"></label><label>Description<input name="description" value="${escapeHtml(editing?.description || '')}" maxlength="300"></label></div>
          <label>Instructions<textarea name="instructions" rows="5" required>${escapeHtml(editing?.instructions || '')}</textarea></label>
          <h4>Available connectors</h4>${checkboxList(state.connectors, editing?.connectorIds || [], 'specialistConnectorId', 'Specialist connectors')}
          <h4>Available skills</h4>${checkboxList(state.skills, editing?.enabledSkillIds || [], 'specialistSkillId', 'Specialist skills')}
          <div class="oc-research-card-actions"><button type="submit" class="btn btn-primary btn-sm">${editing ? 'Save specialist' : 'Create specialist'}</button>${editing ? '<button type="button" class="btn btn-outline-secondary btn-sm" data-research-cancel-specialist>Cancel edit</button>' : ''}</div>
        </form></details></section>`;
  }

  function renderModels(){
    const editing = state.models.find(item => item.id === state.editModelId);
    const protocol = editing?.apiProtocol || 'openai-chat-completions';
    return `<header class="oc-research-config-head"><div><h2>Model registry</h2><p>Choose a ready model in Agent &amp; tools. Test a connection before running research.</p></div><button type="button" class="btn btn-outline-secondary btn-sm" data-research-config-refresh>Refresh</button></header>
      <div class="oc-research-model-list">${state.models.map(item => `<article class="oc-research-model-card"><div><strong>${escapeHtml(modelName(item))}</strong><small>${escapeHtml(item.model)} · ${escapeHtml(item.apiProtocol || 'openai-chat-completions')} · ${item.hasApiToken ? 'Credential saved' : 'Needs API key'}</small><small>${escapeHtml(item.baseUrl)}</small></div><div class="oc-research-card-actions"><button type="button" class="btn btn-outline-primary btn-sm" data-research-test-model="${escapeHtml(item.id)}">Test</button><button type="button" class="btn btn-outline-secondary btn-sm" data-research-edit-model="${escapeHtml(item.id)}">Edit</button></div></article>`).join('')}</div>
      <form data-research-model-form class="oc-research-config-card"><h3>${editing ? 'Edit model profile' : 'Add model profile'}</h3><p class="oc-research-config-help">Add a model using your own API key. Your credential is stored by OcWorkspace on this computer.</p>
        <input type="hidden" name="modelId" value="${escapeHtml(editing?.id || '')}">
        <div class="oc-research-config-fields"><label>Profile name<input name="name" required value="${escapeHtml(editing?.name || '')}"></label><label>Model ID<input name="model" required value="${escapeHtml(editing?.model || '')}"></label><label>Base URL<input name="baseUrl" type="url" required value="${escapeHtml(editing?.baseUrl || '')}" placeholder="https://api.example.com/v1"${editing?.providerId ? ' disabled' : ''}>${editing?.providerId ? '<small>Managed by its provider.</small>' : ''}</label>
          <label>API protocol<select name="apiProtocol"${editing?.providerId ? ' disabled' : ''}><option value="openai-chat-completions"${selected(protocol, 'openai-chat-completions')}>OpenAI Chat Completions</option><option value="openai-responses"${selected(protocol, 'openai-responses')}>OpenAI Responses</option><option value="anthropic-messages"${selected(protocol, 'anthropic-messages')}>Anthropic Messages</option></select></label>
          <label>API token<input name="apiToken" type="password" autocomplete="new-password" placeholder="${editing?.hasApiToken ? 'Leave blank to keep saved token' : 'Optional if provider supplies one'}"></label>
          <label>Default thinking mode<select name="thinkingMode"><option value="auto"${selected(editing?.thinkingMode || 'auto', 'auto')}>Auto</option><option value="enabled"${selected(editing?.thinkingMode, 'enabled')}>Enabled</option><option value="disabled"${selected(editing?.thinkingMode, 'disabled')}>Disabled</option></select></label>
          <label>Default thinking effort<select name="thinkingEffort">${['low','medium','high','xhigh','max'].map(value => `<option value="${value}"${selected(editing?.thinkingEffort || 'high', value)}>${value}</option>`).join('')}</select></label>
          <label class="oc-research-inline-check"><input type="checkbox" name="useAsDefault"${checked(!editing)}> Use for new research sessions</label><label class="oc-research-inline-check"><input type="checkbox" name="vision"${checked(editing?.vision)}> Vision input</label></div>
        <div class="oc-research-card-actions"><button type="submit" class="btn btn-primary btn-sm">${editing ? 'Save model' : 'Add model'}</button>${editing ? '<button type="button" class="btn btn-outline-secondary btn-sm" data-research-cancel-model>Cancel edit</button>' : ''}</div>
      </form>`;
  }

  function renderMcp(){
    return `<header class="oc-research-config-head"><div><h2>MCP servers</h2><p>Connect external tools to the research agent.</p></div><button type="button" class="btn btn-outline-secondary btn-sm" data-research-config-refresh>Refresh</button></header>
      <div class="oc-research-model-list">${state.mcpServers.length ? state.mcpServers.map(item => `<article class="oc-research-model-card"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.transport)} · ${escapeHtml(item.status || 'untested')} · ${item.tools?.length || 0} tools</small>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}${item.error ? `<small class="oc-research-error-text">${escapeHtml(item.error)}</small>` : ''}${item.tools?.length ? `<details><summary>Available tools</summary><div class="oc-research-tool-list">${item.tools.map(tool => `<span>${escapeHtml(tool.name)}</span>`).join('')}</div></details>` : ''}</div><div class="oc-research-card-actions"><button type="button" class="btn btn-outline-primary btn-sm" data-research-test-mcp="${escapeHtml(item.id)}">Test</button><button type="button" class="btn btn-outline-secondary btn-sm" data-research-toggle-mcp="${escapeHtml(item.id)}">${item.enabled ? 'Disable' : 'Enable'}</button></div></article>`).join('') : '<div class="oc-research-config-card"><p>No MCP servers configured yet.</p></div>'}</div>
      <form data-research-mcp-form class="oc-research-config-card"><h3>Add MCP server</h3><p class="oc-research-config-help">HTTP and SSE servers use a URL. Local stdio servers use a command and arguments. Secrets entered here are stored by OcWorkspace.</p>
        <div class="oc-research-config-fields"><label>Name<input name="name" required></label><label>Description<input name="description"></label><label>Transport<select name="transport"><option value="http">HTTP</option><option value="sse">SSE</option><option value="stdio">stdio</option></select></label><label>URL<input name="url" type="url" placeholder="https://example.com/mcp"></label><label>Command<input name="command" placeholder="npx"></label><label>Arguments, one per line<textarea name="args" rows="3"></textarea></label><label>Working directory<input name="cwd" placeholder="Optional"></label><label>Timeout (seconds)<input name="timeoutSeconds" type="number" min="1" max="600" value="30"></label></div>
        <div class="oc-research-config-fields"><label>Environment variables (JSON object)<textarea name="env" rows="3" placeholder='{"KEY":"value"}'></textarea></label><label>Headers (JSON object)<textarea name="headers" rows="3" placeholder='{"Authorization":"Bearer ..."}'></textarea></label></div>
        <button type="submit" class="btn btn-primary btn-sm">Add MCP server</button>
      </form>`;
  }

  function render(){
    if (!state.root || state.view === 'workspace') return;
    state.root.innerHTML = `<p data-research-settings-notice class="oc-research-notice${state.noticeError ? ' is-error' : ''}" role="status"${state.notice ? '' : ' hidden'}>${escapeHtml(state.notice)}</p>${state.view === 'agent' ? renderAgent() : state.view === 'models' ? renderModels() : renderMcp()}`;
    syncConditionalInputs();
    window.OCDesktopLayout?.organizeSettings(state.view);
  }
  function syncConditionalInputs(){
    const form = state.root?.querySelector('[data-research-runtime-form]');
    if (!form) return;
    const connectorEnabled = form.elements.overrideConnectors?.checked ?? true;
    form.querySelectorAll('[name="connectorId"]').forEach(input => { input.disabled = !connectorEnabled; });
    const skillEnabled = form.elements.skillMode?.value === 'selected';
    form.querySelectorAll('[name="skillId"]').forEach(input => { input.disabled = !skillEnabled; });
  }
  function values(form, name){ return Array.from(form.querySelectorAll(`[name="${name}"]:checked`)).map(input => input.value); }
  function jsonMap(value, label){
    if (!value.trim()) return {};
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error(`${label} must be valid JSON.`); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(item => typeof item !== 'string')) throw new Error(`${label} must be an object of string values.`);
    return parsed;
  }
  async function saveRuntime(form){
    const details = state.details;
    const path = scopePath();
    if (!details || !path) return;
    const data = new FormData(form);
    const next = structuredClone(details.overrides || {});
    for (const field of ['modelId', 'thinkingMode', 'thinkingEffort']) {
      const value = String(data.get(field) || '');
      if (value) next[field] = value;
      else delete next[field];
    }
    if (state.scope === 'global' || data.has('overrideConnectors')) next.enabledConnectorIds = values(form, 'connectorId');
    else delete next.enabledConnectorIds;
    if (state.scope !== 'global' && data.has('skillMode')) {
      const mode = String(data.get('skillMode') || 'inherit');
      if (mode === 'inherit') { delete next.skillSelectionMode; delete next.enabledSkillIds; }
      else if (mode === 'all') { next.skillSelectionMode = 'all'; delete next.enabledSkillIds; }
      else { next.skillSelectionMode = 'selected'; next.enabledSkillIds = values(form, 'skillId'); }
    }
    await request(path, { method: 'PUT', body: next });
    await loadScope();
    render();
    notify('Runtime settings saved. New runs will use these settings.');
  }
  async function saveSessionAgent(form){
    if (!state.sessionId) return;
    const data = new FormData(form);
    const specialistId = data.get('specialistId') || null;
    const approvalMode = data.get('approvalMode');
    if ((state.session?.specialistId || null) !== specialistId) {
      await request(`sessions/${id(state.sessionId)}`, { method: 'PATCH', body: { specialistId } });
    }
    if (state.session?.approvalMode !== approvalMode) {
      await request(`sessions/${id(state.sessionId)}`, { method: 'PATCH', body: { approvalMode } });
    }
    await loadScope();
    render();
    notify('Session agent saved.');
  }
  async function saveSpecialist(form){
    const data = new FormData(form);
    const specialistId = String(data.get('specialistId') || '');
    const body = {
      name: String(data.get('name') || '').trim(),
      description: String(data.get('description') || '').trim(),
      instructions: String(data.get('instructions') || '').trim(),
      connectorIds: values(form, 'specialistConnectorId'),
      enabledSkillIds: values(form, 'specialistSkillId')
    };
    if (!body.name || !body.instructions) throw new Error('Name and instructions are required.');
    await request(specialistId ? `specialists/${id(specialistId)}` : 'specialists', { method: specialistId ? 'PUT' : 'POST', body });
    state.specialists = await request('specialists');
    state.editSpecialistId = '';
    render();
    notify('Specialist saved.');
  }
  async function saveModel(form){
    const data = new FormData(form);
    const modelId = String(data.get('modelId') || '');
    const previous = state.models.find(item => item.id === modelId);
    const apiProtocol = String(data.get('apiProtocol') || previous?.apiProtocol || 'openai-chat-completions');
    const body = {
      name: String(data.get('name') || '').trim(), model: String(data.get('model') || '').trim(),
      baseUrl: String(data.get('baseUrl') || previous?.baseUrl || '').trim(), apiProtocol,
      apiVariant: previous?.apiProtocol === apiProtocol ? previous.apiVariant : apiProtocol === 'openai-responses' ? 'responses' : apiProtocol === 'anthropic-messages' ? 'anthropic-adaptive' : 'openai',
      thinkingMode: data.get('thinkingMode'), thinkingEffort: data.get('thinkingEffort'),
      vision: data.has('vision'), ...(previous?.proxyPolicy ? { proxyPolicy: previous.proxyPolicy } : {}),
      ...(previous?.facts ? { facts: previous.facts } : {})
    };
    const token = String(data.get('apiToken') || '').trim();
    if (token) body.apiToken = token;
    if (!body.name || !body.model || !body.baseUrl) throw new Error('Name, model ID and base URL are required.');
    const url = new URL(body.baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','::1'].includes(url.hostname))) throw new Error('Use HTTPS or a local HTTP endpoint.');
    const savedModel = await request(modelId ? `models/${id(modelId)}` : 'models', { method: modelId ? 'PUT' : 'POST', body });
    if (data.has('useAsDefault')) {
      const defaults = await request('settings');
      await request('settings', { method:'PUT', body:{ ...(defaults.overrides || {}), modelId:savedModel.id } });
    }
    state.models = await request('models');
    state.editModelId = '';
    render();
    notify('Model profile saved.');
  }
  async function saveMcp(form){
    const data = new FormData(form);
    const transport = String(data.get('transport') || 'http');
    const url = String(data.get('url') || '').trim();
    const command = String(data.get('command') || '').trim();
    if (transport === 'stdio' ? !command : !url) throw new Error(transport === 'stdio' ? 'Enter a command.' : 'Enter a server URL.');
    const body = {
      name: String(data.get('name') || '').trim(), description: String(data.get('description') || '').trim(),
      transport, enabled: true, url: transport === 'stdio' ? '' : url,
      command: transport === 'stdio' ? command : '',
      args: transport === 'stdio' ? String(data.get('args') || '').split('\n').map(item => item.trim()).filter(Boolean) : [],
      cwd: String(data.get('cwd') || '').trim(), timeoutSeconds: Number(data.get('timeoutSeconds')) || 30,
      authMode: 'headers', env: jsonMap(String(data.get('env') || ''), 'Environment variables'),
      headers: jsonMap(String(data.get('headers') || ''), 'Headers')
    };
    await request('mcp/servers', { method: 'POST', body });
    state.mcpServers = await request('mcp/servers');
    render();
    notify('MCP server added. Test it before using its tools.');
  }
  function mcpInput(server){
    return {
      name: server.name, description: server.description, transport: server.transport,
      enabled: !server.enabled, command: server.command, args: server.args, cwd: server.cwd,
      url: server.url, env: server.env || {}, headers: server.headers || {},
      timeoutSeconds: server.timeoutSeconds, authMode: server.authMode || 'headers',
      ...(server.oauth ? { oauth: server.oauth } : {})
    };
  }

  async function activate(view){
    if (view === 'lab') { await activate('workspace'); window.OCResearchWorkspace?.showTools?.(true); return; }
    state.view = view;
    document.querySelectorAll('[data-research-page]').forEach(button => {
      const active = button.dataset.researchPage === view;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    state.workspace.hidden = view !== 'workspace';
    state.root.hidden = view === 'workspace' || view === 'memory';
    document.getElementById('ocResearchMemoryRoot').hidden = view !== 'memory';
    if (view === 'memory') { await window.OCResearchMemory.activate(); return; }
    if (view === 'workspace') { await window.OCResearchWorkspace?.activate?.(); return; }
    state.root.innerHTML = '<p class="text-muted" role="status">Loading settings…</p>';
    try {
      if (!state.loaded) await loadCatalog();
      if (view === 'agent') await loadScope();
      if (view === 'mcp') state.mcpServers = await request('mcp/servers');
      render();
    } catch (error) { state.root.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`; }
  }
  function mount(root, workspace){
    if (!root || !workspace || state.root) return;
    state.root = root;
    state.workspace = workspace;
    document.querySelectorAll('[data-research-page]').forEach(button => button.addEventListener('click', () => { void activate(button.dataset.researchPage); }));
    root.addEventListener('change', async event => {
      const target = event.target;
      try {
        if (target.name === 'researchScope') state.scope = target.value;
        else if (target.name === 'researchProject') {
          state.projectId = target.value;
          await loadSessions('');
        } else if (target.name === 'researchSession') state.sessionId = target.value;
        else if (target.name === 'overrideConnectors' || target.name === 'skillMode') { syncConditionalInputs(); return; }
        else return;
        await loadScope();
        render();
      } catch (error) { notify(error.message, true); }
    });
    root.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || state.busy) return;
      try {
        state.busy = true;
        if (button.hasAttribute('data-research-config-refresh')) {
          await loadCatalog();
          if (state.view === 'agent') await loadScope();
          if (state.view === 'mcp') state.mcpServers = await request('mcp/servers');
          render(); notify('Settings refreshed.');
        } else if (button.dataset.researchTestModel) {
          notify('Testing model connection…');
          const result = await request(`models/${id(button.dataset.researchTestModel)}/test`, { method: 'POST' });
          notify(`${result.ok ? 'Connection ready' : 'Connection failed'}: ${result.message || result.category} (${Math.round(result.latencyMs || 0)} ms)`, !result.ok);
        } else if (button.dataset.researchEditModel) { state.editModelId = button.dataset.researchEditModel; render(); }
        else if (button.hasAttribute('data-research-cancel-model')) { state.editModelId = ''; render(); }
        else if (button.dataset.researchEditSpecialist) { state.editSpecialistId = button.dataset.researchEditSpecialist; render(); }
        else if (button.hasAttribute('data-research-cancel-specialist')) { state.editSpecialistId = ''; render(); }
        else if (button.dataset.researchToggleSpecialist) {
          const specialist = state.specialists.find(item => item.id === button.dataset.researchToggleSpecialist);
          if (!specialist) return;
          await request(`specialists/${id(specialist.id)}`, { method: 'PUT', body: { enabled: specialist.enabled === false } });
          state.specialists = await request('specialists'); render(); notify('Specialist availability updated.');
        } else if (button.dataset.researchTestMcp) {
          notify('Testing MCP server…');
          const result = await request(`mcp/servers/${id(button.dataset.researchTestMcp)}/test`, { method: 'POST' });
          state.mcpServers = await request('mcp/servers'); render();
          notify(`MCP server ${result.status || 'tested'}${result.error ? `: ${result.error}` : ''}.`, result.status === 'error');
        } else if (button.dataset.researchToggleMcp) {
          const server = state.mcpServers.find(item => item.id === button.dataset.researchToggleMcp);
          if (!server) return;
          await request(`mcp/servers/${id(server.id)}`, { method: 'PUT', body: mcpInput(server) });
          state.mcpServers = await request('mcp/servers'); render(); notify('MCP server updated.');
        }
      } catch (error) { notify(error.message, true); }
      finally { state.busy = false; }
    });
    root.addEventListener('submit', async event => {
      const form = event.target;
      if (!form.matches('[data-research-runtime-form], [data-research-session-agent-form], [data-research-specialist-form], [data-research-model-form], [data-research-mcp-form]')) return;
      event.preventDefault();
      if (state.busy) return;
      state.busy = true;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        if (form.matches('[data-research-runtime-form]')) await saveRuntime(form);
        else if (form.matches('[data-research-session-agent-form]')) await saveSessionAgent(form);
        else if (form.matches('[data-research-specialist-form]')) await saveSpecialist(form);
        else if (form.matches('[data-research-model-form]')) await saveModel(form);
        else await saveMcp(form);
      } catch (error) { notify(error.message, true); }
      finally { state.busy = false; if (submit.isConnected) submit.disabled = false; }
    });
    const initial = new URLSearchParams(window.location.search).get('view');
    if (['memory','agent','models','mcp'].includes(initial)) void activate(initial);
  }
  window.OCResearchSettings = { mount, activate };
})();
