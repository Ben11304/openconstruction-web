(() => {
  'use strict';
  const config = window.OC_WEB_CONFIG || {};
  if (!config.backendOrigin) return; // Existing gateway-hosted UI is unchanged.
  const backend = new URL(config.backendOrigin);
  if (backend.protocol !== 'https:' && !(backend.protocol === 'http:' && backend.hostname === '127.0.0.1')) throw new Error('An HTTPS backend is required.');
  const base = config.basePath || '/';
  const key = `oc.browser-session:${backend.origin}`;
  const nativeFetch = window.fetch.bind(window);
  const loginURL = base + 'web/login.html';
  const getToken = () => { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } };
  const setToken = value => { if(value) sessionStorage.setItem(key,value); else sessionStorage.removeItem(key); };
  const isWorkspacePage = pathname => {
    if (!pathname.startsWith(base)) return false;
    const page = pathname.slice(base.length);
    return page === 'research.html' || page === 'account.html' || /^desktop\/(?:projects|platform|admin|workspace|settings)\.html$/.test(page);
  };
  const signInURL = next => loginURL + '?next=' + encodeURIComponent(next);
  const returnTo = () => location.pathname + location.search + location.hash;
  // Static Pages cannot enforce sessions. Gate workspace navigation here; the
  // gateway continues to authorize every private API request independently.
  if (isWorkspacePage(location.pathname) && !getToken()) location.replace(signInURL(returnTo()));
  const status = message => {
    const show = () => {
      let banner = document.getElementById('oc-connection-status');
      if (!banner) { banner = document.createElement('div'); banner.id='oc-connection-status'; banner.setAttribute('role','status'); banner.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;z-index:99999;padding:12px;background:#182230;color:white;border-radius:8px;text-align:center'; document.body.append(banner); }
      banner.textContent = message; banner.hidden = !message;
    };
    if(document.body) show(); else document.addEventListener('DOMContentLoaded',show,{once:true});
  };
  window.OCWebConnection = {
    signInURL,
    hasSession: () => Boolean(getToken()),
    async signIn(email,password) {
      const response = await nativeFetch(backend.origin+'/auth/browser-session',{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(20000)});
      const result = await response.json();
      if(!response.ok) throw new Error(result.error || 'Sign-in failed.');
      setToken(result.token); return result.user;
    },
    async signOut() {
      try { await nativeFetch(backend.origin+'/auth/browser-session',{method:'DELETE',credentials:'omit',redirect:'error',headers:{Authorization:`Bearer ${getToken()}`},signal:AbortSignal.timeout(15000)}); }
      finally { setToken(''); }
    },
  };
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if(url.origin !== location.origin || !/^\/(?:api\/|auth\/|healthz?$)/.test(url.pathname)) return nativeFetch(input,init);
    if(url.pathname === '/auth/logout') { await window.OCWebConnection.signOut(); return new Response('{}',{headers:{'Content-Type':'application/json'}}); }
    const request = new Request(input,init);
    const headers = new Headers(request.headers);
    const token = getToken();
    if(token) headers.set('Authorization',`Bearer ${token}`);
    else headers.delete('Authorization');
    const target = backend.origin+url.pathname+url.search;
    try {
      const response = await nativeFetch(target,{method:request.method,headers,credentials:'omit',redirect:'error',cache:'no-store',signal:request.signal,...(!['GET','HEAD'].includes(request.method)?{body:await request.arrayBuffer()}:{})});
      status('');
      if(response.status===401 && !url.pathname.startsWith('/api/public/')) {
        setToken('');
        if (isWorkspacePage(location.pathname)) location.assign(signInURL(returnTo()));
      }
      return response;
    } catch(error) {
      if(error.name !== 'AbortError') status('The workspace server is offline or the connection was interrupted. Please try again.');
      throw error;
    }
  };
  // Download links cannot attach Authorization themselves. Fetch protected files
  // explicitly so tokens never appear in URLs, browser history or server logs.
  document.addEventListener('click', async event => {
    const anchor = event.target.closest?.('a[href]');
    if(!anchor) return;
    const url = new URL(anchor.href,location.href);
    if (!event.defaultPrevented && url.origin === location.origin && isWorkspacePage(url.pathname) && !getToken()) {
      event.preventDefault(); location.assign(signInURL(url.pathname + url.search + url.hash)); return;
    }
    if(url.origin === location.origin && /^\/projects(?:\/|$)/.test(url.pathname)) { event.preventDefault(); location.assign(backend.origin+url.pathname+url.search); return; }
    if(url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    try {
      const response=await fetch(url.href);
      if(!response.ok) throw new Error('Download failed.');
      const blob=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=blob;link.download=anchor.download||'download';link.click();setTimeout(()=>URL.revokeObjectURL(blob),60000);
    } catch { status('Unable to download the file. Check your connection and sign in again.'); }
  });
})();
