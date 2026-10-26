(() => {
  const root = document.getElementById('ocResearchRoot');
  const year = document.getElementById('yearNow');
  if (year) year.textContent = new Date().getFullYear();
  const banner = document.createElement('div');
  banner.className = 'oc-desktop-research-banner';
  const label = document.createElement('span'); label.textContent = 'Starting OcWorkspace…';
  const settings = document.createElement('a'); settings.href = '/openconstruction-web/desktop/settings.html'; settings.textContent = 'Engine settings';
  banner.append(label, settings); root.before(banner);
  document.querySelector('.oc-research-breadcrumb a')?.setAttribute('href', '/openconstruction-web/desktop/workspace.html');
  window.OCResearchWorkspace.mount(root);
  window.OCDesktopLayout.mount(root);
  window.OCDesktopTrace.mount(root);
  window.OCDesktopSkills.mount(root);
  window.OCDesktopChatControls.mount(root);
  window.OCDesktopSlash?.mount(root);
  window.OCResearchFocus?.mount(root);
  root.querySelector('.oc-research-rail').append(banner);
  let mounted = false, refreshing = false;
  document.querySelectorAll('[data-research-page]').forEach(button => { button.disabled = true; });
  async function refresh() {
    if (refreshing) return; refreshing = true;
    try {
      const status = await window.OCDesktop.researchStatus();
      label.textContent = status.connected ? 'Research engine ready' : (status.runtime.stage || 'OcWorkspace is starting.');
      banner.classList.toggle('is-ready', status.connected);
      if (status.connected && !mounted) {
        mounted = true;
        document.querySelectorAll('[data-research-page]').forEach(button => { button.disabled = false; });
        window.OCResearchSettings.mount(document.getElementById('ocResearchSettingsRoot'), root);
        if (!['agent','models','mcp','memory','lab'].includes(new URLSearchParams(location.search).get('view'))) await window.OCResearchWorkspace.activate();
      }
    } catch(e) { label.textContent = e.message; }
    finally { refreshing = false; }
  }
  void refresh();
  const timer = setInterval(refresh, 1500);
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
