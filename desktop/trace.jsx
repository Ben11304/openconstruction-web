// OC host for the upstream trajectory viewer.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { TrajectoryViewer } from '../../../engine/packages/trajectory/src/web';
import '../../../engine/packages/trajectory/src/style.css';
import './trace.css';

let dialog, container, button, renderer, current = {};
const id = encodeURIComponent;
async function request(sessionId, suffix, signal, blob = false) {
  const response = await fetch(`/api/research/sessions/${id(sessionId)}/trajectory${suffix}`, {
    signal, cache: 'no-store', headers: {'X-OC-Workspace':'research'}
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error || value.detail || `Trace could not be loaded (${response.status}).`);
  }
  return blob ? response.blob() : response.json();
}
const port = {
  index: (session, signal) => request(session, '', signal),
  detail: (session, entry, signal) => request(session, '/detail?id=' + id(entry), signal),
  export: (session, signal) => request(session, '/export', signal, true)
};
function close() {
  renderer?.unmount(); renderer = null;
  if (dialog?.open) dialog.close();
  button?.setAttribute('aria-expanded', 'false');
}
function open() {
  if (!current.sessionId || !current.session || dialog.open) return;
  dialog.showModal();
  button.setAttribute('aria-expanded', 'true');
  renderer = createRoot(container);
  renderer.render(createElement(TrajectoryViewer, {
    sessionId: current.sessionId, title: current.session.title || 'Research session',
    port, locale: 'en', onClose: close
  }));
}
window.OCDesktopTrace = {
  mount(root) {
    button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn-outline-secondary btn-sm';
    button.textContent = 'Trace'; button.dataset.researchTrace = '';
    button.disabled = true; button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false'); button.onclick = open;
    root.querySelector('.oc-research-header-actions').prepend(button);
    dialog = document.createElement('dialog'); dialog.className = 'oc-trace-dialog';
    dialog.setAttribute('aria-label', 'Agent trace');
    container = document.createElement('div'); container.className = 'oc-trace-root';
    dialog.append(container); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (renderer) close(); });
    window.addEventListener('pagehide', close);
  },
  sync(value) {
    if (value.sessionId !== current.sessionId || value.projectId !== current.projectId) close();
    current = value;
    if (button) button.disabled = !value.sessionId || !value.session;
  },
  open, close
};
