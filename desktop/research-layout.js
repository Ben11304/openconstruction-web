(() => {
  let root, inspector, active = null, inspectorCloseTimer;
  let agentTab = 'Runtime';
  let modelAdvancedOpen = false;
  let provenanceProject='';
  let currentProject, renaming = false;
  const saved = () => { try { return JSON.parse(localStorage.getItem('oc.desktop.selection') || '{}'); } catch { return {}; } };
  const api = window.OCDesktopLayout = {
    ready: false,
    isInspectorOpen: () => Boolean(active),
    selection: saved,
    rememberSelection(projectId, sessionId, project) {
      if (projectId && sessionId) localStorage.setItem('oc.desktop.selection', JSON.stringify({projectId, sessionId}));
      currentProject = project;
      window.OCResearchCompute?.select(projectId);
      const rename = root?.querySelector('[data-rename-project]');
      if (rename) {
        rename.textContent = project?.name || 'Untitled project';
        rename.disabled = renaming || !project || project.access?.canEdit === false;
      }
      if(window.OCDesktop?.platform==='web'&&projectId&&projectId!==provenanceProject){
        provenanceProject=projectId;
        document.getElementById('ocProjectProvenance')?.remove();
        void fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/provenance`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(result=>{
          if(provenanceProject!==projectId||!result?.source||!root)return;
          const source=result.source,note=document.createElement('aside');note.id='ocProjectProvenance';note.className='oc-project-provenance';
          const link=document.createElement('a');link.href=`/projects/${encodeURIComponent(source.projectId)}?version=${source.version}`;link.textContent=`${source.name} · v${source.version}`;
          note.append('Private copy of ',link,'. ');
          if(source.status!=='complete')note.append('Copy incomplete — inspect files before continuing. ');
          if(source.datasets.length){
            note.append('Inputs are not copied. Review the license and add each dataset: ');
            for(const d of source.datasets){const a=document.createElement('a');a.href='/datasets/detail.html?id='+encodeURIComponent(d.datasetId);a.textContent=d.name;note.append(a,' ');}
          }
          root.prepend(note);
        }).catch(()=>{});
      }
    },
    mount(workspace) {
      root = workspace;
      const layout = root.querySelector('.oc-research-layout');
      const stage = root.querySelector('.oc-research-stage');
      const toolbar = root.querySelector('.oc-research-header-actions');
      stage.querySelector('.oc-research-stage-head').append(toolbar);
      if (window.OCDesktop?.platform === 'web') {
        const name = document.createElement('button');
        name.type = 'button'; name.className = 'btn btn-outline-secondary btn-sm';
        name.dataset.renameProject = ''; name.disabled = true;
        name.setAttribute('aria-label','Rename project'); name.title = 'Click to rename project';
        name.textContent = 'Untitled project';
        const error = document.createElement('p'); error.setAttribute('role','alert'); error.hidden = true;
        stage.querySelector('.oc-research-stage-head > div').prepend(name,error);
        name.onclick = async () => {
          if (!currentProject || renaming) return;
          const projectId = currentProject.id, sessionId = saved().sessionId;
          const value = window.prompt('Project name',currentProject.name)?.trim();
          if (!value || value === currentProject.name) return;
          if (value.length > 120) { error.textContent = 'Use a project name of 120 characters or fewer.'; error.hidden = false; return; }
          renaming = true; name.disabled = true; error.hidden = true;
          try {
            const response = await fetch(`/api/research/projects/${encodeURIComponent(projectId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:value})});
            if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Could not rename project.'); }
            await window.OCResearchWorkspace.openSession(projectId,sessionId);
          } catch (e) { error.textContent = e.message; error.hidden = false; }
          finally { renaming = false; name.disabled = !currentProject || currentProject.access?.canEdit === false; }
        };
      }
      root.querySelector('.oc-research-header').remove();
      toolbar.querySelector('[data-research-tools-toggle]').textContent = 'Show panel';
      toolbar.querySelector('[data-research-refresh]').setAttribute('aria-label', 'Refresh session');
      toolbar.querySelector('[data-research-refresh]').title = 'Refresh session';
      toolbar.insertAdjacentHTML('afterbegin', '<button type="button" class="btn btn-outline-secondary btn-sm" data-desktop-reload title="Reload interface">↻ Reload</button>');
      toolbar.querySelector('[data-desktop-reload]').onclick = () => {
        if (window.OCResearchChat?.isUploading()) return;
        window.location.reload();
      };
      inspector = document.createElement('aside');
      inspector.className = 'oc-inspector';
      inspector.setAttribute('aria-label', 'Research workspace panel');
      const tabs = root.querySelector('.oc-research-tabs');
      tabs.setAttribute('aria-label', 'Research workspace panel');
      tabs.querySelector('[data-research-view=conversation]').remove();
      const workspaceTab = document.createElement('button');
      workspaceTab.type = 'button'; workspaceTab.textContent = 'Workspace'; workspaceTab.dataset.researchView = 'workspace';
      workspaceTab.setAttribute('role', 'tab'); workspaceTab.setAttribute('aria-controls', 'ocWorkspacePanel');
      tabs.prepend(workspaceTab);
      tabs.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        const buttons = [...tabs.querySelectorAll('[role=tab]')];
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus(); buttons[next].click();
      });
      tabs.querySelector('[data-research-view=artifacts]').textContent = 'Outputs';
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = '×'; close.className = 'oc-inspector-close';
      close.setAttribute('aria-label', 'Close panel');
      close.onclick = () => { api.showInspector(null); root.querySelector('[data-research-tools-toggle]').focus(); };
      const heading = document.createElement('div'); heading.className = 'oc-inspector-heading';
      heading.append(tabs, close); inspector.append(heading);
      root.querySelector('[data-research-tools-panel]').remove();
      for (const name of ['artifacts', 'papers', 'ideas']) inspector.append(root.querySelector(`[data-research-panel=${name}]`));
      const workspacePanel = document.createElement('section');
      workspacePanel.dataset.researchPanel = 'workspace'; workspacePanel.id = 'ocWorkspacePanel';
      workspacePanel.className = 'oc-workspace-panel'; workspacePanel.setAttribute('role', 'tabpanel');
      workspacePanel.setAttribute('aria-label', 'Workspace'); workspacePanel.hidden = true;
      inspector.append(workspacePanel);
      window.OCDesktopWorkspace.mount(workspacePanel);
      layout.append(inspector);
      const prompt = root.querySelector('#ocResearchPrompt');
      prompt.rows = 2;
      prompt.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          const submit = prompt.form.querySelector('button[type=submit]');
          if (!event.repeat && !submit.disabled) prompt.form.requestSubmit(submit);
        }
      });
      const hint = root.querySelector('.oc-chat-upload-hint');
      hint.textContent = '30 MiB max · Enter to send · Shift+Enter for a new line';
      api.ready = true;
      window.OCDesktopAgents?.mount(stage);
      api.showInspector(null);
      window.OCDesktopPanels?.mount(root);
      inspector.addEventListener('keydown', event => {
        if (event.key === 'Escape') { api.showInspector(null); root.querySelector('[data-research-tools-toggle]').focus(); }
      });
    },
    showInspector(view) {
      if (!inspector) return;
      if (view === 'tools') view = 'workspace';
      clearTimeout(inspectorCloseTimer);
      const wasOpen = Boolean(active);
      active = view;
      window.OCDesktopWorkspace?.show(view === 'workspace');
      inspector.inert = !view;
      inspector.setAttribute('aria-hidden', String(!view));
      const animate = root.classList.contains('oc-focus-workspace') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (view) {
        inspector.hidden = false;
        // Establish the collapsed position before starting an opening transition.
        if (!wasOpen && animate) void inspector.offsetWidth;
      } else if (wasOpen && animate) {
        inspectorCloseTimer = setTimeout(() => { inspector.hidden = true; window.OCDesktopPanels?.refresh(); }, 280);
      } else {
        inspector.hidden = true;
      }
      root.querySelector('.oc-research-layout').classList.toggle('is-tools-collapsed', !view);
      // Keep the current panel painted while it slides out. Inert blocks interaction.
      if (view) root.querySelectorAll('[data-research-panel]').forEach(panel => { panel.hidden = !['conversation', view].includes(panel.dataset.researchPanel); });
      inspector.querySelectorAll('[role=tab]').forEach(button => {
        const selected = button.dataset.researchView === view;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-selected', String(selected));
      });
      const toggle = root.querySelector('[data-research-tools-toggle]');
      toggle.setAttribute('aria-expanded', String(Boolean(view)));
      toggle.setAttribute('aria-controls', 'ocDesktopInspector');
      inspector.id = 'ocDesktopInspector';
      if (!toggle.hasAttribute('data-focus-files-arrow')) toggle.textContent = 'Files';
      window.OCResearchFocus?.syncFiles(root);
      if (view && !wasOpen && window.innerWidth < 1180 && document.activeElement === toggle) inspector.querySelector('[role=tab][aria-selected=true]')?.focus();
      window.OCDesktopPanels?.refresh();
    },
    organizeSettings(view) {
      const settings = document.getElementById('ocResearchSettingsRoot');
      settings.dataset.desktopSettings = view;
      if (view === 'models') {
        window.OCDesktopCodex?.mount(settings);
        window.OCDesktopClaude?.mount(settings);
        const list = settings.querySelector('.oc-research-model-list');
        if (list) list.hidden = !list.children.length;
        const modelForm = settings.querySelector('[data-research-model-form]');
        if (modelForm && !modelForm.closest('.oc-model-advanced')) {
          const advanced = document.createElement('details');
          advanced.className = 'oc-model-advanced';
          advanced.open = modelAdvancedOpen || Boolean(modelForm.querySelector('[name=modelId]')?.value);
          const summary = document.createElement('summary');
          summary.textContent = 'Advanced';
          const description = document.createElement('span');
          description.textContent = 'Custom connections and technical settings';
          summary.append(description);
          modelForm.before(advanced);
          advanced.append(summary);
          if (list) advanced.append(list);
          advanced.append(modelForm);
          advanced.addEventListener('toggle', () => { modelAdvancedOpen = advanced.open; });
        }
        settings.querySelector('.oc-research-config-head h2').textContent = 'Models';
        settings.querySelector('.oc-research-config-head p').textContent = 'Connect an account to use its models in Research.';
      }
      if (view !== 'agent') return;
      const form = settings.querySelector('[data-research-runtime-form]');
      if (!form) return;
      const groups = [...form.querySelectorAll('.oc-research-config-group')];
      const runtime = [...form.children].filter(el => !el.matches('.oc-research-config-group,button[type=submit]'));
      const sessionForm = settings.querySelector('[data-research-session-agent-form]');
      const specialists = [...settings.children].filter(el => el.classList.contains('oc-research-config-card') && el !== form && el !== sessionForm);
      const nav = document.createElement('nav'); nav.className = 'oc-settings-subnav'; nav.setAttribute('aria-label', 'Agent settings sections');
      const names = ['Runtime', 'Connectors', ...(groups[1] ? ['Skills'] : []), 'Specialists'];
      if (!names.includes(agentTab)) agentTab = 'Runtime';
      function select(name) {
        agentTab = name;
        runtime.forEach(el => { el.hidden = name !== 'Runtime'; });
        groups.forEach((el, i) => { el.hidden = name !== (i === 0 ? 'Connectors' : 'Skills'); });
        form.hidden = name === 'Specialists';
        if (sessionForm) sessionForm.hidden = name !== 'Runtime';
        specialists.forEach(el => { el.hidden = name !== 'Specialists'; });
        nav.querySelectorAll('button').forEach(b => { b.classList.toggle('is-active', b.textContent === name); b.setAttribute('aria-pressed', String(b.textContent === name)); });
      }
      names.forEach(name => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
        button.onclick = () => select(name); nav.append(button);
      });
      form.before(nav); select(agentTab);
    }
  };
})();
