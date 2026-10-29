/* Human Agent Editor. No model calls, credentials, or direct filesystem access. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tabs=[['role','Vai trò'],['model','Model'],['tools','Công cụ'],['state','Trạng thái'],['memory','Bộ nhớ'],['flow','Luồng xử lý']];
  const labels={name:'Tên agent',role:'Instructions / Role',modelId:'Model',thinkingMode:'Chế độ suy luận',thinkingEffort:'Mức suy luận',connectorIds:'Connectors',allowedToolNames:'Tools được chọn',deniedToolNames:'Tools bị chặn',autoSaveMemory:'Tự lưu kết quả',maxTeamRounds:'Số vòng điều phối'};
  let modal,session,serial=0,abort;
  const dirty=()=>session?.data&&JSON.stringify(session.draft)!==JSON.stringify(session.data.configuration);
  const noteDirty=()=>session?.data&&session.note!==session.noteBaseline;
  const q=selector=>modal.querySelector(selector);
  const canSave=()=>session?.data?.canEdit!==false&&!session?.data?.state?.busy&&!session.pending;
  async function api(suffix,method='GET',body){
    const context=session;
    const response=await fetch(`/api/research/projects/${encodeURIComponent(context.projectId)}/team/${encodeURIComponent(context.agentId)}/${suffix}`,{method,cache:'no-store',headers:{'Content-Type':'application/json','X-OC-Workspace':'research'},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]),...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(value.error?.message||value.error||value.detail||`Request failed (${response.status})`),{status:response.status});
    return value;
  }
  function notice(message,error=false){if(!modal)return;const node=q('[data-editor-notice]');node.textContent=message;node.classList.toggle('is-error',error);}
  function footer(){
    if(!session?.data){q('[data-editor-save]').disabled=true;q('[data-editor-compare]').disabled=true;return;}
    q('[data-editor-save]').disabled=!canSave()||!dirty();q('[data-editor-compare]').disabled=!dirty()||session.pending;
    q('[data-editor-reload]').disabled=session.pending;q('[data-editor-close]').disabled=!!session.saving;
    const memory=q('[data-editor-save-note]');if(memory)memory.disabled=!canSave()||!noteDirty()||session.data.memory.status!=='available';
    q('[data-editor-dirty]').textContent=dirty()?'Có thay đổi cấu hình chưa lưu':`Cấu hình phiên bản ${session.data.revision}`;
    if(session.data.canEdit===false)q('[data-editor-apply]').textContent='Chỉ admin được chỉnh cấu hình và bộ nhớ.';
    else q('[data-editor-apply]').textContent=session.data.state.busy?'Dự án đang có nhiệm vụ. Giữ bản nháp; lưu sau khi các lượt chạy hoàn tất.':'Áp dụng cho nhiệm vụ tiếp theo. Không viết lại lịch sử đã chạy.';
    modal.querySelectorAll('[data-config],[data-connector],[data-tool],[data-editor-note],[data-tool-mode]').forEach(el=>el.disabled=session.pending||session.data.canEdit===false);
    modal.querySelectorAll('[data-editor-tab],[data-editor-versions]').forEach(el=>el.disabled=session.pending);
    const rounds=q('[data-config=maxTeamRounds]');if(rounds&&!session.agents.some(a=>a.parents?.includes(session.agentId)))rounds.disabled=true;
  }
  function check(label,attr,on,help=''){return `<label class="oc-ae-check"><input type="checkbox" ${attr} ${on?'checked':''}><span>${esc(label)}${help?`<small>${esc(help)}</small>`:''}</span></label>`;}
  function field(label,name,value,area=false){return `<label class="oc-ae-field">${esc(label)}${area?`<textarea data-config="${name}" rows="${name==='role'?12:5}" maxlength="${name==='role'?8000:100}">${esc(value)}</textarea>`:`<input data-config="${name}" value="${esc(value)}" maxlength="100">`}</label>`;}
  function tools(){
    const d=session.draft,catalog=session.data.catalog,all=d.allowedToolNames===null;
    const names=[...new Set([...(catalog.tools||[]),...(d.allowedToolNames||[]),...d.deniedToolNames])].sort();
    return `<h3>Connectors được cấp riêng</h3><div class="oc-ae-options">${(catalog.connectors||[]).map(c=>check(c.name,`data-connector="${esc(c.id)}"`,d.connectorIds.includes(c.id))).join('')||'<p>Không có connector trong catalog.</p>'}</div><h3>Quyền gọi công cụ</h3><label class="oc-ae-field">Chế độ<select data-tool-mode><option value="all" ${all?'selected':''}>Tất cả công cụ có sẵn, trừ các mục bị chặn</option><option value="selected" ${!all?'selected':''}>Chỉ các công cụ được chọn</option></select></label><label class="oc-ae-field">Tìm công cụ<input type="search" data-tool-search value="${esc(session.toolQuery)}" placeholder="Tên công cụ"></label><p class="oc-ae-help">Công cụ vẫn tuân theo connector, sandbox và môi trường được cấp. Skills hiện có được giữ nguyên.</p><div class="oc-ae-tool-list">${names.map(name=>check(name,`data-tool="${esc(name)}"`,(all||d.allowedToolNames.includes(name))&&!d.deniedToolNames.includes(name))).join('')}</div>`;
  }
  function content(){
    const d=session.draft,data=session.data;
    if(session.tab==='role')return `<h3>Vai trò và trách nhiệm</h3>${field('Tên hiển thị','name',d.name)}${field('Instructions / Role','role',d.role,true)}<p class="oc-ae-help">ID và quan hệ cha–con giữ nguyên. Nội dung này thay vai trò hiện tại từ nhiệm vụ tiếp theo.</p>`;
    if(session.tab==='model')return `<h3>Model cho agent này</h3><label class="oc-ae-field">Model<select data-config="modelId"><option value="">Theo mặc định dự án</option>${data.models.map(m=>`<option value="${esc(m.id)}" ${d.modelId===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}${d.modelId&&!data.models.some(m=>m.id===d.modelId)?`<option selected value="${esc(d.modelId)}">Model không còn khả dụng</option>`:''}</select></label><label class="oc-ae-field">Suy luận<select data-config="thinkingMode">${[['','Theo cấu hình kế thừa'],['auto','Auto'],['enabled','Bật'],['disabled','Tắt']].map(([v,l])=>`<option value="${v}" ${d.thinkingMode===v||d.thinkingMode===null&&v===''?'selected':''}>${l}</option>`).join('')}</select></label><label class="oc-ae-field">Mức suy luận<select data-config="thinkingEffort">${[['','Theo mặc định'],['low','Low'],['medium','Medium'],['high','High'],['xhigh','Extra high'],['max','Max']].map(([v,l])=>`<option value="${v}" ${d.thinkingEffort===v||d.thinkingEffort===null&&v===''?'selected':''}>${l}</option>`).join('')}</select></label><p class="oc-ae-help">Chỉ các profile đã kết nối được liệt kê. Thiết lập không được model hỗ trợ sẽ bị từ chối khi lưu.</p>`;
    if(session.tab==='tools')return tools();
    if(session.tab==='memory')return `<h3>Ghi chú riêng của agent</h3><p class="oc-ae-help">Ghi chú làm việc, không tự trở thành kiến thức dự án đã xác nhận. Không lưu mật khẩu hoặc token.</p>${data.memory.status==='available'?`<label class="oc-ae-field">Working notes · revision ${session.noteRevision}<textarea data-editor-note maxlength="16000" rows="12">${esc(session.note)}</textarea></label><button type="button" data-editor-save-note>Lưu ghi chú riêng</button><p class="oc-ae-help">Lưu độc lập với cấu hình. Có kiểm tra revision để tránh ghi đè cập nhật mới.</p>`:`<p role="status">${data.memory.status==='not_configured'?'Bộ nhớ chưa được cấu hình.':'Bộ nhớ đang không khả dụng. Tải lại để thử lại.'}</p>`}<h3>Kết quả đã lưu gần đây</h3>${(data.memory.records||[]).map(r=>`<details><summary>Run ${esc(r.key.slice(0,8))} · ${esc(r.outcome)}</summary><pre>${esc(r.request+'\n\n'+r.answer)}</pre></details>`).join('')||'<p class="oc-ae-help">Chưa có bản ghi Store. Kết quả hội thoại vẫn có trong Trạng thái.</p>'}`;
    if(session.tab==='state')return `<h3>Trạng thái và lịch sử · chỉ đọc</h3><dl><dt>Agent ID</dt><dd>${esc(session.agentId)}</dd><dt>Session</dt><dd>${esc(data.sessionId)}</dd><dt>Quan hệ cha</dt><dd>${esc(data.state.parents.join(', ')||'Cấp cao nhất')}</dd><dt>Nhiệm vụ trong dự án</dt><dd>${data.state.busy?'Đang có lượt chạy / hàng đợi':'Không có lượt đang chạy'}</dd><dt>Phê duyệt công cụ</dt><dd>${esc(data.state.approvalMode)}</dd></dl>${data.latestResult?`<details open><summary>Kết quả gần nhất · ${esc(data.latestResult.status)}</summary><pre>${esc(data.latestResult.answer||data.latestResult.error||'Chưa có câu trả lời cuối.')}</pre></details>`:''}<p class="oc-ae-help">Hội thoại, checkpoint và kết quả công cụ không bị sửa trong editor.</p>`;
    const coordinator=session.agents.some(a=>a.parents?.includes(session.agentId));
    return `<h3>Luồng điều khiển</h3><div class="oc-ae-flow">Nhận nhiệm vụ → Model / Tools → Kiểm tra kết quả → Trả lời</div>${check('Tự lưu kết quả sau khi hoàn tất',`data-config="autoSaveMemory"`,d.autoSaveMemory,'Áp dụng cho bước lưu tự động; không xóa bản ghi đã có.')}<label class="oc-ae-field">Số vòng giao việc / kiểm tra của coordinator<select data-config="maxTeamRounds" ${!coordinator?'disabled':''}>${[1,2,3].map(n=>`<option value="${n}" ${d.maxTeamRounds===n?'selected':''}>${n} vòng</option>`).join('')}</select></label><p class="oc-ae-help">${coordinator?'Giới hạn tối đa 3 vòng theo runtime hiện tại.':'Agent này không có agent con; giới hạn vòng chỉ có hiệu lực với coordinator.'} Điểm phê duyệt, sandbox và retry của runtime giữ nguyên.</p>`;
  }
  function body(){
    q('[data-editor-tabs]').innerHTML=tabs.map(([id,label])=>`<button type="button" data-editor-tab="${id}" aria-pressed="${session.tab===id}">${label}</button>`).join('');
    q('[data-editor-body]').innerHTML=content();
    if(session.tab==='tools')filterTools();
    footer();
    if(session.tab==='flow'&&!session.agents.some(a=>a.parents?.includes(session.agentId)))q('[data-config=maxTeamRounds]').disabled=true;
  }
  function filterTools(){const query=session.toolQuery.toLowerCase();modal.querySelectorAll('[data-tool]').forEach(input=>input.closest('label').hidden=!input.dataset.tool.toLowerCase().includes(query));}
  function compare(){
    const changed=Object.keys(session.draft).filter(k=>JSON.stringify(session.draft[k])!==JSON.stringify(session.data.configuration[k]));
    const value=v=>Array.isArray(v)?v.join(', ')||'Không có':v===null?'Kế thừa / tất cả':String(v);
    const box=q('[data-editor-diff]');box.hidden=false;box.innerHTML='<h3>Thay đổi so với cấu hình hiện tại</h3>'+changed.map(k=>`<div><strong>${esc(labels[k]||k)}</strong><p>Trước: ${esc(value(session.data.configuration[k]))}</p><p>Sau: ${esc(value(session.draft[k]))}</p></div>`).join('');
  }
  async function load({keepDraft=false,keepNote=false}={}){
    const generation=serial;session.pending=true;notice('Đang tải cấu hình…');if(session.data)footer();
    try{
      const data=await api('editor');if(generation!==serial)return;
      if(data.agentId!==session.agentId||data.projectId!==session.projectId)throw Error('Agent response does not match this project.');
      session.data=data;if(!keepDraft)session.draft=structuredClone(data.configuration);
      const content=data.memory.notes?.content||'';
      if(!keepNote){session.noteRevision=data.memory.notes?.revision||0;session.note=content;session.noteBaseline=content;session.noteOperation=null;}
      q('[data-editor-agent-title]').textContent=data.configuration.name;
      q('[data-editor-versions]').innerHTML='<option value="">Phiên bản hiện tại</option>'+data.history.map(v=>`<option value="${v.revision}">v${v.revision} · ${esc(new Date(v.createdAt).toLocaleString())}</option>`).join('');
      q('[data-editor-diff]').hidden=true;notice('');body();
      return true;
    }catch(error){if(generation===serial){if([403,404].includes(error.status))clearPrivateView();notice(error.message,true);}return false;}
    finally{if(generation===serial){session.pending=false;if(session.data)footer();}}
  }
  async function save(){
    if(!canSave()||!dirty())return;
    const generation=serial;session.pending=true;session.saving=true;footer();notice('Đang lưu cấu hình…');
    try{
      await api('editor','PUT',{expectedRevision:session.data.revision,expectedToken:session.data.token,configuration:session.draft});
      if(generation!==serial)return;
      if(await load({keepNote:noteDirty()}))notice('Đã lưu phiên bản cấu hình mới. Áp dụng cho nhiệm vụ tiếp theo.');
      window.dispatchEvent(new CustomEvent('oc-agent-configuration-changed',{detail:{projectId:session.projectId,agentId:session.agentId}}));
    }catch(error){if(generation===serial)notice(error.message,true);}
    finally{if(generation===serial){session.pending=false;session.saving=false;footer();}}
  }
  async function saveNote(){
    if(!canSave()||!noteDirty())return;
    const generation=serial;session.pending=true;session.saving=true;session.noteOperation ||= crypto.randomUUID();footer();notice('Đang lưu ghi chú…');
    try{
      const result=await api('working-note','PUT',{content:session.note,expectedRevision:session.noteRevision,operationId:session.noteOperation});
      if(generation!==serial)return;
      session.noteRevision=result.revision;session.noteBaseline=result.content;session.note=result.content;session.noteOperation=null;
      session.data.memory.notes={content:result.content,revision:result.revision};body();notice('Đã lưu ghi chú riêng. Cấu hình và các run cũ không đổi.');
    }catch(error){if(generation===serial)notice(error.message,true);}
    finally{if(generation===serial){session.pending=false;session.saving=false;footer();}}
  }
  function leave(){if(session.saving)return false;return !dirty()&&!noteDirty()||window.confirm('Bỏ các thay đổi chưa lưu trong editor?');}
  function clearPrivateView(){session.data=null;session.draft=null;session.note='';session.noteBaseline='';q('[data-editor-body]').replaceChildren();q('[data-editor-tabs]').replaceChildren();q('[data-editor-diff]').replaceChildren();q('[data-editor-diff]').hidden=true;q('[data-editor-versions]').innerHTML='<option value="">Phiên bản hiện tại</option>';q('[data-editor-dirty]').textContent='';q('[data-editor-apply]').textContent='';footer();}
  function close(force=false){if(!force&&!leave())return;serial++;abort?.abort();modal.close();modal.remove();modal=null;session=null;}
  async function select(id){if(!leave())return;serial++;abort?.abort();abort=new AbortController();session.agentId=id;clearPrivateView();session.toolQuery='';q('[data-editor-body]').textContent='Đang tải…';q('[data-editor-agent-title]').textContent=id;modal.querySelectorAll('[data-editor-agent]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.editorAgent===id)));await load();}
  async function open({projectId,agentId,projectName=''}){
    if(modal){if(!leave())return;close(true);}
    serial++;abort=new AbortController();session={projectId,agentId,projectName,tab:'role',data:null,draft:null,note:'',noteBaseline:'',pending:false,agents:[],toolQuery:''};
    modal=document.createElement('dialog');modal.className='oc-agent-editor';modal.setAttribute('aria-label','Agent Editor');
    modal.innerHTML=`<header><div><small>${esc(projectName||'Project')} / Agent Editor</small><h2 data-editor-agent-title>${esc(agentId)}</h2></div><button type="button" data-editor-close aria-label="Close Agent Editor">×</button></header><div class="oc-ae-layout"><aside aria-label="Project agents" data-editor-agents></aside><main><nav data-editor-tabs aria-label="Agent configuration sections"></nav><p data-editor-notice role="status" aria-live="polite"></p><section data-editor-body></section><section data-editor-diff hidden></section></main></div><footer><div><span data-editor-dirty></span><small data-editor-apply></small></div><div><select data-editor-versions aria-label="Configuration history"><option>Phiên bản hiện tại</option></select><button type="button" data-editor-reload>Tải lại</button><button type="button" data-editor-compare disabled>Xem thay đổi</button><button type="button" data-editor-save disabled>Lưu cấu hình</button></div></footer>`;
    document.body.append(modal);modal.showModal();
    modal.addEventListener('cancel',event=>{event.preventDefault();close();});
    modal.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-editor-close'))close();else if(b.dataset.editorAgent)void select(b.dataset.editorAgent);else if(b.dataset.editorTab){session.tab=b.dataset.editorTab;body();}else if(b.hasAttribute('data-editor-save'))void save();else if(b.hasAttribute('data-editor-save-note'))void saveNote();else if(b.hasAttribute('data-editor-compare'))compare();else if(b.hasAttribute('data-editor-reload')&&leave())void load();});
    modal.addEventListener('input',event=>{
      const t=event.target;if(!session.data||session.pending)return;
      if(t.hasAttribute('data-tool-search')){session.toolQuery=t.value;filterTools();return;}
      if(t.hasAttribute('data-editor-note')){session.note=t.value;session.noteOperation=null;footer();return;}
      if(t.dataset.config){let value=t.type==='checkbox'?t.checked:t.value||null;if(t.dataset.config==='maxTeamRounds')value=Number(value);session.draft[t.dataset.config]=value;if(t.dataset.config==='thinkingMode'&&value!=='enabled'){session.draft.thinkingEffort=null;body();}if(t.dataset.config==='thinkingEffort'&&value){session.draft.thinkingMode='enabled';body();}}
      else if(t.dataset.connector){const set=new Set(session.draft.connectorIds);t.checked?set.add(t.dataset.connector):set.delete(t.dataset.connector);session.draft.connectorIds=[...set];}
      else if(t.dataset.tool){const d=session.draft,id=t.dataset.tool;if(d.allowedToolNames===null){d.deniedToolNames=d.deniedToolNames.filter(x=>x!==id);if(!t.checked)d.deniedToolNames.push(id);}else{d.allowedToolNames=d.allowedToolNames.filter(x=>x!==id);d.deniedToolNames=d.deniedToolNames.filter(x=>x!==id);if(t.checked)d.allowedToolNames.push(id);}}
      else return;
      q('[data-editor-diff]').hidden=true;footer();
    });
    modal.addEventListener('change',async event=>{
      const t=event.target;if(!session.data||session.pending)return;if(t.hasAttribute('data-tool-mode')){session.draft.allowedToolNames=t.value==='all'?null:[];body();return;}
      if(!t.hasAttribute('data-editor-versions')||t.value==='')return;
      if(!leave()){t.value='';return;}
      const generation=serial;session.pending=true;footer();notice('Đang tải phiên bản…');
      try{const data=await api('editor?version='+encodeURIComponent(t.value));if(generation!==serial)return;session.draft=structuredClone(data.selectedVersion?.configuration||data.configuration);body();notice('Đã nạp phiên bản cũ vào bản nháp. Lưu để tạo phiên bản mới; lịch sử cũ giữ nguyên.');}
      catch(error){if(generation===serial)notice(error.message,true);}finally{if(generation===serial){session.pending=false;footer();}}
    });
    const generation=serial;
    try{const response=await fetch(`/api/research/projects/${encodeURIComponent(projectId)}/team`,{headers:{'X-OC-Workspace':'research'},signal:abort.signal});if(!response.ok)throw Error('Không tải được đội agent.');const team=await response.json();if(generation!==serial)return;session.agents=team.agents;q('[data-editor-agents]').innerHTML=team.agents.map(a=>`<button type="button" data-editor-agent="${esc(a.id)}" aria-pressed="${a.id===agentId}"><strong>${esc(a.id)}</strong><small>${esc(a.name)}</small></button>`).join('');await load();}catch(error){if(generation===serial)notice(error.message,true);}
  }
  window.OCAgentEditor={open};
})();
