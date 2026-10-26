/* Independent Builder: templates and a tool-free assistant; creation stays in OC. */
(() => {
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hasBoss=agents=>agents.some(a=>a.isBoss===true||a.id==='BOSS');
  const canCreateBoss=(metadata,agents,busy=false)=>!!metadata?.bossPreset&&!hasBoss(agents)&&!busy;
  function reviewState(fields,values,questions){return {missing:fields.filter(f=>!String(values[f.key]||'').trim()).map(f=>f.key),questions:questions.filter(q=>q.trim()).length};}
  function canCreate(metadata,draft,{busy=false,dirty=false}={}) {
    if(!metadata||!draft||busy||dirty)return false;
    const r=reviewState(metadata.fields,draft.design.fields,draft.design.questions);
    return !r.missing.length&&!r.questions&&/^[A-Z][A-Z0-9_]{0,47}$/.test(draft.id)&&!!draft.name.trim();
  }
  async function open({host,projectId,agents,onCreated}){
    if(host.querySelector('dialog'))return;
    const dialog=document.createElement('dialog');dialog.className='oc-team-dialog oc-designer oc-builder';
    let metadata,draft,jobId='',timer,closed=false,busy=false,creating=false,dirty=false,epoch=0,startedAt=0,elapsed;
    const base=`/api/research/projects/${encodeURIComponent(projectId)}/team`;
    async function api(path='',method='GET',body){
      const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
      const data=await r.json();if(!r.ok)throw Error(data.error?.message||data.error||`Request failed (${r.status})`);return data;
    }
    dialog.innerHTML=`<form novalidate>
      <header><h3>Add an agent</h3><p>Create the project BOSS, or design a specialist.</p></header>
      <label class="oc-boss-choice"><input type="checkbox" name="isBoss" disabled><span>Project BOSS<small data-boss-help>${hasBoss(agents)?'This project already has a BOSS.':'One per project. Ready-made coordinator; no project brief required.'}</small></span></label>
      <section data-boss-preview hidden><h4>BOSS</h4><p data-boss-mission></p><p>Uses the project model unless you choose another below. No AI drafting, new permissions or automatic tasks. Existing agents are not reparented.</p></section>
      <div data-standard-brief>
      <label>Starting point<select name="templateId" aria-label="Agent template"></select></label>
      <p data-template-help></p>
      <label>What should this agent do?<textarea name="need" maxlength="600" rows="3" placeholder="Review IFC quantity evidence and report missing inputs."></textarea></label>
      <div class="oc-designer-identity"><label>Name <small>Optional — the template supplies a default.</small><input name="name" maxlength="100" placeholder="e.g. IFC reviewer"></label>
      <label>Reports to<select name="parent"><option value="">No parent (top-level)</option>${agents.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.id)})</option>`).join('')}</select></label></div>
      <div class="oc-designer-actions"><button type="button" data-template disabled>Preview template</button><button type="button" data-generate disabled>Help me design</button><button type="button" data-stop hidden>Stop</button></div>
      </div>
      <p data-status role="status" aria-live="polite">Loading templates…</p>
      <section data-preview hidden aria-label="Agent preview">
        <h4 data-preview-title></h4><p data-mission></p>
        <dl data-summary></dl>
        <p class="oc-builder-access">No additional access is granted. Existing OC settings and approval rules apply. A new agent starts with no children.</p>
        <section data-questions hidden><h4>A little more context</h4><ul></ul></section>
        <label>Ask for changes or answer the questions<textarea name="feedback" maxlength="6000" rows="2" placeholder="e.g. Only check quantities; do not modify the model."></textarea></label>
        <button type="button" data-refine>Update with AI</button>
      </section>
      <details data-advanced><summary>Advanced settings &amp; full contract</summary>
        <label>Model for AI drafting and the new agent<select name="modelId"><option value="">Use project default</option></select></label>
        <div data-contract></div>
        <details data-handbook><summary>Handbook checklist &amp; runtime support</summary><p>Completeness is not benchmark validation.</p><div data-checklist></div><ul data-runtime></ul><div data-sources></div></details>
      </details>
      <p data-form-error role="alert"></p>
      <footer><small data-create-help>Preview template uses no model. Help me design sends your brief and team roles to the selected model, separately from BOSS. Create agent confirms this design; it does not start a task.</small><div><button type="button" data-cancel>Cancel</button><button type="submit" disabled>Create agent</button></div></footer>
    </form>`;
    host.append(dialog);dialog.showModal();
    const form=dialog.querySelector('form'),q=s=>dialog.querySelector(s),val=n=>form.elements.namedItem(n)?.value||'';
    const status=q('[data-status]'),error=q('[data-form-error]'),create=q('[type=submit]');
    const parents=()=>val('parent')?[val('parent')]:[];
    const bossMode=()=>form.elements.namedItem('isBoss').checked;
    function readDraft(){
      if(!draft)return;
      draft.id=val('id');draft.name=val('name').trim()||draft.name;
      for(const f of metadata.fields)draft.design.fields[f.key]=val('design_'+f.key);
      draft.design.questions=val('questions').split('\n').map(s=>s.trim()).filter(Boolean);
    }
    function sync(){
      const locked=busy||creating;
      const boss=bossMode();
      form.elements.namedItem('isBoss').disabled=locked||!metadata?.bossPreset||hasBoss(agents);
      for(const n of ['templateId','need','name','parent','feedback'])form.elements.namedItem(n).disabled=locked||boss;
      form.elements.namedItem('modelId').disabled=locked;
      q('[data-standard-brief]').hidden=boss;q('[data-boss-preview]').hidden=!boss;
      q('[data-contract]').hidden=boss;q('[data-handbook]').hidden=boss;
      q('[data-advanced] summary').textContent=boss?'Model (optional)':'Advanced settings & full contract';
      create.textContent=boss?'Create BOSS':'Create agent';
      q('[data-create-help]').hidden=boss;
      for(const field of q('[data-contract]').querySelectorAll('input,textarea'))field.disabled=locked;
      q('[data-template]').disabled=!metadata||locked;q('[data-generate]').disabled=!metadata||locked;
      q('[data-refine]').disabled=!metadata||!draft||locked||!val('feedback').trim();
      q('[data-stop]').hidden=!busy;q('[data-cancel]').disabled=creating;
      create.disabled=boss?!canCreateBoss(metadata,agents,locked):!canCreate(metadata,draft,{busy:locked,dirty});
      q('[data-preview]').hidden=boss||!draft;
      if(boss)return;
      if(!draft)return;
      q('[data-preview-title]').textContent=draft.name+' · '+draft.id;
      q('[data-mission]').textContent=draft.design.fields.mission;
      q('[data-summary]').innerHTML=[['Delivers','outputs'],['Verifier & checks','acceptance'],['Resources','resources']].map(([label,key])=>`<dt>${label}</dt><dd>${esc(draft.design.fields[key])}</dd>`).join('');
      q('[data-questions]').hidden=!draft.design.questions.length;
      q('[data-questions] ul').innerHTML=draft.design.questions.map(s=>`<li>${esc(s)}</li>`).join('');
      q('[data-checklist]').innerHTML=metadata.fields.map(f=>`<div class="oc-designer-check"><span>${esc(f.label)} <small>${esc(f.ref)}</small></span><span>${draft.design.fields[f.key].trim()?'Written':'Missing'}</span></div>`).join('');
    }
    function renderDraft(next,mode){
      draft=next;dirty=false;form.elements.namedItem('name').value=draft.name;form.elements.namedItem('feedback').value='';
      q('[data-contract]').innerHTML=`<label>Agent ID<input name="id" maxlength="48" value="${esc(draft.id)}"></label>`+
        metadata.fields.map(f=>`<label>${esc(f.label)}<small>${esc(f.hint)}</small><textarea name="design_${f.key}" maxlength="600" rows="3">${esc(draft.design.fields[f.key])}</textarea></label>`).join('')+
        `<label>Unresolved questions<small>Resolve each in the contract before removing it.</small><textarea name="questions" rows="2">${esc(draft.design.questions.join('\n'))}</textarea></label>`;
      status.textContent=mode==='template'?'Template ready — no model was called. Review the defaults and create, or ask AI to tailor them.':'Draft updated. Review the summary; nothing has been created.';
      sync();
    }
    async function stop(){
      epoch++;clearTimeout(timer);clearInterval(elapsed);const id=jobId;jobId='';busy=false;
      if(id)await api('/designs/'+id,'DELETE').catch(()=>{});
    }
    async function close(){if(creating)return;closed=true;await stop();dialog.remove();observer.disconnect();}
    const observer=new MutationObserver(()=>{if(!dialog.isConnected&&!closed){closed=true;void stop();observer.disconnect();}});observer.observe(host,{childList:true});
    q('[data-cancel]').onclick=close;dialog.oncancel=e=>{e.preventDefault();void close();};
    q('[data-stop]').onclick=async()=>{await stop();status.textContent='Stopped. Your previous draft is preserved.';sync();};
    async function generate(mode,refine=false){
      if(busy||!metadata)return;
      if(!val('need').trim()){error.textContent='Describe the task first.';form.elements.namedItem('need').focus();return;}
      if(draft&&!refine&&!confirm('Replace the current draft?'))return;
      readDraft();const generation=++epoch;busy=true;jobId='';error.textContent='';startedAt=Date.now();
      const progress=()=>{status.textContent=mode==='template'?'Preparing template locally…':`Designing independently of BOSS… ${Math.floor((Date.now()-startedAt)/1000)}s. No agent is being created.`;};
      progress();elapsed=setInterval(progress,1000);sync();
      const finish=()=>{clearInterval(elapsed);busy=false;sync();};
      async function poll(){
        if(closed||generation!==epoch)return;
        try{
          const job=await api('/designs/'+jobId);if(closed||generation!==epoch)return;
          if(job.status==='generating'){timer=setTimeout(poll,1000);return;}
          finish();if(job.status!=='ready')throw Error(job.error||'Generation cancelled.');
          renderDraft(job.draft,mode);
        }catch(e){if(closed||generation!==epoch)return;await stop();error.textContent=e.message;status.textContent='Could not update the draft. Your previous version is preserved.';sync();}
      }
      try{
        const job=await api('/designs','POST',{mode,templateId:val('templateId'),need:val('need'),name:val('name'),parents:parents(),...(val('modelId')?{modelId:val('modelId')}:{ }),
          ...(refine?{draft,feedback:val('feedback')}:{})});
        if(closed||generation!==epoch){await api('/designs/'+job.id,'DELETE').catch(()=>{});return;}
        jobId=job.id;void poll();
      }catch(e){if(closed||generation!==epoch)return;finish();error.textContent=e.message;status.textContent='Could not prepare the draft. You can retry.';}
    }
    q('[data-template]').onclick=()=>generate('template');q('[data-generate]').onclick=()=>generate('ai');q('[data-refine]').onclick=()=>generate('ai',true);
    form.elements.namedItem('isBoss').onchange=()=>{error.textContent='';status.textContent=bossMode()?'Ready to create BOSS. Project details can be supplied later in chat.':draft?'Your specialist draft is preserved.':'Pick a starting point and describe the task.';sync();};
    form.oninput=e=>{
      if(['need','templateId','parent','feedback'].includes(e.target.name)&&draft){dirty=true;status.textContent='Changes pending — update the draft before creating.';}
      if(e.target.name==='name'&&draft)draft.name=val('name');
      if(e.target.closest('[data-contract]'))readDraft();
      if(e.target.name==='templateId')q('[data-template-help]').textContent=metadata.templates.find(t=>t.id===val('templateId'))?.description||'';
      sync();
    };
    form.onsubmit=async e=>{
      e.preventDefault();if(!bossMode())readDraft();sync();if(create.disabled||closed)return;
      creating=true;sync();error.textContent='';
      try{await api('','POST',{...(bossMode()?{isBoss:true}:{...draft,parents:parents(),designReviewed:true}),...(val('modelId')?{modelId:val('modelId')}:{})});creating=false;await close();await onCreated();}
      catch(e){creating=false;error.textContent=e.message;sync();}
    };
    try{
      metadata=await api('/designs');if(closed)return;
      if(!metadata.templates?.length)throw Error('Restart OC to load Agent Builder templates.');
      form.elements.namedItem('templateId').innerHTML=metadata.templates.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
      q('[data-template-help]').textContent=metadata.templates[0].description;
      q('[data-boss-mission]').textContent=metadata.bossPreset?.design.fields.mission||'';
      if(!metadata.bossPreset)q('[data-boss-help]').textContent='Restart OC to load project BOSS creation.';
      q('[data-runtime]').innerHTML=metadata.runtimeNotes.map(s=>`<li>${esc(s)}</li>`).join('');
      q('[data-sources]').textContent=`${metadata.skill.name} v${metadata.skill.version} · ${metadata.handbook.id}\n`+metadata.handbook.sources.map(s=>s.file+' SHA-256: '+s.sha256).join('\n');
      status.textContent='Pick a starting point and describe the task. No BOSS or model is needed for a template.';sync();
      const r=await fetch('/api/research/models',{headers:{'X-OC-Workspace':'research'},signal:AbortSignal.timeout(15000)});
      if(r.ok&&!closed)for(const m of await r.json()){const option=document.createElement('option');option.value=m.id;option.textContent=m.name||m.id;form.elements.namedItem('modelId').append(option);}
    }catch(e){if(!closed)error.textContent=e.message;}
  }
  window.OCAgentDesigner={open,reviewState,canCreate,hasBoss,canCreateBoss};
})();
