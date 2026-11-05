/* Resource assignments use the existing project/session APIs and revision checks. */
(() => {
  const id=encodeURIComponent;
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const ref=s=>({libraryId:s.libraryId,versionId:s.versionId||s.libraryVersionId,skillId:s.skillId||s.id});
  const key=s=>[s.libraryId,s.versionId||s.libraryVersionId,s.skillId||s.id].join('/');
  async function api(route,method='GET',body){const r=await fetch('/api/research/'+route,{method,cache:'no-store',headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error||v.detail||'Resource request failed');return v;}
  window.OCResourceWorkspace={mount(root){
    const pane=node('section',undefined,'oc-resource-workspace');pane.id='ocResourcePanel';pane.dataset.researchPanel='resources';pane.hidden=true;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby','ocResourceTab');
    const tab=node('button','Resources');tab.type='button';tab.id='ocResourceTab';tab.dataset.researchView='resources';tab.setAttribute('role','tab');tab.setAttribute('aria-controls',pane.id);tab.setAttribute('aria-selected','false');
    root.querySelector('[data-research-view=workspace]').after(tab);root.querySelector('.oc-inspector').append(pane);
    const heading=node('h3','Resources'),scope=node('p','Select a project session.','oc-resource-scope'),toolbar=node('div',undefined,'oc-resource-toolbar');
    const search=node('input');search.type='search';search.placeholder='Find skills, connectors or MCP…';search.setAttribute('aria-label','Find resources');
    const view=node('select');view.setAttribute('aria-label','Resource list');for(const [value,label] of [['assigned','Added'],['available','Available'],['all','All resources']]){const option=node('option',label);option.value=value;view.append(option);}
    const kind=node('select');kind.setAttribute('aria-label','Resource type');for(const value of ['All types','Skills','Connectors','MCP servers']){const option=node('option',value);option.value=value;kind.append(option);}
    const reload=node('button','↻');reload.type='button';reload.title='Refresh';reload.setAttribute('aria-label','Refresh');reload.className='oc-resource-refresh';
    const addTool=node('button','+ Add tool','oc-resource-add');addTool.type='button';addTool.setAttribute('aria-expanded','false');addTool.setAttribute('aria-controls','ocResourcePicker');
    const actions=node('div',undefined,'oc-resource-primary');actions.append(addTool,reload);
    const done=node('button','Done');done.type='button';toolbar.id='ocResourcePicker';toolbar.hidden=true;
    const status=node('p',undefined,'oc-resource-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const list=node('div',undefined,'oc-resource-list');toolbar.append(search,view,kind,done);pane.append(heading,scope,actions,toolbar,status,list);
    const advanced=node('details',undefined,'oc-resource-advanced');advanced.append(node('summary','Usage & settings'));pane.append(advanced);
    const links=node('nav',undefined,'oc-resource-links');links.setAttribute('aria-label','Resource catalogs');for(const [label,href] of [['Import skills','/openconstruction-web/desktop/skills.html'],['Connect accounts','/openconstruction-web/desktop/connectors.html'],['Configure MCP servers','/openconstruction-web/research.html?view=mcp']]){const a=node('a',label);a.href=href;links.append(a);}advanced.append(links);
    const usage=root.querySelector('.oc-project-skills');if(usage)advanced.append(usage);
    let selection={},serial=0,state=null,busy=false,loading=false,dialog=null,query='',adding=false;
    const expanded=new Set();
    const notice=(text,error=false)=>{status.textContent=text;status.classList.toggle('is-error',error);};
    const close=()=>{if(dialog){dialog.close();dialog.remove();dialog=null;}};
    const act=(text,fn,disabled=false)=>{const b=node('button',text);b.type='button';b.disabled=disabled;b.onclick=fn;return b;};
    function entries(){
      if(!state)return [];
      const assignedSkills=state.agent?state.cap.skills:state.project.items;
      const selected=state.agent?state.cap.connectorIds:state.settings.effective.enabledConnectorIds||[];
      const catalog=state.agent?state.catalog.skills:state.skills;
      const allSkills=new Map(catalog.map(s=>[key(s),s]));for(const s of assignedSkills)allSkills.set(key(s),{...allSkills.get(key(s)),...s});
      const connectors=new Map(state.connectors.map(c=>[c.id,c]));for(const cid of selected)if(!connectors.has(cid))connectors.set(cid,{id:cid,name:cid,unavailable:true});
      return [...[...allSkills.values()].map(s=>({type:'Skills',id:key(s),name:s.skillId||s.id,description:s.description||'',item:s,added:assignedSkills.some(a=>key(a)===key(s)),unavailable:s.status==='unavailable'})),
        ...[...connectors.values()].map(c=>({type:c.id.startsWith('custom-')?'MCP servers':'Connectors',id:c.id,name:c.name||c.displayName||c.id,description:c.description||c.id,item:c,added:selected.includes(c.id),unavailable:c.unavailable}))];
    }
    function render(){
      list.replaceChildren();reload.disabled=busy||loading;view.disabled=kind.disabled=!state;addTool.disabled=!state||busy;
      toolbar.hidden=!adding;addTool.setAttribute('aria-expanded',String(adding));
      scope.textContent=!state?'Select a project session.':state.agent?`Agent: ${state.agentName}`:'Project skills · Session connections';
      if(!state)return;
      const matches=entries().filter(e=>!adding?e.added:(view.value==='all'||(view.value==='assigned'?e.added:!e.added))&&(kind.value==='All types'||kind.value===e.type)&&`${e.name} ${e.description} ${e.type}`.toLowerCase().includes(query));
      let group;
      if(!adding)matches.sort((a,b)=>['Skills','Connectors','MCP servers'].indexOf(a.type)-['Skills','Connectors','MCP servers'].indexOf(b.type));
      for(const entry of matches){
        if(!adding){
          if(group!==entry.type){group=entry.type;list.append(node('h4',group,'oc-resource-group'));}
          const row=node('article',undefined,'oc-resource-item is-compact'),details=node('details'),label=node('summary'),icon=node('span',entry.type==='Skills'?'✦':entry.type==='Connectors'?'↗':'⌘','oc-resource-icon');icon.setAttribute('aria-hidden','true');
          label.append(icon,node('span',entry.name,'oc-resource-name'));if(entry.unavailable)label.append(node('small','Unavailable'));
          details.open=expanded.has(entry.id);details.ontoggle=()=>{if(!details.isConnected)return;if(details.open)expanded.add(entry.id);else expanded.delete(entry.id);};
          const body=node('div',undefined,'oc-resource-expanded');if(entry.description&&entry.description!==entry.id)body.append(node('p',entry.description));
          const controls=node('div',undefined,'oc-resource-actions');if(entry.type==='Skills')controls.append(act('Review instructions',()=>void review(entry),busy));
          controls.append(act('Remove',()=>void change(entry,false),busy||state.active));body.append(controls);details.append(label,body);row.append(details);list.append(row);continue;
        }
        const row=node('article',undefined,'oc-resource-item'),copy=node('div'),title=node('strong',entry.name),meta=node('p',`${entry.type} · ${entry.added?'Added':'Available'}${entry.unavailable?' · Unavailable':''}`);
        copy.append(title,meta);if(entry.description)copy.append(node('p',entry.description.slice(0,220),'oc-resource-description'));row.append(copy);
        const actions=node('div',undefined,'oc-resource-actions');
        if(entry.type==='Skills')actions.append(act('Review',()=>void review(entry),busy));
        actions.append(act(entry.added?'Remove':'Add',()=>entry.added?void change(entry,false):entry.type==='Skills'?void review(entry):void change(entry,true),busy||state.active||(!entry.added&&entry.unavailable)));
        row.append(actions);list.append(row);
      }
      if(!matches.length)list.append(node('p',adding?'No tools match your search.':'No tools added yet.','oc-resource-empty'));
    }
    async function load(){
      if(loading||busy||!selection.projectId||!selection.sessionId)return;loading=true;const ticket=serial,ctx={...selection};notice('Loading resources…');render();
      try{
        const [activity,project,runs]=await Promise.all([api(`sessions/${id(ctx.sessionId)}/skills`),api(`projects/${id(ctx.projectId)}/skills`),api(`sessions/${id(ctx.sessionId)}/runs`)]);
        const agent=activity.scope==='agent';let details;
        if(agent)details=await api(`sessions/${id(ctx.sessionId)}/capabilities`);
        else{const [settings,connectors,skills]=await Promise.all([api(`sessions/${id(ctx.sessionId)}/settings`),api('connectors'),api('oc/skills')]);details={settings,connectors,skills:skills.items};}
        if(ticket!==serial)return;
        state={agent,agentName:activity.agentId||'current agent',project,cap:details.capabilities,catalog:details.catalog,settings:details.settings,skills:details.skills,connectors:agent?details.catalog.connectors:details.connectors,active:runs.some(r=>['running','queued','blocked'].includes(r.status))};
        notice(state.active?'Research is active. Resource assignments can be changed after it finishes.':'');render();
      }catch(e){if(ticket===serial){state=null;notice(e.message,true);render();}}
      finally{loading=false;if(ticket!==serial)void load();else render();}
    }
    async function change(entry,add,reviewed=false){
      if(busy||!state||state.active)return;busy=true;const ticket=serial,ctx={...selection},snapshot=state;notice('Saving…');render();
      try{
        if(snapshot.agent){
          const c=snapshot.cap,skills=entry.type==='Skills'?(add?[...c.skills.map(ref),ref(entry.item)]:c.skills.filter(s=>key(s)!==entry.id).map(ref)):c.skills.map(ref);
          const connectorIds=entry.type==='Skills'?c.connectorIds:add?[...new Set([...c.connectorIds,entry.id])]:c.connectorIds.filter(cid=>cid!==entry.id);
          await api(`sessions/${id(ctx.sessionId)}/capabilities`,'PUT',{expectedRevision:c.revision,skills,connectorIds,allowedToolNames:c.allowedToolNames,deniedToolNames:c.deniedToolNames,reviewed});
        }else if(entry.type==='Skills'){
          const route=`projects/${id(ctx.projectId)}/skills`;
          if(add)await api(route,'POST',{...ref(entry.item),expectedRevision:snapshot.project.revision,reviewed});
          else await api(route+'/'+id(entry.item.bindingId),'DELETE',{expectedRevision:snapshot.project.revision});
        }else{
          const route=`sessions/${id(ctx.sessionId)}/settings`,fresh=await api(route),ids=fresh.effective.enabledConnectorIds||[];
          await api(route,'PUT',{...fresh.overrides,enabledConnectorIds:add?[...new Set([...ids,entry.id])]:ids.filter(cid=>cid!==entry.id)});
        }
        if(ticket===serial){close();window.dispatchEvent(new CustomEvent('oc-agent-configuration-changed',{detail:{projectId:ctx.projectId,sessionId:ctx.sessionId,agentId:snapshot.agentName}}));}
      }catch(e){if(ticket===serial){notice(e.message+' Refresh before trying again.',true);if(dialog){const error=dialog.querySelector('[data-resource-error]');if(error)error.textContent=e.message;}}return;}
      finally{busy=false;if(ticket===serial)render();else void load();}
      if(ticket===serial){void window.OCDesktopSkills.refresh?.();await load();if(ticket===serial)notice(entry.added?'Resource removed.':'Resource added.');}
    }
    async function review(entry){
      close();const ticket=serial,d=dialog=node('dialog',undefined,'oc-skill-dialog');d.setAttribute('aria-label','Review skill');const head=node('header');head.append(node('h2',entry.name),act('Close',close));d.append(head);
      const preview=node('pre','Loading instructions…'),error=node('p',undefined,'oc-skill-error');error.dataset.resourceError='';d.append(preview,error);document.body.append(d);d.showModal();d.addEventListener('cancel',e=>{e.preventDefault();close();});
      try{const data=await api('oc/skills/inspect?'+new URLSearchParams({...ref(entry.item),path:'SKILL.md'}));if(ticket!==serial||dialog!==d)return;preview.textContent=data.content+(data.truncated?'\n[Preview truncated]':'');
        if(!entry.added){const label=node('label'),check=node('input');check.type='checkbox';label.append(check,document.createTextNode(' I reviewed these instructions and the applicable license.'));const add=act('Add skill',()=>void change(entry,true,true),true);check.onchange=()=>add.disabled=!check.checked||busy||state.active;d.append(label,add);}
      }catch(e){if(dialog===d)error.textContent=e.message;}
    }
    search.oninput=()=>{query=search.value.trim().toLowerCase();render();};view.onchange=kind.onchange=render;reload.onclick=()=>void load();
    addTool.onclick=()=>{adding=true;query='';search.value='';view.value='available';kind.value='All types';render();search.focus();};
    done.onclick=()=>{adding=false;render();addTool.focus();};toolbar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();done.click();}});
    const sync=window.OCDesktopSkills.sync.bind(window.OCDesktopSkills);window.OCDesktopSkills.sync=value=>{sync(value);if(selection.projectId===value.projectId&&selection.sessionId===value.sessionId)return;serial++;close();selection={...value};state=null;adding=false;expanded.clear();notice('');render();if(!pane.hidden)void load();};
    new MutationObserver(()=>{if(!pane.hidden&&!state)void load();}).observe(pane,{attributes:true,attributeFilter:['hidden']});
    const timer=setInterval(()=>{if(!pane.hidden&&!document.hidden&&!dialog)void load();},10000);window.addEventListener('pagehide',()=>{clearInterval(timer);close();});render();
  }};
})();
