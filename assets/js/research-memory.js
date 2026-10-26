// OC research memory. Copyright (c) OpenConstruction — Apache-2.0
(() => {
  const s = { root: null, project: '', projects: [], items: [], last: null, filter: 'active', edit: null, serial: 0 };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kinds = {goal:'Goal',constraint:'Constraint',decision:'Decision',resource:'Resource',result:'Result',next_step:'Next step',progress:'Progress'};
  async function api(path, method='GET', body) {
    const r = await fetch('/api/research/' + path, {method, cache:'no-store', headers:{'X-OC-Workspace':'research',...(body === undefined ? {} : {'Content-Type':'application/json'})},body:body === undefined ? undefined : JSON.stringify(body)});
    const data = await r.json(); if (!r.ok) throw new Error(data.detail || data.error || `Request failed (${r.status})`); return data;
  }
  const path = () => `projects/${encodeURIComponent(s.project)}/memory`;
  function notice(text, error=false) { const el=s.root.querySelector('[data-memory-notice]'); el.textContent=text; el.classList.toggle('is-error',error); }
  function source(item) {
    const src=item.source || {};
    return `${esc(src.type || 'user')}${src.sessionId ? ` · session ${esc(src.sessionId)}` : ''}${src.runId ? ` · run ${esc(src.runId)}` : ''}${src.artifactId ? ` · artifact ${esc(src.artifactId)} v${esc(src.version)}` : ''}${src.url && /^https?:\/\//.test(src.url) ? ` · <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}${src.excerpt ? ' · saved excerpt' : ''}`;
  }
  function snapshot(data) {
    if (!data) return '<p>No context has been retrieved by the agent yet.</p>';
    return `<p>${esc(new Date(data.retrievedAt).toLocaleString())} · ${data.entries.length} included · ${data.omittedCount} omitted · ${data.excludedProposals} proposals excluded</p>
    ${data.sessionId ? `<small>Session ${esc(data.sessionId)} · turn ${esc(data.turn || 'preview')}</small>` : ''}
    ${data.entries.map(x=>`<details><summary>${esc(x.title)} · v${x.revision}${x.truncated ? ' · excerpt' : ''}</summary><p class="oc-memory-content">${esc(x.content)}</p></details>`).join('')}`;
  }
  function render() {
    const items=s.items.filter(x => s.filter === 'archived' ? x.state==='archived' : x.state==='active' && (s.filter!=='proposed' || x.status==='proposed'));
    s.root.innerHTML=`<header class="oc-memory-header"><div><h1>Project memory</h1><p>Keep decisions and knowledge available across research sessions.</p></div><button class="btn btn-outline-secondary" data-memory-action="refresh">Sync sources</button></header>
    <div class="oc-memory-controls"><label>Project <select class="form-select" data-memory-project>${s.projects.map(p=>`<option value="${esc(p.id)}" ${p.id===s.project?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>Show <select class="form-select" data-memory-filter><option value="active" ${s.filter==='active'?'selected':''}>Active memory</option><option value="proposed" ${s.filter==='proposed'?'selected':''}>Needs confirmation</option><option value="archived" ${s.filter==='archived'?'selected':''}>Archived</option></select></label><button class="btn btn-dark" data-memory-action="new" ${s.project?'':'disabled'}>Add memory</button></div>
    <p data-memory-notice role="status" aria-live="polite"></p><div data-memory-editor></div>
    <div class="oc-memory-layout"><section aria-label="Memory entries"><p class="text-muted">${s.items.filter(x=>x.state==='active').length} active · ${s.items.filter(x=>x.state==='active'&&x.status==='proposed').length} awaiting confirmation. Confirmed and observed entries can enter context; proposals stay out.</p>
    ${items.length ? items.map(x=>`<article class="oc-memory-card"><div class="oc-memory-badges"><span>${esc(kinds[x.kind])}</span><span>${esc(x.status)}</span>${x.pinned?'<span>Pinned</span>':''}<small>v${x.revision}</small></div><h3>${esc(x.title)}</h3><p class="oc-memory-content">${esc(x.content)}</p><small class="oc-memory-source">${source(x)}</small><div class="oc-memory-actions" data-memory-id="${esc(x.id)}"><button data-memory-action="edit">Edit</button>${x.state==='active'&&x.status==='proposed'?'<button data-memory-action="confirm">Confirm</button>':''}${x.state==='active'&&x.status!=='proposed'?`<button data-memory-action="pin">${x.pinned?'Unpin':'Pin'}</button>`:''}<button data-memory-action="archive">${x.state==='archived'?'Restore':'Archive'}</button><button data-memory-action="history">History</button>${x.source?.sessionId ? '<button data-memory-action="source">Open source session</button>' : ''}</div><div data-memory-history="${esc(x.id)}"></div></article>`).join('') : '<div class="oc-memory-card">No memories in this view. Add a goal or a decision to get started.</div>'}</section>
    <aside><section class="oc-memory-card"><h2>Context preview</h2><p>See what would be selected for your next question. Up to 12 entries; pinned items come first.</p><form data-memory-preview><label class="w-100">Research question<textarea class="form-control" name="query" maxlength="2000" rows="3"></textarea></label><button class="btn btn-outline-secondary mt-2" ${s.project?'':'disabled'}>Preview context</button></form><div data-memory-preview-result></div></section><section class="oc-memory-card"><h2>Latest agent retrieval</h2><p class="text-muted">The context fetched for an agent turn. This does not prove every entry was used in its answer.</p>${snapshot(s.last)}</section></aside></div>`;
  }
  async function load(sync=false) {
    const serial=++s.serial, project=s.project;
    if (!project) { s.items=[];s.last=null;render();return; }
    let result;
    if(sync) { notice('Synchronizing recent research sessions…'); result=await api(path()+'/sync','POST',{}); }
    const data=await api(`projects/${encodeURIComponent(project)}/memory`);
    if(serial!==s.serial || project!==s.project)return;
    s.items=data.items;s.last=data.lastContext;render();
    if(result) notice(`Checked ${result.sessionsChecked} recent sessions. ${result.failedSessions.length} could not be synchronized.${result.olderSessionsNotChecked ? ` ${result.olderSessionsNotChecked} older sessions were not checked.`:''}`);
  }
  function editor(item) {
    s.edit=item || null;
    const area=s.root.querySelector('[data-memory-editor]');
    area.innerHTML=`<form class="oc-memory-card" data-memory-form><h2>${item?'Edit memory':'Add memory'}</h2><div class="oc-memory-controls"><label>Type<select class="form-select" name="kind">${Object.entries(kinds).map(([k,v])=>`<option value="${k}" ${k===(item?.kind||'decision')?'selected':''}>${v}</option>`).join('')}</select></label><label>Status<select class="form-select" name="status"><option value="confirmed">Confirmed by you</option><option value="proposed" ${item?.status==='proposed'?'selected':''}>Proposed</option></select></label></div><label class="w-100">Title<input class="form-control" name="title" required maxlength="180" value="${esc(item?.title||'')}"></label><label class="w-100 mt-2">Content<textarea class="form-control" name="content" rows="5" required maxlength="6000">${esc(item?.content||'')}</textarea></label>${item?'':'<label class="w-100 mt-2">Source URL (optional)<input class="form-control" name="sourceUrl" type="url" maxlength="1000"></label>'}<label class="d-block my-2"><input type="checkbox" name="pinned" ${item?.pinned?'checked':''}> Pin in context (up to 8)</label><button class="btn btn-dark">Save memory</button> <button type="button" class="btn btn-outline-secondary" data-memory-action="cancel">Cancel</button></form>`;
    area.querySelector('[name=title]').focus();
  }
  async function activate() {
    s.root=document.getElementById('ocResearchMemoryRoot');s.root.hidden=false;
    s.root.innerHTML='<p role="status">Loading project memory…</p>';
    try { s.projects=await api('projects'); const current=window.OCResearchWorkspace?.getSelection?.().projectId; s.project=s.projects.some(p=>p.id===current)?current:(s.projects.some(p=>p.id===s.project)?s.project:s.projects[0]?.id||''); render();await load(true); } catch(e) {s.root.innerHTML=`<p class="alert alert-danger">${esc(e.message)}</p>`;}
    if(s.root.dataset.bound)return;s.root.dataset.bound='true';
    s.root.addEventListener('change', async e=>{try {if(e.target.matches('[data-memory-project]')){s.project=e.target.value;s.edit=null;await load(true);}if(e.target.matches('[data-memory-filter]')){s.filter=e.target.value;render();}}catch(err){notice(err.message,true);}});
    s.root.addEventListener('click',async e=>{
      const button=e.target.closest('[data-memory-action]');if(!button)return;
      const action=button.dataset.memoryAction,item=s.items.find(x=>x.id===button.closest('[data-memory-id]')?.dataset.memoryId);
      try {
        if(action==='new'||action==='edit'){editor(item);return;} if(action==='cancel'){s.edit=null;s.root.querySelector('[data-memory-editor]').innerHTML='';return;}
        button.disabled=true;
        if(action==='refresh'){await load(true);return;}
        if(action==='source'){await window.OCResearchSettings.activate('workspace');await window.OCResearchWorkspace.openSession(s.project,item.source.sessionId);return;}
        if(action==='history'){const data=await api(path()+`/${item.id}/history`);s.root.querySelector(`[data-memory-history="${item.id}"]`).innerHTML=data.versions.map(v=>`<details><summary>v${v.revision} · ${esc(v.status)} · ${esc(v.state)} · ${esc(new Date(v.updatedAt).toLocaleString())}</summary><strong>${esc(v.title)}</strong><p class="oc-memory-content">${esc(v.content)}</p></details>`).join('');return;}
        const changes=action==='confirm'?{status:'confirmed'}:action==='pin'?{pinned:!item.pinned}:{state:item.state==='active'?'archived':'active'};
        await api(path()+`/${item.id}`,'PATCH',{expectedRevision:item.revision,...changes});await load();
      }catch(err){notice(err.message,true);}finally{button.disabled=false;}
    });
    s.root.addEventListener('submit',async e=>{
      if(!e.target.matches('[data-memory-form],[data-memory-preview]'))return;e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;
      try {const data=Object.fromEntries(new FormData(form));if(form.matches('[data-memory-preview]')){const result=await api(path()+'/preview?query='+encodeURIComponent(data.query));s.root.querySelector('[data-memory-preview-result]').innerHTML=snapshot(result);return;}
        data.pinned=form.elements.pinned.checked;if(s.edit)data.expectedRevision=s.edit.revision;
        await api(path()+(s.edit?'/'+s.edit.id:''),s.edit?'PATCH':'POST',data);s.edit=null;await load();notice('Memory saved. It is available for the next agent turn.');
      }catch(err){notice(err.message,true);}finally{button.disabled=false;}
    });
  }
  window.OCResearchMemory={activate,saveMessage:async(projectId,sessionId,messageId)=>api(`projects/${encodeURIComponent(projectId)}/memory/from-message`,'POST',{sessionId,messageId})};
})();
