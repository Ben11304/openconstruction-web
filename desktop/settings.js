(() => {
  const api = window.OCDesktop;
  const $ = id => document.getElementById(id);
  let busy = false;
  function message(text, error = false) { $('settingsMessage').textContent = text; $('settingsMessage').hidden = !text; $('settingsMessage').classList.toggle('is-error', error); }
  async function refresh() {
    const info = await api.info();
    $('appVersion').textContent = `Version ${info.version} · ${info.arch}`;
    $('localDataPath').textContent = info.dataPath;
    $('catalogVersion').textContent = `Bundled catalog prepared ${new Date(info.catalogBuiltAt).toLocaleDateString()}.`;
    const status = await api.researchStatus();
    const starting = status.runtime.state === 'starting';
    $('connectionBadge').textContent = status.connected ? '● Ready' : starting ? 'Preparing…' : 'Not ready';
    $('engineStage').textContent = status.runtime.stage || (status.connected ? 'OcWorkspace is ready.' : 'OcWorkspace is stopped.');
    $('startEngine').hidden = starting || status.connected;
    $('startEngine').disabled = busy;
    $('stopEngine').disabled = busy || !status.runtime.managed;
    $('engineSettings').disabled = !status.connected;
    $('runtimeLog').textContent = status.runtime.log || status.message || 'No startup output.';
    return status;
  }
  const action = fn => async event => {
    if (busy) return; busy = true;
    try { await fn(event); } catch(e) { message(e.message, true); }
    finally { busy = false; await refresh().catch(() => {}); }
  };
  $('startEngine').onclick = action(async () => { await api.startResearch(); message('Starting OcWorkspace…'); });
  $('stopEngine').onclick = action(async () => { await api.stopResearch(); message('OcWorkspace stopped. Your research is saved on this device.'); });
  $('engineSettings').onclick = action(() => api.openResearchSettings());
  $('refreshStatus').onclick = action(() => refresh());
  $('showData').onclick = action(() => api.showLocalData());
  void refresh().catch(e => message(e.message, true));
  const timer = setInterval(() => { if (!busy) void refresh().catch(() => {}); }, 1500);
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
