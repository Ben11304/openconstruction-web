(() => {
  const api = window.OCDesktop;
  if (!api) return;
  const web = api.platform === 'web';
  const imageFallback = img => {
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-oc-image-fallback')) return;
    img.removeAttribute('data-oc-image-fallback');
    img.src = '/openconstruction-web/assets/img/previews/0088a2707332b749e38d1585.webp';
    img.classList.add('is-fallback');
    const note = img.closest('.media-wrap')?.querySelector('[data-media-fallback-note]');
    if (note) note.hidden = false;
  };
  document.addEventListener('error', event => imageFallback(event.target), true);
  const mount = () => {
    document.querySelectorAll('img[data-oc-image-fallback]').forEach(img => { if (img.complete && !img.naturalWidth) imageFallback(img); });
    const routes = web ? {Home:'/openconstruction-web/index.html',Workspace:'/openconstruction-web/desktop/projects.html',Research:'/openconstruction-web/research.html',Catalog:'/openconstruction-web/dataset.html',Admin:'/openconstruction-web/desktop/admin.html'} : {Home:'/openconstruction-web/index.html',Workspace:'/openconstruction-web/desktop/platform.html',Research:'/openconstruction-web/research.html',Catalog:'/openconstruction-web/dataset.html',Admin:'/openconstruction-web/desktop/admin.html',Notes:'/openconstruction-web/desktop/workspace.html'};
    const current = location.pathname;
    const home = current === '/' || current === routes.Home || current === routes.Home.replace(/index\.html$/, '');
    document.body.classList.toggle('oc-home-page', home && !web);
    document.body.classList.toggle('oc-web-home', home && web);
    // Home is the inherited OpenConstruction web experience. Keep the desktop
    // application chrome off this page so its original hierarchy stays intact.
    if (home && !web) {
      const create = document.createElement('div'); create.className = 'oc-home-create';
      const createTrigger = document.createElement('button'); createTrigger.type = 'button'; createTrigger.className = 'oc-home-create-trigger';
      createTrigger.dataset.createProject = ''; createTrigger.setAttribute('aria-label', 'Create'); createTrigger.setAttribute('aria-haspopup', 'menu'); createTrigger.setAttribute('aria-expanded', 'false');
      createTrigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
      const createMenu = document.createElement('div'); createMenu.className = 'oc-home-create-menu'; createMenu.hidden = true; createMenu.setAttribute('role', 'menu');
      const projectLink = document.createElement('a'); projectLink.href = web ? '/openconstruction-web/desktop/projects.html?action=new' : '/openconstruction-web/desktop/workspace.html?action=new'; projectLink.dataset.createProjectAction = ''; projectLink.setAttribute('role', 'menuitem');
      projectLink.innerHTML = '<strong>New project</strong><small>Create a research workspace project</small>'; createMenu.append(projectLink); create.append(createTrigger, createMenu);
      const closeCreate = () => { createMenu.hidden = true; createTrigger.setAttribute('aria-expanded', 'false'); };
      createTrigger.onclick = event => { event.stopPropagation(); const opening = createMenu.hidden; createMenu.hidden = !opening; createTrigger.setAttribute('aria-expanded', String(opening)); if (opening) projectLink.focus(); };
      createMenu.onclick = event => event.stopPropagation(); document.addEventListener('click', closeCreate); document.addEventListener('keydown', event => { if (event.key === 'Escape' && !createMenu.hidden) { closeCreate(); createTrigger.focus(); } });
      (document.querySelector('.oc-header-search') || document.querySelector('.navbar-brand'))?.after(create);
      return;
    }
    const rail = document.createElement('nav'); rail.id = 'oc-app-sidebar'; rail.className = 'oc-app-rail'; rail.setAttribute('aria-label', 'Application');
    const brand = document.createElement('a'); brand.className = 'oc-app-brand'; brand.href = '/openconstruction-web/index.html'; brand.title = 'OpenConstruction Home'; brand.setAttribute('aria-label', 'OpenConstruction Home');
    brand.innerHTML = '<img src="/openconstruction-web/assets/img/previews/e6d564f34998d4ea9fbbb4fc.webp" alt="" width="42" height="42">';
    rail.append(brand);
    if(web){
      const create=document.createElement('a');create.className='oc-sidebar-create';create.href='/openconstruction-web/desktop/projects.html?action=new';
      create.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Create</span>';rail.append(create);
    }
    const icons = { Home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/>', Workspace:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M8 5V3h8v2M3 11h18M9 11v9"/>', Research:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>', Catalog:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', Admin:'<path d="M12 3 4.5 6v5.5c0 4.8 3.2 8 7.5 9.5 4.3-1.5 7.5-4.7 7.5-9.5V6z"/><path d="M9 12h6M12 9v6"/>', Notes:'<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"/>', Account:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>', Settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>' };
    const settingsView = current === routes.Research && ['memory','agent','models','mcp'].includes(new URLSearchParams(location.search).get('view'));
    const active = current === '/openconstruction-web/account.html' || current === '/openconstruction-web/desktop/settings.html' || current.startsWith('/auth/') || settingsView ? 'Account' : home ? 'Home' : current === routes.Workspace || current === '/openconstruction-web/desktop/projects.html' || /^\/projects(?:\/|$)/.test(current) ? 'Workspace' : current === routes.Research ? 'Research' : current === routes.Admin ? 'Admin' : current === routes.Notes ? 'Notes' : 'Catalog';
    for (const [name, href] of Object.entries(routes)) {
      if(web&&name==='Catalog')continue;
      const label = web && name === 'Workspace' ? 'My project' : name;
      const link = document.createElement('a'); link.href = href; link.title = label; link.dataset.appDestination = name;
      link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${icons[name]}</svg><span>${label}</span>`;
      if (name === active) link.setAttribute('aria-current', 'page');
      if (web && name === 'Admin') link.hidden = true;
      rail.append(link);
    }
    if (web || active !== 'Research') {
      const reload=document.createElement('button');reload.type='button';reload.className='oc-app-reload';reload.title='Reload';reload.setAttribute('aria-label','Reload');
      reload.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5"/></svg><span>Reload</span>';
      reload.onclick=()=>location.reload();rail.append(reload);
    }
    const account = document.createElement('button'); account.type = 'button'; account.className = 'oc-app-account'; account.title = 'Account and settings';
    const signIn = web ? document.createElement('a') : null;
    if (web) {
      signIn.className = 'oc-web-sign-in'; signIn.textContent = 'Sign in';
      signIn.href = '/openconstruction-web/web/login.html?next=' + encodeURIComponent('/openconstruction-web/desktop/projects.html');
      account.hidden = true;
    }
    account.setAttribute('aria-label','Account and settings');account.setAttribute('aria-haspopup','menu');account.setAttribute('aria-expanded','false');
    const defaultAvatar = '/openconstruction-web/assets/img/previews/6643f80db550f5bc6e4e068a.webp?v=builder-beaver-1';
    const accountAvatar = document.createElement('img');
    accountAvatar.className = 'oc-account-avatar'; accountAvatar.alt = ''; accountAvatar.width = 32; accountAvatar.height = 32;
    accountAvatar.addEventListener('error', () => {
      if (accountAvatar.getAttribute('src') !== defaultAvatar) accountAvatar.src = defaultAvatar;
    });
    accountAvatar.src = defaultAvatar;
    const accountLabel = document.createElement('span'); accountLabel.textContent = 'Account';
    account.append(accountAvatar, accountLabel);
    if(active==='Account')account.classList.add('is-active');
    const accountMenu=document.createElement('div');accountMenu.className='oc-account-menu';accountMenu.hidden=true;accountMenu.setAttribute('role','menu');accountMenu.setAttribute('aria-label','Account settings');
    const menuTitle=document.createElement('strong');menuTitle.textContent='Settings';accountMenu.append(menuTitle);
    const menuWorkspace=document.createElement('small');menuWorkspace.hidden=true;menuWorkspace.style.cssText='display:block;padding:0 12px 8px;color:#718493;font-size:10px;overflow-wrap:anywhere';accountMenu.append(menuWorkspace);
    const settingsEntries={
      'My account':'/openconstruction-web/desktop/platform.html#account',
      'Project memory':'/openconstruction-web/research.html?view=memory',
      'Agent settings':'/openconstruction-web/research.html?view=agent',
      'Models':'/openconstruction-web/research.html?view=models',
      'MCP servers':'/openconstruction-web/research.html?view=mcp',
    };
    for(const [name,href] of Object.entries(settingsEntries)){
      const link=document.createElement('a');link.href=href;link.textContent=name;link.setAttribute('role','menuitem');
      if(current==='/openconstruction-web/research.html'&&new URL(href,location.href).search===location.search)link.setAttribute('aria-current','page');
      accountMenu.append(link);
    }
    const divider=document.createElement('span');divider.className='oc-account-menu-divider';divider.setAttribute('aria-hidden','true');accountMenu.append(divider);
    if(web){
      const signOut=document.createElement('button');signOut.type='button';signOut.textContent='Sign out';signOut.setAttribute('role','menuitem');
      signOut.onclick=async()=>{signOut.disabled=true;await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'}});location.href='/openconstruction-web/web/login.html?logged_out=1';};accountMenu.append(signOut);
    }else{
      for(const [name,href] of [['Desktop settings','/openconstruction-web/desktop/settings.html'],['Open account','/openconstruction-web/account.html']]){const link=document.createElement('a');link.href=href;link.textContent=name;link.setAttribute('role','menuitem');accountMenu.append(link);}
    }
    const closeAccount=()=>{accountMenu.hidden=true;account.setAttribute('aria-expanded','false');};
    account.onclick=event=>{event.stopPropagation();const opening=accountMenu.hidden;accountMenu.hidden=!opening;account.setAttribute('aria-expanded',String(opening));if(opening)accountMenu.querySelector('[role=menuitem]')?.focus();};
    accountMenu.onclick=event=>event.stopPropagation();document.addEventListener('click',closeAccount);document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!accountMenu.hidden){closeAccount();account.focus();}});
    if(!web)rail.append(account);document.body.append(accountMenu);
    document.body.prepend(rail);
    if(web){
      const header=document.createElement('header');header.className='oc-web-topbar';
      const toggle=document.createElement('button');toggle.type='button';toggle.className='oc-sidebar-toggle';toggle.setAttribute('aria-controls',rail.id);
      toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      const title=document.createElement('a');title.className='oc-web-wordmark';title.href='/openconstruction-web/index.html';title.setAttribute('aria-label','OpenConstruction Home');
      title.innerHTML='<img src="/openconstruction-web/assets/img/previews/e6d564f34998d4ea9fbbb4fc.webp" alt="" width="36" height="36"><span>OpenConstruction</span>';
      const search=document.createElement('a');search.href='/openconstruction-web/search.html';search.className='oc-topbar-search';search.setAttribute('aria-label','Search catalog');search.title='Search catalog';
      search.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
      const searchForm=document.createElement('form');searchForm.className='oc-topbar-search-form';searchForm.id='oc-web-search';searchForm.action='/openconstruction-web/search.html';searchForm.method='get';searchForm.hidden=true;searchForm.setAttribute('role','search');
      const searchInput=document.createElement('input');searchInput.type='search';searchInput.name='q';searchInput.placeholder='Search datasets, models, workflows…';searchInput.setAttribute('aria-label','Search catalog');searchInput.autocomplete='off';searchInput.value=new URLSearchParams(location.search).get('q')||'';
      const searchSubmit=document.createElement('button');searchSubmit.type='submit';searchSubmit.setAttribute('aria-label','Submit search');searchSubmit.innerHTML=search.innerHTML;
      const searchClose=document.createElement('button');searchClose.type='button';searchClose.setAttribute('aria-label','Close search');searchClose.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
      searchForm.append(searchInput,searchSubmit,searchClose);search.setAttribute('aria-controls',searchForm.id);search.setAttribute('aria-expanded','false');
      const setSearchOpen=(open,focus=true)=>{searchForm.hidden=!open;header.classList.toggle('is-searching',open);search.setAttribute('aria-expanded',String(open));if(open)closeAccount();if(focus)(open?searchInput:search).focus();};
      search.onclick=event=>{event.preventDefault();setSearchOpen(true);};searchClose.onclick=()=>setSearchOpen(false);
      searchForm.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setSearchOpen(false);}});
      searchForm.addEventListener('submit',event=>{searchInput.value=searchInput.value.trim();if(!searchInput.value){event.preventDefault();searchInput.focus();}});
      header.append(toggle,title,search,searchForm,signIn,account);document.body.prepend(header);
      if(current==='/openconstruction-web/search.html')setSearchOpen(true,false);
      const backdrop=document.createElement('button');backdrop.type='button';backdrop.className='oc-sidebar-backdrop';backdrop.tabIndex=-1;backdrop.setAttribute('aria-label','Close sidebar');document.body.append(backdrop);
      // Keep the same destinations on Home, catalog, research and account pages.
      const navLink=(name,href,icon)=>{
        const link=document.createElement('a');link.href=href;link.textContent=name;link.dataset.appDestination=name;
        if(icon)link.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${icon}</svg><span>${name}</span>`;
        if(current===href){rail.querySelector('[aria-current="page"]')?.removeAttribute('aria-current');link.setAttribute('aria-current','page');}
        return link;
      };
      rail.append(navLink('Benchmarks','/openconstruction-web/benchmarks.html','<path d="M4 21V11h4v10M10 21V3h4v18M16 21V7h4v14"/>'));
      const group=(label,icon,entries)=>{
        const details=document.createElement('details');details.className='oc-sidebar-group';details.open=true;
        const summary=document.createElement('summary');summary.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${icon}</svg><span>${label}</span><svg class="oc-sidebar-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>`;
        details.append(summary);for(const [name,href] of Object.entries(entries))details.append(navLink(name,href));rail.append(details);
      };
      group('Data Hub',icons.Catalog,{Datasets:'/openconstruction-web/dataset.html',Models:'/openconstruction-web/models.html',Workflows:'/openconstruction-web/deployments.html',Skills:'/openconstruction-web/desktop/skills.html',Connectors:'/openconstruction-web/desktop/connectors.html'});
      group('More','<path d="M3 6h18M6 12h12M9 18h6"/>',{Community:'/openconstruction-web/contributors.html',Learn:'/openconstruction-web/guides.html','Open education':'/openconstruction-web/oer.html',Contribute:'/openconstruction-web/contribute.html'});
      const resources=document.createElement('div');resources.className='oc-sidebar-resources';
      for(const [name,href] of Object.entries({'Community digest':'/openconstruction-web/monthly-highlights.html'}))resources.append(navLink(name,href));rail.append(resources);
      const applySidebar=(hidden,persist=false)=>{
        document.documentElement.dataset.ocSidebar=hidden?'hidden':'visible';
        rail.hidden=hidden;backdrop.hidden=hidden;closeAccount();
        toggle.setAttribute('aria-expanded',String(!hidden));
        toggle.setAttribute('aria-label',hidden?'Show sidebar':'Hide sidebar');toggle.title=hidden?'Show sidebar':'Hide sidebar';
        if(persist){try{localStorage.setItem('oc.web.sidebar.v1',hidden?'hidden':'visible');}catch{}}
      };
      toggle.onclick=()=>applySidebar(!rail.hidden,true);
      backdrop.onclick=()=>{applySidebar(true,true);toggle.focus();};
      rail.addEventListener('keydown',event=>{if(event.key==='Escape'&&accountMenu.hidden){applySidebar(true,true);toggle.focus();}});
      window.addEventListener('storage',event=>{if(event.key==='oc.web.sidebar.v1')applySidebar(event.newValue==='hidden');});
      applySidebar(document.documentElement.dataset.ocSidebar==='hidden');
    }
    if ((web || document.querySelector('meta[name="oc-auth-mode"][content="gateway"]')) && (!web || !window.OCWebConnection || window.OCWebConnection.hasSession())) {
      const profileRequest = web && window.OCWebProfile ? window.OCWebProfile() : fetch('/api/platform/me',{credentials:'same-origin',cache:'no-store'}).then(response=>response.ok?response.json():null);
      profileRequest.then(profile=>{
        if(!profile?.user)return;
        if (web) { signIn.hidden = true; account.hidden = false; }
        const avatar = profile.user.avatarUrl || profile.user.avatar_url || profile.user.picture;
        if (typeof avatar === 'string' && avatar.trim()) {
          try {
            const url = new URL(avatar, location.href);
            if (['https:', 'http:'].includes(url.protocol)) accountAvatar.src = url.href;
          } catch { /* Keep the default avatar when the profile URL is invalid. */ }
        }
        const admin=profile.user.role==='admin'||profile.user.roles?.includes('admin');
        const adminLink=rail.querySelector('[data-app-destination="Admin"]');if(adminLink)adminLink.hidden=!admin;
        menuTitle.textContent=profile.user.displayName||profile.user.email||'Your account';
        const selected=profile.workspaces?.find(workspace=>workspace.id===profile.activeWorkspaceId);
        if(selected && !web){menuWorkspace.textContent=selected.name;menuWorkspace.hidden=false;}
        account.title=`${menuTitle.textContent}${selected?` · ${selected.name}`:''}`;
        account.setAttribute('aria-label',`${menuTitle.textContent}: account and settings`);
      }).catch(()=>{});
    }
    if (active === 'Catalog') {
      const catalog = document.createElement('nav'); catalog.className = 'oc-catalog-nav'; catalog.setAttribute('aria-label', 'Catalog sections');
      const entries = {Datasets:'dataset',Models:'models',Skills:'desktop/skills',Connectors:'desktop/connectors',Workflows:'deployments',OER:'oer',Insights:'benchmarks',Tools:'tools',Guides:'guides',Community:'contributors'};
      for (const [name, file] of Object.entries(entries)) {
        const link = document.createElement('a'); link.href = `/${file}.html`; link.textContent = name;
        if (current === link.pathname || (name === 'Skills' && current === '/openconstruction-web/desktop/skills-detail.html')) link.setAttribute('aria-current','page'); catalog.append(link);
      }
      document.body.prepend(catalog); document.body.classList.add('oc-catalog-desktop');
    }
    if (current === '/openconstruction-web/desktop/settings.html') {
      const sections = [...document.querySelectorAll('.oc-desktop-settings-card')];
      const nav = document.createElement('nav'); nav.className = 'oc-settings-subnav';
      nav.setAttribute('aria-label', 'Desktop settings sections');
      ['Research engine','Account','Local data'].forEach((name, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = name;
        b.onclick = () => { sections.forEach((section,j) => { section.hidden = i !== j; }); nav.querySelectorAll('button').forEach((item,j) => { item.classList.toggle('is-active',i === j); item.setAttribute('aria-pressed',String(i === j)); }); };
        nav.append(b);
      });
      sections[0].before(nav); nav.firstChild.click();
      document.querySelector('.oc-desktop-heading h1').textContent = 'Desktop settings';
    }
    if (active === 'Notes') {
      const main = document.querySelector('.oc-desktop-main');
      const listPane = document.createElement('aside'); listPane.className = 'oc-notes-list-pane';
      for (const selector of ['.oc-desktop-section-head','#newProjectForm','#projectList','.oc-desktop-backup-actions']) listPane.append(main.querySelector(selector));
      main.prepend(listPane);
      const saved = document.getElementById('savedResources');
      const details = document.createElement('details'); details.className = 'oc-notes-saved';
      const summary = document.createElement('summary'); summary.textContent = 'Saved catalog resources'; details.append(summary, saved); listPane.append(details);
      document.querySelector('.oc-desktop-heading h1').textContent = 'Project notes';
    }
    // Catalog links to the canonical website stay inside the app when the page is bundled.
    if (!web) document.addEventListener('click', event => {
      const anchor = event.target.closest('a[href]');
      if (!anchor || anchor.download || event.defaultPrevented) return;
      try {
        const url = new URL(anchor.href);
        if (['www.openconstruction.org', 'openconstruction.org'].includes(url.hostname) && /(?:\.html|\/$)/.test(url.pathname)) {
          event.preventDefault(); location.href = `oc-app://desktop${url.pathname === '/' ? '/openconstruction-web/index.html' : url.pathname}${url.search}${url.hash}`;
        }
      } catch {}
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
