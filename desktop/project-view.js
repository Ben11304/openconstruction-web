import {render,close} from './source-editor.js';
const $=id=>document.getElementById(id),enc=encodeURIComponent;
const projectId=$('mainContent').dataset.projectId;
const version=$('mainContent').dataset.version;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notice=text=>{$('releaseNotice').textContent=text;$('releaseNotice').hidden=!text;};
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(value.error||'Request failed.'),{status:response.status});
  return value;
}
// Escaped Markdown subset: never execute published HTML, scripts or links.
function markdown(text){
  return escape(text).split(/(```[\s\S]*?```)/g).map(part=>part.startsWith('```')?'<pre>'+part.replace(/^```[^\n]*\n?/,'').replace(/```$/,'')+'</pre>':part.split('\n').map(line=>{
    const heading=line.match(/^(#{1,6}) (.*)$/);
    return heading?`<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`:`<div>${line||'<br>'}</div>`;
  }).join('')).join('');
}
if(projectId){
  let current=0,objectUrl='',detail;
  async function preview(file){
    const generation=++current;
    close(true);if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl='';}
    document.querySelector('[data-tab="files"]').click();
    $('fileName').textContent=file;
    document.querySelectorAll('[data-file]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.file===file)));
    const url=`/api/public/projects/${enc(projectId)}/sessions/${enc(detail.session.id)}/file?version=${version}&path=${enc(file)}`;
    $('downloadFile').href=url;$('downloadFile').hidden=false;$('filePreview').textContent='Loading…';
    try{
      const response=await fetch(url,{cache:'no-store'});
      if(!response.ok)throw Error('This published file is no longer available.');
      const blob=await response.blob();
      if(current!==generation)return;
      const ext=file.split('.').pop().toLowerCase();
      const imageType={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[ext];
      if(imageType){
        const img=document.createElement('img');img.alt=file;
        objectUrl=URL.createObjectURL(new Blob([blob],{type:imageType}));img.src=objectUrl;
        $('filePreview').replaceChildren(img);
      }else if(ext==='pdf'){
        const pdfjs=await import('/openconstruction-web/desktop/vendor/pdfjs/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc='/openconstruction-web/desktop/vendor/pdfjs/build/pdf.worker.mjs';
        const task=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false});
        try{
          const pdf=await task.promise;
          if(current!==generation)return;
          const container=document.createElement('div');
          // Bounded preview prevents untrusted documents consuming unlimited memory.
          for(let n=1;n<=Math.min(pdf.numPages,5);n++){
            const page=await pdf.getPage(n),size=page.getViewport({scale:1});
            const viewport=page.getViewport({scale:Math.min(1.3,1400/size.width,1800/size.height)});
            const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
            await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;container.append(canvas);page.cleanup();
            if(current!==generation)return;
          }
          if(pdf.numPages>5){const note=document.createElement('p');note.textContent='First 5 pages shown. Download for the complete document.';container.append(note);}
          $('filePreview').replaceChildren(container);
        }finally{await task.destroy();}
      }else if(/\.(pt|pth|zip|gz|tar|onnx|bin|pkl|npy|npz)$/i.test(file)){
        $('filePreview').textContent='Binary artifact — use the download icon.';
      }else{
        await render({body:$('filePreview'),blob,name:file.split('/').pop(),session:detail.session.id,path:file,version:`release-${version}`,isCurrent:()=>current===generation,renderMarkdown:markdown,readOnlyLabel:'Read only'});
      }
    }catch(error){if(current===generation)$('filePreview').textContent=error.message;}
  }
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
    const agents=b.dataset.tab==='agents';
    $('agentPanel').hidden=!agents;$('filePanel').hidden=agents;
    document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  });
  $('filterFiles').oninput=()=>{
    const query=$('filterFiles').value.toLowerCase();
    document.querySelectorAll('[data-file]').forEach(b=>{b.hidden=!b.dataset.file.toLowerCase().includes(query);});
    document.querySelectorAll('#releaseFiles details').forEach(folder=>{folder.hidden=!folder.querySelector('[data-file]:not([hidden])');if(query)folder.open=true;});
  };
  $('releaseFiles').onclick=event=>{const b=event.target.closest('[data-file]');if(b&&detail)void preview(b.dataset.file);};
  $('releaseVersion').onchange=()=>{location.href=`/projects/${enc(projectId)}?version=${$('releaseVersion').value}`;};
  $('releaseVersion').disabled=false;
  let requestKey=crypto.randomUUID();
  $('copyProject').onclick=async()=>{
    const button=$('copyProject');button.disabled=true;notice('Creating a private copy…');
    try{
      const copy=await request(`/api/platform/projects/${enc(projectId)}/fork`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:Number(version),requestKey})});
      const sessions=await request(`/api/research/projects/${enc(copy.projectId)}/sessions`);
      localStorage.setItem('oc.desktop.selection',JSON.stringify({projectId:copy.projectId,sessionId:sessions[0]?.id||''}));
      location.href='/openconstruction-web/research.html';
    }catch(error){
      if(error.status===401){location.href='/openconstruction-web/web/login.html?next='+enc(location.pathname+location.search);return;}
      notice(error.message);button.disabled=false;
    }
  };
  $('copyProject').disabled=false;
  try{
    detail=await request(`/api/public/projects/${enc(projectId)}?version=${version}`);
    const folders=new Map([['',$('releaseFiles')]]);
    $('releaseFiles').replaceChildren();
    for(const f of detail.files){
      const parts=f.path.split('/');let key='';
      for(const part of parts.slice(0,-1)){
        const next=key?key+'/'+part:part;
        if(!folders.has(next)){
          const folder=document.createElement('details');folder.open=true;
          const heading=document.createElement('summary');heading.textContent=part;folder.append(heading);
          folders.get(key).append(folder);folders.set(next,folder);
        }
        key=next;
      }
      const button=document.createElement('button');button.dataset.file=f.path;button.title=f.path;button.textContent=parts.at(-1);
      folders.get(key).append(button);
    }
    const initial=detail.files.find(f=>/^readme\.md$/i.test(f.path))||detail.files[0];
    if(initial)await preview(initial.path);
  }catch(error){notice(error.message);}
  // An owner/editor/viewer may open the same project's authenticated workspace.
  // Anonymous visitors never receive its private configuration or conversations.
  try{
    const {access}=await request(`/api/platform/projects/${enc(projectId)}/sharing`);
    if(access.role){
      $('openDraft').hidden=false;$('openDraft').href='/openconstruction-web/research.html';
      $('openDraft').textContent=access.canEdit?'Open draft workspace':'Open shared workspace';
      $('openDraft').onclick=async event=>{
        event.preventDefault();
        try{
          const sessions=await request(`/api/research/projects/${enc(projectId)}/sessions`);
          localStorage.setItem('oc.desktop.selection',JSON.stringify({projectId,sessionId:sessions[0]?.id||''}));
          location.href='/openconstruction-web/research.html';
        }catch(error){notice(error.message);}
      };
    }
  }catch{}
}
