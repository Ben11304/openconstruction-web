(() => {
  const api = window.OCDesktop;
  if(api?.platform === 'web') { location.replace('/openconstruction-web/desktop/projects.html' + location.search); return; }
  const $ = id => document.getElementById(id);
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  let projects = [], selectedId = '', dirty = false;
  function message(text, error = false) { $('workspaceMessage').textContent = text; $('workspaceMessage').hidden = !text; $('workspaceMessage').classList.toggle('is-error', error); }
  const action = fn => async event => { try { await fn(event); } catch (e) { message(e.message, true); } };
  function render() {
    $('projectCount').textContent = projects.length;
    $('projectList').innerHTML = projects.length ? projects.map(project => `<button class="oc-desktop-project${selectedId === project.id ? ' is-selected' : ''}" data-project="${escape(project.id)}" aria-pressed="${selectedId === project.id}"><div class="oc-desktop-project-top"><span aria-hidden="true">▤</span><small>On this device</small></div><strong>${escape(project.name)}</strong><p>Updated ${new Date(project.updatedAt).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })}</p></button>`).join('') : '<div class="oc-desktop-empty"><div class="oc-desktop-empty-symbol" aria-hidden="true">▤</div><h3>A place for your next research question.</h3><p>Create a project to collect notes and plan your work. Everything here is saved on this device.</p></div>';
  }
  async function save() {
    if (!selectedId || !dirty) return;
    const project = await api.updateProject({ id:selectedId, name:$('editName').value, notes:$('projectNotes').value });
    projects = projects.map(p => p.id === project.id ? project : p);
    dirty = false; $('saveState').textContent = 'Saved locally'; render();
  }
  async function select(id) {
    await save(); selectedId = id;
    const p = projects.find(p => p.id === id); $('projectEditor').hidden = !p;
    if (p) { $('editName').value = p.name; $('projectNotes').value = p.notes; $('saveState').textContent = 'Saved locally'; }
    render();
  }
  const openCreate = () => { $('newProjectForm').hidden = false; $('projectName').focus(); };
  $('newProject').onclick = openCreate;
  $('cancelCreate').onclick = () => { $('newProjectForm').hidden = true; };
  $('newProjectForm').onsubmit = action(async event => {
    event.preventDefault(); await save();
    const project = await api.createProject({ name:$('projectName').value }); projects.unshift(project);
    $('newProjectForm').reset(); $('newProjectForm').hidden = true; await select(project.id); message('Project created on this device.');
  });
  $('projectList').onclick = action(async event => { const button = event.target.closest('[data-project]'); if (button) await select(button.dataset.project); });
  for (const id of ['editName','projectNotes']) $(id).oninput = () => { dirty = true; $('saveState').textContent = 'Unsaved changes'; };
  $('saveProject').onclick = action(async () => { await save(); message('Notes saved locally.'); });
  $('deleteProject').onclick = action(async () => { if (await api.deleteProject(selectedId)) { projects = projects.filter(p => p.id !== selectedId); dirty = false; await select(''); message('Project deleted.'); } });
  $('exportWorkspace').onclick = action(async () => { await save(); if (await api.exportWorkspace()) message('Workspace backup exported.'); });
  $('importWorkspace').onclick = action(async () => { await save(); const count = await api.importWorkspace(); if (count !== null) { projects = await api.listProjects(); render(); message(`Imported ${count} project${count === 1 ? '' : 's'}.`); } });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  async function savedResources() {
    const resources = await window.OCBookmark.list();
    $('savedList').innerHTML = resources.length ? resources.map(r => {
      let href = '/openconstruction-web/dataset.html';
      try { const u = new URL(r.url, location.href); if (u.protocol === 'oc-app:' || ['openconstruction.org','www.openconstruction.org'].includes(u.hostname)) href = u.pathname + u.search; } catch {}
      return `<a class="oc-desktop-resource" href="${escape(href)}"><span>${escape(r.title || r.id)}</span><small>${escape(r.type)}</small></a>`;
    }).join('') : '<div class="oc-desktop-empty"><p>Save resources with the bookmark button while browsing the catalog.</p></div>';
  }
  async function init() {
    projects = await api.listProjects(); render();
    await savedResources().catch(() => { $('savedList').textContent = 'Your online library is unavailable. You can still browse the bundled catalog.'; });
    const status = await api.researchStatus();
    $('engineStatus').textContent = status.connected ? 'OcWorkspace ready' : status.runtime.state === 'starting' ? 'Preparing OcWorkspace…' : 'Open OcWorkspace';
    document.querySelector('.oc-desktop-status .oc-status-dot').classList.toggle('connected', status.connected);
    if (new URLSearchParams(location.search).get('action') === 'new') openCreate();
  }
  document.addEventListener('oc:auth-user', () => { void savedResources().catch(() => {}); });
  if (!api) message('Open this workspace in the OpenConstruction desktop app.', true); else void init().catch(e => message(e.message, true));
})();
