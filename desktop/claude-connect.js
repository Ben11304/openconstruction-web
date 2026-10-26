(() => {
  const api=window.OCDesktop;
  let timer,generation=0;
  window.OCDesktopClaude={mount(root){
    clearInterval(timer);const version=++generation;
    const modelForm=(kind,label)=>`<form data-claude-${kind}-form hidden><label>${label}<select name="model" required></select></label><label class="oc-codex-current"><input type="checkbox" name="default"> Use as the global default</label><label class="oc-codex-current"><input type="checkbox" name="current"> Use for the current project and session</label><button type="submit" class="btn btn-primary">Use in Research</button></form>`;
    const card=document.createElement('section');card.className='oc-codex-card oc-claude-card oc-provider-compact';card.setAttribute('aria-label','Claude account');
    card.innerHTML=`<div class="oc-codex-heading"><img class="oc-codex-mark" src="/openconstruction-web/desktop/assets/claude.png" alt="" width="28" height="28"><h3>Claude</h3><span data-claude-badge>Checking…</span><div class="oc-provider-actions"><button type="button" class="btn btn-primary" data-claude-login>Login</button><button type="button" class="btn btn-outline-secondary" data-claude-cancel hidden>Cancel login</button><button type="button" class="btn btn-outline-secondary" data-claude-manage aria-expanded="false" aria-controls="ocClaudeDetails">Options</button></div></div>
      <div class="oc-provider-details" id="ocClaudeDetails" hidden>
      <p data-claude-status role="status" aria-live="polite">Checking sign-in status…</p>
      ${modelForm('account','Claude account model')}
      <div class="oc-codex-actions"><button type="button" class="btn btn-outline-secondary" data-claude-logout hidden>Sign out</button><button type="button" class="btn btn-outline-secondary" data-claude-refresh-account hidden>Refresh models</button></div>
      <p class="oc-codex-help">Sign in with your Claude account in the browser through Claude Code. Your plan’s access and usage limits apply.</p>
      <details data-claude-api><summary>Use an API key instead</summary>
      <form data-claude-key-form><label>Anthropic API key<input name="apiKey" type="password" autocomplete="new-password" required maxlength="4096" placeholder="Enter your API key"></label><div class="oc-codex-actions"><button class="btn btn-primary" type="submit">Connect API key</button><button class="btn btn-outline-secondary" type="button" data-claude-refresh hidden>Refresh API models</button><button class="btn btn-outline-secondary" type="button" data-claude-disconnect hidden>Remove API key</button></div></form>
      ${modelForm('api','Claude API model')}
      <p class="oc-codex-help">API usage is billed separately to your Anthropic Console account. <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">Get an API key</a></p>
      <button type="button" class="btn btn-outline-secondary" data-claude-console>Sign in to Claude Console</button>
      </details></div>`;
    root.querySelector('.oc-research-model-list').before(card);
    const q=selector=>card.querySelector(selector),alive=()=>version===generation&&card.isConnected;
    let busy=false,refreshing=false,connected=false,hasKey=false,loaded=false,apiLoaded=false,loginFlow=false;
    const status=text=>{q('[data-claude-status]').textContent=text;};
    const selection=()=>window.OCResearchWorkspace?.getSelection?.()||window.OCDesktopLayout?.selection?.()||{};
    const expand=open=>{q('#ocClaudeDetails').hidden=!open;q('[data-claude-manage]').setAttribute('aria-expanded',String(open));q('[data-claude-manage]').textContent=open?'Close':connected||hasKey?'Manage':'Options';};
    q('[data-claude-manage]').onclick=()=>expand(q('#ocClaudeDetails').hidden);
    for(const kind of ['account','api']){
      const form=q(`[data-claude-${kind}-form]`),current=selection();
      form.elements.current.checked=Boolean(current.projectId);form.elements.current.closest('label').hidden=!current.projectId;form.elements.default.checked=!current.projectId;
      form.onsubmit=event=>{
        event.preventDefault();const target=selection();
        const input={model:form.elements.model.value,useAsDefault:form.elements.default.checked,...(form.elements.current.checked?{projectId:target.projectId,sessionId:target.sessionId}:{})};
        void action(async()=>{status('Connecting Claude to Research…');await (kind==='account'?api.connectClaudeAccountModel(input):api.connectClaudeModel(input));root.querySelector('[data-research-config-refresh]').click();});
      };
    }
    async function loadModels(kind,preferred){
      const form=q(`[data-claude-${kind}-form]`);form.hidden=true;
      const models=await (kind==='account'?api.claudeAccountModels():api.claudeModels());if(!alive())return;
      form.elements.model.replaceChildren();
      for(const model of models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;option.selected=model.id===preferred;form.elements.model.append(option);}
      form.hidden=!models.length;
      if(!models.length)throw new Error('No Claude models are available for this connection.');
      if(kind==='account')loaded=true;else apiLoaded=true;
    }
    async function refresh(){
      if(refreshing||!alive())return;refreshing=true;
      try{
        const state=await api.claudeStatus();if(!alive())return;
        const justConnected=!connected&&state.connected;connected=state.connected;hasKey=state.hasApiToken;
        q('[data-claude-badge]').textContent=connected?'Signed in':state.pending?'Waiting for login':hasKey?'API key saved':'Not connected';
        q('[data-claude-badge]').classList.toggle('is-connected',connected);
        q('[data-claude-login]').hidden=connected||state.pending;q('[data-claude-cancel]').hidden=!state.pending;
        q('[data-claude-logout]').hidden=!connected;q('[data-claude-refresh-account]').hidden=!connected;
        q('[data-claude-refresh]').hidden=!hasKey;q('[data-claude-disconnect]').hidden=!hasKey;
        q('[data-claude-console]').hidden=connected||state.pending;
        expand(!q('#ocClaudeDetails').hidden);
        if(state.pending||state.error||(justConnected&&loginFlow))expand(true);
        if(!connected){loaded=false;q('[data-claude-account-form]').hidden=true;}
        if(!hasKey){apiLoaded=false;q('[data-claude-api-form]').hidden=true;}
        if(connected&&!loaded)await loadModels('account',state.accountModel);
        if(hasKey&&!apiLoaded)await loadModels('api',state.model);
        if(state.error)status(state.error);
        else if(state.pending)status('Finish signing in in your browser. This page updates automatically.');
        else if(connected&&(!loaded||justConnected||loginFlow))status('Signed in. Choose a model, then select Use in Research.');
        else if(!connected&&!hasKey)status('Choose Login to connect your Claude account. No API key needed.');
        if(connected)loginFlow=false;
      }catch(error){expand(true);status(error.message);}finally{refreshing=false;}
    }
    async function action(fn){
      if(busy)return;busy=true;card.querySelectorAll('button,input,select').forEach(el=>{el.disabled=true;});
      try{await fn();}catch(error){expand(true);status(error.message);}finally{busy=false;card.querySelectorAll('button,input,select').forEach(el=>{el.disabled=false;});}
    }
    const login=useConsole=>void action(async()=>{loginFlow=true;expand(true);status('Opening the Claude sign-in page…');await api.loginClaude({console:useConsole});await refresh();});
    q('[data-claude-login]').onclick=()=>login(false);q('[data-claude-console]').onclick=()=>login(true);
    q('[data-claude-cancel]').onclick=()=>void action(async()=>{loginFlow=false;await api.cancelClaudeLogin();await refresh();status('Login cancelled.');});
    q('[data-claude-logout]').onclick=()=>void action(async()=>{await api.logoutClaude();loaded=false;await refresh();expand(false);});
    q('[data-claude-refresh-account]').onclick=()=>void action(async()=>{loaded=false;await loadModels('account',q('[data-claude-account-form]').elements.model.value);status('Claude models refreshed.');});
    q('[data-claude-key-form]').onsubmit=event=>{event.preventDefault();const apiKey=q('[name=apiKey]').value;void action(async()=>{
      try{await api.saveClaudeKey({apiKey});apiLoaded=false;}finally{q('[name=apiKey]').value='';}
      await refresh();q('[data-claude-api]').open=true;status('API key saved. Choose an API model below.');
    });};
    q('[data-claude-refresh]').onclick=()=>void action(()=>loadModels('api',q('[data-claude-api-form]').elements.model.value));
    q('[data-claude-disconnect]').onclick=()=>void action(async()=>{await api.disconnectClaude();apiLoaded=false;await refresh();status('API key removed.');});
    void refresh();timer=setInterval(()=>{if(!alive()){clearInterval(timer);return;}if(!busy)void refresh();},3000);
  }};
})();
