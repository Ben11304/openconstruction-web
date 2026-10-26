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
  const status = message => {
    const show = () => {
      let banner = document.getElementById('oc-connection-status');
      if (!banner) { banner = document.createElement('div'); banner.id='oc-connection-status'; banner.setAttribute('role','status'); banner.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;z-index:99999;padding:12px;background:#182230;color:white;border-radius:8px;text-align:center'; document.body.append(banner); }
      banner.textContent = message; banner.hidden = !message;
    };
    if(document.body) show(); else document.addEventListener('DOMContentLoaded',show,{once:true});
  };
  window.OCWebConnection = {
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
      if(response.status===401 && !url.pathname.startsWith('/api/public/') && !location.pathname.endsWith('/web/login.html')) {
        setToken(''); location.assign(loginURL+'?next='+encodeURIComponent(location.pathname+location.search));
      }
      return response;
    } catch(error) {
      if(error.name !== 'AbortError') status('Máy chủ đang ngoại tuyến hoặc kết nối bị gián đoạn. Hãy thử lại sau.');
      throw error;
    }
  };
  // Download links cannot attach Authorization themselves. Fetch protected files
  // explicitly so tokens never appear in URLs, browser history or server logs.
  document.addEventListener('click', async event => {
    const anchor = event.target.closest?.('a[href]');
    if(!anchor) return;
    const url = new URL(anchor.href,location.href);
    if(url.origin === location.origin && /^\/projects(?:\/|$)/.test(url.pathname)) { event.preventDefault(); location.assign(backend.origin+url.pathname+url.search); return; }
    if(url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    try {
      const response=await fetch(url.href);
      if(!response.ok) throw new Error('Download failed.');
      const blob=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=blob;link.download=anchor.download||'download';link.click();setTimeout(()=>URL.revokeObjectURL(blob),60000);
    } catch { status('Không tải được tệp. Kiểm tra kết nối và đăng nhập.'); }
  });
})();
