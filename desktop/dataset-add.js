(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function paperOption(paper, selected, accepted) {
    return `<section class="oc-add-paper"><label class="oc-add-paper-toggle"><span><strong>Include dataset paper</strong><small>Save the original PDF in each selected project’s papers folder.</small></span><input type="checkbox" role="switch" data-add-paper aria-label="Include dataset paper" ${selected ? 'checked' : ''} ${paper?.available ? '' : 'disabled'}></label>${paper?.available ? `<p>${escape(paper.title)}</p><p class="oc-add-paper-meta">${escape((paper.bytes / 1048576).toFixed(1))} MB · License: ${escape(paper.license)} · Rights: ${escape(paper.rightsStatus)}</p><p class="oc-add-paper-meta">${paper.sourceUrl ? `<a href="${escape(paper.sourceUrl)}" target="_blank" rel="noopener noreferrer">Original paper source</a>` : 'Original source link unavailable.'}${paper.licenseUrl ? ` · <a href="${escape(paper.licenseUrl)}" target="_blank" rel="noopener noreferrer">Paper license</a>` : ''}</p><div data-paper-terms ${selected ? '' : 'hidden'}><p class="oc-add-paper-meta">The dataset license does not cover the paper. Unreviewed rights are not permission to redistribute. Adding a PDF does not mean the agent has read it.</p><label class="oc-add-check"><input type="checkbox" data-paper-accept ${accepted ? 'checked' : ''}> I have reviewed the paper’s license and source terms.</label></div>` : `<p>${escape(paper?.reason || 'No downloadable paper is available for this dataset.')}</p>`}</section>`;
  }
  window.OCDatasetPaperPresentation = {render:paperOption};
  function accessPresentation(access) {
    if (!access) return '';
    const titles={ready:'Automatic download supported',unsupported:'Automatic download not configured',auth_required:'Provider authorization required',source_error:'Source could not be verified'};
    let source='';try{const u=new URL(access.source);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)source=u.href;}catch{}
    return `<section class="oc-add-access" role="status"><strong>${escape(titles[access.status]||'Check dataset access')}</strong><p>${escape(access.message)}</p>${access.coverage ? `<p><strong>Download contents:</strong> ${escape(access.coverage)}</p>` : ''}${source ? `<a href="${escape(source)}" target="_blank" rel="noopener noreferrer">Open original source</a>` : ''}</section>`;
  }
  window.OCDatasetAccessPresentation={render:accessPresentation};
  if (!window.OCDesktop?.reviewDataset) return;
  const root = document.getElementById('detailRoot');
  const datasetId = new URLSearchParams(location.search).get('id');
  if (!root || !datasetId) return;
  const state = { review:null, step:'review', jobId:null, timer:null, busy:false, selected:[], includePaper:false, paperAccepted:false, datasetAccepted:false };
  let modal, body, primary, back, status, licenseBody;

  function message(value, error = false) {
    status.textContent = value;
    status.classList.toggle('is-error', error);
    status.hidden = !value;
  }
  function render() {
    if (!state.review) return;
    if (state.step === 'review') {
      if(state.review.access && !state.review.access.canDownload){
        body.innerHTML=accessPresentation(state.review.access);primary.textContent='Close';primary.disabled=false;back.hidden=true;return;
      }
      body.innerHTML = `<p class="oc-add-context">One local copy can be used by several projects. Each selected project receives read-only access to this dataset.</p><div data-add-license-body></div><p class="oc-add-source">Source: ${escape(state.review.source || 'See catalog record')}</p><label class="oc-add-check"><input type="checkbox" data-add-accept ${state.datasetAccepted ? 'checked' : ''}> I have reviewed the dataset license and source terms.</label>${paperOption(state.review.paper,state.includePaper,state.paperAccepted)}`;
      const terms = body.querySelector('[data-add-license-body]');
      body.insertAdjacentHTML('afterbegin',accessPresentation(state.review.access));
      if (licenseBody) terms.append(...[...licenseBody.children].map(node => node.cloneNode(true)));
      else terms.textContent = state.review.license;
      const update = () => {primary.disabled = !state.datasetAccepted || (state.includePaper && !state.paperAccepted);};
      primary.textContent = 'Choose projects'; update();
      back.hidden = true;
      body.querySelector('[data-add-accept]').addEventListener('change', event => {state.datasetAccepted=event.target.checked;update();});
      body.querySelector('[data-add-paper]').addEventListener('change', event => {
        state.includePaper=event.target.checked;state.paperAccepted=false;state.selected=[];
        const terms=body.querySelector('[data-paper-terms]');if(terms)terms.hidden=!state.includePaper;
        const accept=body.querySelector('[data-paper-accept]');if(accept)accept.checked=false;update();
      });
      body.querySelector('[data-paper-accept]')?.addEventListener('change',event=>{state.paperAccepted=event.target.checked;update();});
    } else if (state.step === 'projects') {
      body.innerHTML = `<p class="oc-add-context">Select the projects to add. No project is selected automatically.${state.includePaper ? ' You can also add the paper to an already-linked dataset without downloading the dataset again.' : ''}</p><div class="oc-add-projects">${state.review.projects.map(project => `<label class="oc-add-project"><input type="checkbox" value="${escape(project.id)}" ${project.linked && !state.includePaper ? 'disabled' : state.selected.includes(project.id) ? 'checked' : ''}><span><strong>${escape(project.name)}</strong><small>${project.linked ? state.includePaper ? 'Dataset linked · add or verify paper' : 'Already linked · manage from this project’s Workspace' : 'Not linked'}</small><small>Project ${escape(project.id.slice(0,8))}</small></span></label>`).join('') || '<p>No research projects yet. Create one in Research, then return here.</p>'}</div>`;
      primary.textContent = 'Review selection'; primary.disabled = !body.querySelector('input:checked:not(:disabled)');
      back.hidden = false;
      body.querySelectorAll('input').forEach(input => input.addEventListener('change', () => { state.selected=[...body.querySelectorAll('input:checked:not(:disabled)')].map(input=>input.value);primary.disabled = !state.selected.length; }));
    } else if(state.step==='confirm') {
      const projects=state.review.projects.filter(project=>state.selected.includes(project.id));
      body.innerHTML=`<p class="oc-add-context">Add <strong>${escape(state.review.name)}</strong> to these ${projects.length} project(s):</p><ul>${projects.map(project=>`<li><strong>${escape(project.name)}</strong> <small>(${escape(project.id.slice(0,8))})</small></li>`).join('')}</ul><p>These projects will receive read-only access to the shared local copy.</p><p><strong>Dataset paper: ${state.includePaper ? 'Included' : 'Not requested'}</strong>${state.includePaper ? '<br>'+escape(state.review.paper.title)+'<br>The PDF will be saved in each project’s papers folder. No automatic content extraction.' : ''}</p>`;
      primary.textContent='Add to '+projects.length+' project'+(projects.length===1?'':'s');primary.disabled=!projects.length;back.hidden=false;
    } else {
      body.innerHTML = `<div class="oc-add-progress"><span class="oc-add-progress-icon" aria-hidden="true">↓</span><h3>${state.step === 'done' ? 'Dataset ready' : state.step === 'failed' ? 'Dataset needs attention' : 'Preparing shared dataset'}</h3><p>${escape(state.lastMessage || 'Checking the local library…')}</p></div>`;
      if(state.step==='failed')body.insertAdjacentHTML('beforeend',accessPresentation({...state.review.access,message:state.lastMessage}));
      primary.textContent = state.step === 'failed' && state.retryable!==false ? 'Try again' : 'Close';
      primary.disabled = state.step === 'progress'; back.hidden = true;
    }
  }
  async function poll() {
    if (!state.jobId) return;
    try {
      const job = await window.OCDesktop.datasetJobStatus(state.jobId);
      state.lastMessage = job.message;
      state.retryable = job.retryable;
      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(state.timer);state.timer = null;
        state.step = job.status === 'completed' ? 'done' : 'failed';
      }
      render();
    } catch(error) {message(error.message, true);}
  }
  async function open() {
    message('');
    modal.show();
    if (state.jobId && state.step === 'progress') { render(); await poll(); return; }
    body.textContent = 'Loading dataset terms and projects…';primary.disabled = true;back.hidden = true;
    try { state.review = await window.OCDesktop.reviewDataset(datasetId);state.selected=[];state.includePaper=false;state.paperAccepted=false;state.datasetAccepted=false;state.step = 'review';render(); }
    catch(error) {body.textContent = 'The dataset cannot be added right now.';message(error.message,true);}
  }
  async function advance() {
    if (state.busy || primary.disabled) return;
    if (state.step === 'review') {if(state.review.access && !state.review.access.canDownload){modal.hide();return;}state.step = 'projects';message('');render();return;}
    if (state.step === 'done') {modal.hide();return;}
    if (state.step === 'failed') {if(state.retryable===false){modal.hide();return;}await open();return;}
    if(state.step==='projects'){state.step='confirm';render();return;}
    if (state.step !== 'confirm') return;
    const projectIds = [...state.selected];
    state.busy = true;primary.disabled = true;message('');
    try {
      const job = await window.OCDesktop.addDatasetToProjects({datasetId,projectIds,licenseFingerprint:state.review.licenseFingerprint,licenseAccepted:true,includePaper:state.includePaper,paperFingerprint:state.includePaper ? state.review.paper.fingerprint : undefined,paperAccepted:state.includePaper && state.paperAccepted});
      state.jobId = job.id;state.step = 'progress';state.lastMessage = job.message;render();
      state.timer = setInterval(poll, 1500);void poll();
    } catch(error) {message(error.message,true);primary.disabled=false;}
    finally {state.busy=false;}
  }
  function mount() {
    if (root.querySelector('[data-add-to-project]')) return;
    const heading = [...root.querySelectorAll('h2')].find(node => node.textContent.trim() === 'Dataset Access');
    const actions = heading?.closest('.card')?.querySelector('.d-grid');
    if (!actions) return;
    licenseBody = root.querySelector('#licenseDownloadModal .modal-body')?.cloneNode(true);
    root.querySelector('#licenseDownloadModal')?.remove();
    root.querySelector('#datasetDownloadInstructionsModal')?.remove();
    actions.querySelectorAll('[data-license-gate]').forEach(node => node.remove());
    const button = document.createElement('button');button.type='button';button.className='btn btn-primary btn-sm';button.dataset.addToProject='';button.textContent='Add to project';
    actions.prepend(button);
    const dialog = document.createElement('div');dialog.className='modal fade';dialog.id='ocAddDatasetModal';dialog.tabIndex=-1;dialog.setAttribute('aria-labelledby','ocAddDatasetTitle');dialog.setAttribute('aria-hidden','true');
    dialog.innerHTML='<div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable"><div class="modal-content oc-add-dataset"><div class="modal-header"><h2 class="modal-title h5" id="ocAddDatasetTitle">Add dataset to project</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body" data-add-body></div><div class="modal-footer"><p data-add-status role="status" aria-live="polite" hidden></p><button type="button" class="btn btn-outline-secondary" data-add-back hidden>Back</button><button type="button" class="btn btn-primary" data-add-primary disabled>Choose projects</button></div></div></div>';
    root.append(dialog);
    modal = new bootstrap.Modal(dialog);body = dialog.querySelector('[data-add-body]');primary = dialog.querySelector('[data-add-primary]');back = dialog.querySelector('[data-add-back]');status = dialog.querySelector('[data-add-status]');
    button.addEventListener('click', () => {void open();});
    primary.addEventListener('click', () => {void advance();});
    back.addEventListener('click', () => {state.step=state.step==='confirm'?'projects':'review';message('');render();});
    dialog.addEventListener('hidden.bs.modal', () => {if (state.timer && state.step !== 'progress') {clearInterval(state.timer);state.timer=null;}});
  }
  const observer = new MutationObserver(() => mount());
  observer.observe(root,{childList:true});
  mount();
  window.addEventListener('pagehide', () => {observer.disconnect();clearInterval(state.timer);});
})();
