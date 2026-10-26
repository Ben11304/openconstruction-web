(() => {
  const api = window.OCDesktop;
  let timer, generation = 0;
  window.OCDesktopCodex = {mount(root) {
    clearInterval(timer); const version = ++generation;
    const card = document.createElement('section'); card.className = 'oc-codex-card oc-provider-compact'; card.setAttribute('aria-label','Codex account');
    card.innerHTML = `<div class="oc-codex-heading"><img class="oc-codex-mark" src="/openconstruction-web/desktop/assets/codex.png" alt="" width="28" height="28"><h3>Codex</h3><span data-codex-badge>Checking…</span><div class="oc-provider-actions"><button type="button" class="btn btn-primary" data-codex-login>Login</button><button type="button" class="btn btn-outline-secondary" data-codex-cancel hidden>Cancel login</button><button type="button" class="btn btn-outline-secondary" data-codex-manage aria-expanded="false" aria-controls="ocCodexDetails" hidden>Manage</button></div></div>
      <div class="oc-provider-details" id="ocCodexDetails" hidden>
      <p data-codex-status role="status" aria-live="polite">Checking sign-in status…</p>
      <div data-codex-device hidden><p>Open the sign-in page on this device and enter this one-time code:</p><p><strong data-codex-code></strong></p><a data-codex-verify target="_blank" rel="noopener noreferrer">Open ChatGPT sign-in</a><p class="oc-codex-help">You are connecting a ChatGPT account to this OC host. If device login is disabled, enable it in ChatGPT Security settings or ask your workspace administrator. Keep this code private.</p></div>
      <form data-codex-form hidden><label>Codex model<select name="model" required></select></label><label class="oc-codex-current"><input type="checkbox" name="current" checked> Also use for the current research project and session</label><p class="oc-codex-help">Your selection becomes the default for new research sessions.</p><button type="submit" class="btn btn-primary">Use in Research</button></form>
      <div class="oc-codex-actions"><button type="button" class="btn btn-outline-secondary" data-codex-logout hidden>Sign out</button></div>
      <p class="oc-codex-help">Sign in with your ChatGPT account in the browser. No API key needed.</p></div>`;
    root.querySelector('.oc-research-model-list').before(card);
    let busy = false, refreshing = false, modelsLoaded = false, connected = false, loginFlow = false;
    const q = selector => card.querySelector(selector);
    const expand = open => {q('#ocCodexDetails').hidden=!open;q('[data-codex-manage]').setAttribute('aria-expanded',String(open));q('[data-codex-manage]').textContent=open?'Close':'Manage';};
    q('[data-codex-manage]').onclick=()=>expand(q('#ocCodexDetails').hidden);
    const selection = () => {
      const current = window.OCResearchWorkspace?.getSelection?.();
      return current?.sessionId ? current : window.OCDesktopLayout?.selection?.() || {};
    };
    q('.oc-codex-current').hidden = !selection().sessionId;
    const statusText = text => {q('[data-codex-status]').textContent = text;};
    const showDevice = state => {
      const device = state.pending && state.device;
      let url;
      try {url=new URL(device?.verificationUrl);} catch {}
      const valid=device && url?.protocol==='https:' && ['auth.openai.com','chatgpt.com'].includes(url.hostname) && !url.username && !url.password;
      q('[data-codex-device]').hidden=!valid;
      q('[data-codex-code]').textContent=valid ? device.userCode : '';
      if(valid) q('[data-codex-verify]').href=url.href;
      else q('[data-codex-verify]').removeAttribute('href');
    };
    async function refresh() {
      if(refreshing || version !== generation || !card.isConnected) return;
      refreshing = true;
      try {
        const state = await api.codexStatus(); if(version !== generation || !card.isConnected) return;
        connected = state.connected;
        showDevice(state);
        q('[data-codex-manage]').hidden=!connected;
        if(state.pending || state.error || (connected && loginFlow)) expand(true);
        if(connected) loginFlow=false;
        q('[data-codex-badge]').textContent = state.connected ? 'Signed in' : state.pending ? 'Waiting for login' : 'Not connected';
        q('[data-codex-badge]').classList.toggle('is-connected',state.connected);
        q('[data-codex-login]').hidden = state.connected || state.pending;
        q('[data-codex-login]').disabled = busy || !state.available;
        q('[data-codex-cancel]').hidden = !state.pending;
        q('[data-codex-logout]').hidden = !state.connected;
        q('[data-codex-form]').hidden = !state.connected;
        if(!busy) statusText(state.error || (state.connected ? [state.email,state.plan].filter(Boolean).join(' · ') || 'Codex account connected.' : state.pending ? 'Complete sign-in in your browser, then return here.' : 'Ready to sign in.'));
        if(state.connected && !modelsLoaded) {
          const models = await api.codexModels(); if(version !== generation || !card.isConnected) return;
          const select=q('select');select.replaceChildren();
          for(const model of models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;option.selected=state.model ? model.id===state.model : model.isDefault;select.append(option);}
          modelsLoaded = true;
          q('[data-codex-form] button').disabled = !models.length;
          if(!models.length) statusText('No Codex models are available for this account.');
        }
        if(!state.connected) modelsLoaded = false;
      } catch(error) {expand(true);statusText(error.message);} finally {refreshing=false;}
    }
    async function action(fn) {
      if(busy)return;busy=true;card.querySelectorAll('button').forEach(b=>{b.disabled=true;});
      try {await fn();} catch(error) {expand(true);statusText(error.message);}
      finally {busy=false;card.querySelectorAll('button').forEach(b=>{b.disabled=false;});}
    }
    q('[data-codex-login]').onclick=()=>action(async()=>{loginFlow=true;expand(true);statusText(api.platform==='web' ? 'Preparing device sign-in…' : 'Opening your browser…');const result=await api.loginCodex();showDevice(result);await refresh();statusText(result.device ? 'Open ChatGPT sign-in and enter the code above, then return here.' : 'Complete sign-in in your browser, then return here.');});
    q('[data-codex-cancel]').onclick=()=>action(async()=>{loginFlow=false;await api.cancelCodexLogin();await refresh();statusText('Login cancelled.');});
    q('[data-codex-logout]').onclick=()=>action(async()=>{await api.logoutCodex();modelsLoaded=false;expand(false);await refresh();statusText('Signed out of Codex for OpenConstruction.');});
    q('[data-codex-form]').onsubmit=event=>{
      event.preventDefault();
      void action(async()=>{
        statusText('Connecting Codex to Research…');
        await api.connectCodexModel({model:q('select').value,...(q('[name=current]').checked ? selection() : {})});
        // Refresh the existing registry through its own handler and keep the user on Models.
        root.querySelector('[data-research-config-refresh]').click();
      });
    };
    void refresh();
    timer=setInterval(()=>{if(!card.isConnected){clearInterval(timer);return;}if(!connected && !busy)void refresh();},1800);
  }};
  window.addEventListener('pagehide',()=>{clearInterval(timer);generation++;});
})();
