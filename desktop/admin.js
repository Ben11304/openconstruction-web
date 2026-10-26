(() => {
  'use strict';

  const API_ROOT = '/api/research/';
  const nativeHost=window.OCDesktop?.platform && window.OCDesktop.platform!=='web' && !document.querySelector('meta[name="oc-auth-mode"][content="gateway"]');
  const ACTIVE_RUNS = new Set(['queued', 'running', 'blocked']);
  const state = {
    health:null, settings:null, timeouts:null, quotas:null, network:null, environmentSources:null, proxySettings:null,
    webSettings:null, memorySettings:null, ideaTree:null, runtime:null, models:[], providers:[], runners:[],
    environments:[], connectors:[], mcpSources:[], projects:[], sessions:[], runs:[], usage:null,
    permissionRequests:[], permissionGrants:[], users:[], authMode:'', context:null, updatedAt:null, platform:null, currentUser:null, engineAvailable:false,
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const encode = encodeURIComponent;
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
  const array = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.results) ? value.results : [];
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatNumber = value => new Intl.NumberFormat().format(number(value));
  const formatBytes = value => {
    const bytes = number(value); if (!bytes) return '0 B';
    const units = ['B','KB','MB','GB','TB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
  };
  const formatDate = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
  const formatDuration = (start, end) => {
    if (!start) return '—'; const duration = Math.max(0, new Date(end || Date.now()).getTime() - new Date(start).getTime());
    if (duration < 1000) return `${duration} ms`; if (duration < 60000) return `${(duration / 1000).toFixed(1)} s`;
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  };
  const truncate = (value, length=80) => String(value ?? '').length > length ? `${String(value).slice(0,length - 1)}…` : String(value ?? '');
  const modelById = id => state.models.find(model => model.id === id);
  const projectById = id => state.projects.find(project => project.id === id);
  const sessionById = id => state.sessions.find(session => session.id === id);
  const statusClass = status => ['ok','ready','completed','succeeded','connected','healthy','available'].includes(String(status).toLowerCase()) ? 'is-ok' : ['failed','error','unavailable','disconnected'].includes(String(status).toLowerCase()) ? 'is-bad' : ['running','queued','blocked','pending','interrupted'].includes(String(status).toLowerCase()) ? 'is-warn' : 'is-info';

  async function request(path, {method='GET', body}={}) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(API_ROOT + path, {
        method, cache:'no-store', credentials:'same-origin', signal:controller.signal,
        headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},
        body:body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.detail || payload?.error || `Request failed (${response.status}).`);
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Request timed out: ${path}`);
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function gatewayRequest(path, {method='GET', body}={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response = await fetch(path, {
        method, cache:'no-store', credentials:'same-origin',signal:controller.signal,
        headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if(response.status===401){location.assign('/openconstruction-web/web/login.html');throw new Error('Your session ended. Sign in again.');}
      if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
      return payload;
    } finally {clearTimeout(timer);}
  }
  const optional = async (path, fallback) => { try { return await request(path); } catch { return fallback; } };

  let noticeTimer;
  function notice(message, kind='info', persistent=false) {
    const element = $('#adminNotice'); clearTimeout(noticeTimer);
    element.textContent = message; element.hidden = false; element.className = `oc-admin-notice ${kind === 'error' ? 'is-error' : kind === 'success' ? 'is-success' : ''}`;
    if (!persistent) noticeTimer = setTimeout(() => { element.hidden = true; }, 5000);
  }
  function setBusy(busy) {
    $('#adminRefresh').disabled = busy; $('#adminRefresh').textContent = busy ? 'Refreshing…' : 'Refresh all';
  }

  async function refreshAll() {
    setBusy(true); notice('Loading platform state…', 'info', true);
    try {
      const results=await Promise.allSettled([
        nativeHost?Promise.resolve():gatewayRequest('/api/admin/users').then(value=>{state.users=array(value.users);state.authMode=value.authMode||'local';renderUsers();}),
        nativeHost?Promise.resolve():gatewayRequest('/api/platform/admin/overview').then(value=>{state.platform=value;renderPlatform();}),
        nativeHost?Promise.resolve():gatewayRequest('/api/platform/me').then(value=>{state.currentUser=value.user;}),
        loadEngineState(),
      ]);
      state.updatedAt = new Date(); renderAll();
      const errors=results.map((result,index)=>result.status==='rejected'?`${['Accounts','Platform overview','Current account','Research runtime'][index]}: ${result.reason?.message||'unavailable'}`:'').filter(Boolean);
      if(!state.engineAvailable)errors.push('Research engine is unavailable. Accounts and workspaces remain manageable.');
      notice(errors.length?errors.join(' '):'Admin data is up to date.',errors.length?'error':'success',!!errors.length);
    } catch (error) {
      notice(error.message || String(error), 'error', true);
    } finally { setBusy(false); }
  }

  async function loadEngineState() {
    const paths=['health','settings','timeout-settings','quota-settings','sandbox-network-settings','environment-source-settings','proxy/settings','web/settings','memory/settings','settings/idea-tree','runtime-status','models','providers','runners','environments','connectors','mcp/sources','projects?scope=all','usage/analytics','permission-requests','permission-grants'];
    const results=await Promise.allSettled(paths.map(path=>request(path)));
    const values=results.map(result=>result.status==='fulfilled'?result.value:null);
    [state.health,state.settings,state.timeouts,state.quotas,state.network,state.environmentSources,state.proxySettings,state.webSettings,state.memorySettings,state.ideaTree,state.runtime,state.models,state.providers,state.runners,state.environments,state.connectors,state.mcpSources,state.projects,state.usage,state.permissionRequests,state.permissionGrants]=values;
    state.engineAvailable=results[0].status==='fulfilled';
    if(!state.engineAvailable)state.health={status:'unavailable',service:'Research engine offline'};
    for(const key of ['models','runners','environments','connectors','mcpSources','projects','permissionRequests','permissionGrants'])state[key]=array(state[key]);
    state.providers=array(state.providers?.providers||state.providers);
    await loadOperations();
  }

  function renderPlatform() {
    if(!state.platform)return;
    const {counts={},workspaces=[],audit=[],storage={},limits={}}=state.platform;
    $('#platformMetrics').innerHTML=[metric(counts.users||0,'Accounts',`${counts.activeUsers||0} active`),metric(counts.workspaces||0,'Workspaces'),metric(counts.projects||0,'Projects'),metric(counts.tasks||0,'Research tasks'),metric(counts.activeRuns||0,'Active runs',`${counts.runs||0} total`),metric(counts.publications||0,'Published reports')].join('');
    $('#platformWorkspaces').innerHTML=workspaces.length?`<table class="oc-admin-table"><thead><tr><th>Workspace</th><th>Members</th><th>Projects</th><th>Tasks</th><th>Created</th></tr></thead><tbody>${workspaces.map(workspace=>`<tr><td><strong>${escapeHtml(workspace.name)}</strong><span class="oc-admin-cell-sub">${escapeHtml(workspace.description)}</span><code>${escapeHtml(workspace.id)}</code></td><td>${number(workspace.memberCount)}</td><td>${number(workspace.projectCount)}</td><td>${number(workspace.taskCount)}</td><td>${escapeHtml(formatDate(workspace.createdAt))}</td></tr>`).join('')}</tbody></table>`:'<p class="oc-admin-empty">No workspaces yet. Create your first workspace to organize research.</p>';
    $('#platformStorage').innerHTML=definitionList([['Store',escapeHtml(storage.backend||'—')],['Schema version',escapeHtml(storage.schemaVersion||'—')],['Database size',formatBytes(storage.databaseBytes)],['Active sign-in sessions',formatNumber(counts.sessions)],['Concurrent run limit',escapeHtml(limits.maxConcurrentRuns??'—')],['Execution mode',escapeHtml(limits.executionMode||'trusted-lab')]]);
    $('#platformAudit').innerHTML=audit.length?`<table class="oc-admin-table"><thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>${audit.map(item=>`<tr><td>${escapeHtml(formatDate(item.createdAt))}</td><td>${escapeHtml(item.actorName||item.actorId||'System')}</td><td>${escapeHtml(item.action)}</td><td><code>${escapeHtml(item.target||'—')}</code></td><td>${escapeHtml(truncate(JSON.stringify(item.detail||{}),200))}</td></tr>`).join('')}</tbody></table>`:'<p class="oc-admin-empty">Platform actions will appear here.</p>';
  }

  async function loadOperations() {
    const sessionGroups = await Promise.all(state.projects.map(async project => array(await optional(`projects/${encode(project.id)}/sessions?state=all`,[])).map(session => ({...session,_projectId:project.id}))));
    state.sessions = sessionGroups.flat();
    const runGroups = await Promise.all(state.sessions.map(async session => array(await optional(`sessions/${encode(session.id)}/runs`,[])).map(run => ({...run,_projectId:session._projectId,_sessionTitle:session.title}))));
    state.runs = runGroups.flat().sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function metric(value, label, detail='') {
    return `<article class="oc-admin-metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</article>`;
  }
  function healthCard(label, status, detail) {
    return `<article class="oc-admin-health ${statusClass(status)}"><span class="oc-admin-health-dot"></span><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail || status || 'Unknown')}</span></div></article>`;
  }
  function badge(status) { return `<span class="oc-admin-status ${statusClass(status)}">${escapeHtml(status || 'unknown')}</span>`; }
  function definitionList(rows) { return `<dl class="oc-admin-definition-list">${rows.map(([key,value]) => `<dt>${escapeHtml(key)}</dt><dd>${value}</dd>`).join('')}</dl>`; }
  function progress(label, used, total) {
    const percent = total ? Math.min(100, Math.max(0, used / total * 100)) : 0;
    return `<div class="oc-admin-progress-label"><span>${escapeHtml(label)}</span><span>${formatBytes(used)} / ${formatBytes(total)} · ${percent.toFixed(1)}%</span></div><div class="oc-admin-progress ${percent > 90 ? 'is-danger' : percent > 75 ? 'is-warn' : ''}"><span style="width:${percent}%"></span></div>`;
  }

  function renderOverview() {
    const runnerHealth = state.health?.runner || {}; const runtimeRunner = state.runtime?.runner || {};
    $('#overviewHealth').innerHTML = [
      healthCard('API service', state.health?.status, state.health?.service || 'OpenConstruction API'),
      healthCard('Runner', runnerHealth.status || runtimeRunner.status, `${runnerHealth.platform || 'local'} · ${runnerHealth.sandbox || 'sandbox unknown'}`),
      healthCard('Memory graph', state.health?.memoryGraph === 'disabled' ? 'warn' : state.health?.memoryGraph, state.health?.memoryGraph || 'unknown'),
      healthCard('MCP registry', state.mcpSources.some(item => ['error','unavailable'].includes(item.status?.status)) ? 'warn' : 'ok', `${state.mcpSources.filter(item => item.status?.status === 'ready').length}/${state.mcpSources.length} sources ready`),
    ].join('');
    const active = state.runs.filter(run => ACTIVE_RUNS.has(run.status)).length;
    const input = state.usage?.overview?.inputTokens || 0; const output = state.usage?.overview?.outputTokens || 0;
    $('#overviewMetrics').innerHTML = [metric(state.projects.length,'Projects'),metric(state.sessions.length,'Sessions'),metric(state.runs.length,'Runs'),metric(active,'Active runs'),metric(state.models.length,'Models'),metric(formatNumber(input + output),'Total tokens',`${formatNumber(input)} in · ${formatNumber(output)} out`)].join('');
    renderRunnerSummary(); renderUsageSummary();
    $('#overviewRuns').innerHTML = runsTable(state.runs.slice(0,8),false);
  }

  function renderUsers() {
    $('#authMode').textContent=`Authentication mode: ${state.authMode}`;
    $('#userCount').textContent=`${state.users.length} ${state.users.length === 1 ? 'account' : 'accounts'}`;
    $('#usersTable').innerHTML=state.users.length?`<table class="oc-admin-table"><thead><tr><th>User</th><th>Identity links</th><th>Role</th><th>Status</th><th>New password</th><th></th></tr></thead><tbody>${state.users.map(user=>`<tr data-user-row="${escapeHtml(user.id)}"><td><input name="displayName" value="${escapeHtml(user.displayName)}" maxlength="160"><span class="oc-admin-cell-sub">${escapeHtml(user.email)}</span><span class="oc-admin-cell-sub"><code>${escapeHtml(user.id)}</code></span></td><td>${array(user.identities).map(identity=>`<span class="oc-admin-status is-info">${escapeHtml(identity.provider)}</span>`).join(' ')||'—'}</td><td><select name="role"><option value="member" ${user.role==='member'?'selected':''}>Member</option><option value="viewer" ${user.role==='viewer'?'selected':''}>Viewer</option><option value="admin" ${user.role==='admin'?'selected':''}>Admin</option></select></td><td><select name="status"><option value="active" ${user.status==='active'?'selected':''}>Active</option><option value="disabled" ${user.status==='disabled'?'selected':''}>Disabled</option></select></td><td><input name="password" type="password" minlength="12" maxlength="256" placeholder="Keep current"></td><td><button class="oc-admin-button" type="button" data-save-user="${escapeHtml(user.id)}">Save</button></td></tr>`).join('')}</tbody></table>`:'<p class="oc-admin-empty">No local accounts yet. Sign out and use the host recovery password with an email to create the first administrator.</p>';
  }

  function primaryRunner() { return state.runners.find(runner => runner.id === 'local') || state.runners[0] || state.health?.runner || {}; }
  function runnerResources(runner) { return runner.runnerStatus?.resources || runner.resources || runner.resourceSnapshot || runner.system || runner; }
  function runtimeCount(value) { return Array.isArray(value) ? value.length : number(value); }
  function renderRunnerSummary() {
    const runner = primaryRunner(), resources = runnerResources(runner);
    const memoryTotal = number(resources.memoryTotalBytes || resources.memoryTotal), memoryFree = number(resources.memoryFreeBytes || resources.memoryFree);
    const diskTotal = number(resources.workspaceDisk?.totalBytes || resources.diskTotalBytes || resources.diskTotal), diskAvailable = number(resources.workspaceDisk?.availableBytes || resources.diskAvailableBytes || resources.diskAvailable);
    $('#runnerSummary').innerHTML = `${memoryTotal ? progress('Memory',memoryTotal-memoryFree,memoryTotal) : ''}${diskTotal ? progress('Disk',diskTotal-diskAvailable,diskTotal) : ''}${definitionList([
      ['Identity',escapeHtml(runner.name || runner.id || 'local')],['Status',badge(runner.status || state.health?.runner?.status)],
      ['CPU',escapeHtml(`${resources.cpuCores || resources.cpus || '—'} cores`)],['Load (1m)',escapeHtml(resources.loadAverage1m ?? resources.loadAverage?.[0] ?? '—')],
      ['Active executions',escapeHtml(runtimeCount(state.runtime?.runner?.activeExecutions))],['Kernels',escapeHtml(runtimeCount(state.runtime?.runner?.kernels) || state.runtime?.runner?.kernelCount || 0)],
    ])}`;
  }
  function renderUsageSummary() {
    const overview = state.usage?.overview || {};
    $('#usageSummary').innerHTML = definitionList([
      ['Input tokens',`<strong>${formatNumber(overview.inputTokens)}</strong>`],['Output tokens',`<strong>${formatNumber(overview.outputTokens)}</strong>`],
      ['Cache reads',formatNumber(overview.cacheReadTokens)],['Cache writes',formatNumber(overview.cacheWriteTokens)],
      ['Total',`<strong>${formatNumber(overview.totalTokens)}</strong>`],['Generated',escapeHtml(formatDate(state.usage?.generatedAt))],
    ]);
  }

  function modelFacts(model) { return model.facts || model.user || model.resolvedFacts || {}; }
  function renderModels() {
    const select = $('#defaultModelSelect'), effectiveId = state.settings?.effective?.modelId || state.settings?.overrides?.modelId || '';
    select.innerHTML = `<option value="">Not configured</option>${state.models.map(model => `<option value="${escapeHtml(model.id)}" ${model.id === effectiveId ? 'selected' : ''}>${escapeHtml(model.name)} · ${escapeHtml(model.model)}</option>`).join('')}`;
    $('#modelCount').textContent = `${state.models.length} profiles`;
    $('#modelsTable').innerHTML = `<table class="oc-admin-table"><thead><tr><th>Profile</th><th>Provider / endpoint</th><th>Protocol</th><th>Context</th><th>Max output</th><th>Capabilities</th><th>Connection</th></tr></thead><tbody>${state.models.map(model => {
      const facts=modelFacts(model), isDefault=model.id===effectiveId;
      return `<tr><td><span class="oc-admin-cell-main">${escapeHtml(model.name)} ${isDefault ? badge('default') : ''}</span><span class="oc-admin-cell-sub"><code>${escapeHtml(model.model)}</code></span></td><td>${escapeHtml(model.providerId || 'standalone')}<span class="oc-admin-cell-sub">${escapeHtml(truncate(model.baseUrl,48))}</span></td><td>${escapeHtml(model.apiProtocol || 'openai-compatible')}<span class="oc-admin-cell-sub">${escapeHtml(model.apiVariant || '')}</span></td><td>${facts.contextWindow ? formatNumber(facts.contextWindow) : 'Unknown'}</td><td>${facts.maxOutputTokens ? formatNumber(facts.maxOutputTokens) : 'Unknown'}</td><td>${model.vision ? 'Vision · ' : ''}${facts.thinkingSupported || model.thinkingMode ? 'Thinking' : 'Text'}</td><td><button class="oc-admin-button" type="button" data-test-model="${escapeHtml(model.id)}">Test</button><span class="oc-admin-cell-sub" data-model-result="${escapeHtml(model.id)}">${model.hasApiToken ? 'Credentials configured' : 'No profile token'}</span></td></tr>`;
    }).join('')}</tbody></table>`;
    renderContextSelectors();
  }

  function renderContextSelectors() {
    const projectSelect=$('#contextProject'), sessionSelect=$('#contextSession');
    const previousProject=projectSelect.value, previousSession=sessionSelect.value;
    projectSelect.innerHTML=`<option value="">Choose project</option>${state.projects.map(project=>`<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('')}`;
    if (state.projects.some(item=>item.id===previousProject)) projectSelect.value=previousProject;
    const sessions=projectSelect.value ? state.sessions.filter(item=>item._projectId===projectSelect.value) : state.sessions;
    sessionSelect.innerHTML=`<option value="">Choose session</option>${sessions.map(session=>`<option value="${escapeHtml(session.id)}">${escapeHtml(session.title || session.id)}</option>`).join('')}`;
    if (sessions.some(item=>item.id===previousSession)) sessionSelect.value=previousSession;
  }

  function contextInput(detail) { return detail?.context?.input || detail?.value?.context?.input || detail?.value?.input || detail?.value || {}; }
  function extractDeferred(systemPrompt) {
    const matches=[...String(systemPrompt||'').matchAll(/(?:^|\n)<available-deferred-tools>\s*\n([\s\S]*?)\n<\/available-deferred-tools>/gi)];
    const content=matches.at(-1)?.[1]||'';
    return [...new Set(content.split(/\r?\n/).map(line=>line.trim().replace(/^[-*]\s*/, '')).filter(Boolean))];
  }
  function toolName(tool,index) { return tool?.name || tool?.function?.name || tool?.spec?.name || `tool_${index + 1}`; }
  function renderContext() {
    if (!state.context) return;
    const {detail,manifest,model,systemPrompt,history,tools,deferred,toolRows,totalToolChars}=state.context;
    const contextWindow=modelFacts(model || {}).contextWindow || 0, inputTokens=manifest?.inputTokens;
    const ratio=contextWindow && inputTokens ? Math.min(100,inputTokens/contextWindow*100) : 0;
    $('#contextInspector').className='';
    $('#contextInspector').innerHTML=`
      <div class="oc-admin-context-metrics">
        ${metric(formatNumber(inputTokens || 0),'Input tokens',contextWindow ? `${ratio.toFixed(1)}% of context` : 'manifest total')}
        ${metric(formatNumber(contextWindow),'Context window',model?.name || 'model unknown')}
        ${metric(toCompactSize(systemPrompt.length),'System prompt',`${formatNumber(systemPrompt.length)} chars`)}
        ${metric(toCompactSize(JSON.stringify(history).length),'History',`${history.length} messages`)}
        ${metric(toCompactSize(totalToolChars),'Tool schemas',`${tools.length} bound`)}
        ${metric(deferred.length,'Deferred tools','lazy loaded')}
      </div>
      ${contextWindow && inputTokens ? `<div class="oc-admin-progress-label" style="margin-top:16px"><span>Context occupancy</span><span>${formatNumber(inputTokens)} / ${formatNumber(contextWindow)} tokens</span></div><div class="oc-admin-progress ${ratio>90?'is-danger':ratio>75?'is-warn':''}"><span style="width:${ratio}%"></span></div>` : ''}
      <div class="oc-admin-split" style="margin-top:16px">
        <div>${definitionList([['Session',escapeHtml(sessionById(detail?.entry?.sessionId)?.title || $('#contextSession option:checked')?.textContent || '—')],['Snapshot',escapeHtml(detail?.entry?.id || '—')],['Captured',escapeHtml(formatDate(detail?.entry?.timestamp))],['Prompt version',escapeHtml(manifest?.systemPrompt?.version || '—')],['Model',escapeHtml(manifest?.modelProfileName || model?.name || '—')],['Status',badge(manifest?.status || 'captured')]])}</div>
        <div class="oc-admin-table-wrap"><table class="oc-admin-table"><thead><tr><th>Largest schemas</th><th>Chars</th><th>Share</th></tr></thead><tbody>${toolRows.slice(0,8).map(row=>`<tr><td><code>${escapeHtml(row.name)}</code></td><td>${formatNumber(row.size)}</td><td>${totalToolChars ? (row.size/totalToolChars*100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table></div>
      </div>
      <details class="oc-admin-context-detail"><summary>System prompt (${formatNumber(systemPrompt.length)} characters)</summary><pre>${escapeHtml(systemPrompt)}</pre></details>
      <details class="oc-admin-context-detail"><summary>Conversation history (${history.length} messages)</summary><pre>${escapeHtml(JSON.stringify(history,null,2))}</pre></details>
      <details class="oc-admin-context-detail"><summary>Raw tool schemas (${tools.length})</summary><pre>${escapeHtml(JSON.stringify(tools,null,2))}</pre></details>`;
    renderToolsFromContext();
  }
  function toCompactSize(chars) { return chars >= 1000000 ? `${(chars/1000000).toFixed(1)}M` : chars >= 1000 ? `${(chars/1000).toFixed(1)}K` : String(chars); }

  async function analyzeContext(sessionId) {
    if (!sessionId) return notice('Choose a session first.', 'error');
    const button=$('#contextForm button'); button.disabled=true; button.textContent='Analyzing…';
    try {
      const [trajectory,manifests]=await Promise.all([request(`sessions/${encode(sessionId)}/trajectory`),optional(`sessions/${encode(sessionId)}/prompt-manifests`,[])]);
      const entries=[...array(trajectory?.entries),...array(trajectory?.untimedEntries),...array(trajectory?.historicalEntries)];
      const target=[...entries].reverse().find(entry=>entry.eventType==='context.captured'||entry.label==='context.captured'||String(entry.id).startsWith('context:'));
      if(!target) throw new Error('This session has no captured model context yet. Run at least one model turn first.');
      const detail=await request(`sessions/${encode(sessionId)}/trajectory/detail?id=${encode(target.id)}`), input=contextInput(detail);
      const systemPrompt=typeof input.systemPrompt==='string'?input.systemPrompt:JSON.stringify(input.systemPrompt||'',null,2);
      const history=array(input.history || input.messages), tools=array(input.tools);
      const manifestsList=array(manifests).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
      const recordedTurnId=String(target.id||'').startsWith('event:')?String(target.id).split(':')[1]:undefined;
      const manifest=manifestsList.find(item=>item.turnId===recordedTurnId||item.turnId===target.contextId||item.turnId===target.runId)||manifestsList[0]||null;
      const session=sessionById(sessionId), model=modelById(manifest?.modelProfileId||session?.modelId);
      const toolRows=tools.map((tool,index)=>({name:toolName(tool,index),size:JSON.stringify(tool).length,tool})).sort((a,b)=>b.size-a.size);
      state.context={sessionId,detail,manifest,model,systemPrompt,history,tools,deferred:extractDeferred(systemPrompt),toolRows,totalToolChars:toolRows.reduce((sum,row)=>sum+row.size,0)};
      renderContext(); notice('Loaded the latest captured context.', 'success');
    } catch(error){ notice(error.message||String(error),'error',true); }
    finally{button.disabled=false;button.textContent='Analyze context';}
  }

  function renderToolsFromContext() {
    if(!state.context)return;
    $('#boundToolCount').textContent=`${state.context.tools.length} bound tools`;
    $('#deferredToolCount').textContent=`${state.context.deferred.length} deferred tools`;
    $('#boundTools').innerHTML=`<table class="oc-admin-table"><thead><tr><th>Tool</th><th>Schema size</th><th>Share</th></tr></thead><tbody>${state.context.toolRows.map(row=>`<tr><td><code>${escapeHtml(row.name)}</code></td><td>${formatNumber(row.size)} chars</td><td>${state.context.totalToolChars?(row.size/state.context.totalToolChars*100).toFixed(1):0}%</td></tr>`).join('')}</tbody></table>`;
    $('#deferredTools').innerHTML=state.context.deferred.length?state.context.deferred.map(name=>`<span class="oc-admin-chip">${escapeHtml(name)}</span>`).join(''):'<p class="oc-admin-empty">No deferred tool manifest was found in this snapshot.</p>';
  }

  function renderTools() {
    $('#mcpSources').innerHTML=`<table class="oc-admin-table"><thead><tr><th>Source</th><th>Status</th><th>Available tools</th><th>Missing</th><th>Detail</th></tr></thead><tbody>${state.mcpSources.map(source=>{
      const manifest=source.manifest||source, status=source.status||{}; const available=array(status.availableTools), missing=array(status.missingTools), declared=array(manifest.tools);
      return `<tr><td><span class="oc-admin-cell-main">${escapeHtml(manifest.displayName||manifest.name||manifest.id)}</span><span class="oc-admin-cell-sub"><code>${escapeHtml(manifest.id||'')}</code></span></td><td>${badge(status.status||'unknown')}</td><td>${formatNumber(available.length||status.availableToolCount||declared.length)}</td><td>${formatNumber(missing.length)}</td><td>${escapeHtml(truncate(status.error||status.message||'',90))||'—'}</td></tr>`;
    }).join('')}</tbody></table>`;
    const enabled=new Set(state.settings?.effective?.enabledConnectorIds||[]);
    $('#connectorList').innerHTML=state.connectors.map(connector=>{
      const manifest=connector.manifest||connector; const id=manifest.id||connector.id;
      return `<label class="oc-admin-check"><input type="checkbox" name="connector" value="${escapeHtml(id)}" ${enabled.has(id)?'checked':''}><span><strong>${escapeHtml(manifest.displayName||manifest.name||id)}</strong><small>${escapeHtml(truncate(manifest.description||connector.description||id,100))}</small></span></label>`;
    }).join('')||'<p class="oc-admin-empty">No connector manifests were returned.</p>';
    renderToolsFromContext();
  }

  function runsTable(runs,actions=true) {
    if(!runs.length)return '<p class="oc-admin-empty">No runs recorded.</p>';
    return `<table class="oc-admin-table"><thead><tr><th>Status</th><th>Project / session</th><th>Model</th><th>Prompt</th><th>Started</th><th>Duration</th>${actions?'<th>Action</th>':''}</tr></thead><tbody>${runs.map(run=>{
      const model=modelById(run.settingsSnapshot?.modelId), project=projectById(run._projectId); const active=ACTIVE_RUNS.has(run.status);
      return `<tr><td>${badge(run.status)}</td><td><span class="oc-admin-cell-main">${escapeHtml(project?.name||'Unknown project')}</span><span class="oc-admin-cell-sub">${escapeHtml(run._sessionTitle||run.sessionId)}</span></td><td>${escapeHtml(model?.name||run.settingsSnapshot?.modelId||'—')}</td><td title="${escapeHtml(run.prompt)}">${escapeHtml(truncate(run.prompt,90))}${run.error?`<span class="oc-admin-cell-sub" style="color:#98443e">${escapeHtml(truncate(run.error,100))}</span>`:''}</td><td>${escapeHtml(formatDate(run.startedAt||run.createdAt))}</td><td>${escapeHtml(formatDuration(run.startedAt||run.createdAt,run.finishedAt))}</td>${actions?`<td>${active?`<button class="oc-admin-button oc-admin-button-danger" type="button" data-cancel-run="${escapeHtml(run.id)}" data-session-id="${escapeHtml(run.sessionId)}">Cancel</button>`:'—'}</td>`:''}</tr>`;
    }).join('')}</tbody></table>`;
  }
  function renderOperations() {
    const counts=Object.fromEntries(['queued','running','blocked','completed','failed','cancelled'].map(status=>[status,state.runs.filter(run=>run.status===status).length]));
    $('#operationsMetrics').innerHTML=[metric(state.runs.length,'All runs'),metric(counts.running,'Running'),metric(counts.queued,'Queued'),metric(counts.blocked,'Blocked'),metric(counts.completed,'Completed'),metric(counts.failed,'Failed')].join('');
    $('#operationsRuns').innerHTML=runsTable(state.runs.slice(0,100),true);
    $('#permissionRequests').innerHTML=listItems(state.permissionRequests,item=>[item.summary||item.action||item.id,`${item.state||'pending'} · ${item.sessionId||'unknown session'}`]);
    $('#permissionGrants').innerHTML=listItems(state.permissionGrants,item=>[item.action||item.resource||item.id,`${item.decision||item.scope||'granted'} · ${formatDate(item.createdAt)}`]);
  }
  function listItems(items,render) { return items.length?`<ul class="oc-admin-list">${items.slice(0,30).map(item=>{const [main,sub]=render(item);return `<li><strong class="oc-admin-break">${escapeHtml(main)}</strong><small>${escapeHtml(sub)}</small></li>`;}).join('')}</ul>`:'<p class="oc-admin-empty">Nothing to show.</p>'; }

  const timeoutFields=[['gatewayIdleTimeoutMs','Gateway idle','Seconds'],['gatewayTurnTimeoutMs','Gateway turn','Seconds'],['kernelIdleTimeoutMs','Kernel idle','Seconds'],['permissionWaitTimeoutMs','Permission wait','Seconds'],['runnerExecTimeoutMs','Runner execution','Seconds']];
  const quotaFields=[['runnerMaxOutputBytes','Runner output','GB'],['runnerMaxWorkspaceBytes','Runner workspace','GB'],['uploadMaxFileBytes','Upload file','GB'],['uploadMaxRequestBytes','Upload request','GB']];
  function renderSystem() {
    $('#timeoutsForm').innerHTML=timeoutFields.map(([key,label,unit])=>`<label><span>${escapeHtml(label)} (${unit.toLowerCase()})</span><input name="${key}" type="number" min="0" step="1" value="${number(state.timeouts?.[key])/1000}"><small class="oc-admin-field-note">Current: ${number(state.timeouts?.[key])===0?'unlimited':formatDuration(new Date(0),new Date(number(state.timeouts?.[key])))}</small></label>`).join('')+'<div class="oc-admin-form-actions"><button class="oc-admin-button oc-admin-button-primary" type="submit">Save timeouts</button></div>';
    $('#quotasForm').innerHTML=quotaFields.map(([key,label,unit])=>`<label><span>${escapeHtml(label)} (${unit})</span><input name="${key}" type="number" min="0.001" step="0.001" value="${(number(state.quotas?.[key])/1024**3).toFixed(3)}"><small class="oc-admin-field-note">Current: ${formatBytes(state.quotas?.[key])}</small></label>`).join('')+'<div class="oc-admin-form-actions"><button class="oc-admin-button oc-admin-button-primary" type="submit">Save quotas</button></div>';
    const network=state.network||{};
    const proxyPolicies=[{value:'inherit',label:'Inherit global policy'},{value:'none',label:'No proxy (direct)'},...array(state.proxySettings?.servers).map(server=>({value:`proxy:${server.id}`,label:`${server.name} (${server.kind})`}))];
    if(network.egressProxyPolicy&&!proxyPolicies.some(item=>item.value===network.egressProxyPolicy))proxyPolicies.push({value:network.egressProxyPolicy,label:`Current: ${network.egressProxyPolicy}`});
    $('#networkForm').innerHTML=`<label><span>Network mode</span><select name="mode"><option value="none" ${network.mode==='none'?'selected':''}>No network</option><option value="domain-allowlist" ${network.mode==='domain-allowlist'?'selected':''}>Domain allowlist</option><option value="open" ${network.mode==='open'?'selected':''}>Open network</option></select></label><label><span>Egress proxy</span><select name="egressProxyPolicy">${proxyPolicies.map(policy=>`<option value="${escapeHtml(policy.value)}" ${network.egressProxyPolicy===policy.value?'selected':''}>${escapeHtml(policy.label)}</option>`).join('')}</select></label><label class="oc-admin-toggle oc-admin-wide"><input name="allowPrivateNetwork" type="checkbox" ${network.allowPrivateNetwork?'checked':''}><span>Allow access to private network addresses</span></label><label class="oc-admin-wide"><span>Allowed domains · one per line</span><textarea name="allowedDomains" placeholder="example.com">${escapeHtml(array(network.allowedDomains).join('\n'))}</textarea></label><div class="oc-admin-form-actions"><button class="oc-admin-button oc-admin-button-primary" type="submit">Save network policy</button></div>`;
    const runner=primaryRunner();
    $('#runtimeDetails').innerHTML=definitionList([['API',badge(state.health?.status)],['Runner',badge(runner.status||state.health?.runner?.status)],['Platform',escapeHtml(state.health?.runner?.platform||runner.platform||'—')],['Sandbox',escapeHtml(state.health?.runner?.sandbox||runner.sandbox||'—')],['Runner version',escapeHtml(state.health?.runner?.runnerVersion||runner.runnerStatus?.remoteVersion||runner.version||'—')],['Active executions',escapeHtml(runtimeCount(state.runtime?.runner?.activeExecutions))],['Environment count',escapeHtml(state.environments.length)],['Captured',escapeHtml(formatDate(state.runtime?.capturedAt))]]);
    $('#supportingServices').innerHTML=definitionList([['Memory graph',badge(state.memorySettings?.memoryGraphStatus||state.health?.memoryGraph||'unknown')],['Memory enabled',escapeHtml(String(state.memorySettings?.enabled??false))],['Web search',badge(state.webSettings?.enabled===false?'disabled':'configured')],['Web provider',escapeHtml(state.webSettings?.provider||state.webSettings?.searchProvider||'—')],['Global proxy',escapeHtml(state.proxySettings?.defaultPolicy||'—')],['Conda source',escapeHtml(state.environmentSources?.condaSource||'—')],['Pip source',escapeHtml(state.environmentSources?.pipSource||'—')],['Idea tree',badge(state.ideaTree?.enabled===false?'disabled':state.ideaTree?.enabled===true?'enabled':'configured')],['MCP sources',escapeHtml(state.mcpSources.length)]]);
  }

  function renderAll() {
    $('#adminUpdated').textContent=`Updated ${state.updatedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    renderPlatform();renderOverview();renderUsers();renderModels();renderTools();renderOperations();renderSystem();
    for(const panel of ['models','tools','operations','system'])$$(`[data-admin-panel="${panel}"] button,[data-admin-panel="${panel}"] input,[data-admin-panel="${panel}"] select,[data-admin-panel="${panel}"] textarea`).forEach(element=>{element.disabled=!state.engineAvailable;});
    for(const [form,key] of [['#defaultModelForm','settings'],['#connectorsForm','settings'],['#timeoutsForm','timeouts'],['#quotasForm','quotas'],['#networkForm','network']])if(!state[key])$$(`${form} button,${form} input,${form} select,${form} textarea`).forEach(element=>{element.disabled=true;});
  }

  async function saveGlobalSettings(patch) {
    state.settings=await request('settings',{method:'PUT',body:{...(state.settings?.overrides||{}),...patch}});
    renderAll(); notice('Global settings saved.', 'success');
  }
  async function withSubmit(button,work) {
    const old=button.textContent;button.disabled=true;button.textContent='Saving…';
    try{await work();}catch(error){notice(error.message||String(error),'error',true);}finally{button.disabled=false;button.textContent=old;}
  }

  function bindEvents() {
    $('.oc-admin-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-admin-tab]');if(button)openTab(button.dataset.adminTab);});
    document.addEventListener('click',async event=>{
      const open=event.target.closest('[data-open-tab]');if(open)return openTab(open.dataset.openTab);
      const saveUser=event.target.closest('[data-save-user]');if(saveUser){
        const row=saveUser.closest('[data-user-row]');saveUser.disabled=true;
        try{
          const password=row.querySelector('[name=password]').value;
          const payload={displayName:row.querySelector('[name=displayName]').value,role:row.querySelector('[name=role]').value,status:row.querySelector('[name=status]').value,...(password?{password}:{})};
          const result=await gatewayRequest(`/api/admin/users/${encode(saveUser.dataset.saveUser)}`,{method:'PATCH',body:payload});
          if(result.user.id===state.currentUser?.id){notice('Your account was updated. Sign in again to continue.','success',true);location.assign('/openconstruction-web/web/login.html?account_updated=1');return;}
          state.users=state.users.map(user=>user.id===result.user.id?result.user:user);renderUsers();notice('Account updated. Existing sessions for this user were signed out.','success');
        }catch(error){notice(error.message,'error',true);saveUser.disabled=false;}return;
      }
      const test=event.target.closest('[data-test-model]');if(test){
        const result=$(`[data-model-result="${CSS.escape(test.dataset.testModel)}"]`);test.disabled=true;result.textContent='Testing…';
        try{const value=await request(`models/${encode(test.dataset.testModel)}/test`,{method:'POST'});result.textContent=`${value.ok?'Connected':'Failed'} · ${value.latencyMs||0} ms · ${value.message||value.category}`;notice(value.ok?'Model connection succeeded.':`Model test failed: ${value.message||value.category}`,value.ok?'success':'error');}catch(error){result.textContent=error.message;notice(error.message,'error');}finally{test.disabled=false;}
        return;
      }
      const cancel=event.target.closest('[data-cancel-run]');if(cancel){
        if(!confirm('Cancel this active run? Partial output may remain in the session.'))return;
        cancel.disabled=true;try{await request(`sessions/${encode(cancel.dataset.sessionId)}/runs/${encode(cancel.dataset.cancelRun)}/cancel`,{method:'POST'});notice('Cancellation requested.','success');await refreshAll();}catch(error){notice(error.message,'error',true);cancel.disabled=false;}return;
      }
    });
    $('#adminRefresh').addEventListener('click',refreshAll);
    $('#createUserForm').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);withSubmit(event.submitter,async()=>{const result=await gatewayRequest('/api/admin/users',{method:'POST',body:{email:data.get('email'),displayName:data.get('displayName'),role:data.get('role'),password:data.get('password')}});state.users.push(result.user);form.reset();renderUsers();notice('Local account created. Add the account to a workspace from the Team page.','success');});});
    $('#contextProject').addEventListener('change',renderContextSelectors);
    $('#contextForm').addEventListener('submit',event=>{event.preventDefault();analyzeContext($('#contextSession').value);});
    $('#defaultModelForm').addEventListener('submit',event=>{event.preventDefault();withSubmit(event.submitter,()=>saveGlobalSettings({modelId:$('#defaultModelSelect').value||undefined}));});
    $('#connectorsForm').addEventListener('submit',event=>{event.preventDefault();const ids=$$('#connectorList input[name=connector]:checked').map(input=>input.value);withSubmit(event.submitter,()=>saveGlobalSettings({enabledConnectorIds:ids}));});
    $('#reloadMcp').addEventListener('click',async event=>{const button=event.currentTarget,old=button.textContent;button.disabled=true;button.textContent='Reloading…';try{await request('mcp/sources/reload',{method:'POST'});state.mcpSources=array(await request('mcp/sources'));renderTools();notice('MCP sources reloaded.','success');}catch(error){notice(error.message,'error',true);}finally{button.disabled=false;button.textContent=old;}});
    $('#timeoutsForm').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),body=Object.fromEntries(timeoutFields.map(([key])=>[key,Math.round(number(data.get(key))*1000)]));withSubmit(event.submitter,async()=>{state.timeouts=await request('timeout-settings',{method:'PUT',body});renderSystem();notice('Timeout settings saved.','success');});});
    $('#quotasForm').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),body=Object.fromEntries(quotaFields.map(([key])=>[key,Math.round(number(data.get(key))*1024**3)]));withSubmit(event.submitter,async()=>{state.quotas=await request('quota-settings',{method:'PUT',body});renderSystem();notice('Quota settings saved.','success');});});
    $('#networkForm').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),body={mode:String(data.get('mode')),egressProxyPolicy:String(data.get('egressProxyPolicy')),allowPrivateNetwork:data.get('allowPrivateNetwork')==='on',allowedDomains:String(data.get('allowedDomains')||'').split(/\r?\n|,/).map(value=>value.trim()).filter(Boolean)};if(!confirm(`Apply network mode “${body.mode}”${body.allowPrivateNetwork?' with private network access':''}? Active session kernels may be restarted.`))return;withSubmit(event.submitter,async()=>{state.network=await request('sandbox-network-settings',{method:'PUT',body});renderSystem();notice('Sandbox network policy saved.','success');});});
  }
  function openTab(name) {
    $$('[data-admin-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.adminTab===name)));
    $$('[data-admin-panel]').forEach(panel=>{panel.hidden=panel.dataset.adminPanel!==name;});
    history.replaceState(null,'',`#${name}`);
  }

  function init() {
    bindEvents();
    if(nativeHost){for(const tab of ['platform','users'])$(`[data-admin-tab="${tab}"]`).hidden=true;const link=document.createElement('a');link.href='/openconstruction-web/desktop/platform.html';link.className='oc-admin-button';link.textContent='Hosted accounts & workspaces';$('.oc-admin-header-actions').prepend(link);}
    let requested=location.hash.slice(1)||(nativeHost?'overview':'platform');if(nativeHost&&['platform','users'].includes(requested))requested='overview';if($(`[data-admin-tab="${CSS.escape(requested)}"]`))openTab(requested);
    refreshAll();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
