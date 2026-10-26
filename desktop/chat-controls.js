(() => {
  const EFFORTS = ['low','medium','high','xhigh','max'];
  let root, bar, snapshot = {}, details, models = [], codexModels = [], codexProfiles = {};
  let stamp = '', ticket = 0, loading = false, pending = null, error = '', statusTimer;
  const q = selector => bar?.querySelector(selector);
  const id = value => encodeURIComponent(value);
  async function request(route, method = 'GET', body) {
    const response = await fetch('/api/research/' + route, {method, cache:'no-store', headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
    const value = await response.json();
    if (!response.ok) throw new Error(value.detail || value.error || 'Could not save chat settings.');
    return value;
  }
  function option(select, value, label) { const item = document.createElement('option'); item.value = value; item.textContent = label; select.append(item); }
  function modelInfo(profileId) { return codexModels.find(model => model.id === codexProfiles[profileId]); }
  function effortsFor(profileId) { const info = modelInfo(profileId); return info?.efforts?.length ? EFFORTS.filter(e => info.efforts.includes(e)) : EFFORTS; }
  function message(text, isError = false) {
    clearTimeout(statusTimer);
    error = isError ? text : '';
    const status = q('[data-chat-settings-status]');
    const saved = text === 'Saved for this session.';
    status.textContent = saved ? 'Saved' : text;
    status.classList.toggle('is-error', isError);
    status.classList.toggle('is-saved', saved);
    if (saved) statusTimer = setTimeout(() => {status.textContent = ''; status.classList.remove('is-saved');}, 1800);
  }
  function lock() {
    if (!bar) return;
    const disabled = loading || Boolean(pending) || !snapshot.session || Boolean(snapshot.run);
    bar.querySelectorAll('select').forEach(select => {select.disabled = disabled;});
    bar.setAttribute('aria-busy', String(loading || Boolean(pending)));
    const submit = root.querySelector('[data-research-composer] button[type=submit]');
    submit.disabled = disabled || !models.some(model => model.id === details?.effective?.modelId);
  }
  function render() {
    const selected = details?.effective?.modelId;
    const profile = models.find(model => model.id === selected);
    const modelSelect = q('[data-chat-model]'); modelSelect.replaceChildren();
    option(modelSelect, '', 'Project default');
    const saved = document.createElement('optgroup'); saved.label = 'Connected models';
    for (const model of models) option(saved, 'profile:' + model.id, (model.name || model.model).replace(/^Codex · /, ''));
    modelSelect.append(saved);
    const available = codexModels.filter(model => !models.some(profile => codexProfiles[profile.id] === model.id));
    if (available.length) {
      const group = document.createElement('optgroup'); group.label = 'Codex';
      for (const model of available) option(group, 'codex:' + model.id, model.name);
      modelSelect.append(group);
    }
    if (details?.overrides?.modelId && !profile) option(modelSelect, 'profile:' + details.overrides.modelId, 'Model unavailable');
    modelSelect.value = details?.overrides?.modelId ? 'profile:' + details.overrides.modelId : '';
    modelSelect.title = profile ? 'Current model: ' + (profile.name || profile.model) : 'Choose a model or connect one in Models';
    const effortSelect = q('[data-chat-effort]'); effortSelect.replaceChildren();
    option(effortSelect, '', 'Auto');
    if (!modelInfo(selected) || modelInfo(selected).efforts?.includes('none')) option(effortSelect, 'off', 'Off');
    for (const effort of effortsFor(selected)) option(effortSelect, effort, {low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'}[effort]);
    const thinkingMode = details?.effective?.thinkingMode || profile?.thinkingMode || 'auto';
    const chosenEffort = thinkingMode === 'disabled' ? 'off' : thinkingMode === 'enabled' ? details?.effective?.thinkingEffort || profile?.thinkingEffort || '' : '';
    if (chosenEffort && ![...effortSelect.options].some(option => option.value === chosenEffort)) option(effortSelect, chosenEffort, chosenEffort + ' (unsupported)');
    effortSelect.value = chosenEffort;
    q('[data-chat-permissions]').value = snapshot.session?.approvalMode || 'ask_for_dangerous';
    q('[data-chat-permissions]').closest('label').classList.toggle('is-full-access', snapshot.session?.approvalMode === 'always_allow');
    q('[data-chat-permissions]').title = snapshot.session?.approvalMode === 'always_allow'
      ? 'Automatically approve research tool requests. Existing sandbox and resource limits still apply.'
      : 'Ask before actions that require approval. Existing session grants are respected.';
    lock();
  }
  async function refresh() {
    const sessionId = snapshot.sessionId, version = ++ticket;
    if (!sessionId || !snapshot.session) {details = null; lock(); return;}
    loading = true; lock();
    try {
      const [settings, registry, status, catalog] = await Promise.all([
        request(`sessions/${id(sessionId)}/settings`), request('models'),
        window.OCDesktop.codexStatus().catch(() => ({})), window.OCDesktop.codexModels().catch(() => [])
      ]);
      if (version !== ticket || snapshot.sessionId !== sessionId) return;
      details = settings; models = registry; codexModels = catalog; codexProfiles = status.profiles || (status.modelId ? {[status.modelId]:status.model} : {});
      render();
      message(models.some(model => model.id === settings.effective?.modelId) ? '' : 'Choose a model to start. Connect an account in Models if needed.');
    } catch (e) {if (version === ticket) {details = null; message(e.message, true);}}
    finally {if (version === ticket) {loading = false; lock();}}
  }
  async function change(field, value) {
    if (pending || loading || snapshot.run || !snapshot.sessionId) {render(); return false;}
    const sessionId = snapshot.sessionId;
    pending = (async () => {
      message('Saving…');
      if (field === 'permissions') {
        await request(`sessions/${id(sessionId)}`, 'PATCH', {approvalMode:value});
      } else {
        let profileId;
        if (field === 'model' && value.startsWith('codex:')) {
          const result = await window.OCDesktop.connectCodexModel({model:value.slice(6),sessionId,useAsDefault:false});
          profileId = result.modelId;
          codexProfiles[profileId] = result.model;
        } else if (field === 'model') profileId = value.slice(8);
        const settings = await request(`sessions/${id(sessionId)}/settings`);
        const next = {...settings.overrides};
        if (field === 'model') {
          if (profileId) next.modelId = profileId; else delete next.modelId;
          const allowed = effortsFor(profileId);
          if (profileId && settings.effective?.thinkingMode === 'enabled' && settings.effective?.thinkingEffort && !allowed.includes(settings.effective.thinkingEffort)) {
            const fallback = modelInfo(profileId)?.effort;
            next.thinkingEffort = allowed.includes(fallback) ? fallback : allowed[0];
            if (!next.thinkingEffort) delete next.thinkingEffort;
          }
        } else {
          if (value === 'off') {next.thinkingMode = 'disabled'; delete next.thinkingEffort;}
          else if (!value) {next.thinkingMode = 'auto'; delete next.thinkingEffort;}
          else {next.thinkingMode = 'enabled'; next.thinkingEffort = value;}
        }
        await request(`sessions/${id(sessionId)}/settings`, 'PUT', next);
      }
      if (snapshot.sessionId === sessionId) await window.OCResearchWorkspace.refreshSession();
    })();
    lock();
    let failure;
    try {await pending;} catch (e) {failure = e.message;}
    finally {pending = null; await refresh(); if (failure) message(failure, true); else message('Saved for this session.'); lock();}
    return !failure;
  }
  window.OCDesktopChatControls = {
    choices(field) {
      const select = q(`[data-chat-${field}]`);
      return select ? [...select.options].map(item => ({value:item.value,label:item.textContent,selected:item.selected,disabled:item.disabled || select.disabled})) : [];
    },
    change,
    current: () => ({model:models.find(model => model.id === details?.effective?.modelId)?.name || 'Project default',effort:q('[data-chat-effort]')?.selectedOptions[0]?.textContent || 'Auto',permissions:q('[data-chat-permissions]')?.selectedOptions[0]?.textContent || 'Ask'}),
    mount(workspace) {
      root = workspace;
      bar = document.createElement('div'); bar.className = 'oc-chat-controls';
      const icon = paths => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
      const chevron = icon('<path d="m7 8.5 3 3 3-3"/>');
      bar.innerHTML = `<div class="oc-chat-selectors"><label class="oc-chat-model-control"><span class="oc-control-label">Model</span><select data-chat-model aria-label="Chat model"><option>Loading…</option></select>${chevron}</label><label title="Thinking effort">${icon('<path d="m11.5 2.5-7 8.5H10l-1.5 6.5 7-8.5H10z"/>')}<span class="oc-control-label">Effort</span><select data-chat-effort aria-label="Thinking effort"><option>Auto</option></select>${chevron}</label><label>${icon('<path d="M10 2.5 16 5v4.5c0 3.7-6 7.8-6 7.8s-6-4.1-6-7.8V5z"/><path d="m7.5 9.5 1.7 1.7 3.3-3.5"/>')}<span class="oc-control-label">Permissions</span><select data-chat-permissions aria-label="Research permissions"><option value="ask_for_dangerous">Ask</option><option value="always_allow">Full access</option></select>${chevron}</label></div><small data-chat-settings-status role="status" aria-live="polite"></small>`;
      const composer = root.querySelector('[data-research-composer]');
      const toolbar = composer.lastElementChild;
      toolbar.classList.add('oc-composer-toolbar');
      const attach = toolbar.querySelector('[data-chat-browse]');
      attach.innerHTML = icon('<path d="M10 4v12M4 10h12"/>');
      attach.setAttribute('aria-label', 'Attach files');
      attach.title = 'Attach files · Up to 30 MiB per upload';
      attach.after(bar);
      const send = toolbar.querySelector('button[type=submit]');
      send.innerHTML = icon('<path d="M10 15V5m-5 5 5-5 5 5"/>');
      send.setAttribute('aria-label', 'Run research');
      send.title = 'Send · Enter (Shift+Enter for a new line)';
      for (const field of ['model','effort','permissions']) q(`[data-chat-${field}]`).addEventListener('change', event => {void change(field,event.target.value);});
      lock();
    },
    sync(value) {
      snapshot = value;
      if (!bar) return;
      const nextStamp = [value.sessionId,value.session?.updatedAt,value.session?.modelId,value.session?.approvalMode].join(':');
      if (nextStamp !== stamp) {stamp = nextStamp; if (!pending) void refresh();}
      if (details && !loading && !pending) render(); else lock();
    },
    async beforeRun() {
      if (pending) await pending.catch(() => {});
      if (loading || error || !models.some(model => model.id === details?.effective?.modelId)) {message(error || 'Choose a model and wait for settings to finish saving.', true); return false;}
      return true;
    }
  };
})();
