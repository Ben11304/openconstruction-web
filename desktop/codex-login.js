(() => {
  const api = window.OCDesktop;
  let timer, generation = 0;
  window.OCDesktopCodex = {mount(root) {
    clearInterval(timer); const version = ++generation;
    const card = document.createElement('section'); card.className = 'oc-codex-card oc-provider-compact'; card.setAttribute('aria-label','Codex account');
    card.innerHTML = `<div class="oc-codex-heading"><img class="oc-codex-mark" src="/openconstruction-web/desktop/assets/codex.png" alt="" width="28" height="28"><h3>Codex</h3><span data-codex-badge>Checking…</span><div class="oc-provider-actions"><button type="button" class="btn btn-primary" data-codex-login>Sign in with ChatGPT</button><button type="button" class="btn btn-outline-secondary" data-codex-device-login hidden>Use a device code</button><button type="button" class="btn btn-outline-secondary" data-codex-cancel hidden>Cancel login</button><button type="button" class="btn btn-outline-secondary" data-codex-manage aria-expanded="false" aria-controls="ocCodexDetails" hidden>Manage</button></div></div>
      <p data-codex-method-help class="oc-codex-help" hidden>Browser sign-in works on the computer running this workspace. On another computer, use a device code.</p>
      <div class="oc-provider-details" id="ocCodexDetails" hidden>
      <p data-codex-status role="status" aria-live="polite">Checking sign-in status…</p>
      <div data-codex-browser hidden><a data-codex-browser-open target="_blank" rel="noopener noreferrer">Open ChatGPT sign-in</a><p class="oc-codex-help">Complete sign-in on the computer running this workspace, then return here.</p></div>
      <div data-codex-device hidden><p>Open the sign-in page on this device and enter this one-time code:</p><p><strong data-codex-code></strong></p><a data-codex-verify target="_blank" rel="noopener noreferrer">Open ChatGPT sign-in</a><p class="oc-codex-help">You are connecting a ChatGPT account to this OC host. If device login is disabled, enable it in ChatGPT Security settings or ask your workspace administrator. Keep this code private.</p></div>
      <div class="oc-codex-actions"><button type="button" class="btn btn-outline-secondary" data-codex-logout hidden>Sign out</button></div>
      <p class="oc-codex-help">Sign in with your ChatGPT account in the browser. No API key needed.</p></div>`;
    root.querySelector('.oc-research-model-list').before(card);
    let busy = false, refreshing = false, connected = false, loginFlow = false;
    const q = selector => card.querySelector(selector);
    const expand = open => {q('#ocCodexDetails').hidden=!open;q('[data-codex-manage]').setAttribute('aria-expanded',String(open));q('[data-codex-manage]').textContent=open?'Close':'Manage';};
    q('[data-codex-manage]').onclick=()=>expand(q('#ocCodexDetails').hidden);
    const statusText = text => {q('[data-codex-status]').textContent = text;};
    const signInUrl = value => {
      try {const url=new URL(value);if(url.protocol==='https:' && ['auth.openai.com','chatgpt.com'].includes(url.hostname) && !url.username && !url.password)return url.href;} catch {}
      return '';
    };
    const showDevice = state => {
      const device = state.pending && state.device;
      let url;
      try {url=new URL(device?.verificationUrl);} catch {}
      const valid=device && url?.protocol==='https:' && ['auth.openai.com','chatgpt.com'].includes(url.hostname) && !url.username && !url.password;
      q('[data-codex-device]').hidden=!valid;
      q('[data-codex-code]').textContent=valid ? device.userCode : '';
      if(valid) q('[data-codex-verify]').href=url.href;
      else q('[data-codex-verify]').removeAttribute('href');
      const authUrl=state.pending && signInUrl(state.authUrl);
      q('[data-codex-browser]').hidden=!authUrl;
      if(authUrl)q('[data-codex-browser-open]').href=authUrl;
      else q('[data-codex-browser-open]').removeAttribute('href');
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
        q('[data-codex-device-login]').hidden = api.platform!=='web' || state.connected || Boolean(state.device);
        q('[data-codex-device-login]').disabled = busy || !state.available;
        q('[data-codex-method-help]').hidden = api.platform!=='web' || state.connected;
        q('[data-codex-cancel]').hidden = !state.pending;
        q('[data-codex-logout]').hidden = !state.connected;
        if(!busy) statusText(state.error || (state.connected ? [state.email,state.plan].filter(Boolean).join(' · ') || 'Codex account connected.' : state.pending ? 'Complete sign-in in your browser, then return here.' : 'Ready to sign in.'));
      } catch(error) {expand(true);statusText(error.message);} finally {refreshing=false;}
    }
    async function action(fn) {
      if(busy)return;busy=true;card.querySelectorAll('button').forEach(b=>{b.disabled=true;});
      try {await fn();} catch(error) {expand(true);statusText(error.message);}
      finally {busy=false;card.querySelectorAll('button').forEach(b=>{b.disabled=false;});}
    }
    const beginLogin = mode => action(async()=>{
      // Open during the click so an async host request does not trigger popup blocking.
      const popup=api.platform==='web' && mode==='browser' ? window.open('about:blank','_blank') : null;
      if(popup)popup.opener=null;
      try {
        loginFlow=true;expand(true);statusText(mode==='device' ? 'Preparing device sign-in…' : 'Opening your browser…');
        const result=await api.loginCodex(mode);
        const authUrl=signInUrl(result.authUrl);
        if(result.authUrl && !authUrl)throw new Error('Unexpected ChatGPT sign-in address.');
        if(popup && authUrl && version===generation && card.isConnected)popup.location.replace(authUrl);
        else popup?.close();
        showDevice(result);await refresh();
        statusText(result.device ? 'Open ChatGPT sign-in and enter the code above, then return here.' : authUrl && !popup ? 'Select Open ChatGPT sign-in to continue.' : 'Complete sign-in in your browser, then return here.');
      } catch(error) {popup?.close();throw error;}
    });
    q('[data-codex-login]').onclick=()=>beginLogin('browser');
    q('[data-codex-device-login]').onclick=()=>beginLogin('device');
    q('[data-codex-cancel]').onclick=()=>action(async()=>{loginFlow=false;await api.cancelCodexLogin();await refresh();statusText('Login cancelled.');});
    q('[data-codex-logout]').onclick=()=>action(async()=>{await api.logoutCodex();expand(false);await refresh();statusText('Signed out of Codex for OpenConstruction.');});
    void refresh();
    timer=setInterval(()=>{if(!card.isConnected){clearInterval(timer);return;}if(!connected && !busy)void refresh();},1800);
  }};
  window.addEventListener('pagehide',()=>{clearInterval(timer);generation++;});
})();
