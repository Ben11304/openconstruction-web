(() => {
  const enc = encodeURIComponent;
  const el = (tag, text, cls) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node; };
  // Imported audit descriptions remain backwards compatible with older OC builds.
  // Split only their exact, validated prefix; ordinary skill prose stays intact.
  function skillPresentation(description='') {
    const plain={description,scores:[],status:'',warnings:[]};
    const match=description.match(/^(?:Overall|Tổng) (\d+(?:\.\d+)?)\/100 · Basic (\d+(?:\.\d+)?)\/40 · AEC (\d+(?:\.\d+)?)\/60 · (need to validate on benchmark|Chờ chuyên gia duyệt)((?: · (?:Static review required|License\/provenance unresolved|Cần duyệt static|License chưa rõ))*)\.\s+([\s\S]+)$/);
    if(!match)return plain;
    const scores=['Overall','Basic','AEC'].map((label,i)=>({label,value:Number(match[i+1]),maximum:[100,40,60][i]}));
    if(scores.some(score=>!Number.isFinite(score.value)||score.value>score.maximum))return plain;
    const translations={'Cần duyệt static':'Static review required','License chưa rõ':'License/provenance unresolved'};
    return {description:match[6],scores,status:'need to validate on benchmark',warnings:match[5].split(' · ').filter(Boolean).map(w=>translations[w]||w)};
  }
  function scoreSummary(presentation) {
    if(!presentation.scores.length)return null;
    const section=el('section',undefined,'oc-skill-audit');section.setAttribute('aria-label','Source audit scores');
    const scores=el('dl',undefined,'oc-skill-scores');
    for(const score of presentation.scores){
      const cell=el('div',undefined,'oc-skill-score'),value=el('dd');
      value.append(el('strong',String(score.value)),el('span',` / ${score.maximum}`,'oc-skill-score-max'));
      cell.append(el('dt',score.label),value);scores.append(cell);
    }
    section.append(scores);
    const statuses=el('div',undefined,'oc-skill-audit-status');
    statuses.append(el('span',presentation.status,'oc-skill-validation-label'));
    for(const warning of presentation.warnings)statuses.append(el('span',warning,'oc-skill-audit-warning'));
    section.append(statuses);
    return section;
  }
  window.OCSkillPresentation={parse:skillPresentation,render:scoreSummary};
  function renderLibraryFilters(filters, items, onChange) {
    const selected=new Set([...filters.querySelectorAll('input:checked')].map(input=>input.value));
    const wasOpen=filters.querySelector('.oc-skill-filter-group')?.open??true;
    const libraries=new Map(items.map(item=>[item.libraryId,item.libraryName]));
    const aec=[],other=[];
    for(const [id,name] of libraries){
      const isAEC=id.startsWith('oc-aec-task-')||id==='oc-aec-examples'||/^AEC\s*·\s*/.test(name);
      const label=id==='oc-aec-examples'?'Research examples':isAEC?name.replace(/^AEC\s*·\s*/,''):name;
      (isAEC?aec:other).push({id,label:isAEC?label.charAt(0).toUpperCase()+label.slice(1):label});
    }
    filters.replaceChildren();
    function appendOption(parent, {id,label}, changed=onChange){
      const row=el('label',undefined,'form-check'),check=el('input');
      check.type='checkbox';check.className='form-check-input';check.value=id;check.checked=selected.has(id);
      check.addEventListener('change',changed);row.append(check,el('span',label,'form-check-label'));parent.append(row);
    }
    if(aec.length){
      const group=el('details',undefined,'oc-skill-filter-group'),heading=el('summary','AEC Skills');
      const children=el('div',undefined,'oc-skill-filter-children');
      group.open=wasOpen;group.append(heading,children);filters.append(group);
      const updateHeading=()=>{const count=children.querySelectorAll('input:checked').length;heading.textContent=`AEC Skills${count?` (${count} selected)`:''}`;};
      for(const library of aec)appendOption(children,library,()=>{updateHeading();onChange();});
      updateHeading();
    }
    for(const library of other)appendOption(filters,library);
  }
  window.OCSkillPresentation.renderLibraryFilters=renderLibraryFilters;
  async function request(route, method='GET', body) {
    const response=await fetch('/api/research/'+route,{method,cache:'no-store',headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw Error(value.error||value.detail||'Skill operation failed.');return value;
  }
  const button=(text,click,cls='btn btn-outline-secondary btn-sm')=>{const b=el('button',text,cls);b.type='button';b.onclick=click;return b;};
  let current={},panel,summary,rows,inventory,usage=[],serial=0,loading=false,dialog;
  const close=()=>{if(dialog){dialog.close();dialog.remove();dialog=null;}};
  function skillRef(item){return {libraryId:item.libraryId,versionId:item.libraryVersionId||item.versionId,skillId:item.skillId||item.id};}
  function inspectRoute(ref,path='SKILL.md'){return 'oc/skills/inspect?'+new URLSearchParams({...ref,path});}
  async function inspect(item, options={}) {
    close();const d=dialog=el('dialog',undefined,'oc-skill-dialog');d.setAttribute('aria-label','Skill details');
    const ref=skillRef(item),head=el('header');head.append(el('h2',ref.skillId),button('Close',close));d.append(head);
    d.append(el('p',`${item.version} · Shared · Read-only`,'oc-skill-meta'));
    const message=el('p','Loading package…');message.setAttribute('role','status');d.append(message);
    const files=el('div',undefined,'oc-skill-files'),tree=el('nav',undefined,'oc-skill-file-list'),preview=el('pre');tree.setAttribute('aria-label','Skill files');files.append(tree,preview);d.append(files);
    document.body.append(d);d.showModal();d.addEventListener('cancel',e=>{e.preventDefault();close();});
    let fileSerial=0;
    const read=async path=>{const seq=++fileSerial;try{const data=await request(inspectRoute(ref,path));if(dialog!==d||seq!==fileSerial)return;preview.textContent=data.content+(data.truncated?'\n[Preview truncated]':'');return data;}catch(e){if(dialog===d){message.textContent=e.message;message.className='oc-skill-error';}}};
    const data=await read('SKILL.md');if(dialog!==d)return;
    if(!data)return;
    const folders=new Map([['',tree]]);
    for(const file of data.files){const parts=file.path.split('/');let parent=tree,prefix='';for(const part of parts.slice(0,-1)){prefix+=(prefix?'/':'')+part;if(!folders.has(prefix)){const folder=el('details'),title=el('summary',part);folder.open=true;folder.append(title);parent.append(folder);folders.set(prefix,folder);}parent=folders.get(prefix);}const fileButton=button(parts.at(-1),()=>void read(file.path),'');fileButton.title=file.path;parent.append(fileButton);}
    const presentation=skillPresentation(item.description||'');message.textContent=presentation.description;
    const audit=scoreSummary(presentation);if(audit)message.before(audit);
    if(options.projectId){
      const useTitle=el('h3',`${options.uses.length} successful ${options.uses.length===1?'call':'calls'} in this session`);useTitle.style.fontSize='15px';d.append(useTitle);
      d.append(el('p','Counts successful read_skill calls, including subagents. Reading other files or following instructions is not inferred.','oc-skill-meta'));
      const list=el('ol',undefined,'oc-skill-use-list');
      for(const use of options.uses){const li=el('li',`${new Date(use.timestamp).toLocaleString()} · ${use.agentId==='main'?'Main Agent':'Subagent'} · ${use.toolCallId}`);list.append(li);}d.append(list);
      const footer=el('footer');
      footer.append(button('Open session trace',()=>{close();window.OCDesktopTrace?.open();}));
      const remove=button('Remove from project',async()=>{
        remove.disabled=true;try{await request(`projects/${enc(options.projectId)}/skills/${enc(item.bindingId)}`,'DELETE',{expectedRevision:options.revision});close();void refresh();}catch(e){message.textContent=e.message;message.className='oc-skill-error';remove.disabled=false;}
      });footer.append(remove);d.append(footer);
    } else {
      const projects=await request('projects').catch(e=>{message.textContent=e.message;return [];});if(dialog!==d)return;
      const label=el('label','Add to project'),select=el('select',undefined,'form-select');select.setAttribute('aria-label','Destination project');
      for(const project of projects){const option=el('option',project.name);option.value=project.id;select.append(option);}label.append(select);d.append(label);
      const saved=window.OCDesktopLayout?.selection?.()||JSON.parse(localStorage.getItem('oc.desktop.selection')||'{}');if(projects.some(p=>p.id===saved.projectId))select.value=saved.projectId;
      const consent=el('label'),check=el('input');check.type='checkbox';check.id='ocSkillReviewed';consent.append(check,document.createTextNode(' I reviewed the instructions and applicable license.'));d.append(consent);
      const footer=el('footer'),add=button('Add to project',async()=>{
        const destination=select.value;add.disabled=true;select.disabled=true;check.disabled=true;
        try { const state=await request(`projects/${enc(destination)}/skills`);await request(`projects/${enc(destination)}/skills`,'POST',{...ref,reviewed:true,expectedRevision:state.revision});
          if(dialog!==d)return;message.textContent=`Added to ${projects.find(p=>p.id===destination)?.name}.`;add.textContent='Added';const link=el('a','Open project','btn btn-primary btn-sm');link.href='/openconstruction-web/research.html';link.onclick=async event=>{event.preventDefault();const sessions=await request(`projects/${enc(destination)}/sessions`);const session=sessions[0]||await request(`projects/${enc(destination)}/sessions`,'POST',{title:'New chat'});localStorage.setItem('oc.desktop.selection',JSON.stringify({projectId:destination,sessionId:session.id}));location.href=link.href;};footer.append(link);
        }catch(e){if(dialog===d){message.textContent=e.message;message.className='oc-skill-error';add.disabled=false;select.disabled=false;check.disabled=false;}}
      },'btn btn-primary btn-sm');add.disabled=true;check.onchange=()=>{add.disabled=!check.checked||!select.value;};footer.append(add);d.append(footer);
      if(!projects.length)message.textContent='Create a research project first, then add this skill.';
    }
  }
  function renderPanel(){
    if(!panel)return;rows.replaceChildren();const items=inventory?.items||[];
    const used=items.filter(item=>usage.some(use=>use.skillId===item.skillId)).length;
    summary.textContent=`Skills · ${items.length} added · ${used} used`;
    rows.append(el('p',current.sessionId?'Calls in current session':'Select a session to see usage','oc-skill-meta'));
    if(!items.length)rows.append(el('p','No skills added. Choose a workflow from the catalog.'));
    for(const item of items){const calls=usage.filter(use=>use.skillId===item.skillId),row=el('div',undefined,'oc-skill-row');row.append(button(item.skillId,()=>void inspect(item,{projectId:current.projectId,revision:inventory.revision,uses:calls}),''),el('span',item.status==='unavailable'?'Unavailable':calls.length?`${calls.length} ${calls.length===1?'call':'calls'}`:'Not used','oc-skill-count'));rows.append(row);}
    const link=el('a','Browse Skills catalog');link.href='/openconstruction-web/desktop/skills.html';rows.append(link);
  }
  async function refresh(){
    if(!panel||!current.projectId||loading)return;loading=true;const ticket=serial,pid=current.projectId,sid=current.sessionId;
    try{const [list,activity]=await Promise.all([request(`projects/${enc(pid)}/skills`),sid?request(`sessions/${enc(sid)}/skills`):Promise.resolve({uses:[]})]);if(ticket!==serial)return;inventory=list;usage=activity.uses||[];renderPanel();}
    catch(e){if(ticket===serial){summary.textContent='Skills · unavailable';rows.replaceChildren(el('p',e.message,'oc-skill-error'));}}
    finally{loading=false;if(ticket!==serial)void refresh();}
  }
  window.OCDesktopSkills={mount(root){panel=el('details',undefined,'oc-project-skills');summary=el('summary','Skills');rows=el('div');panel.append(summary,rows);root.querySelector('.oc-inspector-heading').after(panel);panel.addEventListener('toggle',()=>{if(panel.open)void refresh();});const timer=setInterval(()=>{if(panel.open&&!document.hidden)void refresh();},5000);window.addEventListener('pagehide',()=>clearInterval(timer));},sync(value){if(current.projectId===value.projectId&&current.sessionId===value.sessionId)return;serial++;close();current=value;inventory=null;usage=[];renderPanel();void refresh();}};
  const libraryRank=item=>item.libraryId==='oc-aec-examples'?0:item.libraryId==='oc-local-skills'?1:2;
  const skillDetailUrl=item=>'/openconstruction-web/desktop/skills-detail.html?'+new URLSearchParams(skillRef(item));
  const skillTitle=id=>({
    'aec-datasets-tools':'AEC Datasets & Tools',
    'aec-standards-codes':'AEC Standards & Codes',
    'research-methods':'Research Methods',
  })[id]||id.split('-').map(word=>word==='aec'?'AEC':word[0].toUpperCase()+word.slice(1)).join(' ');
  const skillVersion=version=>version?.startsWith('revision:')?`Version ${version.slice(9)}`:version;
  async function catalog(){
    const list=document.getElementById('ocSkillCatalogList');if(!list)return;
    const status=document.getElementById('ocSkillCatalogStatus'),search=document.getElementById('ocSkillSearch');
    const filters=document.getElementById('ocSkillLibraries'),sort=document.getElementById('ocSkillSort');let items=[];
    function render(){
      const query=search.value.trim().toLowerCase(),selected=[...filters.querySelectorAll('input:checked')].map(input=>input.value);
      const matches=items.filter(item=>(!selected.length||selected.includes(item.libraryId))&&`${item.id} ${item.description} ${item.libraryName}`.toLowerCase().includes(query));
      matches.sort((a,b)=>sort.value==='name'?a.id.localeCompare(b.id):libraryRank(a)-libraryRank(b)||a.id.localeCompare(b.id));
      document.getElementById('ocSkillResultCount').textContent=matches.length;list.replaceChildren();
      for(const item of matches){
        const href=skillDetailUrl(item),row=el('article',undefined,'paper-card oc-skill-catalog-row');
        const mark=el('div',item.id==='research-methods'?'RM':item.id.startsWith('aec-')?'AEC':'SK','oc-skill-card-mark');
        mark.setAttribute('aria-hidden','true');
        const copy=el('div',undefined,'oc-skill-card-copy'),heading=el('h2',undefined,'h6 title mb-1'),title=el('a',skillTitle(item.id));
        title.href=href;heading.append(title);
        const presentation=skillPresentation(item.description||'');
        copy.append(heading,el('p',`${item.libraryName} · ${skillVersion(item.version)}`,'meta'));
        const audit=scoreSummary(presentation);if(audit)copy.append(audit);
        copy.append(el('p',presentation.description,'oc-skill-card-description'));
        const action=el('a','View details','btn btn-sm btn-primary');action.href=href;copy.append(action);row.append(mark,copy);list.append(row);
      }
      if(!matches.length)list.append(el('p',items.length?'No skills match your search or filters.':'No skills yet. Import a folder containing SKILL.md to get started.','oc-skill-empty'));
      list.setAttribute('aria-busy','false');
    }
    function renderFilters(){
      renderLibraryFilters(filters,items,render);
    }
    async function load(){status.textContent='Loading local library…';try{items=(await request('oc/skills')).items;renderFilters();render();status.textContent=`${items.length} skills available on this device`;}catch(e){status.textContent=e.message;status.className='oc-skill-error';list.setAttribute('aria-busy','false');}}
    search.oninput=render;sort.onchange=render;document.getElementById('ocSkillImport').onchange=async event=>{
      const input=event.target;input.disabled=true;status.className='';
      try{const files=[...input.files].filter(file=>!file.webkitRelativePath.split('/').some(part=>part.startsWith('.')));if(!files.length||files.length>100||files.reduce((n,file)=>n+file.size,0)>700000)throw Error('Import at most 100 files, up to 700 KB total.');
        const packageFiles=[];for(const file of files){const path=file.webkitRelativePath.split('/').slice(1).join('/');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);packageFiles.push({path,content:btoa(binary),encoding:'base64'});}
        if(!packageFiles.some(file=>file.path==='SKILL.md'))throw Error('Select the folder containing SKILL.md directly.');
        status.textContent='Validating package…';await request('oc/skills/import','POST',{package:{files:packageFiles}});await load();status.textContent='Imported into the local catalog. Review the skill to add it to a project.';
      }catch(e){status.textContent=e.message;status.className='oc-skill-error';}finally{input.disabled=false;input.value='';}
    };await load();
  }
  async function detail(){
    const title=document.getElementById('ocSkillDetailTitle');if(!title)return;
    const query=new URLSearchParams(location.search),ref={libraryId:query.get('libraryId'),versionId:query.get('versionId'),skillId:query.get('skillId')};
    const status=document.getElementById('ocSkillDetailStatus'),files=document.getElementById('ocSkillDetailFiles'),preview=document.getElementById('ocSkillDetailPreview');
    if(Object.values(ref).some(value=>!value)){title.textContent='Skill not found';status.textContent='Choose a skill from the catalog.';return;}
    try{
      const catalogItems=(await request('oc/skills')).items;
      const item=catalogItems.find(candidate=>candidate.libraryId===ref.libraryId&&candidate.versionId===ref.versionId&&candidate.id===ref.skillId);
      if(!item)throw Error('This skill version is no longer in the current catalog. Return to Skills and select an available version.');
      title.textContent=skillTitle(item.id);document.title=`${skillTitle(item.id)} · OpenConstruction`;
      const description=document.getElementById('ocSkillDetailDescription'),presentation=skillPresentation(item.description||'');
      description.textContent=presentation.description;
      const audit=scoreSummary(presentation);if(audit)description.before(audit);
      document.getElementById('ocSkillDetailLibrary').textContent=item.libraryName;
      document.getElementById('ocSkillDetailMark').textContent=item.id==='research-methods'?'RM':item.id.startsWith('aec-')?'AEC':'SK';
      document.getElementById('ocSkillFactLibrary').textContent=item.libraryName;
      document.getElementById('ocSkillFactVersion').textContent=skillVersion(item.version);
      let fileTicket=0;
      const read=async path=>{const ticket=++fileTicket;const data=await request(inspectRoute(ref,path));if(ticket!==fileTicket)return;preview.textContent=data.content+(data.truncated?'\n[Preview truncated]':'');for(const button of files.querySelectorAll('button'))button.setAttribute('aria-current',button.dataset.path===path?'true':'false');return data;};
      const first=await read('SKILL.md');
      for(const file of first.files){const fileButton=button(file.path,()=>void read(file.path).catch(e=>{status.textContent=e.message;status.className='oc-skill-error';}),'');fileButton.dataset.path=file.path;fileButton.setAttribute('aria-current',file.path==='SKILL.md'?'true':'false');files.append(fileButton);}
      const license=first.files.find(file=>file.path==='LICENSE'||file.path==='LICENSE.txt');
      if(license){const licenseFile=await request(inspectRoute(ref,license.path));document.getElementById('ocSkillFactLicense').textContent=licenseFile.content.startsWith('MIT License')?'MIT':`See ${license.path}`;}
      else document.getElementById('ocSkillFactLicense').textContent=first.metadata?.frontmatter?.license||'See skill instructions';
      const projects=await request('projects'),select=document.getElementById('ocSkillProject'),check=document.getElementById('ocSkillReviewed'),add=document.getElementById('ocSkillAdd');
      for(const project of projects){const option=el('option',project.name);option.value=project.id;select.append(option);}
      const saved=window.OCDesktopLayout?.selection?.()||JSON.parse(localStorage.getItem('oc.desktop.selection')||'{}');if(projects.some(project=>project.id===saved.projectId))select.value=saved.projectId;
      if(!projects.length){status.textContent='Create a research project first, then add this skill.';select.disabled=true;}
      const update=()=>{add.disabled=!check.checked||!select.value;};check.onchange=update;select.onchange=update;update();
      add.onclick=async()=>{add.disabled=true;try{const destination=select.value,state=await request(`projects/${enc(destination)}/skills`);await request(`projects/${enc(destination)}/skills`,'POST',{...ref,reviewed:true,expectedRevision:state.revision});status.textContent=`Added to ${projects.find(project=>project.id===destination)?.name}.`;status.className='oc-skill-success';add.textContent='Added to project';const link=el('a','Open project','btn btn-outline-primary btn-sm');link.href='/openconstruction-web/research.html';link.onclick=async event=>{event.preventDefault();const sessions=await request(`projects/${enc(destination)}/sessions`);const session=sessions[0]||await request(`projects/${enc(destination)}/sessions`,'POST',{title:'New chat'});localStorage.setItem('oc.desktop.selection',JSON.stringify({projectId:destination,sessionId:session.id}));location.href=link.href;};status.after(link);}catch(e){status.textContent=e.message;status.className='oc-skill-error';update();}};
    }catch(e){status.textContent=e.message;status.className='oc-skill-error';if(title.textContent==='Loading skill…')title.textContent='Skill unavailable';}
  }
  void catalog();
  void detail();
})();
