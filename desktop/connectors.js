(() => {
  const logos=Object.freeze({
    openconstruction:'/openconstruction-web/assets/img/icon.png',
    github:'/openconstruction-web/desktop/connector-logos/github.svg',
    huggingface:'/openconstruction-web/desktop/connector-logos/huggingface.svg',
    crossref:'/openconstruction-web/desktop/connector-logos/crossref.svg',
    'semantic-scholar':'/openconstruction-web/desktop/connector-logos/semantic-scholar.png',
    arxiv:'/openconstruction-web/desktop/connector-logos/arxiv.jpg',
    'llm-wiki':'/openconstruction-web/desktop/connector-logos/local-wiki.svg'
  });
  const fallbackLogo='/openconstruction-web/desktop/connector-logos/connector.svg';
  function logo(item){
    const image=document.createElement('img');
    image.src=Object.hasOwn(logos,item.id)?logos[item.id]:fallbackLogo;
    image.alt=item.id==='llm-wiki'?'Local knowledge base icon':Object.hasOwn(logos,item.id)?`${item.displayName||item.id} logo`:'Connector icon';
    image.className='oc-connector-logo';image.width=112;image.height=84;image.decoding='async';
    image.addEventListener('error',()=>{image.src=fallbackLogo;image.alt='Connector icon';},{once:true});
    return image;
  }
  // Presentation only: the live engine catalog remains the source of connector
  // identity and selection. Unknown/custom connectors are never auto-enabled.
  const descriptions={
    openconstruction:'Discover construction research resources through the OpenConstruction catalog.',
    github:'Search public repositories and read repository metadata, licenses and READMEs. No push, clone or code execution.',
    huggingface:'Search public models, datasets and Spaces; read card metadata and file names. No weight downloads or inference.',
    crossref:'Search publication metadata and look up DOIs. Metadata only, not full text.',
    'semantic-scholar':'Search papers and read abstracts, citation counts and open-access links. Public access may be rate-limited.',
    arxiv:'Search scientific preprints and abstracts; prepare paper PDFs through the governed download workflow.',
    'llm-wiki':'Search and read pages and source references from a configured LLM Wiki knowledge base. Requires an available Wiki service.'
  };
  const description=item=>descriptions[item.id]||item.description||'Review the provider terms and configured service before enabling this connector.';
  const category = id => ['arxiv','crossref','semantic-scholar'].includes(id) ? 'Papers' : ['github','huggingface'].includes(id) ? 'Code, models & datasets' : id === 'openconstruction' ? 'AEC resources' : 'Knowledge & other sources';
  const safeUrl = value => { try { const url=new URL(value); return url.protocol==='https:'&&!url.username&&!url.password?url.href:null; } catch { return null; } };
  // Snapshot only the selected project's inherited connector list, leaving every
  // unrelated override intact. Never mutate global defaults or session settings.
  function updatedSettings(settings,id,enabled) {
    const ids=new Set(settings.effective?.enabledConnectorIds||[]);
    enabled?ids.add(id):ids.delete(id);
    return {...settings.overrides,enabledConnectorIds:[...ids]};
  }
  window.OCConnectorCatalog={category,safeUrl,updatedSettings,description,logos,logo};
  const list=document.getElementById('ocConnectorList');if(!list)return;
  const $=id=>document.getElementById(id), el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const status=$('ocConnectorStatus'),project=$('ocConnectorProject'),search=$('ocConnectorSearch'),filters=$('ocConnectorCategories'),refresh=$('ocConnectorRefresh');
  let items=[],projects=[],settings=null,sequence=0,busy=false,dialog=null;
  const selectedCategories=new Set();
  async function request(route,method='GET',body){
    const response=await fetch('/api/research/'+route,{method,cache:'no-store',headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Error(data.detail||data.error||'Connector settings are unavailable.');return data;
  }
  function notice(message,error=false){status.textContent=message;status.className=error?'oc-skill-error':'oc-skill-meta';}
  const button=(text,click,cls='btn btn-outline-secondary btn-sm')=>{const b=el('button',text,cls);b.type='button';b.onclick=click;return b;};
  function close(){if(busy)return;dialog?.close();dialog?.remove();dialog=null;}
  function render(){
    const query=search.value.trim().toLowerCase(),enabled=new Set(settings?.effective?.enabledConnectorIds||[]);
    const matches=items.filter(item=>(!selectedCategories.size||selectedCategories.has(category(item.id)))&&[item.displayName,item.id,description(item),item.publisher].join(' ').toLowerCase().includes(query));
    $('ocConnectorCount').textContent=`${matches.length} ${matches.length===1?'connector':'connectors'}`;list.replaceChildren();
    for(const item of matches){
      const row=el('article',undefined,'paper-card oc-skill-catalog-row'),mark=el('div',undefined,'oc-connector-mark');mark.append(logo(item));
      const copy=el('div',undefined,'oc-skill-card-copy');copy.append(el('h2',item.displayName||item.id),el('p',category(item.id),'meta'),el('p',description(item),'oc-skill-card-description'));
      copy.append(el('span',settings?(enabled.has(item.id)?'Enabled for this project':'Off for this project'):'Select an available project to manage access','oc-connector-state'+(settings&&enabled.has(item.id)?' is-enabled':'')));
      const action=button('View details',()=>inspect(item),'btn btn-primary btn-sm');action.disabled=busy;copy.append(el('br'),action);row.append(mark,copy);list.append(row);
    }
    if(!matches.length)list.append(el('p',items.length?'No connectors match your search or filters.':'No connectors are available. Refresh after the research engine starts.','oc-skill-empty'));
  }
  function inspect(item){
    close();const d=dialog=el('dialog',undefined,'oc-skill-dialog oc-connector-dialog');d.setAttribute('aria-label','Connector details');
    const header=el('header'),identity=el('div',undefined,'oc-connector-identity');identity.append(logo(item),el('h2',item.displayName||item.id));header.append(identity,button('Close',close));d.append(header,el('p',description(item)));
    if(item.id==='llm-wiki')d.append(el('p','The book symbol identifies OC’s local knowledge connector; it is not a third-party brand logo.','oc-skill-meta'));
    if(item.id==='arxiv')d.append(el('p','Thank you to arXiv for use of its open access interoperability. This product was not reviewed or approved by, nor does it necessarily express or reflect the policies or opinions of, arXiv.','oc-skill-meta'));
    d.append(el('h3','Provider & access','h6'),el('p',`${item.publisher||item.displayName||item.id} · ${item.dataClassification||'See provider terms'}`));
    if(item.networkHosts?.length)d.append(el('p','Service hosts: '+item.networkHosts.join(', '),'oc-skill-meta'));
    const url=safeUrl(item.termsUrl||item.governance?.termsUrl);if(url){const a=el('a','Provider terms');a.href=url;a.target='_blank';a.rel='noopener noreferrer';d.append(a);}
    d.append(el('p','Enabling selects this source for the agent. Availability still depends on its service and runtime permissions; it does not connect an account. GitHub, Hugging Face, Crossref and Semantic Scholar currently use public access only.','oc-skill-meta'));
    const enabled=settings?.effective?.enabledConnectorIds?.includes(item.id)===true,destination=project.value;
    const message=el('p',destination?`${enabled?'Disable':'Enable'} for ${projects.find(p=>p.id===destination)?.name}. New runs use this selection unless a session overrides it or a specialist adds its own connectors.`:'Create or select a project first.');message.setAttribute('role','status');d.append(message);
    d.append(el('p','Saving creates an explicit project connector selection, preserving the other currently selected sources. Global defaults are not changed.','oc-skill-meta'));
    const save=button(enabled?'Disable for project':'Enable for project',async()=>{
      if(busy||!destination)return;busy=true;save.disabled=true;project.disabled=true;refresh.disabled=true;render();message.textContent='Saving project selection…';
      try{
        const route=`projects/${encodeURIComponent(destination)}/settings`,fresh=await request(route);
        const result=await request(route,'PUT',updatedSettings(fresh,item.id,!enabled));
        if(project.value===destination)settings=result;
        busy=false;close();notice(`${item.displayName||item.id} ${enabled?'disabled':'enabled'} for ${projects.find(p=>p.id===destination)?.name}. Applies to new runs.`);
      }catch(error){message.textContent=error.message;message.className='oc-skill-error';save.disabled=false;}
      finally{busy=false;project.disabled=!projects.length;refresh.disabled=false;render();}
    },enabled?'btn btn-outline-primary':'btn btn-primary');save.disabled=!settings||!destination;
    const footer=el('footer');footer.append(button('Cancel',close),save);d.append(footer);document.body.append(d);d.addEventListener('cancel',event=>{event.preventDefault();close();});d.showModal();
  }
  async function loadProject(){
    const ticket=++sequence;settings=null;list.setAttribute('aria-busy','true');render();notice('Loading project selection…');
    try{const data=project.value?await request(`projects/${encodeURIComponent(project.value)}/settings`):null;if(ticket!==sequence)return;settings=data;notice(data?'Review a connector to enable or disable it for this project.':'Create a project in Research to enable connectors.');}
    catch(error){if(ticket===sequence)notice(error.message,true);}
    finally{if(ticket===sequence){list.setAttribute('aria-busy','false');render();}}
  }
  async function load(){
    refresh.disabled=true;project.disabled=true;settings=null;notice('Loading connectors…');list.setAttribute('aria-busy','true');
    try{
      const [sources,available]=await Promise.all([request('connectors'),request('projects')]);items=sources;projects=available;
      let saved={};try{saved=JSON.parse(localStorage.getItem('oc.desktop.selection')||'{}');}catch{}
      const preferred=project.value||saved.projectId;project.replaceChildren(el('option','Select a project'));project.firstChild.value='';
      for(const p of projects){const option=el('option',p.name);option.value=p.id;project.append(option);}project.value=projects.some(p=>p.id===preferred)?preferred:projects[0]?.id||'';
      filters.replaceChildren();for(const group of [...new Set(items.map(i=>category(i.id)))]){const label=el('label',undefined,'form-check'),input=el('input',undefined,'form-check-input');input.type='checkbox';input.checked=selectedCategories.has(group);input.onchange=()=>{input.checked?selectedCategories.add(group):selectedCategories.delete(group);render();};label.append(input,el('span',group,'form-check-label'));filters.append(label);}
      await loadProject();
    }catch(error){notice(error.message,true);list.replaceChildren();list.setAttribute('aria-busy','false');}
    finally{refresh.disabled=false;project.disabled=!projects.length;}
  }
  search.oninput=render;project.onchange=()=>{close();void loadProject();};refresh.onclick=()=>void load();void load();
})();
