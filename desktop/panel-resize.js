(() => {
  const key = 'oc.desktop.panel-sizes.v1';
  const defaults = { projects:216, inspector:354, sidebar:0.35, workspace:0.425, outputs:0.35, composer:72 };
  const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
  let dispose;
  window.OCDesktopPanels = {
    refresh() {},
    mount(root) {
      dispose?.();
      let saved;
      try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { saved = {}; }
      const sizes = { ...defaults };
      for (const name of Object.keys(defaults)) if (typeof saved?.[name] === 'number' && Number.isFinite(saved[name])) {
        sizes[name] = clamp(saved[name], ['sidebar','workspace','outputs'].includes(name) ? 0.1 : 60, ['sidebar','workspace','outputs'].includes(name) ? 0.9 : 800);
      }
      const layout = root.querySelector('.oc-research-layout');
      const rail = root.querySelector('.oc-research-rail');
      const inspector = root.querySelector('.oc-inspector');
      const workspace = root.querySelector('.oc-workspace-panel');
      const conversation = root.querySelector('[data-research-panel=conversation]');
      const composer = root.querySelector('[data-research-composer]');
      const prompt = root.querySelector('#ocResearchPrompt');
      const outputLayout = root.querySelector('.oc-research-artifact-layout');
      const handles = [], splits = [];
      let drag, frame;
      const persist = () => { try { localStorage.setItem(key, JSON.stringify(sizes)); } catch {} };
      const style = (element, name, value) => { if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value); };

      function separator(name, label, axis, parent, before) {
        const handle = document.createElement('div');
        handle.className = 'oc-panel-divider'; handle.dataset.panelResize = name;
        handle.tabIndex = 0; handle.setAttribute('role','separator');
        handle.setAttribute('aria-label',label); handle.setAttribute('aria-orientation',axis === 'x' ? 'vertical' : 'horizontal');
        handle.title = `${label} · Drag to resize · Double-click to reset`;
        parent.insertBefore(handle, before || null);
        const item = { name, axis, handle, min:0, max:1, current:0, extent:1, sign:1, ratio:false };
        handles.push(item);
        function change(value) { sizes[name] = clamp(value, item.min, item.max); update(); }
        handle.addEventListener('pointerdown', event => {
          if (event.button !== 0 || drag) return;
          event.preventDefault(); event.stopPropagation();
          handle.focus({preventScroll:true}); handle.setPointerCapture(event.pointerId);
          drag = { item, pointer:event.pointerId, start:axis === 'x' ? event.clientX : event.clientY, value:item.current, original:sizes[name] };
          document.documentElement.dataset.ocResizing = axis;
          handle.classList.add('is-dragging');
        });
        handle.addEventListener('pointermove', event => {
          if (drag?.item !== item || drag.pointer !== event.pointerId) return;
          const delta = (axis === 'x' ? event.clientX : event.clientY) - drag.start;
          change(drag.value + delta * item.sign / (item.ratio ? item.extent : 1));
        });
        handle.addEventListener('pointerup', () => finish(false));
        handle.addEventListener('pointercancel', () => finish(true));
        handle.addEventListener('lostpointercapture', () => finish(true));
        handle.addEventListener('dblclick', () => { sizes[name] = defaults[name]; update(); persist(); });
        handle.addEventListener('keydown', event => {
          if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
          const minus = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
          const plus = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
          if (![minus,plus,'Home','End','Enter'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Enter') sizes[name] = defaults[name];
          else change(event.key === 'Home' ? item.min : event.key === 'End' ? item.max : item.current + (event.key === plus ? 1 : -1) * item.sign * (event.shiftKey ? 40 : 10) / (item.ratio ? item.extent : 1));
          update(); persist();
        });
        return item;
      }
      function finish(cancel) {
        if (!drag) return;
        const previous = drag; drag = null;
        if (cancel) sizes[previous.item.name] = previous.original;
        previous.item.handle.classList.remove('is-dragging');
        if (previous.item.handle.hasPointerCapture(previous.pointer)) previous.item.handle.releasePointerCapture(previous.pointer);
        delete document.documentElement.dataset.ocResizing;
        update(); if (!cancel) persist();
      }
      const left = separator('projects','Resize project sidebar','x',layout);
      const right = separator('inspector','Resize right panel','x',layout); right.sign = -1;
      left.handle.classList.add('oc-panel-divider-left'); right.handle.classList.add('oc-panel-divider-right');

      // Keep existing controls and their listeners; only group their containers.
      const projectPane = document.createElement('div'); projectPane.className = 'oc-sidebar-projects';
      const sessionPane = document.createElement('div'); sessionPane.className = 'oc-sidebar-sessions';
      const projectNodes = [rail.querySelector('.oc-research-rail-head'),rail.querySelector('[data-research-create-project]'),rail.querySelector('[data-research-projects]')];
      const sessionNodes = [rail.querySelector('.oc-research-sessions-head'),rail.querySelector('[data-research-create-session]'),rail.querySelector('[data-research-sessions]')];
      rail.prepend(projectPane); projectPane.append(...projectNodes);
      projectPane.after(sessionPane); sessionPane.append(...sessionNodes);
      function split(name, label, parent, first, second, minimum) {
        const item = separator(name,label,'y',parent,second); item.ratio = true;
        splits.push({ item, parent, first, second, minimum });
      }
      split('sidebar','Resize projects and sessions',rail,projectPane,sessionPane,90);
      split('workspace','Resize Input and Project',workspace,workspace.querySelector('.oc-ws-input'),workspace.querySelector('.oc-ws-project'),100);
      split('outputs','Resize output list and preview',outputLayout,outputLayout.querySelector('.oc-research-artifact-list'),outputLayout.querySelector('.oc-research-artifact-preview'),100);
      const input = separator('composer','Resize chat input','y',composer,composer.firstChild); input.sign = -1;
      input.handle.classList.add('oc-panel-divider-composer');

      function measure(item, value, min, max) {
        item.min = min; item.max = Math.max(min,max); item.current = clamp(value,min,max);
        const scale = item.ratio ? 100 : 1;
        item.handle.setAttribute('aria-valuemin',String(Math.round(item.min * scale)));
        item.handle.setAttribute('aria-valuemax',String(Math.round(item.max * scale)));
        item.handle.setAttribute('aria-valuenow',String(Math.round(item.current * scale)));
        item.handle.setAttribute('aria-valuetext',`${Math.round(item.current * scale)} ${item.ratio ? 'percent' : 'pixels'}`);
        return item.current;
      }
      function update() {
        const width = layout.clientWidth;
        if (!width) return;
        const overlay = window.innerWidth < 1180;
        const showRight = !inspector.hidden;
        const chatMin = Math.min(360, Math.max(240,width-180));
        const sidebarMax = Math.min(420,width-chatMin-(showRight && !overlay ? 280 : 0));
        const sidebarWidth = measure(left,sizes.projects,180,sidebarMax);
        const panelWidth = measure(right,sizes.inspector,280,Math.min(760,overlay ? width-40 : width-sidebarWidth-chatMin));
        style(layout,'--oc-projects',`${sidebarWidth}px`);
        style(layout,'--oc-inspector',`${panelWidth}px`);
        style(left.handle,'left',`${sidebarWidth-4}px`);
        style(right.handle,'right',`${panelWidth-4}px`);
        right.handle.hidden = !showRight;
        for (const {item,parent,first,second,minimum} of splits) {
          if (!parent.clientHeight) continue;
          const css = getComputedStyle(parent);
          const children = [...parent.children].filter(child => child.getClientRects().length);
          const occupied = children.reduce((sum,child) => {
            const childStyle = getComputedStyle(child);
            return sum + (child === first || child === second ? 0 : child.getBoundingClientRect().height) + (parseFloat(childStyle.marginTop)||0) + (parseFloat(childStyle.marginBottom)||0);
          },0);
          const available = parent.clientHeight - (parseFloat(css.paddingTop)||0) - (parseFloat(css.paddingBottom)||0) - occupied - (parseFloat(css.rowGap)||0)*Math.max(0,children.length-1);
          if (available <= 0) continue;
          item.extent = available;
          const min = Math.min(minimum,available/2)/available;
          const ratio = measure(item,sizes[item.name],min,1-min);
          style(first,'flex',`0 0 ${Math.round(available*ratio)}px`); style(second,'flex','1 1 0px');
        }
        const max = Math.min(400, Math.max(60,conversation.clientHeight - (composer.offsetHeight-prompt.offsetHeight) - 160));
        const inputHeight = measure(input,sizes.composer,60,max);
        style(prompt,'height',`${inputHeight}px`);
      }
      function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = null; update(); }); }
      const observer = new ResizeObserver(schedule);
      for (const element of [layout,rail,workspace,conversation,composer,outputLayout]) observer.observe(element);
      const blur = () => finish(true);
      window.addEventListener('blur',blur);
      window.addEventListener('resize',schedule);
      window.OCDesktopPanels.refresh = update;
      dispose = () => { finish(true); observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('blur',blur); window.removeEventListener('resize',schedule); };
      update();
    }
  };
})();
