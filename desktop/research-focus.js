/* Compact research chrome. Existing controls retain their runtime handlers. */
(() => {
  window.OCResearchFocus = {
    syncFiles(root) {
      const toggle = root.querySelector('[data-research-tools-toggle]');
      const action = root.querySelector('[data-focus-files-expand]');
      if (!toggle || !action) return;
      const open = toggle.getAttribute('aria-expanded') === 'true';
      const label = open ? 'Collapse file panel' : 'Expand file panel';
      toggle.setAttribute('aria-label', label); action.textContent = label;
    },
    mount(root) {
      if (root.classList.contains('oc-focus-workspace')) return;
      root.classList.add('oc-focus-workspace');
      const head = root.querySelector('.oc-research-stage-head');
      const rail = root.querySelector('.oc-research-rail');
      const actions = root.querySelector('.oc-research-header-actions');
      const project = root.querySelector('[data-rename-project]');
      if (project) {
        const identity = document.createElement('div'); identity.className = 'oc-focus-project';
        identity.append(project); rail.prepend(identity);
        window.OCResearchCompute?.mount(identity);
      }
      const nav = root.querySelector('.oc-agent-view-tabs');
      if (nav) actions.prepend(nav);
      const files = actions.querySelector('[data-research-tools-toggle]');
      const fileControl = document.createElement('div'); fileControl.className = 'oc-focus-files';
      root.querySelector('.oc-research-stage').prepend(fileControl); fileControl.append(files);
      files.dataset.focusFilesArrow = ''; files.removeAttribute('title');
      files.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M14 3 4 10l10 7Z"/></svg>';
      const popup = document.createElement('div'); popup.className = 'oc-focus-files-popup'; popup.hidden = true;
      popup.id = 'ocFocusFilesPopup'; popup.setAttribute('role', 'group'); popup.setAttribute('aria-label', 'Files and outputs');
      popup.innerHTML = '<strong>Files and outputs</strong><p>Browse project documents and results.</p><button type="button" data-focus-files-expand>Expand file panel</button>';
      fileControl.append(popup);
      function hideFilesPopup() { popup.hidden = true; }
      fileControl.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') popup.hidden = false; });
      fileControl.addEventListener('pointerleave', () => { if (!fileControl.contains(document.activeElement)) hideFilesPopup(); });
      fileControl.addEventListener('focusin', () => { popup.hidden = false; });
      fileControl.addEventListener('focusout', event => { if (!fileControl.contains(event.relatedTarget)) hideFilesPopup(); });
      fileControl.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); files.focus(); hideFilesPopup(); }
      });
      popup.querySelector('button').onclick = () => { files.click(); files.focus(); hideFilesPopup(); };
      files.addEventListener('click', hideFilesPopup);
      window.OCResearchFocus.syncFiles(root);
      const menu = document.createElement('details'); menu.className = 'oc-focus-menu';
      const summary = document.createElement('summary'); summary.textContent = '···'; summary.setAttribute('aria-label', 'More session actions');
      const contents = document.createElement('div'); contents.className = 'oc-focus-menu-body';
      menu.append(summary, contents);
      for (const button of [...actions.children]) if (button.matches('button') && button !== files) contents.append(button);
      actions.append(menu);
      // Dismiss before invoking the original action, retaining button listeners.
      contents.addEventListener('click', event => { if (event.target.closest('button')) menu.open = false; });
      const mobile = document.createElement('button'); mobile.type = 'button'; mobile.className = 'oc-focus-sidebar-toggle';
      mobile.textContent = 'Sessions'; mobile.setAttribute('aria-expanded', 'false');
      rail.id = 'ocFocusSessions'; mobile.setAttribute('aria-controls', rail.id);
      head.prepend(mobile);
      function closeSidebar() { root.classList.remove('oc-focus-sidebar-open'); mobile.setAttribute('aria-expanded', 'false'); }
      mobile.onclick = () => { const open = root.classList.toggle('oc-focus-sidebar-open'); mobile.setAttribute('aria-expanded', String(open)); };
      rail.addEventListener('click', event => { if (event.target.closest('[data-research-session]')) closeSidebar(); });
      const selectors = root.querySelector('.oc-chat-selectors');
      if (selectors) {
        const options = document.createElement('details'); options.className = 'oc-focus-options';
        const label = document.createElement('summary'); label.textContent = 'Options'; label.setAttribute('aria-label', 'Thinking effort and permissions');
        const body = document.createElement('div'); body.className = 'oc-focus-options-body';
        options.append(label, body);
        for (const field of ['effort', 'permissions']) body.append(selectors.querySelector(`[data-chat-${field}]`).closest('label'));
        selectors.append(options);
      }
      root.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        for (const details of root.querySelectorAll('.oc-focus-menu[open],.oc-focus-options[open]')) { details.open = false; details.querySelector('summary').focus(); }
        if (root.classList.contains('oc-focus-sidebar-open')) { closeSidebar(); mobile.focus(); }
      });
      document.addEventListener('pointerdown', event => {
        if (!fileControl.contains(event.target)) hideFilesPopup();
        for (const details of root.querySelectorAll('.oc-focus-menu[open],.oc-focus-options[open]')) if (!details.contains(event.target)) details.open = false;
      });
      root.querySelector('#ocResearchPrompt').placeholder = 'Describe a task, or type / for commands';
    }
  };
})();
