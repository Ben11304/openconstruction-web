(() => {
  let dialog, serial=0, objectUrl;
  function close(){
    serial++;window.OCDesktopPDF?.close();
    if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;
    if(dialog?.open)dialog.close();
  }
  async function open(selection){
    close();const version=serial;
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='oc-chat-preview';dialog.dataset.datasetPreview='';
      dialog.innerHTML='<header><strong data-dataset-title></strong><button type="button" data-dataset-close>Close</button></header><div class="oc-dataset-preview-meta"><span data-dataset-meta>Shared dataset · Read-only</span><button type="button" data-dataset-reveal>Reveal in Finder</button></div><div data-dataset-body></div>';
      document.body.append(dialog);
      dialog.querySelector('[data-dataset-close]').onclick=close;
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    }
    dialog.querySelector('[data-dataset-title]').textContent=selection.datasetId+' / '+selection.path;
    const body=dialog.querySelector('[data-dataset-body]');body.textContent='Loading preview…';
    dialog.querySelector('[data-dataset-meta]').textContent='Shared dataset · Read-only';
    dialog.querySelector('[data-dataset-reveal]').onclick=()=>{void window.OCDesktop.revealWorkspacePath(selection).catch(error=>{body.textContent=error.message;});};
    dialog.showModal();
    try{
      const file=await window.OCDesktop.datasetPreview(selection);if(version!==serial)return;
      body.replaceChildren();dialog.querySelector('[data-dataset-meta]').textContent='Read-only · '+file.size.toLocaleString()+' bytes';
      if(file.text!==undefined){
        const pre=document.createElement('pre');pre.textContent=file.text;body.append(pre);
        if(file.truncated){const note=document.createElement('p');note.textContent='Preview shows the first 1 MiB. Use Reveal in Finder to inspect the full file.';body.prepend(note);}
      }else if(file.data){
        const blob=new Blob([file.data],{type:file.mime});
        if(file.mime==='application/pdf'&&window.OCDesktopPDF)await window.OCDesktopPDF.render(blob,body,()=>version===serial);
        else if(file.mime.startsWith('image/')){objectUrl=URL.createObjectURL(blob);const img=document.createElement('img');img.src=objectUrl;img.alt=file.name;body.append(img);}
        else body.textContent='Preview is unavailable for this file. Use Reveal in Finder to inspect it.';
      }else body.textContent='Preview is unavailable for this file type or size. Use Reveal in Finder to inspect it.';
    }catch(error){if(version===serial)body.textContent=error.message;}
  }
  window.OCDesktopDatasetPreview={open,close};
  window.addEventListener('pagehide',close);
})();
