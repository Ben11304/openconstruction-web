(() => {
  const commands = [
    ['model','Choose a model','model'], ['effort','Set thinking effort','effort'],
    ['permissions','Choose Ask or Full access','permissions'], ['skills','Select a skill for your next message','skills'],
    ['new','Start a new chat in this project','new'], ['clear','Start fresh; keep this chat in history','new'],
    ['stop','Stop the current run','stop'], ['status','Show this session’s model and run status','status'],
    ['workspace','Open project files','workspace'], ['papers','Open project papers','papers'],
    ['outputs','Open saved outputs','artifacts'], ['mcp','Open MCP connections','mcp'],
    ['settings','Open agent settings','agent'], ['help','Browse commands and skills','help']
  ].map(([name,description,action])=>({name,description,action,kind:'command'}));
  let root, input, menu, list, footer, chips, status, snapshot={}, catalog=[], settings, loading=false, loadError='', busy=false;
  let selected=new Map(), entries=[], cursor=0, contextKey='', dismissed='', ticket=0;
  const pending=new Map();
  const controls=()=>window.OCDesktopChatControls;
  const parse=()=>input.value.match(/^\/([^\s/]*)(?:[ \t]+([^\n]*))?$/);
  const commandFor=name=>commands.find(c=>c.name===name.toLowerCase());
  const skillCommand=skill=>commands.some(c=>c.name===skill.id)?'skill:'+skill.id:skill.id;
  const skillFor=name=>catalog.find(s=>skillCommand(s)===name);
  const enabled=skill=>settings?.effective?.enabledSkillIds?.includes(skill.id);
  const pluginDisabled=()=>settings?.effective?.plugins?.skill?.enabled===false;
  async function request(route,method='GET',body) {
    const response=await fetch('/api/research/'+route,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.detail||result.error||'Command failed.');return result;
  }
  function notice(text,error=false){status.textContent=text;status.hidden=!text;status.classList.toggle('is-error',error);}
  function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function position(){
    const r=input.getBoundingClientRect(),height=Math.max(100,Math.min(336,r.top-20));
    menu.style.left=Math.max(8,Math.min(r.left,innerWidth- Math.min(r.width,600)-8))+'px';
    menu.style.width=Math.min(r.width,600,innerWidth-16)+'px';
    menu.style.bottom=Math.max(8,innerHeight-r.top+6)+'px';menu.style.maxHeight=height+'px';
  }
  function renderChips(){
    chips.replaceChildren();chips.hidden=!selected.size;
    for(const skill of selected.values()){
      const chip=document.createElement('span');chip.className='oc-skill-chip';
      const label=document.createElement('span');label.textContent='/'+skillCommand(skill);chip.append(label);
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove skill '+skill.name);remove.onclick=()=>{selected.delete(skill.id);renderChips();input.focus();};chip.append(remove);chips.append(chip);
    }
  }
  async function load(){
    const sid=snapshot.sessionId,version=++ticket;if(!sid)return;
    loading=true;loadError='';render();
    try{const result=await Promise.all([request(`projects/${encodeURIComponent(snapshot.projectId)}/skills`),request(`sessions/${encodeURIComponent(sid)}/settings`)]);
      if(version!==ticket||sid!==snapshot.sessionId)return;
      catalog=(result[0].items||[]).filter(s=>s.status==='ready').map(s=>({...s,id:s.skillId,name:s.skillId}));settings=result[1];
    }catch(e){if(version===ticket)loadError=e.message;}
    finally{if(version===ticket){loading=false;render();}}
  }
  const availableSkills=()=>catalog.map(skill=>({name:skillCommand(skill),label:skill.name,description:skill.description||'Research skill',kind:'skill',skill,disabled:busy||loading||!!snapshot.run||pluginDisabled(),badge:selected.has(skill.id)?'Selected':enabled(skill)?'Skill':'Unavailable in this session'}));
  function choices(){
    const match=parse();if(!match)return [];
    const [,,arg]=match,name=match[1].toLowerCase(),command=commandFor(name);
    if(command&&arg!==undefined&&['model','effort','permissions'].includes(command.action)){
      return (controls()?.choices(command.action)||[]).filter(c=>(c.label+' '+c.value).toLowerCase().includes(arg.toLowerCase())).map(c=>({...c,name:c.label,description:command.action==='permissions'?(c.value==='always_allow'?'Automatically approve research actions; sandbox limits still apply.':'Ask before actions requiring approval.'):'Save for this session',kind:'setting',field:command.action,badge:c.selected?'Current':'',disabled:c.disabled||busy}));
    }
    if(command?.action==='skills'&&arg!==undefined)return availableSkills().filter(s=>(s.name+' '+s.description).toLowerCase().includes(arg.toLowerCase()));
    if(skillFor(match[1])&&arg!==undefined)return [];
    if(arg!==undefined)return [];
    return [...commands.map(c=>({...c,disabled:busy||(['new'].includes(c.action)&&(!snapshot.projectId||!!snapshot.run))||(c.action==='stop'&&!snapshot.run)})),...availableSkills()].filter(c=>(c.name+' '+c.description).toLowerCase().includes(name));
  }
  function render(){
    if(!menu||!input||document.activeElement!==input||busy||!parse()||input.value===dismissed){close();return;}
    const match=parse(),key=match[1]+'|'+(match[2]===undefined?'root':'args');if(key!==contextKey){cursor=0;contextKey=key;}
    entries=choices();cursor=Math.min(cursor,Math.max(0,entries.length-1));list.replaceChildren();
    const skillRequest=skillFor(match[1]);if(skillRequest&&match[2]!==undefined){close();return;}
    if(!entries.length){const empty=document.createElement('div');empty.className='oc-slash-empty';empty.textContent=loading?'Loading skills…':loadError||'No matching command. Try /help.';list.append(empty);}
    entries.forEach((entry,index)=>{
      const row=document.createElement('div');row.id='ocSlashOption'+index;row.className='oc-slash-option';row.setAttribute('role','option');row.setAttribute('aria-selected',String(index===cursor));row.setAttribute('aria-disabled',String(!!entry.disabled));
      const icon=document.createElement('span');icon.className='oc-slash-icon';icon.textContent=entry.kind==='skill'?'✧':entry.kind==='setting'&&entry.badge==='Current'?'✓':'/';
      const copy=document.createElement('span');copy.className='oc-slash-copy';const title=document.createElement('strong');title.textContent=(entry.kind==='setting'?'':'/')+entry.name;const desc=document.createElement('small');desc.textContent=entry.description;copy.append(title,desc);row.append(icon,copy);
      if(entry.badge){const badge=document.createElement('span');badge.className='oc-slash-badge';badge.textContent=entry.badge;row.append(badge);}
      row.addEventListener('mousedown',event=>event.preventDefault());row.addEventListener('click',()=>{void choose(entry);});list.append(row);
    });
    footer.textContent=loadError?'Skills unavailable · /skills to retry':loading?'Loading skills…':'↑ ↓ Navigate   ↵ Select   esc Close';
    menu.hidden=false;position();input.setAttribute('aria-expanded','true');
    if(entries.length){input.setAttribute('aria-activedescendant','ocSlashOption'+cursor);list.children[cursor]?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
  }
  function consume(text,tail=''){if(input.value===text){input.value=tail;input.dispatchEvent(new Event('input',{bubbles:true}));}}
  function submenu(name){input.value=name?'/'+name+' ':'/';dismissed='';cursor=0;input.focus();render();if(name==='skills')void load();}
  async function choose(entry){
    if(!entry||entry.disabled||busy)return;
    if(entry.kind==='command'&&['model','effort','permissions','skills','help'].includes(entry.action)){submenu(entry.action==='help'?'':entry.action);return;}
    const text=input.value,sid=snapshot.sessionId,pid=snapshot.projectId;
    busy=true;close();notice('');
    try{
      if(entry.kind==='setting'){
        if(!await controls().change(entry.field,entry.value))throw Error('Setting was not saved. Check the chat settings below.');
        if(sid===snapshot.sessionId){consume(text);notice(entry.name+' selected for this session.');}
      }else if(entry.kind==='skill'){
        if(!sid)throw Error('Select a session first.');
        const fresh=await request(`sessions/${encodeURIComponent(sid)}/settings`);
        if(fresh.effective?.plugins?.skill?.enabled===false)throw Error('Skills are disabled. Enable the skill plugin in Agent settings.');
        if(!fresh.effective?.enabledSkillIds?.includes(entry.skill.id)){
          throw Error('This skill is not enabled in the current session. Check its project binding in the Skills panel.');
        }
        if(sid===snapshot.sessionId){selected.set(entry.skill.id,entry.skill);renderChips();const tail=text.match(/^\/\S+[ \t]+([\s\S]*)$/)?.[1]||'';consume(text,tail);notice('Skill selected. Add your request, then send.');void load();}
      }else if(entry.action==='new'){
        if(window.OCResearchChat.isUploading())throw Error('Wait for the upload to finish.');
        const session=await request(`projects/${encodeURIComponent(pid)}/sessions`,'POST',{title:'New chat'});
        if(sid===snapshot.sessionId){consume(text);await window.OCResearchWorkspace.openSession(pid,session.id);notice('New chat. Previous history is saved.');}
      }else if(entry.action==='stop'){
        await request(`sessions/${encodeURIComponent(sid)}/runs/${encodeURIComponent(snapshot.run.id)}/cancel`,'POST',{});
        if(sid===snapshot.sessionId){consume(text);await window.OCResearchWorkspace.refreshSession();notice('Stop requested. The run is finishing its current cleanup.');}
      }else if(entry.action==='status'){
        const current=controls().current();consume(text);notice(`${current.model} · ${current.effort} effort · ${current.permissions} · ${snapshot.run?.status||'Idle'}`);
      }else if(['workspace','papers','artifacts'].includes(entry.action)){
        consume(text);root.querySelector(`[data-research-view="${entry.action}"]`)?.click();
      }else {consume(text);void window.OCResearchSettings?.activate(entry.action);}
    }catch(e){if(sid===snapshot.sessionId)notice(e.message,true);}
    finally{busy=false;if(sid===snapshot.sessionId&&!input.closest('[hidden]'))input.focus();}
  }
  async function beforeSubmit(){
    if(busy)return false;
    const match=input.value.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
    if(match){
      const command=commandFor(match[1]),skill=skillFor(match[1]);
      if(skill){await choose(availableSkills().find(s=>s.skill.id===skill.id));if(input.value.startsWith('/'))return false;}
      else if(command){
        if(['model','effort','permissions'].includes(command.action)&&match[2]){
          const choices=controls().choices(command.action);const value=match[2].trim().toLowerCase();const item=choices.find(c=>c.label.toLowerCase()===value||c.value.toLowerCase()===value||c.value.split(':').at(-1).toLowerCase()===value);
          if(item)await choose({...item,name:item.label,kind:'setting',field:command.action});else{submenu(command.name);notice('Choose an available '+command.name+'.',true);}
        }else await choose({...command,disabled:(command.action==='stop'&&!snapshot.run)||(command.action==='new'&&!!snapshot.run)});
        return false;
      }else{notice(loading?'Skills are loading. Try again shortly.':'Unknown command. Use /help to browse commands and skills.',true);render();return false;}
    }
    if(selected.size&&!input.value.trim()){notice('Add a request for the selected skill.');input.focus();return false;}
    if(selected.size){
      const sid=snapshot.sessionId;
      try{const fresh=await request(`sessions/${encodeURIComponent(sid)}/settings`);if(sid!==snapshot.sessionId)return false;
        if([...selected.keys()].some(id=>!fresh.effective?.enabledSkillIds?.includes(id)))throw Error('A selected skill is no longer enabled. Select it again or enable it in Agent settings.');
      }catch(e){notice(e.message,true);return false;}
    }
    return true;
  }
  window.OCDesktopSlash={
    mount(workspace){
      root=workspace;input=root.querySelector('#ocResearchPrompt');
      menu=document.createElement('div');menu.className='oc-slash-menu';menu.hidden=true;
      const heading=document.createElement('div');heading.className='oc-slash-heading';heading.textContent='Commands & skills';
      list=document.createElement('div');list.id='ocSlashList';list.className='oc-slash-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','Commands and skills');
      footer=document.createElement('div');footer.className='oc-slash-footer';menu.append(heading,list,footer);document.body.append(menu);
      chips=document.createElement('div');chips.className='oc-skill-chips';chips.hidden=true;input.before(chips);
      status=document.createElement('div');status.className='oc-slash-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;input.after(status);
      input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');input.placeholder='Ask the research agent, or type / for commands';
      input.addEventListener('input',()=>{dismissed='';cursor=0;render();});input.addEventListener('focus',render);input.addEventListener('blur',close);
      input.addEventListener('keydown',event=>{
        if(event.isComposing||event.keyCode===229)return;
        if(!menu.hidden&&['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)&&!event.shiftKey&&!event.metaKey&&!event.ctrlKey){
          event.preventDefault();event.stopImmediatePropagation();
          if(event.key==='Escape'){dismissed=input.value;close();return;}
          if(event.key==='ArrowDown'||event.key==='ArrowUp'){cursor=(cursor+(event.key==='ArrowDown'?1:-1)+Math.max(entries.length,1))%Math.max(entries.length,1);render();}
          else if(!event.repeat)void choose(entries[cursor]);
        }else if(event.key==='Enter'&&!event.shiftKey&&input.value.startsWith('/')&&parse()){
          event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)void beforeSubmit().then(ok=>{if(ok)input.form.requestSubmit();});
        }
      },true);
      window.addEventListener('resize',()=>{if(!menu.hidden)position();});document.addEventListener('pointerdown',e=>{if(e.target!==input&&!menu.contains(e.target))close();});
    },
    sync(value){const changed=value.sessionId!==snapshot.sessionId;snapshot=value;if(!input)return;
      if(changed){pending.set(selected.sessionId||'',selected);selected=pending.get(value.sessionId)||new Map();selected.sessionId=value.sessionId;catalog=[];settings=null;notice('');close();renderChips();void load();}
      else if(!menu.hidden)render();
    },
    beforeSubmit,
    references:()=>[...selected.values()].map(skill=>({id:skill.id,kind:'skill',label:skill.name})),
    sent(sid){pending.delete(sid);if(sid===snapshot.sessionId){selected.clear();renderChips();notice('');close();}}
  };
})();
