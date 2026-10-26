/* Runtime team view. No second orchestrator, execution state or memory store. */
(() => {
  const live = status => ['running','queued','blocked'].includes(status);
  const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={running:'Working',queued:'Queued',blocked:'Needs approval',completed:'Completed',failed:'Failed',cancelled:'Stopped',timed_out:'Timed out',interrupted:'Interrupted'};
  function mergeSteps(previous=[],incoming=[]){
    if(!Array.isArray(previous))previous=[];if(!Array.isArray(incoming))incoming=[];
    const steps=new Map(previous.map(step=>[step.id,step]));
    for(const step of incoming){const old=steps.get(step.id);if(!old||old.status!=='completed'||step.status!=='running')steps.set(step.id,{...step,...(step.content==='[omitted]'&&old?.content?{content:old.content}:{})});}
    return [...steps.values()];
  }
  function recordsFor(snapshot,runId){
    return [...new Map((snapshot.histories?.find(h=>h.runId===runId)?.records||[]).filter(r=>r.event&&(!r.runId||r.runId===runId)).map(r=>[r.sequence,r])).values()].sort((a,b)=>a.sequence-b.sequence);
  }
  // Checkpoints index the event log, not a fabricated percentage of task completion.
  function timeline(snapshot,runId){
    const states=new Map();
    return recordsFor(snapshot,runId).flatMap(r=>{
      const e=r.event;let title='',node='boss';
      if(e.type==='subagent.updated'&&e.subagent?.sessionId===snapshot.sessionId&&e.subagent.parentTurnId===runId){
        node=e.subagent.id;if(states.get(node)===e.subagent.status)return [];
        states.set(node,e.subagent.status);title=`${e.subagent.input?.description||'Worker'}: ${labels[e.subagent.status]||e.subagent.status}`;
      }else if(e.type==='subagent.step'&&states.has(e.subagentId)&&e.step?.kind==='tool'){node=e.subagentId;title=`${e.step.toolName||'Tool'}: ${e.step.status}`;}
      else if(e.type==='run.started')title='BOSS started';
      else if(e.type==='run.completed')title='BOSS delivered final response';
      else if(e.type==='run.failed')title='Run failed';
      else if(e.type==='run.cancelled')title='Run stopped';
      else if(e.type==='plan.updated')title='BOSS updated plan';
      else if(e.type==='assistant.commentary.delta')title='BOSS progress update';
      else if(e.type==='tool.started'||e.type==='tool.completed')title=`BOSS · ${e.trace?.name||'tool'} ${e.type==='tool.started'?'started':'returned'}`;
      if(!title)return [];
      return [{sequence:r.sequence,time:r.createdAt,title,node}];
    });
  }
  function project(snapshot, runId, now=Date.now(), cutoff=null) {
    const run=snapshot.runs?.find(r=>r.id===runId && (!r.sessionId||r.sessionId===snapshot.sessionId));
    if(!run)return null;
    const history=snapshot.histories?.find(h=>h.runId===runId);
    const replay=cutoff!==null;
    const records=recordsFor(snapshot,runId).filter(r=>!replay||r.sequence<=cutoff);
    const children=new Map((replay?[]:snapshot.children||[]).filter(c=>c.sessionId===snapshot.sessionId&&c.parentTurnId===runId).map(c=>[c.id,structuredClone(c)]));
    let status=replay?'queued':run.status, plan='', update='', result='', error=replay?'':run.error||'';
    for(const {event:e} of records){
      if(replay&&e.type==='run.started')status='running';
      if(e.type==='run.status'&&e.run?.id===runId&&(replay||live(status)||!live(e.run.status)))status=e.run.status;
      const returned=e.type==='tool.completed'&&e.trace?.details?.subagent;
      if(returned&&returned.sessionId===snapshot.sessionId&&returned.parentTurnId===runId){
        const old=children.get(returned.id);
        children.set(returned.id,structuredClone({...old,...returned,input:typeof returned.input==='object'&&returned.input?{...old?.input,...returned.input}:old?.input||{},steps:mergeSteps(old?.steps,returned.steps),resultValidation:returned.resultValidation??old?.resultValidation}));
      }
      if(e.type==='subagent.updated'&&e.subagent.sessionId===snapshot.sessionId&&e.subagent.parentTurnId===runId){
        const old=children.get(e.subagent.id);
        // A durable terminal snapshot wins over older replayed running events.
        if(!old||live(old.status)||!live(e.subagent.status))children.set(e.subagent.id,structuredClone({
          ...old,...e.subagent,steps:mergeSteps(old?.steps,e.subagent.steps),
          resultValidation:e.subagent.resultValidation??old?.resultValidation,
        }));
      }
      if(e.type==='subagent.step'&&children.has(e.subagentId)){
        const child=children.get(e.subagentId),steps=child.steps||[],i=steps.findIndex(s=>s.id===e.step.id);
        if(i<0)steps.push(e.step);else if(steps[i].status!=='completed'||e.step.status!=='running')steps[i]=e.step;
        child.steps=steps;
      }
      if(e.type==='plan.updated')plan=e.plan?.items?.find(i=>i.status==='in_progress')?.step||'';
      if(e.type==='assistant.commentary.delta')update+=e.delta||'';
      if(e.type==='run.completed'){status='completed';result=e.message?.content||'';}
      if(e.type==='run.cancelled')status='cancelled';
      if(e.type==='run.failed'){status='failed';error=e.error||'';}
    }
    // Follow-up turns retain worker identity but are not new BOSS dispatches.
    for(const child of children.values())child.dispatchActive=child.status==='running';
    if(!replay)for(const saved of snapshot.children||[]){
      if(saved.sessionId!==snapshot.sessionId||saved.parentTurnId!==runId)continue;
      const followups=snapshot.runs.filter(r=>r.sessionId===snapshot.sessionId&&r.targetSubagentId===saved.id);
      if(!followups.length)continue;
      const merged=structuredClone(saved);merged.dispatchActive=!followups.some(r=>r.startedAt)&&children.get(saved.id)?.dispatchActive===true;
      for(const followup of followups.slice().sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))){
        for(const {event} of recordsFor(snapshot,followup.id)){
          if(event.type==='subagent.step'&&event.subagentId===saved.id)merged.steps=mergeSteps(merged.steps,[event.step]);
        }
      }
      children.set(saved.id,merged);
    }
    const last=Date.parse(records.at(-1)?.createdAt||run.startedAt||run.createdAt);
    return {run,status,plan,update,result,error,children:[...children.values()],replay,connectionError:history?.error||'',stale:!replay&&live(status)&&Number.isFinite(last)&&now-last>45000};
  }
  function workflow(model){
    const count=model.children.length,width=Math.max(660,count*276+64),center=width/2-120;
    const nodes=[{id:'boss',title:'BOSS',status:model.status,subtitle:model.plan||'Assigns work and coordinates this run',x:center,y:28}];
    const edges=[];
    model.children.forEach((c,i)=>{
      const active=c.steps?.findLast(s=>s.kind==='tool'&&s.status==='running');
      nodes.push({id:c.id,title:c.input?.description||'Worker',status:c.status,subtitle:active?`Using ${active.toolName}`:c.input?.brief?.goal||c.input?.prompt||'',x:(width-count*276)/2+i*276+18,y:192});
      const activeDispatch=c.dispatchActive??c.status==='running';
      edges.push({from:'boss',to:c.id,label:activeDispatch?'Dispatching':'Delegated',kind:activeDispatch?'active':'assigned'});
    });
    return {nodes,edges,width,height:count?340:180};
  }
  function chatEntries(model,agentId,snapshot){
    if(agentId==='boss')return [
      {id:'task',role:'You',content:model.run.prompt},
      ...(model.update?[{id:'update',role:'BOSS · progress',content:model.update}]:[]),
      ...(model.result?[{id:'result',role:'BOSS',content:model.result}]:[]),
      ...(model.error?[{id:'error',role:'Error',content:model.error}]:[]),
    ];
    const child=model.children.find(c=>c.id===agentId);if(!child)return [];
    const turns=model.replay?[]:(snapshot.runs||[]).filter(r=>r.sessionId===snapshot.sessionId&&r.targetSubagentId===agentId);
    const entries=[...(child.steps||[]).filter(s=>['assistant','tool'].includes(s.kind)&&s.content&&s.content!=='[omitted]').map(s=>({id:s.id,role:s.kind==='assistant'?'Worker':s.toolName||'Tool',content:s.content,time:s.createdAt})),
      ...turns.map(r=>({id:r.id,role:'You',content:r.prompt,time:r.createdAt})),
      ...turns.filter(r=>r.error).map(r=>({id:r.id+':error',role:'Error',content:r.error,time:r.finishedAt||r.createdAt}))];
    entries.sort((a,b)=>Date.parse(a.time||0)-Date.parse(b.time||0));
    return [{id:'assignment',role:'BOSS · assigned task',content:child.input?.brief?.goal||child.input?.prompt||child.input?.description||''},...entries];
  }
  let stage,panel,view,chatLayer,nav,context={sessionId:'',messages:[]},selectedRun='',selectedNode='boss',visible=false,timer,busy=false,lastRenderKey='';
  let chats=new Map(),chatZ=1,currentModel,currentSnapshot,polling=false,teamView,teamMode=true;
  let replayIndex=null,playTimer=null,checkpoints=[],graphModel,drag=null,suppressClick=false;
  let viewport={x:0,y:0,scale:1},positions=new Map(),needsFit=true,topology='';
  function pause(){clearInterval(playTimer);playTimer=null;}
  function resetGraph(){pause();replayIndex=null;positions=new Map();needsFit=true;topology='';lastRenderKey='';}
  function update(next){if(context.sessionId!==next.sessionId){selectedRun='';selectedNode='boss';resetGraph();for(const chat of chats.values())chat.el.remove();chats.clear();}context=next;render();}
  function openChat(agentId){
    const existing=chats.get(agentId);if(existing){existing.el.classList.remove('is-minimized');existing.el.style.zIndex=++chatZ;existing.el.querySelector('textarea').focus();return;}
    const child=currentModel?.children.find(c=>c.id===agentId);if(agentId!=='boss'&&!child)return;
    const el=document.createElement('section');el.className='oc-agent-chat';el.setAttribute('role','region');el.setAttribute('aria-label',(child?.input?.description||'BOSS')+' chat');
    const offset=chats.size%5*26;el.style.left=Math.min(22+offset,Math.max(0,panel.clientWidth-370))+'px';el.style.top=(180+offset)+'px';el.style.zIndex=++chatZ;
    el.innerHTML=`<header class="oc-agent-chat-title" tabindex="0"><strong>${esc(child?.input?.description||'BOSS')}</strong><button type="button" data-chat-minimize aria-label="Minimize chat">−</button><button type="button" data-chat-dismiss aria-label="Close chat">×</button></header><div class="oc-agent-chat-content"><p class="oc-agent-chat-status" role="status"></p><div class="oc-agent-chat-messages" role="log" aria-label="Agent conversation"></div><form><textarea rows="2" aria-label="Message ${esc(child?.input?.description||'BOSS')}" placeholder="Message ${esc(child?'this worker':'BOSS')}…"></textarea><div><small>Enter to send · Shift+Enter for a new line</small><button type="submit">Send</button></div></form></div>`;
    const chat={el,agentId,sessionId:context.sessionId,sending:false,error:'',key:''};chats.set(agentId,chat);chatLayer.append(el);
    if(child){const stop=document.createElement('button');stop.type='button';stop.dataset.agentStop=agentId;stop.textContent='Stop worker';stop.className='oc-chat-stop';el.querySelector('form>div').prepend(stop);}
    el.addEventListener('pointerdown',()=>{el.style.zIndex=++chatZ;});
    el.querySelector('[data-chat-minimize]').onclick=()=>el.classList.toggle('is-minimized');
    el.querySelector('[data-chat-dismiss]').onclick=()=>{el.remove();chats.delete(agentId);};
    const title=el.querySelector('header');let moving;
    const moveWindow=e=>{if(!moving)return;el.style.left=Math.max(0,Math.min(panel.clientWidth-el.offsetWidth,moving.left+e.clientX-moving.x))+'px';el.style.top=Math.max(0,Math.min(panel.clientHeight-44,moving.top+e.clientY-moving.y))+'px';};
    const endMove=()=>{moving=null;document.removeEventListener('mousemove',moveWindow);document.removeEventListener('mouseup',endMove);window.removeEventListener('blur',endMove);};
    title.addEventListener('mousedown',e=>{if(e.target.closest('button')||e.button!==0)return;e.preventDefault();moving={x:e.clientX,y:e.clientY,left:el.offsetLeft,top:el.offsetTop};document.addEventListener('mousemove',moveWindow);document.addEventListener('mouseup',endMove);window.addEventListener('blur',endMove);});
    title.addEventListener('keydown',e=>{const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(e.target===title&&delta){e.preventDefault();el.style.left=Math.max(0,Math.min(panel.clientWidth-80,el.offsetLeft+delta[0]))+'px';el.style.top=Math.max(0,Math.min(panel.clientHeight-44,el.offsetTop+delta[1]))+'px';}});
    el.querySelector('form').addEventListener('submit',e=>{e.preventDefault();void sendChat(chat);});
    el.querySelector('textarea').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();void sendChat(chat);}});
    syncChats();el.querySelector('textarea').focus();
  }
  async function sendChat(chat){
    const input=chat.el.querySelector('textarea'),content=input.value.trim();
    if(!content||chat.sending||currentModel?.replay||chat.sessionId!==context.sessionId)return;
    chat.sending=true;chat.error='';syncChats();
    try{
      const response=await fetch(`/api/research/sessions/${encodeURIComponent(chat.sessionId)}/runs`,{method:'POST',headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},body:JSON.stringify({content,...(chat.agentId==='boss'?{}:{targetSubagentId:chat.agentId})})});
      const body=await response.json();if(!response.ok)throw Error(body.error?.message||body.error||'Message could not be queued.');
      if(chat.sessionId!==context.sessionId)return;
      if(input.value.trim()===content)input.value='';
      if(chat.agentId==='boss'){selectedRun=body.id;resetGraph();}
      chat.pendingRun=body;await window.OCResearchWorkspace.refreshSession();
    }catch(error){chat.error=error.message;}finally{chat.sending=false;syncChats();}
  }
  function syncChats(){
    if(!currentModel||!currentSnapshot)return;
    for(const chat of chats.values()){
      const {el,agentId}=chat,child=currentModel.children.find(c=>c.id===agentId);
      const unavailable=agentId!=='boss'&&!child;
      const followup=currentSnapshot.runs.filter(r=>r.targetSubagentId===agentId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
      if(chat.pendingRun&&currentSnapshot.runs.some(r=>r.id===chat.pendingRun.id))chat.pendingRun=null;
      const turn=chat.pendingRun||followup;
      const status=agentId==='boss'?currentModel.status:turn&&live(turn.status)?turn.status:child?.status;
      const disabled=currentModel.replay||unavailable||chat.sending;
      el.querySelector('textarea').disabled=disabled;el.querySelector('[type=submit]').disabled=disabled;
      const stop=el.querySelector('[data-agent-stop]');if(stop){stop.hidden=currentModel.replay||child?.status!=='running';stop.disabled=busy;}
      el.querySelector('.oc-agent-chat-status').textContent=chat.error||(currentModel.replay?'Replay · read-only':unavailable?'This worker belongs to another run. Select its original run to continue.':chat.sending?'Sending…':`${labels[status]||status||'Ready'}${status==='queued'?' · waiting for the current session run to finish':''}${agentId!=='boss'?' · same worker, saved conversation':''}`);
      const entries=chatEntries(currentModel,agentId,currentSnapshot),key=JSON.stringify(entries);
      if(chat.key!==key){const log=el.querySelector('.oc-agent-chat-messages'),bottom=log.scrollHeight-log.scrollTop-log.clientHeight<70;chat.key=key;log.innerHTML=entries.map(entry=>`<article class="${entry.role==='You'?'is-user':''}"><strong>${esc(entry.role)}</strong>${['Worker','BOSS','BOSS · progress'].includes(entry.role)&&window.OCResearchChat.markdown?`<div class="oc-chat-markdown">${window.OCResearchChat.markdown(entry.content)}</div>`:`<p>${esc(entry.content)}</p>`}</article>`).join('');if(bottom)log.scrollTop=log.scrollHeight;}
    }
  }
  function applyViewport(){
    const world=panel.querySelector('.oc-graph-world');if(world)world.style.transform=`translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})`;
    const label=panel.querySelector('[data-zoom-label]');if(label)label.textContent=Math.round(viewport.scale*100)+'%';
  }
  function fitGraph(){
    const canvas=panel.querySelector('.oc-graph-canvas');if(!canvas||!graphModel)return;
    const ns=graphModel.nodes.map(n=>({...n,...positions.get(n.id)}));
    const left=Math.min(...ns.map(n=>n.x))-35,top=Math.min(...ns.map(n=>n.y))-30;
    const width=Math.max(...ns.map(n=>n.x+240))-left+35,height=Math.max(...ns.map(n=>n.y+112))-top+35;
    const scale=Math.max(.15,Math.min(1.15,(canvas.clientWidth-20)/width,(canvas.clientHeight-20)/height));
    viewport={scale,x:(canvas.clientWidth-width*scale)/2-left*scale,y:(canvas.clientHeight-height*scale)/2-top*scale};applyViewport();
  }
  function zoomGraph(factor,cx,cy){
    const canvas=panel.querySelector('.oc-graph-canvas');if(!canvas)return;
    cx??=canvas.clientWidth/2;cy??=canvas.clientHeight/2;
    const scale=Math.max(.15,Math.min(2,viewport.scale*factor)),ratio=scale/viewport.scale;
    viewport={scale,x:cx-(cx-viewport.x)*ratio,y:cy-(cy-viewport.y)*ratio};applyViewport();
  }
  function edgeMarkup(g){
    const nodes=new Map(g.nodes.map(n=>[n.id,{...n,...positions.get(n.id)}]));
    return `<defs>${['active','assigned','returned','failed'].map(k=>`<marker id="oc-arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="oc-arrow-${k}"/></marker>`).join('')}</defs>`+g.edges.map(e=>{
      const a=nodes.get(e.from),b=nodes.get(e.to),x=a.x+120,y=a.y+112,tx=b.x+120,ty=b.y-8,mid=(y+ty)/2;
      return `<g class="oc-flow-edge is-${e.kind}"><path d="M${x},${y} C${x},${mid} ${tx},${mid} ${tx},${ty}" marker-end="url(#oc-arrow-${e.kind})"/><text x="${(x+tx)/2}" y="${mid-7}" text-anchor="middle">${esc(e.label)}</text></g>`;
    }).join('');
  }
  function drawEdges(){const svg=panel.querySelector('.oc-graph-edges');if(svg&&graphModel)svg.innerHTML=edgeMarkup(graphModel);}
  function bindCanvas(){
    const canvas=panel.querySelector('.oc-graph-canvas');if(!canvas)return;
    canvas.addEventListener('wheel',e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoomGraph(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
    canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;const button=e.target.closest('[data-agent-node]');
      const node=button&&graphModel.nodes.find(n=>n.id===button.dataset.agentNode);
      drag={id:node?.id,x:e.clientX,y:e.clientY,origin:node?{...node,...positions.get(node.id)}:{...viewport},moved:false};
    });
    canvas.addEventListener('pointermove',e=>{
      if(!(e.buttons&1)){drag=null;return;}if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)<4&&!drag.moved)return;drag.moved=true;canvas.setPointerCapture(e.pointerId);
      if(drag.id){const p={x:drag.origin.x+dx/viewport.scale,y:drag.origin.y+dy/viewport.scale};positions.set(drag.id,p);const n=[...canvas.querySelectorAll('[data-agent-node]')].find(b=>b.dataset.agentNode===drag.id);n.style.left=p.x+'px';n.style.top=p.y+'px';drawEdges();}
      else{viewport.x=drag.origin.x+dx;viewport.y=drag.origin.y+dy;applyViewport();}
    });
    const release=()=>{if(!drag)return;const moved=drag.moved;drag=null;if(moved){suppressClick=true;setTimeout(()=>{suppressClick=false;},0);}};
    canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',()=>{drag=null;});
    canvas.addEventListener('keydown',e=>{
      if(e.target!==canvas)return;
      const moves={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};
      if(moves[e.key]){e.preventDefault();viewport.x+=moves[e.key][0];viewport.y+=moves[e.key][1];applyViewport();}
      if(e.key==='+'||e.key==='='){e.preventDefault();zoomGraph(1.2);}if(e.key==='-'){e.preventDefault();zoomGraph(1/1.2);}if(e.key==='0'){e.preventDefault();fitGraph();}
    });
    if(needsFit){fitGraph();needsFit=false;}else applyViewport();
  }
  function mount(target){
    stage=target;nav=document.createElement('nav');nav.className='oc-agent-view-tabs';nav.setAttribute('aria-label','Research view');
    nav.innerHTML='<button type="button" data-agent-view="chat" aria-pressed="true">Chat</button><button type="button" data-agent-view="agents" aria-pressed="false">Project team</button>';
    stage.querySelector('.oc-research-stage-head').after(nav);
    panel=document.createElement('section');panel.className='oc-agents';panel.hidden=true;panel.setAttribute('aria-label','Agent team');nav.after(panel);
    view=document.createElement('div');view.className='oc-agent-view';chatLayer=document.createElement('div');chatLayer.className='oc-agent-chat-layer';panel.append(view,chatLayer);
    const teamHost=document.createElement('section');teamHost.className='oc-project-team';teamHost.hidden=true;panel.append(teamHost);teamView=window.OCProjectTeam?.mount(teamHost);
    nav.addEventListener('click',e=>{const b=e.target.closest('[data-agent-view]');if(!b)return;visible=b.dataset.agentView!=='chat';teamMode=b.dataset.agentView==='agents';pause();stage.classList.toggle('oc-agents-visible',visible);stage.classList.toggle('oc-project-team-visible',teamMode);panel.hidden=!visible;view.hidden=teamMode;chatLayer.hidden=teamMode;teamView?.show(visible&&teamMode);nav.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
    panel.addEventListener('change',e=>{
      if(e.target.matches('[data-agent-run]')){selectedRun=e.target.value;selectedNode='boss';resetGraph();render();}
      if(e.target.matches('[data-replay-range]')){pause();replayIndex=Number(e.target.value);render();}
    });
    panel.addEventListener('click',async e=>{
      if(suppressClick)return;
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.agentNode){selectedNode=b.dataset.agentNode;render();openChat(selectedNode);}
      if(b.dataset.graphAction){
        const action=b.dataset.graphAction;
        if(action==='fit')fitGraph();
        if(action==='zoom-in')zoomGraph(1.2);
        if(action==='zoom-out')zoomGraph(1/1.2);
        if(action==='layout'){positions.clear();renderGraphOnly();fitGraph();}
        if(action==='latest'){pause();replayIndex=null;render();}
        if(action==='prev'||action==='next'){pause();replayIndex=Math.max(0,Math.min(checkpoints.length,(replayIndex??checkpoints.length)+(action==='prev'?-1:1)));render();}
        if(action==='play'){
          if(playTimer)pause();else{if(replayIndex===null||replayIndex>=checkpoints.length)replayIndex=0;playTimer=setInterval(()=>{if(!visible){pause();return;}replayIndex++;if(replayIndex>=checkpoints.length){replayIndex=checkpoints.length;pause();}render();},1000);}
          render();
        }
      }
      if(b.dataset.checkpoint){pause();replayIndex=Number(b.dataset.checkpoint);selectedNode=checkpoints[replayIndex-1]?.node||'boss';render();}
      if(b.hasAttribute('data-agent-chat'))nav.querySelector('[data-agent-view="chat"]').click();
      if(b.dataset.agentStop&&!busy&&replayIndex===null){
        if(!window.confirm('Stop this worker? The BOSS will receive a cancelled result.'))return;
        const sessionId=context.sessionId;busy=true;render();
        try{const r=await fetch(`/api/research/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(b.dataset.agentStop)}/stop`,{method:'POST',headers:{'X-OC-Workspace':'research'}});if(!r.ok)throw Error('Worker stop failed. Refresh and try again.');await window.OCResearchWorkspace.refreshSession();}
        catch(error){if(sessionId===context.sessionId)window.alert(error.message);}finally{busy=false;render();}
      }
    });
    timer=setInterval(async()=>{if(!visible||polling)return;polling=true;try{if(teamMode)await teamView?.refresh();else{await window.OCResearchWorkspace.refreshSession();render();}}catch{}finally{polling=false;}},1500);window.addEventListener('beforeunload',()=>{clearInterval(timer);pause();});
    new ResizeObserver(()=>{if(visible&&!drag)fitGraph();}).observe(panel);render();
  }
  function renderGraphOnly(){lastRenderKey='';render();}
  function render(){
    teamView?.update(context);
    if(teamMode)return;
    if(!panel||!visible||drag)return;
    const snapshot=window.OCResearchChat?.agentSnapshot();
    if(!snapshot||snapshot.sessionId!==context.sessionId||!snapshot.runs.length){pause();lastRenderKey='';view.innerHTML='<div class="oc-agents-empty"><h3>No agent run yet</h3><p>Start a task in Chat. Workers appear here only when the BOSS actually delegates work.</p><button type="button" data-agent-chat>Go to Chat</button></div>';return;}
    const rootRuns=snapshot.runs.filter(r=>!r.targetSubagentId&&!r.automaticWake);
    if(!rootRuns.length)return;
    if(!rootRuns.some(r=>r.id===selectedRun)){selectedRun=rootRuns.find(r=>live(r.status))?.id||rootRuns[0].id;resetGraph();}
    checkpoints=timeline(snapshot,selectedRun);
    if(replayIndex!==null)replayIndex=Math.min(replayIndex,checkpoints.length);
    const cutoff=replayIndex===null?null:replayIndex===0?0:checkpoints[replayIndex-1].sequence;
    const model=project(snapshot,selectedRun,Date.now(),cutoff);if(!model)return;
    currentModel=model;currentSnapshot=snapshot;syncChats();
    const task=context.messages.find(m=>m.id===model.run.userMessageId)?.content||model.run.prompt||'Original request is not available in this snapshot.';
    const child=model.children.find(c=>c.id===selectedNode);if(!child&&selectedNode!=='result')selectedNode='boss';
    const renderKey=JSON.stringify([model,task,selectedNode,busy,snapshot.runs,replayIndex,!!playTimer,checkpoints]);
    if(lastRenderKey===renderKey&&panel.querySelector('.oc-agents-body'))return;
    lastRenderKey=renderKey;
    const running=model.children.filter(c=>c.status==='running').length;
    graphModel=workflow(model);
    const nextTopology=graphModel.nodes.map(n=>n.id).join('|');if(topology!==nextTopology){needsFit=true;topology=nextTopology;}
    const card=n=>{const p=positions.get(n.id)||n;return `<button type="button" class="oc-agent-node ${selectedNode===n.id?'is-selected':''} ${n.id==='result'?'is-output':''}" style="left:${p.x}px;top:${p.y}px" data-agent-node="${esc(n.id)}" data-status="${esc(n.status)}" aria-pressed="${selectedNode===n.id}"><strong>${esc(n.title)}</strong><span class="oc-agent-status" data-status="${esc(n.status)}">${esc(labels[n.status]||n.status==='pending'&&'Awaiting response'||n.status)}</span><p>${esc(n.subtitle)}</p></button>`;};
    const focus=panel.contains(document.activeElement)?{node:document.activeElement.dataset.agentNode,run:document.activeElement.hasAttribute('data-agent-run'),range:document.activeElement.hasAttribute('data-replay-range'),action:document.activeElement.dataset.graphAction,checkpoint:document.activeElement.dataset.checkpoint}:null;
    const index=replayIndex??checkpoints.length,checkpoint=checkpoints[index-1];
    const actions='<button type="button" data-graph-action="zoom-out" aria-label="Zoom out">−</button><span data-zoom-label></span><button type="button" data-graph-action="zoom-in" aria-label="Zoom in">+</button><button type="button" data-graph-action="fit">Fit</button><button type="button" data-graph-action="layout">Reset layout</button>';
    view.innerHTML=`<header class="oc-agents-toolbar"><label>Run <select data-agent-run aria-label="Agent run">${rootRuns.map(r=>`<option value="${esc(r.id)}" ${r.id===selectedRun?'selected':''}>${esc(new Date(r.createdAt).toLocaleString())} · ${esc(labels[r.status]||r.status)}</option>`).join('')}</select></label><span class="oc-flow-mode ${model.replay?'is-replay':''}">${model.replay?'Replay · recorded events':'Latest recorded state'}</span><span>${running} worker${running===1?'':'s'} active${running>1?' · parallel execution':''}</span></header>${model.connectionError||model.stale?`<p class="oc-agent-warning" role="status">${esc(model.connectionError?'Activity connection unavailable. Showing the last recorded state.':'No recent activity update. This is the last recorded state.')}</p>`:''}
      <div class="oc-agents-body"><div class="oc-flow-workspace">
        <div class="oc-graph-tools"><strong>Agent workspace · click a node to chat</strong><div>${actions}</div></div>
        <div class="oc-graph-canvas ${model.replay?'is-replay':''} ${model.stale||model.connectionError?'is-stale':''}" tabindex="0" role="region" aria-label="Execution graph. Drag nodes or background. Scroll to zoom. Arrow keys pan, plus and minus zoom, zero fits.">
          <div class="oc-graph-world" style="width:${graphModel.width}px;height:${graphModel.height}px"><svg class="oc-graph-edges" width="${graphModel.width}" height="${graphModel.height}" aria-hidden="true">${edgeMarkup(graphModel)}</svg>${graphModel.nodes.map(card).join('')}</div>
        </div>
        <div class="oc-flow-legend"><span><i class="is-assigned"></i>Delegation</span><span><i class="is-active"></i>Active BOSS dispatch</span><small>Click to chat · Drag to move · Scroll to zoom</small></div>
        <section class="oc-flow-timeline" aria-label="Run event timeline"><div class="oc-replay-controls"><button type="button" data-graph-action="play" ${!checkpoints.length?'disabled':''}>${playTimer?'Pause':'Replay'}</button><button type="button" data-graph-action="prev" aria-label="Previous event" ${!index?'disabled':''}>‹</button><input data-replay-range type="range" min="0" max="${checkpoints.length}" value="${index}" aria-label="Recorded event checkpoint"><button type="button" data-graph-action="next" aria-label="Next event" ${index>=checkpoints.length?'disabled':''}>›</button><button type="button" data-graph-action="latest" ${!model.replay?'disabled':''}>Latest</button></div><p class="oc-checkpoint-caption">${esc(checkpoints.length?(checkpoint?`${new Date(checkpoint.time).toLocaleTimeString()} · ${checkpoint.title}`:'Before the first recorded event'):'No event history available. Showing the saved snapshot only.')}</p><div class="oc-event-list">${checkpoints.map((c,i)=>`<button type="button" data-checkpoint="${i+1}" aria-current="${index===i+1?'step':'false'}"><time>${esc(new Date(c.time).toLocaleTimeString())}</time><span>${esc(c.title)}</span></button>`).join('')}</div><small>Recorded order is not a dependency. Worker-to-worker dependencies are not supplied by this runtime.</small></section>
      </div></div>`;
    bindCanvas();
    const activeEvent=panel.querySelector('[aria-current="step"]');if(activeEvent)panel.querySelector('.oc-event-list').scrollTop=activeEvent.offsetTop;
    if(focus?.run)panel.querySelector('[data-agent-run]').focus();
    if(focus?.range)panel.querySelector('[data-replay-range]').focus();
    if(focus?.action)panel.querySelector(`[data-graph-action="${focus.action}"]`)?.focus();
    if(focus?.checkpoint)panel.querySelector(`[data-checkpoint="${focus.checkpoint}"]`)?.focus();
    if(focus?.node)[...panel.querySelectorAll('[data-agent-node]')].find(b=>b.dataset.agentNode===focus.node)?.focus();
  }
  window.OCDesktopAgents={mount,update,project,timeline,workflow,chatEntries};
})();
