(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = document.querySelector('[data-admin-panel="monitor"]');
  if (!panel) return;
  const native = window.OCDesktop?.platform && window.OCDesktop.platform !== 'web' && !document.querySelector('meta[name="oc-auth-mode"][content="gateway"]');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const bytes = value => {
    if (!Number.isFinite(value)) return 'Unavailable';
    const units = ['B','KiB','MiB','GiB','TiB'];
    const index = Math.min(4, Math.max(0, Math.floor(Math.log2(Math.max(1, value)) / 10)));
    return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  };
  const pct = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Sampling…';
  const rate = value => Number.isFinite(value) ? `${bytes(value)}/s` : 'Sampling…';
  const time = value => new Date(value).toLocaleTimeString();
  let snapshot = null, samples = [], timer = null, controller = null, busy = false, paused = false, denied = false;
  const active = () => !panel.hidden && !document.hidden && !paused && !denied;
  function status(label, kind = 'info') { $('monitorStatus').textContent = label; $('monitorStatus').className = `oc-admin-status is-${kind}`; }

  function metric(title, value, detail, usage) {
    return `<div class="oc-admin-metric"><span>${escape(title)}</span><strong>${escape(value)}</strong><small>${escape(detail)}</small>${Number.isFinite(usage) ? `<progress max="100" value="${Math.max(0, Math.min(100, usage))}" aria-label="${escape(title)} utilization"></progress>` : ''}</div>`;
  }

  function renderProcesses() {
    if (!snapshot) return;
    const query = $('monitorSearch').value.toLowerCase();
    const sorts = {
      cpu: (a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) || (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0),
      memory: (a, b) => (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1),
      pid: (a, b) => a.pid - b.pid,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    const rows = snapshot.processes.filter(item => `${item.name} ${item.pid}`.toLowerCase().includes(query)).sort(sorts[$('monitorSort').value] || sorts.cpu);
    $('monitorProcessCount').textContent = `· ${snapshot.processCount} detected`;
    const states = { R:'Running', S:'Sleeping', D:'Waiting for I/O', Z:'Zombie', T:'Stopped', t:'Tracing stop', I:'Idle' };
    $('monitorProcesses').innerHTML = rows.length ? `<table class="oc-admin-table"><thead><tr><th>Process</th><th>PID</th><th>Status</th><th>CPU</th><th>Memory (RSS)</th></tr></thead><tbody>${rows.slice(0, 200).map(item => `<tr><td><strong>${escape(item.name)}</strong>${item.isMonitor ? '<span class="oc-admin-cell-sub">OC monitor host</span>' : ''}</td><td>${item.pid}</td><td>${escape(states[item.state] || item.state)}</td><td>${pct(item.cpuPercent)}</td><td>${bytes(item.memoryBytes)}</td></tr>`).join('')}</tbody></table>` : '<p class="oc-admin-empty">No readable processes match this filter.</p>';
    $('monitorProcessNote').textContent = `Showing ${Math.min(200, rows.length)} of ${rows.length} matches · ${snapshot.scannedProcesses} PIDs scanned · ${snapshot.unreadableProcesses} exited or unreadable. Process names only; command arguments are not collected.`;
  }

  function renderChart() {
    const line = key => {
      let drawing = false;
      return samples.map((sample, index) => {
        if (!Number.isFinite(sample[key])) { drawing = false; return ''; }
        const command = drawing ? 'L' : 'M'; drawing = true;
        return `${command}${(index / 59 * 600).toFixed(1)},${(150 - sample[key] * 1.5).toFixed(1)}`;
      }).join(' ');
    };
    $('monitorChart').innerHTML = '<path class="oc-monitor-grid" d="M0,1H600 M0,75H600 M0,149H600"/>' +
      `<path class="oc-monitor-cpu" d="${line('cpu')}"/><path class="oc-monitor-memory" d="${line('memory')}"/>`;
    $('monitorChartRange').textContent = samples.length ? `0–100% · ${time(samples[0].at)} – ${time(samples.at(-1).at)} · ${samples.length} samples` : 'Collecting samples…';
  }

  function render(value) {
    snapshot = value;
    const { host, cpu, memory, storage, network } = value;
    $('monitorScope').textContent = host.scope === 'WSL'
      ? 'Live Linux / WSL resources allocated to OC’s host. Windows host totals are outside this view.'
      : `Live resources on OC’s ${host.platform} host.`;
    $('monitorUpdated').textContent = `Last sample ${time(value.sampledAt)}`;
    $('monitorWarning').hidden = !value.warnings.length;
    $('monitorWarning').textContent = value.warnings.join(' ');
    const networkRate = key => network && network.every(item => Number.isFinite(item[key])) ? network.reduce((sum, item) => sum + item[key], 0) : null;
    $('monitorMetrics').innerHTML = [
      metric('CPU', pct(cpu.percent), `${host.logicalCpus} logical CPUs`, cpu.percent),
      metric('Memory', memory ? pct(memory.percent) : 'Unavailable', memory ? `${bytes(memory.usedBytes)} / ${bytes(memory.totalBytes)}` : 'Counters unavailable', memory?.percent),
      metric('Storage', storage ? pct(storage.percent) : 'Unavailable', storage ? `${bytes(storage.usedBytes)} / ${bytes(storage.totalBytes)} · ${bytes(storage.availableBytes)} available` : 'Counters unavailable', storage?.percent),
      metric('Network ↓ / ↑', network ? `${rate(networkRate('receiveBytesPerSecond'))} / ${rate(networkRate('sendBytesPerSecond'))}` : 'Unavailable', 'All visible interfaces except loopback'),
    ].join('');
    const uptime = `${Math.floor(host.uptimeSeconds / 86400)}d ${Math.floor(host.uptimeSeconds % 86400 / 3600)}h ${Math.floor(host.uptimeSeconds % 3600 / 60)}m`;
    const facts = [['Host', host.hostname], ['System', `${host.scope} · ${host.arch}`], ['Kernel', host.release], ['Processor', host.cpuModel], ['Uptime', uptime],
      ['Swap used / total', memory ? `${bytes(memory.swapUsedBytes)} / ${bytes(memory.swapTotalBytes)}` : 'Unavailable'],
      ['Load average (1 / 5 / 15 min)', cpu.loadAverage?.map(value => value.toFixed(2)).join(' / ') || 'Unavailable'],
      ['Network interfaces', network?.map(item => item.name).join(', ') || 'None available'], ['Storage scope', 'OC data filesystem']];
    $('monitorHost').innerHTML = `<dl class="oc-admin-definition-list">${facts.map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;
    if (samples.at(-1)?.at !== value.sampledAt) {
      if (samples.length && new Date(value.sampledAt) - new Date(samples.at(-1).at) > 15000) samples = [];
      samples.push({ at: value.sampledAt, cpu: cpu.percent, memory: memory?.percent });
      samples = samples.slice(-60);
    }
    renderChart(); renderProcesses();
    renderGpu(value.gpu);
  }

  function renderGpu(gpu) {
    if (!gpu?.devices?.length) {
      $('monitorGpu').innerHTML = `<p class="oc-admin-empty">${escape(gpu?.message || 'GPU telemetry is unavailable.')}</p>`;
      return;
    }
    const availablePercent = value => Number.isFinite(value) ? pct(value) : 'Unavailable';
    $('monitorGpu').innerHTML = gpu.devices.map(device => `<section class="oc-monitor-gpu"><h3>GPU ${device.index} · ${escape(device.name)}</h3><div class="oc-monitor-metrics">${[
      metric('GPU utilization', availablePercent(device.utilizationPercent), 'Driver-reported load', device.utilizationPercent),
      metric('VRAM', availablePercent(device.memoryPercent), `${bytes(device.memoryUsedBytes)} / ${bytes(device.memoryTotalBytes)}`, device.memoryPercent),
      metric('Temperature', Number.isFinite(device.temperatureCelsius) ? `${device.temperatureCelsius} °C` : 'Unavailable', 'GPU temperature'),
      metric('Power draw', Number.isFinite(device.powerWatts) ? `${device.powerWatts.toFixed(1)} W` : 'Unavailable', Number.isFinite(device.powerLimitWatts) ? `Power limit ${device.powerLimitWatts.toFixed(1)} W` : 'Power limit unavailable'),
    ].join('')}</div></section>`).join('');
  }

  async function poll() {
    if (!active() || busy) return;
    busy = true;
    controller = new AbortController();
    const current = controller;
    const timeout = setTimeout(() => current.abort(), 10000);
    try {
      let value;
      if (native) {
        if (!window.OCDesktop.systemSnapshot) throw new Error('Restart OC to enable the host monitor.');
        value = await Promise.race([window.OCDesktop.systemSnapshot(), new Promise((_, reject) => current.signal.addEventListener('abort', () => reject(new Error('Sample timed out.')), { once:true }))]);
      } else {
        const response = await fetch('/api/admin/system', { cache:'no-store', credentials:'same-origin', signal:current.signal });
        if ([401, 403].includes(response.status)) { denied = true; throw new Error('Administrator sign-in is required. Reload after signing in.'); }
        if (!response.ok) throw new Error(`Host monitor unavailable (${response.status}).`);
        value = await response.json();
      }
      if (active() && !current.signal.aborted) {
        render(value); status(value.cpu.percent === null ? 'Sampling' : 'Live', value.warnings.length ? 'warn' : 'ok');
      }
    } catch (error) {
      if (active() || denied) {
        status(denied ? 'Access required' : 'Disconnected · retrying', 'bad');
        $('monitorWarning').hidden = false;
        $('monitorWarning').textContent = `${error.name === 'AbortError' ? 'Sample timed out.' : error.message} ${snapshot ? 'Displayed values are from the last successful sample.' : ''}`;
      }
    } finally {
      clearTimeout(timeout); controller = null; busy = false;
      if (active()) timer = setTimeout(poll, Number($('monitorInterval').value));
    }
  }

  function sync() {
    clearTimeout(timer);
    if (!active()) { controller?.abort(); if (!denied) status(paused ? 'Paused' : 'Inactive'); return; }
    if (!busy) { status('Connecting'); void poll(); }
  }
  $('monitorPause').addEventListener('click', () => { paused = !paused; $('monitorPause').textContent = paused ? 'Resume' : 'Pause'; $('monitorPause').setAttribute('aria-pressed', String(paused)); sync(); });
  $('monitorInterval').addEventListener('change', sync);
  $('monitorSearch').addEventListener('input', renderProcesses);
  $('monitorSort').addEventListener('change', renderProcesses);
  $('adminRefresh').addEventListener('click', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { clearTimeout(timer); controller?.abort(); });
  new MutationObserver(sync).observe(panel, { attributes:true, attributeFilter:['hidden'] });
  sync();
})();
