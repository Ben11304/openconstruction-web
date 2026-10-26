/* Read-only project pages. All data stays behind the existing project-scoped APIs. */
(() => {
  'use strict';
  window.OCProjectPages = {
    create({request, esc, enc, dateLabel, dateValue, onChange}) {
      const cache = new Map();
      const url = (project, tab, item = '') => `/openconstruction-web/desktop/projects.html?project=${enc(project.id)}&tab=${enc(tab)}${item ? `&item=${enc(item)}` : ''}`;
      const link = (project, tab, item, label) => `<a data-project-tab="${tab}" data-project-item="${esc(item)}" href="${url(project,tab,item)}">${esc(label)}</a>`;
      const muted = text => `<p class="oc-platform-muted">${esc(text)}</p>`;
      const prose = text => `<p class="oc-project-detail-prose">${esc(text || 'Not specified.')}</p>`;
      const date = value => esc(dateLabel(dateValue(value)));
      const fact = (label,value) => `<div><dt>${esc(label)}</dt><dd>${esc(value ?? '—')}</dd></div>`;
      const heading = (project,tab,title) => `${link(project,tab,'',`← All ${tab}`)}<h2 id="projectPageTitle" tabindex="-1">${esc(title)}</h2>`;
      function resource(project, route, validate = value => value, loader = () => request(route)) {
        const key = `${project.id}:${route}`;
        if (!cache.has(key)) {
          const entry = {state:'loading'}; cache.set(key,entry);
          Promise.resolve().then(loader).then(value => { entry.data=validate(value); entry.state='ready'; }).catch(error => { entry.state='error'; entry.error=error.message; }).finally(() => {
            if (cache.get(key)===entry && new URLSearchParams(location.search).get('project')===project.id) onChange();
          });
        }
        return cache.get(key);
      }
      function pending(entry,label) {
        return entry.state==='loading' ? `<p role="status" class="oc-platform-muted">Loading ${esc(label)}…</p>` : `<p role="alert" class="oc-project-page-error">${esc(label)} could not be loaded. ${esc(entry.error)} Use Refresh to try again.</p>`;
      }
      function array(value) { if (!Array.isArray(value)) throw new Error('Unexpected response.'); return value; }
      const unavailable = (label,loading) => muted(loading ? `Loading ${label}…` : `${label} temporarily unavailable. Use Refresh to try again.`);
      const missing = label => muted(`${label} is not available in this project.`);
      function tasks(project,info,item,loading) {
        if (!info?.tasks) return unavailable('Tasks',loading);
        const rows=[...info.tasks].sort((a,b)=>dateValue(b.updatedAt || b.createdAt)-dateValue(a.updatedAt || a.createdAt));
        if (!item) return `<h2 id="projectPageTitle" tabindex="-1">Tasks <small>${rows.length}</small></h2>${rows.length ? `<ul class="oc-project-page-list">${rows.map(task=>`<li><div>${link(project,'tasks',task.id,task.title || 'Untitled task')}<p>${esc(task.objective || 'View task details and run history.')}</p></div><span class="oc-project-state">${esc(task.status)}</span><time>${date(task.updatedAt || task.createdAt)}</time></li>`).join('')}</ul>` : muted('No tasks yet. Tasks created in this project will appear here.')}`;
        const selected=rows.find(t=>t.id===item); if (!selected) return missing('This task');
        const entry=resource(project,`platform/tasks/${enc(item)}`,value=>{
          if (value.task?.projectId!==project.id || value.task?.id!==item) throw new Error('Task does not belong to this project.');
          return {...value,runs:array(value.runs)};
        });
        if (entry.state!=='ready') return heading(project,'tasks',selected.title)+pending(entry,'Task details');
        const {task,runs}=entry.data;
        return `${heading(project,'tasks',task.title)}<dl class="oc-project-detail-facts">${fact('Status',task.status)}${fact('Created',dateLabel(dateValue(task.createdAt)))}${fact('Last updated',dateLabel(dateValue(task.updatedAt)))}</dl><h3>Objective</h3>${prose(task.objective)}<h3>Success criteria</h3>${prose(task.successCriteria)}<h3>Run history</h3>${runs.length ? `<ul class="oc-project-page-list">${[...runs].sort((a,b)=>dateValue(b.createdAt)-dateValue(a.createdAt)).map(run=>`<li><div><strong>${esc(run.id)}</strong>${run.error ? prose(typeof run.error==='string'?run.error:run.error.message) : ''}<small>${date(run.createdAt)}</small></div><span class="oc-project-state">${esc(run.status)}</span></li>`).join('')}</ul>` : muted('No runs yet.')}`;
      }
      function datasets(project,info,item,loading) {
        if (!info?.datasets) return unavailable('Datasets',loading);
        if (!item) return `<h2 id="projectPageTitle" tabindex="-1">Datasets <small>${info.datasets.length}</small></h2>${info.datasets.length ? `<ul class="oc-project-page-list">${info.datasets.map(d=>`<li><div><a href="/datasets/detail.html?id=${enc(d.datasetId)}">${esc(d.name || d.title || d.datasetId)}</a><p>${esc(d.license || 'License details are available in the catalog.')}</p></div><span>Linked ${date(d.linkedAt)}</span></li>`).join('')}</ul>` : muted('No datasets linked to this project yet.')}`;
        const dataset=info.datasets.find(d=>d.datasetId===item); if(!dataset)return missing('This dataset');
        return `${heading(project,'datasets',dataset.name || dataset.title || dataset.datasetId)}<dl class="oc-project-detail-facts">${fact('Dataset ID',dataset.datasetId)}${fact('License',dataset.license)}${fact('Linked',dateLabel(dateValue(dataset.linkedAt)))}${fact('Project folder',dataset.directory)}</dl><a class="oc-platform-button" href="/datasets/detail.html?id=${enc(dataset.datasetId)}">View dataset catalog ↗</a>`;
      }
      function agents(project,item) {
        const entry=resource(project,`research/projects/${enc(project.id)}/team`,value=>({...value,agents:array(value.agents),dispatches:array(value.dispatches)}));
        if(entry.state!=='ready')return `<h2 id="projectPageTitle" tabindex="-1">Agents</h2>${pending(entry,'Agents')}`;
        const {agents,dispatches}=entry.data;
        if(!item)return `<h2 id="projectPageTitle" tabindex="-1">Agents <small>${agents.length}</small></h2>${agents.length ? `<div class="oc-project-agent-grid">${agents.map(agent=>`<article><div class="oc-project-agent-heading">${link(project,'agents',agent.id,agent.name || agent.id)}<span class="oc-project-state">${esc(agent.status)}</span></div><small>${esc(agent.id)}</small><p>${esc(agent.role)}</p></article>`).join('')}</div>` : muted('No agents have been added to this project yet.')}`;
        const agent=agents.find(a=>a.id===item);if(!agent)return missing('This agent');
        const activity=dispatches.filter(d=>d.sourceId===item || d.targetId===item).slice(-10).reverse();
        return `${heading(project,'agents',agent.name || agent.id)}<dl class="oc-project-detail-facts">${fact('Agent ID',agent.id)}${fact('Status',agent.status)}${fact('Model',agent.modelId || 'Project default')}${fact('Reports to',(agent.parents || []).join(', ') || 'Top-level agent')}</dl><h3>Role and responsibilities</h3>${prose(agent.role)}<h3>Current / latest task</h3>${prose(agent.currentTask || 'No task assigned yet.')}<h3>Recent delegation</h3>${activity.length ? `<ul class="oc-project-page-list">${activity.map(d=>`<li><div><strong>${esc(d.sourceId)} → ${esc(d.targetId)}</strong><small>${date(d.createdAt)}</small></div><span class="oc-project-state">${esc(d.status)}</span></li>`).join('')}</ul>` : muted('No delegation activity yet.')}`;
      }
      async function textPreview(route) {
        const response=await fetch(`/api/${route}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error(`Preview unavailable (${response.status}).`);
        const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0,truncated=false;
        try { while(true){const part=await reader.read();if(part.done)break;const left=128*1024-bytes;const chunk=part.value.subarray(0,left);text+=decoder.decode(chunk,{stream:true});bytes+=chunk.length;if(part.value.length>left || bytes>=128*1024){truncated=true;await reader.cancel();break;}}text+=decoder.decode(); } finally { reader.releaseLock(); }
        return {text,truncated};
      }
      function results(project,item) {
        const route=`research/projects/${enc(project.id)}`;
        const entry=resource(project,`${route}/artifacts`,array);
        if(entry.state!=='ready')return `<h2 id="projectPageTitle" tabindex="-1">Results</h2>${pending(entry,'Results')}`;
        const artifacts=entry.data.filter(a=>a.projectId===project.id && !a.deletedAt);
        if(!item)return `<h2 id="projectPageTitle" tabindex="-1">Results <small>${artifacts.length}</small></h2>${muted('Saved project outputs and their versions.')} ${artifacts.length ? `<ul class="oc-project-page-list">${artifacts.map(a=>`<li><div>${link(project,'results',a.id,a.title || a.name || a.logicalName)}<p>${esc(a.description || a.kind)}</p></div><span>v${esc(a.currentVersion)}</span><time>${date(a.updatedAt)}</time></li>`).join('')}</ul>` : muted('No saved results yet. Outputs registered by your project will appear here.')}`;
        const artifact=artifacts.find(a=>a.id===item);if(!artifact)return missing('This result');
        const versions=resource(project,`${route}/artifacts/${enc(item)}/versions`,array);
        const head=heading(project,'results',artifact.title || artifact.name || artifact.logicalName)+prose(artifact.description || `Saved ${artifact.kind} output.`);
        if(versions.state!=='ready')return head+pending(versions,'Result versions');
        const rows=versions.data.filter(v=>v.projectId===project.id && v.artifactId===item).sort((a,b)=>b.version-a.version);
        if(!rows.length)return head+muted('No versions available.');
        const latest=rows[0],content=`${route}/artifact-versions/${enc(latest.id)}/content`;
        const previewable=/^(text\/|application\/(json|xml|.*\+json))/.test(latest.mediaType || '');
        let preview=muted('Download this file to view its contents.');
        if(previewable){const entry=resource(project,content,value=>value,()=>textPreview(content));preview=entry.state==='ready'?`<pre class="oc-project-result-preview">${esc(entry.data.text || '(Empty file)')}</pre>${entry.data.truncated?muted('Preview limited to 128 KB. Download the full version below.'):''}`:pending(entry,'Result preview');}
        return `${head}<h3>Latest version · v${esc(latest.version)}</h3>${preview}<h3>Versions</h3><ul class="oc-project-page-list">${rows.map(v=>`<li><div><strong>Version ${esc(v.version)}</strong><small>${date(v.createdAt)} · ${esc(v.mediaType)}</small></div><a href="/api/${route}/artifact-versions/${enc(v.id)}/content" download="${esc(artifact.name || artifact.logicalName || 'result')}">Download</a></li>`).join('')}</ul>`;
      }
      return {url,link,reset:()=>cache.clear(),render(project,tab,item,info,loading){return ({tasks:()=>tasks(project,info,item,loading),datasets:()=>datasets(project,info,item,loading),results:()=>results(project,item),agents:()=>agents(project,item)})[tab]?.() || '';}};
    }
  };
})();
