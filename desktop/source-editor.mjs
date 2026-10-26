import {basicSetup,EditorView} from 'codemirror';
import {EditorState} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {LanguageDescription,StreamLanguage} from '@codemirror/language';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {json} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {markdown} from '@codemirror/lang-markdown';
import {yaml} from '@codemirror/lang-yaml';
import {sql} from '@codemirror/lang-sql';
import {cpp} from '@codemirror/lang-cpp';
import {java} from '@codemirror/lang-java';
import {rust} from '@codemirror/lang-rust';
import {xml} from '@codemirror/lang-xml';
import {shell} from '@codemirror/legacy-modes/mode/shell';
import {r} from '@codemirror/legacy-modes/mode/r';

const languages=[
  ['JavaScript',['js','jsx','mjs','cjs'],()=>javascript({jsx:true})],
  ['TypeScript',['ts','tsx'],()=>javascript({typescript:true,jsx:true})],
  ['Python',['py','pyw'],python],['JSON',['json','ipynb'],json],
  ['HTML',['html','htm'],html],['CSS',['css'],css],['Markdown',['md','markdown'],markdown],
  ['YAML',['yaml','yml'],yaml],['SQL',['sql'],sql],['C/C++',['c','h','cpp','hpp','cc'],cpp],
  ['Java',['java'],java],['Rust',['rs'],rust],['XML',['xml','svg'],xml],
  ['Shell',['sh','bash','zsh'],()=>StreamLanguage.define(shell)],['R',['r'],()=>StreamLanguage.define(r)],
].map(([name,extensions,load])=>LanguageDescription.of({name,extensions,load:async()=>load()}));
let current;
const drafts=new Map();
const LIMIT=1024*1024;
export function close(force=false){
  if(!current)return true;
  if(current.busy&&!force)return false;
  if(current.dirty()){
    if(!force&&!confirm('Discard unsaved edits to this file?'))return false;
    if(force)drafts.set(current.key,current.draft());
    else drafts.delete(current.key);
  }
  current.view.destroy();current=null;return true;
}
window.addEventListener('beforeunload',event=>{if(current?.dirty()||current?.busy||drafts.size){event.preventDefault();event.returnValue='';}});
export async function render({body,blob,name,session,path,version,isCurrent,renderMarkdown,readOnlyLabel}){
  const key=session+':'+(version||path);
  let text,revision,canEdit=false,warning='';
  if(!version&&window.OCDesktop?.readWorkspaceText){
    try{const result=await window.OCDesktop.readWorkspaceText({sessionId:session,path});text=result.content;revision=result.revision;canEdit=result.canEdit;}
    catch(error){warning=error.message;}
  }
  if(!isCurrent())return;
  if(text===undefined){
    const bytes=await blob.slice(0,LIMIT).arrayBuffer();
    try{if(new Uint8Array(bytes).includes(0))throw new Error();text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
    catch{body.textContent='This is not UTF-8 text. Download the file to inspect it.';return;}
    warning=warning||(blob.size>LIMIT?'Preview truncated to 1 MiB. Download the full file.':version?(readOnlyLabel??'Historical artifact versions are read-only. Open the working file to edit.'):'Read-only preview.');
  }
  if(!isCurrent())return;
  const language=LanguageDescription.matchFilename(languages,name.toLowerCase());
  const support=language?await language.load():[];
  if(!isCurrent())return;
  const bom=text.startsWith('\uFEFF')?'\uFEFF':'',eol=text.includes('\r\n')?'\r\n':'\n';
  let baseline=text;
  const toolbar=document.createElement('span');toolbar.className='oc-source-toolbar';toolbar.dataset.sourceTools='';
  body.closest('[data-chat-preview]')?.querySelector('[data-source-tools]')?.remove();
  const status=document.createElement('p');status.className='oc-source-status';status.setAttribute('role','status');
  const host=document.createElement('div');host.className='oc-source-editor';
  const preview=document.createElement('div');preview.className='oc-chat-markdown';preview.hidden=true;
  host.title=(language?.name||'Plain text')+' · UTF-8';
  body.replaceChildren(status,host,preview);
  const actions=body.closest('[data-chat-preview]')?.querySelector('[data-chat-preview-actions]');
  if(actions)actions.insertBefore(toolbar,actions.querySelector('[data-chat-close]'));else body.prepend(toolbar);
  const icons={
    Save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    'Reload file':'<path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 0-2.3 5.7M20 7v5"/>',
    'Preview / Source':'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  };
  const button=(text,action)=>{const b=document.createElement('button');b.type='button';b.className='oc-preview-icon';b.setAttribute('aria-label',text);b.title=text;b.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[text]}</svg>`;b.addEventListener('click',action);toolbar.append(b);return b;};
  let state;
  const content=()=>bom+view.state.doc.toString().replace(/\n/g,eol);
  const update=()=>{
    const dirty=content()!==baseline;
    save.disabled=!canEdit||!dirty||state?.busy;
    reload.disabled=!!state?.busy;
    status.textContent=warning||(state?.busy?'Saving…':dirty?'Unsaved changes':canEdit?'':'Read-only');
    status.hidden=!status.textContent;
  };
  async function saveFile(){
    if(!canEdit||state.busy||!state.dirty())return;
    const submitted=content();
    if(new TextEncoder().encode(submitted).length>LIMIT){warning='The editor supports files up to 1 MiB.';update();return;}
    state.busy=true;warning='';update();
    try{
      const result=await window.OCDesktop.saveWorkspaceText({sessionId:session,path,content:submitted,revision});
      revision=result.revision;baseline=submitted;
      const pending=drafts.get(key);
      if(current!==state&&pending&&pending.content!==submitted)drafts.set(key,{...pending,revision,baseline});else drafts.delete(key);
      window.dispatchEvent(new CustomEvent('oc-workspace-file-saved',{detail:{sessionId:session,path}}));
    }catch(error){warning=error.message+' Your edits are still here.';}
    finally{state.busy=false;if(current===state)update();}
  }
  const save=button('Save',()=>void saveFile());save.dataset.sourceSave='';save.hidden=!canEdit;
  const reload=button('Reload file',async()=>{
    if(state.busy||state.dirty()&&!confirm('Discard your edits and reload the latest file?'))return;
    try{
      const latest=await window.OCDesktop.readWorkspaceText({sessionId:session,path});
      if(current!==state)return;
      close(true);drafts.delete(key);
      await render({body,blob:new Blob([latest.content],{type:'text/plain'}),name,session,path,version,isCurrent,renderMarkdown});
    }catch(error){warning=error.message;update();}
  });
  reload.hidden=!!version||!window.OCDesktop?.readWorkspaceText;
  if(/\.(md|markdown)$/i.test(name)){
    const toggle=button('Preview / Source',()=>{
    preview.hidden=!preview.hidden;host.hidden=!preview.hidden;
    toggle.setAttribute('aria-pressed',String(!preview.hidden));
    if(!preview.hidden)preview.innerHTML=renderMarkdown(content());else view.requestMeasure();
    });
    toggle.setAttribute('aria-pressed',String(!canEdit));
  }
  const view=new EditorView({parent:host,doc:text.slice(bom.length).replace(/\r\n/g,'\n'),extensions:[
    basicSetup,support,EditorState.readOnly.of(!canEdit),EditorView.editable.of(canEdit),
    EditorView.contentAttributes.of({'aria-label':'File source editor',tabindex:'0'}),
    keymap.of([{key:'Mod-s',run:()=>{void saveFile();return true;}}]),
    EditorView.updateListener.of(change=>{if(change.docChanged)update();}),
    EditorView.theme({'&':{height:'55vh',fontSize:'13px'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{backgroundColor:'#f4f7fa',color:'#64748b'}}),
  ]});
  state={key,view,busy:false,dirty:()=>content()!==baseline,draft:()=>({content:content(),revision,baseline})};current=state;
  if(/\.(md|markdown)$/i.test(name)&&!canEdit){preview.hidden=false;host.hidden=true;preview.innerHTML=renderMarkdown(text);}
  const draft=drafts.get(key);
  if(draft&&canEdit){
    baseline=draft.baseline;revision=draft.revision;
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:draft.content.slice(bom.length).replace(/\r\n/g,'\n')}});
    warning='Your unsaved draft was restored. Save when ready; newer file changes will not be overwritten.';
  }
  update();
}
window.OCSourceEditor={render,close};
