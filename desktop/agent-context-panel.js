/* Read-only presentation of recorded OC model input. Never assembles or sends a prompt. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count=value=>Number.isFinite(value)?value>=1000000?(value/1000000).toFixed(2)+'M':value>=1000?(value/1000).toFixed(1)+'k':String(value):'Unknown';
  const colors={system:'#d49b22',messages:'#3283df',tools:'#d97b43',mcp:'#18a38b',skills:'#8a76b7',memory:'#6f8758',data:'#8c9299'};
  const percent=(value,total)=>total>0?Math.max(0,Math.min(100,value/total*100)):0;
  const chosen=entry=>`${entry.timestamp?new Date(entry.timestamp).toLocaleString():'Capture #'+(entry.sequence??'?')} · turn ${entry.turn??'?'} · ${(entry.requestExecutionId||entry.runId||entry.id).slice(0,12)}`;
  function render(session) {
    const data=session.contextResult,snapshot=data?.snapshot;
    const top=`<div class="oc-ci-heading"><div><h3>Context Inspector</h3><p>Recorded model input · read only</p></div><button type="button" data-context-refresh ${session.contextLoading?'disabled':''}>${session.contextLoading?'Loading…':'Refresh'}</button></div>`;
    if(session.contextError)return top+`<p role="alert" class="oc-ci-error">${esc(session.contextError)}</p>`;
    if(!data)return top+'<p class="oc-ae-help" role="status">Reading captured invocations…</p>';
    if(!snapshot)return top+'<div class="oc-ci-empty"><strong>No captured input yet</strong><p>This agent has no readable model-input snapshot. A future agent run can create one; opening this inspector does not start a run.</p></div>';
    const capacity=snapshot.capacityTokens,used=snapshot.estimatedInputTokens,reserve=snapshot.outputReserveTokens;
    const categoryRows=snapshot.categories.map(row=>`<details class="oc-ci-category"><summary><span><i style="--ci-color:${colors[row.id]||'#8c9299'}"></i>${esc(row.label)} <small>${row.count} ${row.count===1?'item':'items'}</small></span><span>≈ ${count(row.estimatedTokens)}</span><span>${capacity?(row.estimatedTokens/capacity*100).toFixed(1)+'%':'—'}</span></summary><div class="oc-ci-items">${row.items.map(item=>`<details><summary>${esc(item.label)} <small>≈ ${count(item.estimatedTokens)} tokens</small></summary><p class="oc-ae-help">Source: ${esc(item.source)}</p>${item.preview?`<pre>${esc(item.preview)}</pre>`:'<p class="oc-ae-help">Preview omitted to keep this response bounded.</p>'}${item.truncated?'<small>Preview shortened; the estimate covers the captured item.</small>':''}</details>`).join('')||'<p class="oc-ae-help">No items in this captured input.</p>'}${row.count>row.items.length?'<p class="oc-ae-help">Additional items are included in the total; their previews are omitted.</p>':''}</div></details>`).join('');
    const bar=snapshot.categories.map(row=>`<span style="width:${percent(row.estimatedTokens,capacity)}%;background:${colors[row.id]||'#8c9299'}"></span>`).join('')+(reserve?`<span style="width:${percent(reserve,capacity)}%;background:#bbc2b6"></span>`:'');
    return top+`<label class="oc-ae-field">Captured invocation<select data-context-entry ${session.contextLoading?'disabled':''}>${data.entries.map(entry=>`<option value="${esc(entry.id)}" ${entry.id===data.selected?.id?'selected':''}>${esc(chosen(entry))}</option>`).join('')}</select></label>
      <p class="oc-ae-help">This is a saved invocation, not a preview of unsaved edits or the next run.</p>
      <div class="oc-ci-card"><div class="oc-ci-total"><strong>≈ ${count(used)} input tokens</strong><span>${capacity?count(capacity):'Unknown'} ${snapshot.capacityBasis==='recorded_model'?'model window':snapshot.capacityBasis==='runtime_budget'?'runtime budget':'capacity'}</span></div>
      ${capacity?`<div class="oc-ci-bar" role="img" aria-label="Estimated OC input, reserved output and remaining capacity">${bar}</div>`:''}
      ${snapshot.overBudget?'<p class="oc-ci-error">Estimated input and reserved output exceed this captured budget.</p>':''}
      <p class="oc-ci-model">${esc(snapshot.model)} · estimates, not billing usage</p>${categoryRows}
      <div class="oc-ci-row"><span>Reserved output</span><span>${count(reserve)}</span></div><div class="oc-ci-row"><span>Estimated remaining</span><span>${count(snapshot.estimatedFreeTokens)}</span></div>
      <div class="oc-ci-row"><span>Provider wrapper overhead</span><span>Unknown</span></div></div>
      <details class="oc-ci-deferred"><summary>Deferred / unloaded tools <span>${snapshot.deferred.count}</span></summary><p class="oc-ae-help">${snapshot.deferred.estimatedTokens===null?'Definition token cost not recorded.':'≈ '+count(snapshot.deferred.estimatedTokens)+' definition tokens.'} Excluded from the input estimate above.</p><pre>${esc(snapshot.deferred.names.join('\n')||'None recorded.')}</pre></details>
      ${snapshot.mediaTokensUnknown?'<p class="oc-ci-error">This input contains media. Image/audio token costs are unknown and excluded from this text estimate.</p>':''}
      ${snapshot.opaqueTokensUnknown?'<p class="oc-ae-help">Opaque provider state is omitted. Its token cost is unknown.</p>':''}
      <details><summary>Compaction & measurement notes</summary><p>Pruned tool results: ${esc(snapshot.compaction.prunedToolResults??'Not recorded')} · summarized messages: ${esc(snapshot.compaction.summarizedMessages??'Not recorded')}</p><p>${esc(snapshot.compaction.reason||'No compaction reason recorded.')}</p>${snapshot.notes.map(note=>`<p class="oc-ae-help">${esc(note)}</p>`).join('')}<p class="oc-ae-help">${esc(snapshot.boundary)} · ${esc(snapshot.estimator)}</p></details>
      ${(data.warnings||[]).map(warning=>`<p class="oc-ae-help">${esc(warning)}</p>`).join('')}`;
  }
  window.OCAgentContextPanel={render};
})();
