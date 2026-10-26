// Copyright (c) 2024-2026 OpenConstruction Open Science Initiative
// SPDX-License-Identifier: Apache-2.0

(function(){
  function init(){
  const filterPanel = document.querySelector('.oc-search-filters');
  if (filterPanel && !document.getElementById('searchModalityText')) {
    const taskGroup = document.getElementById('searchFacetText')?.closest('.oc-search-filter-group');
    const yearGroup = document.getElementById('searchYearMin')?.closest('.oc-search-filter-group');
    const modalityMarkup = '<div class="oc-search-filter-group"><label class="form-label oc-search-filter-label" for="searchModalityText">Modalities</label><input id="searchModalityText" class="form-control form-control-sm mb-2 oc-search-filter-input" type="search" placeholder="Search for modalities..." autocomplete="off"><div id="searchModalityOptions" class="facet-list"></div></div>';
    const licenseMarkup = '<div class="oc-search-filter-group"><label class="form-label oc-search-filter-label" for="searchLicenseText">Licenses</label><input id="searchLicenseText" class="form-control form-control-sm mb-2 oc-search-filter-input" type="search" placeholder="Search for licenses..." autocomplete="off"><div id="searchLicenseOptions" class="facet-list"></div></div>';
    if (taskGroup) taskGroup.insertAdjacentHTML('beforebegin', modalityMarkup); else filterPanel.insertAdjacentHTML('beforeend', modalityMarkup);
    if (yearGroup) yearGroup.insertAdjacentHTML('beforebegin', licenseMarkup); else filterPanel.insertAdjacentHTML('beforeend', licenseMarkup);
  }
  const makeCollapsible = (inputId, title, open) => {
    const inputElement = document.getElementById(inputId);
    const group = inputElement?.closest('.oc-search-filter-group');
    if (!group || group.tagName.toLowerCase() === 'details') return;
    const label = group.querySelector('label');
    const details = document.createElement('details');
    details.className = 'oc-search-filter-group oc-search-filter-collapsible';
    details.open = open;
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${title}</span><span class="oc-search-filter-toggle" aria-hidden="true"></span>`;
    details.appendChild(summary);
    Array.from(group.childNodes).forEach(node => { if (node !== label) details.appendChild(node); });
    group.replaceWith(details);
  };
  makeCollapsible('searchModalityText', 'Modalities', false);
  makeCollapsible('searchFacetText', 'Tasks', false);
  makeCollapsible('searchLicenseText', 'Licenses', false);
  const taskLabel = document.querySelector('label[for="searchFacetText"]');
  if (taskLabel) taskLabel.textContent = 'Tasks';
  const existingResultsShell = document.getElementById('unifiedSearchResultsShell');
  if (existingResultsShell && !document.getElementById('searchPagination')) existingResultsShell.insertAdjacentHTML('beforeend', '<nav id="searchPagination" class="oc-search-pagination" aria-label="Search result pages"></nav>');
  const input = document.getElementById('unifiedSearchInput') || document.getElementById('ocHeaderSearchInput');
  const form = document.getElementById('unifiedSearchForm') || input?.form;
  const resultsRoot = document.getElementById('unifiedSearchResults');
  const status = document.getElementById('unifiedSearchStatus');
  const resultsShell = document.getElementById('unifiedSearchResultsShell');
  const suggestionsRoot = document.getElementById('unifiedSearchSuggestions');
  const typeFilters = document.getElementById('searchTypeFilters');
  const facetTextInput = document.getElementById('searchFacetText');
  const yearMinInput = document.getElementById('searchYearMin');
  const yearMaxInput = document.getElementById('searchYearMax');
  const yearMinValue = document.getElementById('searchYearMinVal');
  const yearMaxValue = document.getElementById('searchYearMaxVal');
  const yearSelected = document.getElementById('searchYearSelected');
  const facetOptions = document.getElementById('searchFacetOptions');
  const modalityTextInput = document.getElementById('searchModalityText');
  const modalityOptions = document.getElementById('searchModalityOptions');
  const licenseTextInput = document.getElementById('searchLicenseText');
  const licenseOptions = document.getElementById('searchLicenseOptions');
  const paginationRoot = document.getElementById('searchPagination');
  const sortInput = document.getElementById('searchSort');
  const clearFiltersButton = document.getElementById('clearSearchFilters');
  if (!input || !form || !resultsRoot) return;
  const avatarFallback = 'assets/img/contributors/avatar.png';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const text = value => Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : String(value || '').trim();
  const normalize = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = value => Array.isArray(value) ? value.flatMap(item => list(item)) : value == null ? [] : [text(value)];
  const firstText = (...values) => values.map(text).find(Boolean) || '';
  const previewImage = row => {
    const media = Array.isArray(row?.media) ? row.media : [];
    const mediaImage = media.find(item => typeof item === 'string' || item?.type === 'image' || item?.url || item?.src);
    return firstText(row?.image_url, row?.image, row?.thumbnail, mediaImage?.url, mediaImage?.src, typeof mediaImage === 'string' ? mediaImage : '');
  };
  const previewTags = row => [...new Set([
    ...list(row?.data_modality), ...list(row?.potential_tasks), ...list(row?.tasks), ...list(row?.task),
    ...list(row?.applications), ...list(row?.modalities), ...list(row?.topics), ...list(row?.tags), ...list(row?.classes)
  ].map(text).filter(Boolean))].slice(0, 5);
  const facetValues = (...values) => [...new Set(values.flatMap(list).map(text).filter(Boolean))];
  const rowModalities = row => facetValues(row?.data_modality, row?.data_modalities, row?.modality, row?.modalities);
  const rowLicenses = row => facetValues(row?.license, row?.licence, row?.license_name, row?.licence_name);
  const authors = row => {
    const values = [];
    if (Array.isArray(row?.authors)) values.push(...row.authors.map(item => text(item?.name || item)));
    else if (row?.authors) values.push(...text(row.authors).split(/[,;]+/));
    ['author','contributors','contributor','provider','creator','publisher'].forEach(field => {
      if (Array.isArray(row?.[field])) values.push(...row[field].map(item => text(item?.name || item)));
      else if (row?.[field]) values.push(text(row[field]));
    });
    return [...new Set(values.map(text).filter(Boolean))];
  };
  const rowsFrom = (type, payload) => {
    if (type === 'dataset' && payload && !Array.isArray(payload)) return Object.entries(payload).map(([id, row]) => ({id: row?.id || id, ...(row || {})}));
    if (type === 'oer') return Array.isArray(payload?.resources) ? payload.resources : [];
    if (type === 'workflow') return Array.isArray(payload?.use_cases) ? payload.use_cases : [];
    return Array.isArray(payload) ? payload : [];
  };
  const hrefFor = (type, row) => {
    const id = encodeURIComponent(text(row?.id || row?.name || row?.title));
    return type === 'dataset' ? `datasets/detail.html?id=${id}` : type === 'model' ? `models/details.html?id=${id}` : type === 'oer' ? `oers/details.html?id=${id}` : `workflows/details.html?id=${id}`;
  };
  const parseYear = value => {
    const match = text(value).match(/\b(19|20)\d{2}\b/);
    const year = match ? Number(match[0]) : null;
    return year && year >= 1900 && year <= new Date().getFullYear() + 1 ? year : null;
  };
  const resourceRecords = (type, payload) => rowsFrom(type, payload).map(row => {
    const title = text(row?.title || row?.name || row?.id || 'Catalog resource');
    const authorText = authors(row).join(' ');
    return {kind:'resource', type, id:text(row?.id || row?.name || row?.title), title, meta:authorText || 'OpenConstruction catalog resource', description:firstText(row?.description, row?.abstract, row?.summary, row?.notes, row?.paper_title), tags:previewTags(row), modalities:rowModalities(row), licenses:rowLicenses(row), image:previewImage(row), year:parseYear(row?.year || row?.publication_year || row?.release_year), href:hrefFor(type, row), haystack:normalize(`${title} ${authorText} ${JSON.stringify(row)}`)};
  });
  let catalogRecords = [];
  let catalogPeople = [];
  let staticContributors = [];
  async function loadCatalog(){
    const requests = [['dataset','data/datasets.json'],['model','data/models.json'],['oer','data/oer.json'],['workflow','data/use-cases.json']].map(async ([type, url]) => {
      try { const response = await fetch(url, {cache:'no-store'}); return [type, response.ok ? await response.json() : null]; } catch { return [type, null]; }
    });
    const values = await Promise.all(requests);
    catalogRecords = values.flatMap(([type, payload]) => resourceRecords(type, payload));
    const people = new Map();
    values.forEach(([type, payload]) => rowsFrom(type, payload).forEach(row => authors(row).forEach(name => {
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (key && !people.has(key)) people.set(key, {name, type});
    })));
    catalogPeople = Array.from(people.values());
    try { const response = await fetch('data/contributors.json', {cache:'no-store'}); staticContributors = response.ok ? await response.json() : []; } catch { staticContributors = []; }
  }
  async function loadPublicMembers(query){
    const client = window.OCAuth?.getClient?.();
    if (!client) return [];
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const [names, affiliations] = await Promise.all([
      client.from('profiles').select('user_id,display_name,affiliation,avatar_url,catalog_profile_id').eq('public_profile', true).is('merged_into_user_id', null).ilike('display_name', pattern).limit(12),
      client.from('profiles').select('user_id,display_name,affiliation,avatar_url,catalog_profile_id').eq('public_profile', true).is('merged_into_user_id', null).ilike('affiliation', pattern).limit(12)
    ]);
    const map = new Map();
    [...(names.data || []), ...(affiliations.data || [])].forEach(row => {
      const key = normalize(row.display_name || row.user_id);
      const previous = map.get(key);
      if (!previous || (row.catalog_profile_id && !previous.catalog_profile_id)) map.set(key, row);
    });
    return Array.from(map.values()).map(row => ({kind:'member', type:'Contributor', id:row.user_id, catalogProfileId:row.catalog_profile_id || '', title:row.display_name || 'OpenConstruction member', meta:row.affiliation || '', description:'', tags:[], image:row.avatar_url || '', year:null, href:row.catalog_profile_id ? `profile.html?person=${encodeURIComponent(row.catalog_profile_id)}` : `profile.html?user=${encodeURIComponent(row.user_id)}`, haystack:normalize(`${row.display_name || ''} ${row.affiliation || ''}`)}));
  }
  function contributorRecords(){
    const records = new Map();
    (Array.isArray(staticContributors) ? staticContributors : []).forEach((row, index) => {
      const title = text(row?.name || row?.id);
      if (!title) return;
      records.set(normalize(title).replace(/[^a-z0-9]+/g, ' ').trim(), {kind:'contributor', type:'Contributor', catalogProfileId:text(row?.id), title, meta:text(row?.affiliation), image:firstText(row?.image, row?.image_url, row?.avatar_url), year:null, addedSort:index + 1, href:`profile.html?person=${encodeURIComponent(text(row?.id || title))}`, haystack:normalize(`${title} ${row?.affiliation || ''} ${row?.role || ''}`)});
    });
    catalogPeople.forEach(person => {
      const title = text(person.name);
      const key = normalize(title).replace(/[^a-z0-9]+/g, ' ').trim();
      if (!title || records.has(key)) return;
      records.set(key, {kind:'contributor', type:'Contributor', catalogProfileId:normalize(title).replace(/[^a-z0-9]+/g, '-'), title, meta:'', year:null, addedSort:0, href:`profile.html?person=${encodeURIComponent(normalize(title).replace(/[^a-z0-9]+/g, '-'))}`, haystack:normalize(title)});
    });
    return Array.from(records.values());
  }
  function score(record, terms){
    const title = normalize(record.title);
    return (title === terms.join(' ') ? 50 : 0) + (title.startsWith(terms[0]) ? 20 : 0) + terms.reduce((total, term) => total + (record.haystack.includes(term) ? 1 : 0), 0);
  }
  const typeLabels = {dataset:'Dataset', model:'Model', workflow:'Workflow', oer:'OER', Contributor:'Community members'};
  const typeOrder = ['dataset', 'model', 'workflow', 'oer', 'Contributor'];
  const filterState = {types:new Set(), text:'', modalities:new Set(), licenses:new Set(), minYear:'', maxYear:'', sort:'relevance', page:1};
  const facetExpanded = {tasks:false, modalities:false, licenses:false};
  const pageSize = 30;
  let matchedRecords = [];
  let activeQuery = '';
  function renderTypeFilters(records){
    if (!typeFilters) return;
    const counts = new Map(typeOrder.map(type => [type, records.filter(record => record.type === type).length]));
    typeFilters.innerHTML = typeOrder.map(type => {
      const checked = filterState.types.has(type);
      const count = counts.get(type) || 0;
      return `<label class="form-check oc-search-filter-option${count || checked ? '' : ' is-disabled'}"><input class="form-check-input" type="checkbox" value="${esc(type)}"${checked ? ' checked' : ''}${count || checked ? '' : ' disabled'}><span class="form-check-label">${esc(typeLabels[type])}</span><span class="oc-search-filter-count">${count}</span></label>`;
    }).join('');
    typeFilters.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', () => {
      if (input.checked) filterState.types.add(input.value); else filterState.types.delete(input.value);
      filterState.page = 1;
      renderFilteredResults();
    }));
  }
  function renderFacetOptions(records){
    if (!facetOptions) return;
    const counts = new Map();
    records.flatMap(record => record.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
    const options = Array.from(counts.entries()).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const visible = facetExpanded.tasks ? options : options.slice(0, 6);
    facetOptions.innerHTML = visible.map(([tag, count]) => `<label class="form-check oc-search-filter-option"><input class="form-check-input" type="checkbox" value="${esc(tag)}"><span class="form-check-label">${esc(tag)}</span><span class="oc-search-filter-count">${count}</span></label>`).join('');
    facetOptions.parentElement?.querySelector('[data-search-facet-more="tasks"]')?.remove();
    if (options.length > visible.length) facetOptions.insertAdjacentHTML('afterend', '<button type="button" class="oc-search-facet-more" data-search-facet-more="tasks">Show all</button>');
    facetOptions.parentElement?.querySelector('[data-search-facet-more="tasks"]')?.addEventListener('click', () => { facetExpanded.tasks = !facetExpanded.tasks; renderFacetOptions(records); });
    facetOptions.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', () => {
      const selected = Array.from(facetOptions.querySelectorAll('input:checked')).map(item => item.value);
      filterState.text = selected.join(' ');
      if (facetTextInput) facetTextInput.value = filterState.text;
      filterState.page = 1;
      renderFilteredResults();
    }));
  }
  function renderValueFacet(records, field, input, container, selectedSet){
    if (!container) return;
    const query = normalize(input?.value || '');
    const values = new Map();
    records.flatMap(record => record[field] || []).forEach(value => {
      const label = text(value);
      const key = normalize(label);
      if (!key) return;
      const current = values.get(key) || {label, count:0};
      current.count += 1;
      values.set(key, current);
    });
    const options = Array.from(values.entries())
      .filter(([, item]) => !query || normalize(item.label).includes(query))
      .sort((a,b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));
    const facetKey = field === 'modalities' ? 'modalities' : 'licenses';
    const visible = facetExpanded[facetKey] || query ? options : options.slice(0, 6);
    container.innerHTML = visible.map(([key, item]) => `<label class="form-check oc-search-filter-option"><input class="form-check-input" type="checkbox" value="${esc(key)}"${selectedSet.has(key) ? ' checked' : ''}><span class="form-check-label">${esc(item.label)}</span><span class="oc-search-filter-count">${item.count}</span></label>`).join('');
    container.parentElement?.querySelector(`[data-search-facet-more="${facetKey}"]`)?.remove();
    if (options.length > visible.length && !query) container.insertAdjacentHTML('afterend', `<button type="button" class="oc-search-facet-more" data-search-facet-more="${facetKey}">Show all</button>`);
    container.parentElement?.querySelector(`[data-search-facet-more="${facetKey}"]`)?.addEventListener('click', () => { facetExpanded[facetKey] = !facetExpanded[facetKey]; renderValueFacet(records, field, input, container, selectedSet); });
    container.querySelectorAll('input[type="checkbox"]').forEach(control => control.addEventListener('change', () => {
      if (control.checked) selectedSet.add(control.value); else selectedSet.delete(control.value);
      filterState.page = 1;
      renderFilteredResults();
    }));
  }
  function renderAdditionalFacets(records){
    renderValueFacet(records, 'modalities', modalityTextInput, modalityOptions, filterState.modalities);
    renderValueFacet(records, 'licenses', licenseTextInput, licenseOptions, filterState.licenses);
  }
  function updateYearRange(records){
    if (!yearMinInput || !yearMaxInput) return;
    const currentYear = new Date().getFullYear();
    const years = records.map(record => Number(record.year)).filter(year => Number.isInteger(year) && year >= 1900 && year <= currentYear + 1);
    const min = years.length ? Math.min(...years) : 2000;
    const max = years.length ? Math.max(...years) : new Date().getFullYear();
    yearMinInput.min = String(min);
    yearMinInput.max = String(max);
    yearMaxInput.min = String(min);
    yearMaxInput.max = String(max);
    if (!filterState.minYear || Number(filterState.minYear) < min) filterState.minYear = String(min);
    if (!filterState.maxYear || Number(filterState.maxYear) > max) filterState.maxYear = String(max);
    yearMinInput.value = filterState.minYear;
    yearMaxInput.value = filterState.maxYear;
    if (yearMinValue) yearMinValue.textContent = filterState.minYear;
    if (yearMaxValue) yearMaxValue.textContent = filterState.maxYear;
    if (yearSelected) {
      const span = Math.max(1, max - min);
      yearSelected.style.left = `${((Number(filterState.minYear) - min) / span) * 100}%`;
      yearSelected.style.width = `${((Number(filterState.maxYear) - Number(filterState.minYear)) / span) * 100}%`;
    }
  }
  function renderPagination(totalPages){
    if (!paginationRoot) return;
    if (totalPages <= 1) { paginationRoot.innerHTML = ''; return; }
    const items = [];
    const addPage = page => items.push(`<button type="button" class="oc-search-page-button${page === filterState.page ? ' is-active' : ''}" data-search-page="${page}" aria-label="Page ${page}"${page === filterState.page ? ' aria-current="page"' : ''}>${page}</button>`);
    items.push(`<button type="button" class="oc-search-page-button oc-search-page-previous" data-search-page="${Math.max(1, filterState.page - 1)}"${filterState.page === 1 ? ' disabled' : ''}>Previous</button>`);
    const pages = new Set([1, totalPages, filterState.page - 1, filterState.page, filterState.page + 1].filter(page => page >= 1 && page <= totalPages));
    let previous = 0;
    [...pages].sort((a,b) => a - b).forEach(page => { if (previous && page - previous > 1) items.push('<span class="oc-search-page-ellipsis" aria-hidden="true">...</span>'); addPage(page); previous = page; });
    items.push(`<button type="button" class="oc-search-page-button oc-search-page-next" data-search-page="${Math.min(totalPages, filterState.page + 1)}"${filterState.page === totalPages ? ' disabled' : ''}>Next</button>`);
    paginationRoot.innerHTML = items.join('');
    paginationRoot.querySelectorAll('[data-search-page]').forEach(button => button.addEventListener('click', () => { filterState.page = Number(button.dataset.searchPage); renderFilteredResults(); }));
  }
  function renderFilteredResults(){
    if (!activeQuery || activeQuery.length < 2) return;
    const terms = normalize(filterState.text).split(/\s+/).filter(Boolean);
    const minYear = Number(filterState.minYear) || null;
    const maxYear = Number(filterState.maxYear) || null;
    const filtered = matchedRecords.filter(record => {
      if (filterState.types.size && !filterState.types.has(record.type)) return false;
      if (terms.length && !terms.every(term => record.haystack.includes(term))) return false;
      if (filterState.modalities.size && ![...(record.modalities || [])].some(value => filterState.modalities.has(normalize(value)))) return false;
      if (filterState.licenses.size && ![...(record.licenses || [])].some(value => filterState.licenses.has(normalize(value)))) return false;
      if (record.year && minYear && record.year < minYear) return false;
      if (record.year && maxYear && record.year > maxYear) return false;
      return true;
    });
    const ordered = filtered.slice().sort((a, b) => {
      if (filterState.sort === 'title') return a.title.localeCompare(b.title);
      if (filterState.sort === 'newest') return (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title);
      return matchedRecords.indexOf(a) - matchedRecords.indexOf(b);
    });
    const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
    filterState.page = Math.min(Math.max(1, filterState.page), totalPages);
    const start = (filterState.page - 1) * pageSize;
    const visible = ordered.slice(start, start + pageSize);
    status.textContent = filtered.length ? `${filtered.length} result${filtered.length === 1 ? '' : 's'} for "${activeQuery}"` : `No results for "${activeQuery}"`;
    resultsRoot.innerHTML = visible.map(record => {
      const imageSource = record.image || avatarFallback;
      const image = `<img src="${esc(imageSource)}" alt="" loading="lazy" data-oc-image-fallback>`;
      const tags = (record.tags || []).map(tag => `<span>${esc(tag)}</span>`).join('');
      const star = record.id && record.kind === 'resource' && window.OCRecommend?.buttonHtml ? window.OCRecommend.buttonHtml({type:record.type, id:record.id, title:record.title, variant:'detail'}) : '';
      const peopleMeta = record.kind !== 'resource' && record.meta ? `<div class="oc-search-resource-meta">${esc(record.meta)}</div>` : '';
      return `<article class="oc-search-resource-card"><div class="oc-search-resource-media">${image}</div><div class="oc-search-resource-body"><div class="oc-search-resource-heading"><span class="oc-unified-result-type">${esc(typeLabels[record.type] || record.type)}</span>${record.year ? `<span class="oc-search-resource-year">${esc(record.year)}</span>` : ''}</div><a class="oc-search-resource-title" href="${esc(record.href)}">${esc(record.title)}</a>${record.description ? `<p class="oc-search-resource-description">${esc(record.description)}</p>` : ''}${tags ? `<div class="oc-search-resource-tags">${tags}</div>` : ''}${peopleMeta}</div><div class="oc-search-resource-actions">${star}</div></article>`;
    }).join('');
    renderPagination(totalPages);
    window.OCBookmark?.mount?.(resultsRoot);
    window.OCBookmark?.refresh?.(resultsRoot);
    window.OCRecommend?.mount?.(resultsRoot);
  }
  function renderSuggestions(query){
    if (!suggestionsRoot) return;
    const value = normalize(query);
    if (value.length < 2) { suggestionsRoot.hidden = true; suggestionsRoot.innerHTML = ''; return; }
    const terms = value.split(/\s+/).filter(Boolean);
    const records = [...catalogRecords, ...contributorRecords()]
      .filter(record => terms.every(term => record.haystack.includes(term)))
      .sort((a,b) => score(b, terms) - score(a, terms) || (b.addedSort || 0) - (a.addedSort || 0) || a.title.localeCompare(b.title))
      .slice(0, 6);
    suggestionsRoot.innerHTML = records.map(record => `<a class="oc-search-suggestion" href="${esc(record.href)}"><span class="oc-search-suggestion-title">${esc(record.title)}</span><span class="oc-search-suggestion-type">${esc(record.type)}</span></a>`).join('');
    suggestionsRoot.hidden = !records.length;
  }
  async function run(query){
    const value = String(query || '').trim();
    activeQuery = value;
    filterState.page = 1;
    if (suggestionsRoot) suggestionsRoot.hidden = true;
    if (resultsShell) resultsShell.hidden = false;
    if (value.length < 2) { status.textContent = 'Type at least two characters to search.'; resultsRoot.innerHTML = ''; return; }
    status.textContent = 'Searching...';
    const terms = normalize(value).split(/\s+/).filter(Boolean);
    const [members] = await Promise.all([loadPublicMembers(value), catalogRecords.length || staticContributors.length ? Promise.resolve() : loadCatalog()]);
    const contributors = contributorRecords();
    const contributorNames = new Set(contributors.map(record => normalize(record.title)));
    const uniqueMembers = members.filter(record => !contributorNames.has(normalize(record.title)));
    matchedRecords = [...catalogRecords, ...contributors, ...uniqueMembers].filter(record => terms.every(term => record.haystack.includes(term))).sort((a,b) => score(b, terms) - score(a, terms) || (b.addedSort || 0) - (a.addedSort || 0) || a.title.localeCompare(b.title));
    renderTypeFilters(matchedRecords);
    renderFacetOptions(matchedRecords);
    renderAdditionalFacets(matchedRecords);
    updateYearRange(matchedRecords);
    renderFilteredResults();
  }
  facetTextInput?.addEventListener('input', () => { filterState.text = facetTextInput.value; filterState.page = 1; renderFilteredResults(); });
  modalityTextInput?.addEventListener('input', () => { filterState.page = 1; renderValueFacet(matchedRecords, 'modalities', modalityTextInput, modalityOptions, filterState.modalities); });
  licenseTextInput?.addEventListener('input', () => { filterState.page = 1; renderValueFacet(matchedRecords, 'licenses', licenseTextInput, licenseOptions, filterState.licenses); });
  yearMinInput?.addEventListener('input', () => { filterState.minYear = yearMinInput.value; filterState.page = 1; updateYearRange(matchedRecords); renderFilteredResults(); });
  yearMaxInput?.addEventListener('input', () => { filterState.maxYear = yearMaxInput.value; filterState.page = 1; updateYearRange(matchedRecords); renderFilteredResults(); });
  sortInput?.addEventListener('change', () => { filterState.sort = sortInput.value; filterState.page = 1; renderFilteredResults(); });
  clearFiltersButton?.addEventListener('click', () => {
    filterState.types.clear();
    filterState.text = '';
    filterState.modalities.clear();
    filterState.licenses.clear();
    facetExpanded.tasks = false;
    facetExpanded.modalities = false;
    facetExpanded.licenses = false;
    filterState.minYear = '';
    filterState.maxYear = '';
    filterState.sort = 'relevance';
    filterState.page = 1;
    if (facetTextInput) facetTextInput.value = '';
    if (modalityTextInput) modalityTextInput.value = '';
    if (licenseTextInput) licenseTextInput.value = '';
    if (yearMinInput) yearMinInput.value = '';
    if (yearMaxInput) yearMaxInput.value = '';
    if (sortInput) sortInput.value = 'relevance';
    renderTypeFilters(matchedRecords);
    renderFacetOptions(matchedRecords);
    renderAdditionalFacets(matchedRecords);
    updateYearRange(matchedRecords);
    renderFilteredResults();
  });
  if (form?.id === 'unifiedSearchForm') form.addEventListener('submit', event => { event.preventDefault(); run(input.value); });
  input.addEventListener('input', () => renderSuggestions(input.value));
  input.addEventListener('focus', () => renderSuggestions(input.value));
  document.addEventListener('click', event => { if (suggestionsRoot && !suggestionsRoot.contains(event.target) && event.target !== input) suggestionsRoot.hidden = true; });
  const initial = new URLSearchParams(location.search).get('q') || '';
  input.value = initial;
  if (location.hash === '#unifiedSearchInput') input.focus({ preventScroll: true });
  loadCatalog().then(() => { const records = [...catalogRecords, ...contributorRecords()]; renderTypeFilters(records); renderFacetOptions(records); renderAdditionalFacets(records); updateYearRange(records); renderSuggestions(input.value); if (initial) run(initial); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
