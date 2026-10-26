// OC research conversation activity and file controls. Apache-2.0.
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const decodePath=value=>{try{return decodeURIComponent(value);}catch{return value;}};
  const id=encodeURIComponent, active=r=>['running','queued','blocked'].includes(r.status);
  const s={root:null,session:'',generation:0,runs:[],events:new Map(),outputs:[],files:[],children:[],open:new Map(),streams:new Map(),liveStreams:new Map(),liveRetry:new Map(),terminalRuns:new Set(),liveRenderTimer:null,pending:new Map(),loaded:10,render:()=>{},notice:()=>{},previewUrl:null,previewSerial:0,uploading:false};
  let reloadDraft;
  let progressTimer;
  try { reloadDraft=JSON.parse(sessionStorage.getItem('oc.chat.reload-draft')||'null'); if(reloadDraft?.session&&Array.isArray(reloadDraft.pending))s.pending.set(reloadDraft.session,reloadDraft.pending.filter(p=>typeof p==='string')); } catch {}
  const imagePath=p=>typeof p==='string' && /\.(png|jpe?g|webp|gif)$/i.test(p) && !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..');
  const imageCache=new Map();
  function figure(file,version,compact=false){
    const path=file.path||file.logicalName||file.name||file.title||'';
    if(!imagePath(path))return '';
    const attrs=version?`data-chat-version="${esc(version.id)}"`:`data-chat-file="${esc(path)}"`;
    const label=file.title||path.split('/').pop();
    return `<span class="oc-chat-figure ${compact?'is-attachment':''}"><button type="button" class="oc-chat-figure-open" ${attrs} data-chat-name="${esc(path)}" aria-label="Enlarge ${esc(label)}"><img data-chat-image="${esc(path)}" ${version?`data-image-version="${esc(version.id)}"`:''} alt="${esc(label)}" loading="lazy"><span class="oc-chat-image-status">Loading image…</span></button><span class="oc-chat-figure-caption"><span>${esc(label)}</span>${compact?'':`<button type="button" ${attrs} data-chat-name="${esc(path)}" data-chat-download>Download</button>`}</span></span>`;
  }
  function clearImages(){for(const entry of imageCache.values())if(entry.url)URL.revokeObjectURL(entry.url);imageCache.clear();}
  function hydrateImages(){
    const session=s.session,generation=s.generation;
    for(const img of s.root?.querySelectorAll('img[data-chat-image]:not([data-image-loading])')||[]){
      img.dataset.imageLoading='true';
      const route=img.dataset.imageVersion?`artifact-versions/${id(img.dataset.imageVersion)}/content`:'file?path='+id(img.dataset.chatImage);
      const sourceSession=img.closest('[data-chat-source-session]')?.dataset.chatSourceSession||session;
      const cacheKey=sourceSession+':'+route;
      let entry=imageCache.get(cacheKey);
      if(!entry){entry={};imageCache.set(cacheKey,entry);entry.promise=(async()=>{
        const response=await request(`sessions/${id(sourceSession)}/${route}`,{raw:true});const blob=await response.blob();
        if(!/^image\/(png|jpeg|webp|gif)$/.test(blob.type.split(';')[0])||blob.size>30*1024*1024)throw new Error('Image preview unavailable');
        if(generation!==s.generation||imageCache.get(cacheKey)!==entry)throw new Error('Session changed');
        entry.url=URL.createObjectURL(blob);return entry.url;
      })();}
      entry.promise.then(url=>{if(generation!==s.generation||!img.isConnected)return;img.onload=()=>{img.parentElement.querySelector('.oc-chat-image-status')?.remove();};img.onerror=()=>{img.parentElement.querySelector('.oc-chat-image-status').textContent='Open image';};img.src=url;}).catch(()=>{if(img.isConnected)img.parentElement.querySelector('.oc-chat-image-status').textContent='Open file to view';});
    }
  }
  function inline(value){
    const tokens=[];const token=html=>{tokens.push(html);return '\u0000'+(tokens.length-1)+'\u0000';};
    let text=String(value).replace(/\u0000/g,'');
    text=text.replace(/`([^`\n]+)`/g,(_,v)=>token('<code>'+esc(v)+'</code>'));
    text=text.replace(/(!?)\[([^\]\n]+)\]\(([^\s)]+)\)/g,(_,image,label,url)=>{
      if(imagePath(decodePath(url)))return token(figure({path:decodePath(url),title:label}));
      if(/^https?:\/\//i.test(url))return token(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
      if(!/^[a-z][a-z0-9+.-]*:/i.test(url)&&!url.startsWith('//')&&!url.startsWith('#'))return token(`<button type="button" class="oc-chat-file-link" data-chat-file="${esc(decodePath(url.replace(/^\.\//,'')))}">${esc(label)}</button>`);
      return esc(label);
    });
    return esc(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[Number(n)]||'');
  }
  function markdown(value){
    const lines=String(value??'').replace(/\r\n/g,'\n').split('\n');let out='',i=0;
    const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
    while(i<lines.length){const line=lines[i];
      if(/^\s*```/.test(line)){const language=line.trim().slice(3),code=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);i++;out+=`<div class="oc-chat-code"><small>${esc(language||'Code')}</small><pre><code>${esc(code.join('\n'))}</code></pre></div>`;continue;}
      if(!line.trim()){i++;continue;}
      if(i+1<lines.length&&line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){const headers=cells(line);i+=2;let rows='';while(i<lines.length&&lines[i].includes('|'))rows+='<tr>'+cells(lines[i++]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';out+='<div class="oc-chat-table"><table><thead><tr>'+headers.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';continue;}
      const heading=line.match(/^(#{1,6})\s+(.+)/);if(heading){const level=Math.min(heading[1].length+2,6);out+=`<h${level}>${inline(heading[2])}</h${level}>`;i++;continue;}
      if(/^\s*([-*+]\s+|\d+\.\s+)/.test(line)){const ordered=/^\s*\d+\./.test(line),tag=ordered?'ol':'ul';let items='';while(i<lines.length&&/^\s*([-*+]\s+|\d+\.\s+)/.test(lines[i]))items+='<li>'+inline(lines[i++].replace(/^\s*([-*+]\s+|\d+\.\s+)/,''))+'</li>';out+=`<${tag}>${items}</${tag}>`;continue;}
      if(/^>\s?/.test(line)){out+='<blockquote>'+inline(line.replace(/^>\s?/,''))+'</blockquote>';i++;continue;}
      out+='<p>'+inline(line)+'</p>';i++;
    }return out;
  }
  function reduceEvents(records){
    const entries=[],tools=new Map(),responses=new Map(),children=new Map();let response='initial';
    for(const record of [...records].sort((a,b)=>a.sequence-b.sequence)){
      const e=record.event||{},key=String(record.sequence);
      if(e.type==='assistant.response.started')response=e.responseId||key;
      if(e.type==='assistant.delta'||e.type==='assistant.snapshot'){
        const rid=e.responseId||response;let item=responses.get(rid);if(!item){item={kind:'assistant',key:'text-'+rid,content:''};responses.set(rid,item);entries.push(item);}
        item.content=e.type==='assistant.snapshot'?String(e.content||''):item.content+String(e.delta||'');item.truncated ||= e.truncated;continue;
      }
      if(e.type==='assistant.commentary.delta'){
        const rid=e.responseId||response,key='commentary-'+rid;let item=responses.get(key);if(!item){item={kind:'commentary',key,content:''};responses.set(key,item);entries.push(item);}
        item.content+=String(e.delta||'');continue;
      }
      if(e.type==='tool.started'||e.type==='tool.completed'){
        const t=e.trace||{};let item=tools.get(t.id);if(!item){item={kind:'tool',key:'tool-'+t.id,trace:{},startedAt:record.createdAt};tools.set(t.id,item);entries.push(item);}
        item.trace={...item.trace,...t};if(e.type==='tool.completed')item.finishedAt=record.createdAt;continue;
      }
      if(e.type==='tool.output'){const item=tools.get(e.toolCallId);if(item)item.trace.output=(item.trace.output||'')+(e.chunk||'');continue;}
      if(e.type==='subagent.step'){const child=children.get(e.subagentId);if(child?.agent){const steps=child.agent.steps||[],index=steps.findIndex(step=>step.id===e.step.id);child.agent={...child.agent,steps:index<0?[...steps,e.step]:steps.map((step,i)=>i===index?e.step:step)};}continue;}
      if(e.type==='subagent.updated'){let item=children.get(e.subagent.id);if(!item){item={kind:'subagent',key:'subagent-'+e.subagent.id};children.set(e.subagent.id,item);entries.push(item);}item.agent=e.subagent;continue;}
      if(e.type==='workspace.changed')entries.push({kind:'files',key:'files-'+key,files:e.files||[],paths:e.changedPaths||[]});
      else if(e.type==='plan.updated')entries.push({kind:'plan',key:'plan-'+key,value:e.plan});
      else if(e.type==='permission.required'||e.type==='permission.resolved'){
        const found=entries.find(x=>x.kind==='permission'&&x.request.id===e.request.id);if(found)found.request=e.request;else entries.push({kind:'permission',key:'permission-'+e.request.id,request:e.request});
      }else if(e.type==='run.history.truncated')entries.push({kind:'notice',key,text:`The backend omitted ${e.droppedEvents} earlier events.`});
      else if(e.type==='run.failed')entries.push({kind:'notice',key,text:e.error,error:true});
      else if(e.type==='run.cancelled')entries.push({kind:'notice',key,text:e.reason||'Run cancelled.'});
    }return entries;
  }
  async function request(path,options={}){
    const response=await fetch('/api/research/'+path,{cache:'no-store',...options,headers:{'X-OC-Workspace':'research',...options.headers}});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||data.error||`Research service returned ${response.status}`);}return options.raw?response:response.json();
  }
  function setSession(session){
    if(s.session===session)return;closeLiveStreams();clearImages();s.generation++;s.session=session;s.runs=[];s.events.clear();s.outputs=[];s.files=[];s.children=[];s.open.clear();s.streams.clear();s.liveRetry.clear();s.terminalRuns.clear();s.loaded=10;closePreview(true);renderAttachments();
    if(reloadDraft?.session===session){const input=s.root?.querySelector('textarea[name=prompt]');if(input)input.value=String(reloadDraft.text||'');reloadDraft=null;try{sessionStorage.removeItem('oc.chat.reload-draft');}catch{}}
  }
  function closeLiveStreams(){
    for(const source of s.liveStreams.values())source.close();s.liveStreams.clear();
    if(s.liveRenderTimer)clearTimeout(s.liveRenderTimer);s.liveRenderTimer=null;
    clearTimeout(progressTimer);progressTimer=null;
  }
  function watchProgressClock(){
    clearTimeout(progressTimer);progressTimer=null;
    if(!s.root||!s.runs.some(run=>active(run)&&!s.terminalRuns.has(run.id)))return;
    progressTimer=setTimeout(()=>{
      // Update only status nodes: preserve selection, scroll and streamed text.
      for(const run of s.runs.filter(run=>active(run)&&!s.terminalRuns.has(run.id))){
        const node=[...s.root.querySelectorAll('[data-chat-progress-run]')].find(node=>node.dataset.chatProgressRun===run.id);
        if(node)node.innerHTML=progressMarkup(run);
      }
      watchProgressClock();
    },10000);
  }
  function renderLiveSoon(){
    if(s.liveRenderTimer)return;
    s.liveRenderTimer=setTimeout(()=>{s.liveRenderTimer=null;s.render();},250);
  }
  function watchLiveRuns(session,runs){
    watchProgressClock();
    const current=new Set(runs.filter(active).map(run=>run.id));
    for(const [runId,source] of s.liveStreams)if(!current.has(runId)){source.close();s.liveStreams.delete(runId);s.liveRetry.delete(runId);s.terminalRuns.delete(runId);}
    if(window.OC_WEB_CONFIG?.backendOrigin || typeof EventSource!=='function')return;
    for(const run of runs.filter(active)){
      if(s.liveStreams.has(run.id)||s.terminalRuns.has(run.id)||Date.now()<(s.liveRetry.get(run.id)||0))continue;
      const cursor=s.events.get(run.id)?.cursor||0;
      let source;
      try{source=new EventSource(`/api/research/sessions/${id(session)}/runs/${id(run.id)}/events?after=${cursor}`);}
      catch{ s.liveRetry.set(run.id,Date.now()+5000);continue; }
      s.liveStreams.set(run.id,source);
      source.onmessage=message=>{
        if(session!==s.session)return;
        const sequence=Number(message.lastEventId);if(!Number.isSafeInteger(sequence)||sequence<=0)return;
        let event;try{event=JSON.parse(message.data);}catch{return;}
        const history=s.events.get(run.id)||{records:new Map(),cursor:0,loaded:true,status:run.status};
        if(sequence<=history.cursor)return;
        history.records.set(sequence,{sequence,event,createdAt:new Date().toISOString()});history.cursor=sequence;
        s.events.set(run.id,history);renderLiveSoon();
        if(['run.completed','run.failed','run.cancelled'].includes(event.type)){
          s.terminalRuns.add(run.id);source.close();s.liveStreams.delete(run.id);
        }
      };
      source.onerror=()=>{source.close();if(s.liveStreams.get(run.id)===source)s.liveStreams.delete(run.id);s.liveRetry.set(run.id,Date.now()+5000);};
    }
  }
  async function sync(session,runs){
    if(session!==s.session)return;const generation=s.generation;s.runs=runs;
    const selected=runs.filter((r,i)=>i<s.loaded||active(r));
    const work=selected.filter(r=>{const entry=s.events.get(r.id);return !entry||!entry.loaded||entry.status!==r.status||active(r);});
    for(let offset=0;offset<work.length;offset+=3){await Promise.all(work.slice(offset,offset+3).map(async run=>{
      let entry=s.events.get(run.id)||{records:new Map(),cursor:0,loaded:false};
      try{const records=await request(`sessions/${id(session)}/runs/${id(run.id)}/events?after=${entry.cursor}`);if(generation!==s.generation)return;
        for(const record of records){entry.records.set(record.sequence,record);entry.cursor=Math.max(entry.cursor,record.sequence||0);}entry.loaded=true;entry.status=run.status;entry.error='';s.events.set(run.id,entry);
      }catch(err){if(generation!==s.generation)return;entry.error=err.message;entry.loaded=false;s.events.set(run.id,entry);}
    }));if(generation!==s.generation)return;}
    const results=await Promise.allSettled(['artifact-outputs','files','subagents'].map(path=>request(`sessions/${id(session)}/${path}`)));
    if(generation!==s.generation)return;
    if(results[1].status==='fulfilled' && JSON.stringify(results[1].value)!==JSON.stringify(s.files)){clearImages();renderAttachments();}
    ['outputs','files','children'].forEach((key,i)=>{if(results[i].status==='fulfilled')s[key]=results[i].value;});
    window.OCDesktopWorkspace?.updateFiles(session,s.files);
    // Keep an expanded tool's output live, including its final chunks at completion.
    for(const run of work){const history=s.events.get(run.id);if(!history)continue;
      for(const item of reduceEvents([...history.records.values()]))if(item.kind==='tool'&&item.trace.outputStream&&s.open.get(run.id+':'+item.key))await loadOutput(run.id,item.trace.id,item.trace.outputStream);
      if(generation!==s.generation)return;
    }
    watchLiveRuns(session,runs);
    s.render();
  }
  function disclosure(key,summary,body,defaultOpen=false,attrs=''){
    return `<details class="oc-chat-disclosure" data-chat-key="${esc(key)}" ${s.open.get(key)??defaultOpen?'open':''} ${attrs}><summary>${summary}</summary>${body}</details>`;
  }
  function fileCard(file,version){
    const media=figure(file,version);if(media)return media;
    const path=file.path||file.logicalName||file.name||file.title||'File';const attrs=version?`data-chat-version="${esc(version.id)}"`:`data-chat-file="${esc(path)}"`;
    return `<div class="oc-chat-file-card"><span aria-hidden="true">▤</span><div><strong>${esc(file.title||path)}</strong><small>${version?'Saved artifact · v'+version.version:'Workspace file · current contents'}${file.size!=null?' · '+Number(file.size).toLocaleString()+' bytes':''}</small></div><button type="button" ${attrs} data-chat-name="${esc(path)}">View</button><button type="button" ${attrs} data-chat-name="${esc(path)}" data-chat-download>Download</button></div>`;
  }
  function outputsForRun(run){
    const parents=new Map(s.children.map(x=>[x.id,x.parentTurnId]));const latest=new Map();
    for(const item of s.outputs){let turn=item.version?.turnId;const seen=new Set();while(turn&&!seen.has(turn)&&turn!==run.id){seen.add(turn);turn=parents.get(turn);}if(turn!==run.id)continue;const old=latest.get(item.artifact.id);if(!old||old.version.version<item.version.version)latest.set(item.artifact.id,item);}
    return [...latest.values()];
  }
  function liveAnswer(run,entries){
    if(!active(run))return '';
    const text=entries.filter(item=>item.kind==='assistant'&&item.content).at(-1)?.content;
    const tool=entries.filter(item=>item.kind==='tool').at(-1);
    const status=text?'Writing…':run.status==='blocked'?'Waiting for permission…':run.status==='queued'?'Queued…':tool?.trace.status==='running'?`Using ${tool.trace.name||'a tool'}…`:tool?'Waiting for the next agent update…':'Preparing project context…';
    return `<article class="oc-research-message oc-research-message-assistant oc-chat-live-message" data-chat-live-run="${esc(run.id)}"><div class="oc-research-message-meta"><strong>Research agent</strong><span class="oc-chat-live-status">${esc(status)}</span></div>${text?`<div class="oc-research-message-content oc-chat-markdown">${markdown(text)}</div>`:''}<div class="oc-chat-progress" data-chat-progress-run="${esc(run.id)}">${progressMarkup(run)}</div></article>`;
  }
  const duration=ms=>{const seconds=Math.max(0,Math.floor(ms/1000));return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;};
  function progressForRun(run,records,now=Date.now()){
    const ordered=[...records].sort((a,b)=>a.sequence-b.sequence);
    const entries=reduceEvents(ordered);
    const plan=entries.findLast(item=>item.kind==='plan')?.value;
    const step=plan?.items?.find(item=>item.status==='in_progress')?.step;
    const tool=entries.findLast(item=>item.kind==='tool');
    const start=Date.parse(run.startedAt||run.createdAt||ordered[0]?.createdAt);
    const last=Date.parse(ordered.at(-1)?.createdAt);
    const quiet=Number.isFinite(last)?Math.max(0,now-last):Number.isFinite(start)?Math.max(0,now-start):0;
    const stale=quiet>=45000;
    const message=run.status==='blocked'?'Your approval is needed before this run can continue.':run.status==='queued'?'Request received. Waiting for an available agent.':stale?'Waiting for a new activity update. The last recorded state is shown below.':!entries.length?'Request received. Waiting for the agent’s first update.':tool?.trace.status==='running'?`Last reported tool: ${tool.trace.name||'tool'}.`:tool?.trace.status==='failed'?'The last tool reported a failure. Waiting for the agent’s response.':tool?'The last tool finished. Waiting for the agent’s next response.':'Waiting for the agent’s next update.';
    return {message,step:typeof step==='string'?step:'',elapsed:Number.isFinite(start)?duration(now-start):'',quiet:stale?duration(quiet):'',stale};
  }
  function progressMarkup(run){
    const history=s.events.get(run.id),p=progressForRun(run,[...(history?.records.values()||[])]);
    return `<span class="oc-chat-progress-label">OC status${p.elapsed?` · Elapsed ${esc(p.elapsed)}`:''}</span><p>${esc(history?.error?'Activity connection unavailable. Reconnecting; the last recorded state may be outdated.':p.message)}</p>${p.step?`<p class="oc-chat-progress-step"><strong>Current plan</strong> ${esc(p.step)}</p>`:''}${p.quiet?`<small>No new activity for ${esc(p.quiet)}. This is not a completion estimate.</small>`:''}`;
  }
  function agentUpdates(entries){
    return entries.filter(item=>item.kind==='commentary'&&item.content.trim()).map(item=>`<article class="oc-research-message oc-research-message-assistant oc-chat-agent-update"><div class="oc-research-message-meta"><strong>Research agent</strong><span>Update</span></div><div class="oc-research-message-content oc-chat-markdown">${markdown(item.content)}</div></article>`).join('');
  }
  function renderRun(run,canonical=''){
    const history=s.events.get(run.id);
    const entries=history?reduceEvents([...history.records.values()]):[];
    const error=run.error||entries.findLast(item=>item.kind==='notice'&&item.error)?.text||'';
    const label={failed:'Run failed',cancelled:'Stopped'}[run.status];
    const status=label?'<div class="oc-chat-run-status'+(run.status==='failed'?' is-error':'')+'" role="status"><span>'+esc(label)+'</span>'+(error?'<small>'+esc(error)+'</small>':'')+'</div>':'';
    const outputs=outputsForRun(run);
    return agentUpdates(entries)+liveAnswer(run,entries)+status+(outputs.length?'<section class="oc-chat-outputs"><h4>Files produced</h4>'+outputs.map(x=>fileCard(x.artifact,x.version)).join('')+'</section>':'');
  }
  function renderRuns(runs,canonical=''){return runs.map(run=>renderRun(run,canonical)).join('');}
  function renderSessionFiles(){return disclosure('session-files','<strong>Session files</strong><span>'+s.files.length+'</span>',s.files.map(f=>fileCard(f)).join('')||'<p>No files yet.</p>');}
  function renderReferences(message){const skills=(message.references||[]).filter(r=>r.kind==='skill').map(r=>`<span class="oc-skill-chip" title="Attached skill">/${esc(r.label)}</span>`).join(' ');return skills+ (message.references||[]).filter(r=>r.path).map(r=>fileCard({path:r.path,title:r.label})).join('');}
  function renderAttachments(){
    const box=s.root?.querySelector('[data-chat-attachments]');if(!box)return;
    const input=s.root.querySelector('textarea[name=prompt]');if(input)input.required=!(s.pending.get(s.session)||[]).some(imagePath);
    box.innerHTML=(s.pending.get(s.session)||[]).map(path=>`<span class="oc-chat-pending-item">${imagePath(path)?figure({path},null,true):esc(path)}<button type="button" data-chat-remove="${esc(path)}" aria-label="Remove attachment ${esc(path)}">×</button></span>`).join('');
  }
  function attachedContent(){const files=(s.pending.get(s.session)||[]).filter(p=>!imagePath(p));return files.length?'\n\nAttached workspace files:\n'+files.map(path=>'- ['+path.replace(/[\[\]]/g,'')+']('+encodeURI(path).replace(/[()]/g,c=>'%'+c.charCodeAt(0).toString(16))+')').join('\n'):'';}
  function attachedReferences(){return (s.pending.get(s.session)||[]).filter(imagePath).map(path=>({id:path,kind:'sourcefile',path,label:path}));}
  function clearAttachments(session){s.pending.delete(session);if(s.session===session)renderAttachments();}
  function closePreview(force=false){if(window.OCSourceEditor?.close(force)===false)return false;window.OCDesktopPDF?.close();s.previewSerial++;if(s.previewUrl)URL.revokeObjectURL(s.previewUrl);s.previewUrl=null;const dialog=s.root?.querySelector('[data-chat-preview]');if(dialog?.open)dialog.close();}
  async function openFile(button){
    const session=button.dataset.chatSession||button.closest('[data-chat-source-session]')?.dataset.chatSourceSession||s.session,generation=s.generation,name=button.dataset.chatName||button.dataset.chatFile||'research-artifact';
    const path=button.dataset.chatVersion?`artifact-versions/${id(button.dataset.chatVersion)}/content`:'file?path='+id(button.dataset.chatFile);
    const downloading=button.hasAttribute('data-chat-download');
    if(!downloading&&closePreview()===false)return;const serial=s.previewSerial;
    const response=await request(`sessions/${id(session)}/${path}`,{raw:true});if(generation!==s.generation||(!downloading&&serial!==s.previewSerial))return;
    const blob=await response.blob();if(generation!==s.generation||(!downloading&&serial!==s.previewSerial))return;
    if(button.hasAttribute('data-chat-download')){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name.split('/').pop();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    const dialog=s.root.querySelector('[data-chat-preview]'),body=dialog.querySelector('[data-chat-preview-body]');
    dialog.querySelector('[data-chat-preview-title]').textContent=name;body.innerHTML='';dialog.querySelectorAll('[data-chat-preview-actions] [data-chat-download], [data-source-tools]').forEach(node=>node.remove());body.dataset.chatSourceSession=session;
    const type=blob.type.split(';')[0];
    if(/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(type)){s.previewUrl=URL.createObjectURL(blob);const image=document.createElement('img');image.src=s.previewUrl;image.alt=name;body.append(image);}
    else if(type==='application/pdf'){await window.OCDesktopPDF.render(blob,body,()=>generation===s.generation&&serial===s.previewSerial);if(generation!==s.generation||serial!==s.previewSerial)return;}
    else if(type.startsWith('text/')||/json|xml|javascript/.test(type)||/\.(md|markdown|txt|csv|py|r|json|ipynb|yaml|yml|log|js|jsx|ts|tsx|mjs|cjs|html|htm|css|sql|c|cpp|h|hpp|java|rs|sh|bash|zsh|xml|svg|toml|ini|cfg)$/i.test(name)){
      const editor=await import('/openconstruction-web/desktop/source-editor.js');
      await editor.render({body,blob,name,session,path:button.dataset.chatFile,version:button.dataset.chatVersion,isCurrent:()=>generation===s.generation&&serial===s.previewSerial,renderMarkdown:markdown});
      if(generation!==s.generation||serial!==s.previewSerial)return;
    }else body.textContent='Preview is not available for this file type. Download to inspect it.';
    const download=document.createElement('button');download.type='button';download.className='oc-preview-icon';download.setAttribute('aria-label','Download file');download.title='Download file';download.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/></svg>';download.dataset.chatDownload='';download.dataset.chatName=name;download.dataset.chatSession=session;if(button.dataset.chatVersion)download.dataset.chatVersion=button.dataset.chatVersion;else download.dataset.chatFile=button.dataset.chatFile;dialog.querySelector('[data-chat-preview-actions]').prepend(download);dialog.showModal();
  }
  async function loadOutput(run,tool,stream){
    const generation=s.generation,key=run+':'+tool,cached=s.streams.get(key)||{text:'',cursor:0};if(cached.loading)return;cached.loading=true;s.streams.set(key,cached);
    try{const records=await request(`sessions/${id(s.session)}/runs/${id(run)}/streams/${id(stream)}/events?after=${cached.cursor}`);if(generation!==s.generation)return;
      for(const record of records){if(record.sequence<=cached.cursor)continue;cached.cursor=Math.max(cached.cursor,record.sequence||0);if(record.event.type==='tool.output')cached.text+=record.event.chunk||'';}cached.error='';
    }catch(err){if(generation===s.generation)cached.error=err.message;}finally{cached.loading=false;if(generation===s.generation)s.render();}
  }
  function mount(root,{render,notice}){
    s.root=root;s.render=render;s.notice=notice;
    window.addEventListener('oc-workspace-renamed',event=>{
      const {sessionIds,from,to}=event.detail;
      for(const session of sessionIds){const paths=s.pending.get(session);if(paths)s.pending.set(session,paths.map(path=>path===from||path.startsWith(from+'/')?to+path.slice(from.length):path));}
      if(sessionIds.includes(s.session)){closePreview();clearImages();renderAttachments();}
    });
    root.insertAdjacentHTML('beforeend','<dialog class="oc-chat-preview" data-chat-preview><header><strong data-chat-preview-title></strong><span class="oc-preview-actions" data-chat-preview-actions><button type="button" class="oc-preview-icon" data-chat-close aria-label="Close" title="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></span></header><div data-chat-preview-body></div></dialog>');
    root.addEventListener('toggle',event=>{const node=event.target;if(!node.matches('[data-chat-key]')||!node.isConnected)return;s.open.set(node.dataset.chatKey,node.open);if(node.open&&node.dataset.chatAutoStream&&!s.streams.has(node.dataset.chatRun+':'+node.dataset.chatTool))void loadOutput(node.dataset.chatRun,node.dataset.chatTool,node.dataset.chatAutoStream);},true);
    root.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;
      try{if(button.hasAttribute('data-chat-file')||button.dataset.chatVersion)await openFile(button);
        else if(button.hasAttribute('data-chat-close'))closePreview();
        else if(button.dataset.chatStream)await loadOutput(button.dataset.chatRun,button.dataset.chatTool,button.dataset.chatStream);
        else if(button.dataset.chatLoadRun){const index=s.runs.findIndex(r=>r.id===button.dataset.chatLoadRun);s.loaded=Math.max(s.loaded,index+1);await sync(s.session,s.runs);}
        else if(button.dataset.chatRemove){s.pending.set(s.session,(s.pending.get(s.session)||[]).filter(p=>p!==button.dataset.chatRemove));renderAttachments();}
        else if(button.hasAttribute('data-chat-browse')){s.root.querySelector('[data-chat-upload]').click();}
      }catch(err){s.notice(err.message,true);}
    });
    async function upload(files,{attach=true,directory=""}={}){
      const session=s.session,generation=s.generation;if(!files.length||s.uploading)return;if(!session){s.notice('Select a project session before adding files.',true);return;}
      if(files.reduce((n,f)=>n+f.size,0)>30*1024*1024){s.notice('Choose files totaling at most 30 MiB per upload.',true);return;}
      if(attach&&files.some(f=>imagePath(f.name)&&f.size>10*1024*1024)){s.notice('Each image can be at most 10 MiB.',true);return;}
      const pending=s.pending.get(session)||[];
      if(attach&&pending.filter(imagePath).length+files.filter(f=>imagePath(f.name)).length>16){s.notice('Attach at most 16 images per message.',true);return;}
      const button=root.querySelector('[data-chat-browse]');s.uploading=true;button.disabled=true;const reload=root.querySelector('[data-desktop-reload]');if(reload)reload.disabled=true;s.notice('Uploading files…');
      try{const data=new FormData();files.forEach(file=>data.append('files',file,file.name));const result=await request(`sessions/${id(session)}/workspace/upload?conflict=rename&directory=${id(directory)}`,{method:'POST',body:data});
        const uploaded=(result.uploaded||[]).filter(x=>x.status!=='failed'&&x.path).map(x=>x.path);if(attach)s.pending.set(session,[...new Set([...(s.pending.get(session)||[]),...uploaded])]);
        if(generation!==s.generation)return;s.files=result.files||s.files;window.OCDesktopWorkspace?.updateFiles(session,s.files);window.OCDesktopWorkspace?.filesImported(session,directory);clearImages();renderAttachments();s.render();s.notice(`${uploaded.length} file(s) ${attach?'attached':'added to '+(directory||'Project') }.${result.errors?.length?' '+result.errors.map(x=>x.name+': '+x.error).join('; '):''}`,!!result.errors?.length);
      }catch(err){if(generation===s.generation)s.notice(err.message,true);}finally{s.uploading=false;if(button.isConnected)button.disabled=false;if(reload?.isConnected)reload.disabled=false;}
    }
    root.addEventListener('change',event=>{if(!event.target.matches('[data-chat-upload]'))return;const files=[...event.target.files];event.target.value='';void upload(files);});
    root.addEventListener('paste',event=>{if(!event.target.closest('[data-research-composer]'))return;const files=[...(event.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();void upload(files);}});
    // Prevent Chromium from navigating to a dropped local file anywhere in the window.
    const dropTarget=event=>{
      const composer=event.target.closest?.('[data-research-composer]');if(composer)return composer;
      if(window.OCDesktopWorkspace?.dropDirectory(event.target)==null)return null;
      return event.target.closest('[data-ws-row]')||event.target.closest('details[data-ws-folder]')?.querySelector(':scope > summary')||event.target.closest('.oc-ws-project');
    };
    const clearDrop=()=>root.querySelectorAll('.is-file-drop').forEach(node=>node.classList.remove('is-file-drop'));
    document.addEventListener('dragover',event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();clearDrop();const target=dropTarget(event);event.dataTransfer.dropEffect=target&&!s.uploading?'copy':'none';if(target)target.classList.add('is-file-drop');});
    document.addEventListener('dragleave',event=>{if(!event.relatedTarget||!dropTarget(event)?.contains(event.relatedTarget))clearDrop();});
    document.addEventListener('dragend',clearDrop);
    document.addEventListener('drop',event=>{
      if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();clearDrop();const target=dropTarget(event);if(!target){if(event.target.closest?.('.oc-ws-input'))s.notice('Input contains datasets. Drop your files into Project.',true);return;}
      if([...event.dataTransfer.items].some(item=>item.webkitGetAsEntry?.()?.isDirectory)){s.notice('Drop files here. To import a folder, zip it first.',true);return;}
      void upload([...event.dataTransfer.files],{attach:target.matches('[data-research-composer]'),directory:target.matches('[data-research-composer]')?'':window.OCDesktopWorkspace.dropDirectory(event.target)});
    });
    window.addEventListener('beforeunload',()=>{closeLiveStreams();try{if(s.session)sessionStorage.setItem('oc.chat.reload-draft',JSON.stringify({session:s.session,text:root.querySelector('textarea[name=prompt]')?.value||'',pending:s.pending.get(s.session)||[]}));}catch{}});
    new MutationObserver(hydrateImages).observe(root,{childList:true,subtree:true});
    root.querySelector('[data-chat-preview]').addEventListener('cancel',event=>{event.preventDefault();closePreview();});
  }
  // Read-only projection: execution and memory remain owned by the engine.
  function agentSnapshot(){return {sessionId:s.session,runs:s.runs,children:s.children,histories:[...s.events].map(([runId,h])=>({runId,error:h.error,records:[...h.records.values()]}))};}
  window.OCResearchChat={mount,setSession,sync,renderRun,renderRuns,renderSessionFiles,renderReferences,markdown,reduceEvents,progressForRun,attachedContent,attachedReferences,clearAttachments,agentSnapshot,isUploading:()=>s.uploading};
})();
