
  // Copy BibTeX
  const copyBtn = document.getElementById('copyBib');
  if (copyBtn){
    copyBtn.addEventListener('click', async () => {
      const txt = document.getElementById('bibtex').innerText;
      try{
        await navigator.clipboard.writeText(txt);
        copyBtn.textContent = 'Copied';
        setTimeout(() => copyBtn.textContent = 'Copy', 1600);
      }catch(e){
        window.prompt('Copy to clipboard: Ctrl/Cmd+C, Enter', txt);
      }
    });
  }

  /* no timeline JS needed — horizontal layout is pure CSS */

  // ===== Hero Metrics: counts + re-animating rings on view =====
  (function(){
    const metrics = document.getElementById('heroMetrics');
    const countElDatasets = document.getElementById('countDatasets');
    const countElModels   = document.getElementById('countModels');
    const countElUsecases = document.getElementById('countUsecases');
    const countElOERs     = document.getElementById('countOERs');    // NEW
    const ringDatasets = document.getElementById('ringDatasets');
    const ringModels   = document.getElementById('ringModels');
    const ringUsecases = document.getElementById('ringUsecases');
    const ringOERs     = document.getElementById('ringOERs');        // NEW
    const rings = [ringDatasets, ringModels, ringUsecases, ringOERs].filter(Boolean); // UPDATED
    const R = 17, CIRC = 2 * Math.PI * R;

    rings.forEach(r => { r.style.strokeDasharray = `${CIRC}`; r.style.strokeDashoffset = `${CIRC}`; });

    const ease = t => 1 - Math.pow(1 - t, 3);
    function countUp(el, to, dur=900){
      if(!el) return;
      const start = performance.now();
      const from = 0;
      function step(now){
        const t = Math.min(1, (now - start)/dur);
        const v = Math.round(from + (to - from)*ease(t));
        el.textContent = v.toString();
        if(t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    async function fetchFirst(paths){
      for(const p of paths){
        try{
          const res = await fetch(p, { cache:'no-cache' });
          if(res.ok){ return res.json(); }
        }catch(e){}
      }
      throw new Error('All JSON paths failed');
    }
    function arrayishLength(json){
      if (Array.isArray(json)) return json.length;

      if (json && typeof json === 'object'){
        // explicit containers
        if (Array.isArray(json.use_cases)) return json.use_cases.length; // use-cases schema
        if (Array.isArray(json.resources)) return json.resources.length; // OER schema (NEW)
        if (Array.isArray(json.items))     return json.items.length;
        if (Array.isArray(json.data))      return json.data.length;

        // maps (e.g., datasetId -> datasetObject); ignore metadata keys
        const ignore = new Set(['schema', '$schema', 'meta']);
        return Object.keys(json).filter(k => !ignore.has(k)).length;
      }
      return 0;
    }

    function setRings(offset){ rings.forEach(r => r && (r.style.strokeDashoffset = String(offset))); }
    function playRings(){
      document.body.classList.add('ring-ready');
      requestAnimationFrame(() => { setRings(0); });
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.target !== metrics) return;
        if (e.isIntersecting){
          playRings();
        } else {
          setRings(CIRC);
        }
      });
    }, { threshold: 0.35 });
    io.observe(metrics);

    (async function(){
      try{
        const [datasetsJson, modelsJson, usecasesJson, oersJson] = await Promise.all([
          fetchFirst(['data/datasets.json','assets/datasets.json','datasets.json']),
          fetchFirst(['data/models.json','assets/models.json','models.json']),
          // Robust fallbacks for the Use Cases schema
          fetchFirst([
            'data/use-cases.json','assets/deployments.json','deployments.json',
            'data/usecases.json','assets/usecases.json','usecases.json'
          ]),
          fetchFirst(['data/oer.json','assets/oer.json','oer.json']) // NEW
        ]);
        const dCount = arrayishLength(datasetsJson);
        const mCount = arrayishLength(modelsJson);
        const uCount = arrayishLength(usecasesJson);
        const oCount = arrayishLength(oersJson); // NEW

        countUp(countElDatasets, dCount);
        countUp(countElModels,   mCount);
        countUp(countElUsecases, uCount);
        countUp(countElOERs,     oCount); // NEW
        const rect = metrics.getBoundingClientRect();
        const inView = rect.top < (window.innerHeight || document.documentElement.clientHeight) && rect.bottom > 0;
        if (inView) {
          setRings(CIRC);
          requestAnimationFrame(playRings);
        }
      }catch(err){
        if(countElDatasets) countElDatasets.textContent = '—';
        if(countElModels)   countElModels.textContent   = '—';
        if(countElUsecases) countElUsecases.textContent = '—';
        if(countElOERs)     countElOERs.textContent     = '—'; // NEW
      }
    })();
  })();

  // ===== Homepage featured resources =====
  (function(){
    const grid = document.getElementById('featuredResourcesGrid');
    const searchForm = document.getElementById('homeSearchForm');
    const searchInput = document.getElementById('homeSearchInput');
    const searchResults = document.getElementById('homeSearchResults');
    if (!grid) return;

    function esc(s){
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function parseDate(value){
      if (!value) return null;
      const raw = String(value).trim();
      const dateOnlyMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (dateOnlyMatch){
        const [, year, month, day] = dateOnlyMatch;
        // Store date-only metadata at local noon so formatting stays on the same calendar day.
        return new Date(Number(year), Number(month) - 1, Number(day), 12).getTime();
      }
      const ts = Date.parse(raw);
      return Number.isNaN(ts) ? null : ts;
    }

    async function fetchFirst(paths){
      for (const p of paths){
        try{
          const res = await fetch(p, { cache:'no-cache' });
          if (res.ok) return res.json();
        }catch(_){}
      }
      throw new Error('All JSON paths failed');
    }

    function firstLine(text){
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (!clean) return '';
      const match = clean.match(/^.*?[.!?](?:\s|$)/);
      const sentence = match ? match[0].trim() : clean;
      return sentence.length > 140 ? `${sentence.slice(0, 137).trimEnd()}...` : sentence;
    }

    function normalizeText(text){
      return String(text || '').toLowerCase();
    }

    function normalizeContributorHandle(name){
      const text = String(name || '').trim();
      if (!text) return '';
      return text.startsWith('@') ? text : `@${text}`;
    }

    function normalizeContributors(item){
      const list = [];
      const pushContributor = (name, url) => {
        const cleanName = String(name || '').trim();
        const cleanUrl = String(url || '').trim();
        if (!cleanName) return;
        list.push({ name: cleanName, url: cleanUrl });
      };

      if (Array.isArray(item && item.contributors)){
        item.contributors.forEach((entry) => {
          if (!entry) return;
          if (typeof entry === 'string'){
            pushContributor(entry, '');
            return;
          }
          if (typeof entry === 'object'){
            pushContributor(
              entry.name || entry.contributor || entry.handle,
              entry.url || entry.contributor_url || entry.profile || ''
            );
          }
        });
      }

      pushContributor(item && item.contributor, item && item.contributor_url);
      pushContributor(item && item.contributor_2, item && item.contributor_url_2);
      pushContributor(item && item.contributor_3, item && item.contributor_url_3);

      return list.filter((entry, index, arr) => arr.findIndex((other) =>
        normalizeText(other.name) === normalizeText(entry.name) &&
        normalizeText(other.url) === normalizeText(entry.url)
      ) === index).slice(0, 3);
    }

    function contributorOverlayHtml(contributors){
      if (!Array.isArray(contributors) || !contributors.length) return '';
      const names = contributors.map((entry) => {
        const label = `<strong>${esc(normalizeContributorHandle(entry.name))}</strong>`;
        const href = safeContributorHref(entry.url);
        return href
          ? `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`
          : label;
      }).join(', ');
      return `
        <div class="submitted-by">
          Proposed by ${names}
        </div>
      `;
    }

    function safeContributorHref(url){
      const text = String(url || '').trim();
      if (!text) return '';
      if (/^(https?:|mailto:|\/|\.\/|\.\.\/|contributors\.html)/i.test(text)) return text;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${text}`;
      return '';
    }

    function formatCatalogTitle(raw){
      const text = String(raw || '').trim();
      if (!text) return '';
      const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'with']);
      const acronymPattern = /^(2d|3d|4d|rgb|rgbd|rgb-d|slam|lidar|cnn|rnn|gan|svm|ml|ai|nlp|uav|imu|sar|bim|ifc|gpr|vlm|llm|qa|hvac|lod3|ui|pcd|fob|cif|dap)$/i;

      return text.split(/\s+/).map((token, index, arr) => {
        const parts = token.match(/^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9-]*)([^A-Za-z0-9]*)$/);
        if (!parts) return token;
        const [, prefix, core, suffix] = parts;

        if ((/[A-Z].*[a-z]|[a-z].*[A-Z]/).test(core) && !/^[a-z]+$/.test(core)) {
          return `${prefix}${core}${suffix}`;
        }
        if (/[A-Z]{2,}/.test(core) && !/[a-z]/.test(core)) {
          return `${prefix}${core}${suffix}`;
        }

        const rendered = core.split('-').map(part => {
          if (!part) return part;
          if (acronymPattern.test(part)) return part.toUpperCase();
          const lower = part.toLowerCase();
          const previousToken = index > 0 ? arr[index - 1] : '';
          const startsSegment = index === 0 || /[:.!?]["')\]]*$/.test(previousToken);
          if (!core.includes('-') && !startsSegment && index < arr.length - 1 && minorWords.has(lower)) return lower;
          return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
        }).join('-');

        return `${prefix}${rendered}${suffix}`;
      }).join(' ');
    }

    function datasetCountLabel(modalityVal){
      const modalities = Array.isArray(modalityVal)
        ? modalityVal.map(value => normalizeText(value).trim())
        : String(modalityVal || '').split(',').map(value => normalizeText(value).trim());

      if (!modalities.length) return 'samples';

      const has = (pattern) => modalities.some(value => pattern.test(value));

      if (has(/point\s*cloud|lidar|laser\s*scan|3d\s*scan/)) return 'point clouds';
      if (has(/video|clip/)) return 'videos';
      if (has(/document|text|pdf|report|specification|contract/)) return 'documents';
      if (has(/audio|speech|sound/)) return 'audio files';
      if (has(/bim|ifc|cad|mesh|graph/)) return 'models';
      if (has(/timeseries|time\s*series|sensor|tabular|table|csv|database|sql/)) return 'records';
      if (has(/image|rgb|thermal|satellite|aerial|depth/)) return 'images';

      return 'samples';
    }

    function datasetCountSummary(ds){
      const raw = ds && ds.num_images;
      if (raw == null || raw === '') return '';

      const text = String(raw).trim();
      if (/[a-zA-Z]/.test(text)) return text;

      const formatted = typeof raw === 'number' ? raw.toLocaleString() : text;
      return `${formatted} ${datasetCountLabel(ds.data_modality)}`;
    }

    function buildSearchIndex(datasetsJson, modelsJson, usecasesJson, oersJson){
      const datasets = Object.values(datasetsJson || {}).map(ds => ({
        type: 'dataset',
        label: 'Dataset',
        title: formatCatalogTitle(ds.name || ds.id || 'Untitled dataset'),
        href: `datasets/detail.html?id=${encodeURIComponent(ds.id || ds.name || '')}`,
        meta: [ds.year, ds.data_modality, ds.authors ? String(ds.authors).split(',')[0].trim() : null].filter(Boolean).join(' · '),
        text: [
          ds.name, ds.id, ds.data_modality, ds.authors, ds.paper, ds.doi,
          ...(Array.isArray(ds.potential_tasks) ? ds.potential_tasks : []),
          ...(Array.isArray(ds.classes) ? ds.classes : [])
        ].join(' ')
      }));
      const models = (Array.isArray(modelsJson) ? modelsJson : []).map(m => ({
        type: 'model',
        label: 'Model',
        title: formatCatalogTitle(m.title || m.id || 'Untitled model'),
        href: `models/details.html?id=${encodeURIComponent(m.id || m.title || '')}`,
        meta: [m.year, Array.isArray(m.tasks) ? m.tasks.join(', ') : m.task, Array.isArray(m.authors) ? m.authors[0] : m.authors].filter(Boolean).join(' · '),
        text: [
          m.title, m.id, m.abstract, m.Paper, m.paper, m.paper_title, m.paper_url, m.doi, Array.isArray(m.authors) ? m.authors.join(' ') : m.authors,
          ...(Array.isArray(m.tasks) ? m.tasks : normalizeText(m.task) ? [m.task] : []),
          ...(Array.isArray(m.applications) ? m.applications : normalizeText(m.application) ? [m.application] : []),
          ...(Array.isArray(m.modalities) ? m.modalities : normalizeText(m.modality) ? [m.modality] : [])
        ].join(' ')
      }));
      const workflows = ((usecasesJson && usecasesJson.use_cases) || []).map(u => ({
        type: 'workflow',
        label: 'Workflow',
        title: formatCatalogTitle(u.title || 'Untitled workflow'),
        href: `deployments.html?q=${encodeURIComponent(u.title || '')}`,
        meta: [u.year, Array.isArray(u.stakeholders) ? u.stakeholders[0] : null].filter(Boolean).join(' · '),
        text: [
          u.title, u.summary, u.phase, u.provider,
          ...(Array.isArray(u.organizations) ? u.organizations : []),
          ...(Array.isArray(u.companies) ? u.companies.map(c => c && c.name).filter(Boolean) : []),
          ...(Array.isArray(u.stakeholders) ? u.stakeholders : []),
          ...(Array.isArray(u.applications) ? u.applications : [])
        ].join(' ')
      }));
      const oers = ((oersJson && oersJson.resources) || []).map(r => ({
        type: 'oer',
        label: 'OER',
        title: formatCatalogTitle(r.title || 'Untitled resource'),
        href: r.source || 'oer.html',
        external: true,
        meta: [r.year, r.provider || r.publisher].filter(Boolean).join(' · '),
        text: [
          r.title, r.provider, r.publisher, r.authors,
          ...(Array.isArray(r.topics) ? r.topics : []),
          ...(Array.isArray(r.institutions) ? r.institutions : [])
        ].join(' ')
      }));
      return [...datasets, ...models, ...workflows, ...oers].map(item => ({
        ...item,
        haystack: normalizeText(`${item.title} ${item.meta} ${item.text}`)
      }));
    }

    function renderSearchResults(items, query){
      if (!searchResults) return;
      if (!query){
        searchResults.hidden = true;
        searchResults.innerHTML = '';
        return;
      }
      if (!items.length){
        searchResults.hidden = false;
        searchResults.innerHTML = `
          <div class="search-results-head">
            <span>No results for "${esc(query)}"</span>
          </div>
          <div class="search-results-list">
            <div class="search-result">
              <span class="search-result-title">Try a broader keyword.</span>
            </div>
          </div>`;
        return;
      }
      searchResults.hidden = false;
      searchResults.innerHTML = `
        <div class="search-results-head">
          <span>${items.length} result${items.length === 1 ? '' : 's'} for "${esc(query)}"</span>
        </div>
        <div class="search-results-list">
          ${items.map(item => `
            <a class="search-result" href="${esc(item.href)}"${item.external ? ' target="_blank" rel="noopener"' : ''}>
              <span class="search-result-type">${esc(item.label)}</span>
              <span class="search-result-title">${esc(item.title)}</span>
              <span class="search-result-meta">${esc(item.meta || 'OpenConstruction catalog resource')}</span>
            </a>
          `).join('')}
        </div>`;
    }

    function wireSearch(searchIndex){
      if (!searchForm || !searchInput || !searchResults) return;
      function runSearch(){
        const query = searchInput.value.trim();
        if (!query){
          renderSearchResults([], '');
          return [];
        }
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const results = searchIndex
          .filter(item => terms.every(term => item.haystack.includes(term)))
          .slice(0, 8);
        renderSearchResults(results, query);
        return results;
      }
      searchInput.addEventListener('input', runSearch);
      searchForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const results = runSearch();
        if (window.OCUsageAnalytics?.recordSearchInput) {
          await Promise.race([
            window.OCUsageAnalytics.recordSearchInput(searchInput, 'home_submit', { keepalive: true }),
            new Promise(resolve => setTimeout(resolve, 220))
          ]);
        }
        if (searchInput.value.trim()) window.location.href = `search.html?q=${encodeURIComponent(searchInput.value.trim())}`;
      });
      document.addEventListener('click', (event) => {
        if (!searchResults.hidden && !searchForm.contains(event.target) && !searchResults.contains(event.target)){
          searchResults.hidden = true;
        }
      });
      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) runSearch();
      });
      const params = new URLSearchParams(window.location.search);
      const initialQuery = params.get('q') || '';
      if (initialQuery) {
        searchInput.value = initialQuery;
        runSearch();
        searchInput.focus({ preventScroll: true });
        searchForm.scrollIntoView({ block: 'center' });
      } else if (window.location.hash === '#homeSearchInput') {
        searchInput.focus({ preventScroll: true });
        searchForm.scrollIntoView({ block: 'center' });
      }
    }

    function pickItems(datasetsJson, modelsJson, usecasesJson, oersJson){
      const datasets = Object.values(datasetsJson || {}).map(ds => ({
        type: 'Dataset',
        resourceType: 'dataset',
        resourceId: ds.id || ds.name,
        title: formatCatalogTitle(ds.name || 'Untitled dataset'),
        meta: [ds.data_modality, datasetCountSummary(ds) || null].filter(Boolean).join(' · '),
        year: ds.year,
        href: `datasets/detail.html?id=${encodeURIComponent(ds.id || ds.name || '')}`,
        image: ds.image_url || 'assets/img/placeholder/placeholder.png',
        ts: parseDate(ds.added_date || ds.added),
        cta: 'View dataset',
        external: false,
        contributors: normalizeContributors(ds)
      }));

      const models = (Array.isArray(modelsJson) ? modelsJson : []).map(m => ({
        type: 'Model',
        resourceType: 'model',
        resourceId: m.id || m.title,
        title: formatCatalogTitle(m.title || 'Untitled model'),
        description: firstLine(m.abstract) || 'Model entry with tasks, code, and paper links.',
        meta: [Array.isArray(m.modalities) ? m.modalities.join(', ') : m.modality, Array.isArray(m.tasks) ? m.tasks.join(', ') : m.task].filter(Boolean).join(' · '),
        year: m.year,
        href: `models/details.html?id=${encodeURIComponent(m.id || m.title || '')}`,
        image: m.thumbnail || (m.id ? `assets/img/models/${m.id}.png` : 'assets/img/models/_placeholder.png'),
        ts: parseDate(m.added_date || m.added),
        cta: 'View model',
        external: false,
        contributors: normalizeContributors(m)
      }));

      const usecases = ((usecasesJson && usecasesJson.use_cases) || []).map(u => ({
        type: 'Workflow',
        title: formatCatalogTitle(u.title || 'Untitled workflow'),
        description: firstLine(u.summary) || 'Applied workflow connecting AI methods to field deployment.',
        meta: [u.phase, Array.isArray(u.stakeholders) ? u.stakeholders[0] : null].filter(Boolean).join(' · '),
        year: u.year,
        href: `deployments.html?q=${encodeURIComponent(u.title || '')}`,
        image: (Array.isArray(u.media) && u.media.find(media => media && media.type === 'image')?.url) || 'assets/img/placeholder/placeholder.png',
        ts: parseDate(u.added_date || u.added),
        cta: 'Open workflow',
        external: false
      }));

      const oers = ((oersJson && oersJson.resources) || []).map(r => ({
        type: 'OER',
        title: formatCatalogTitle(r.title || 'Untitled resource'),
        description: [Array.isArray(r.topics) ? r.topics[0] : null, Array.isArray(r.media) ? r.media[0] : null].filter(Boolean).join(' · ') || 'Open educational material for AEC teaching and training.',
        meta: [r.provider || r.publisher, Array.isArray(r.institutions) ? r.institutions[0] : null].filter(Boolean).join(' · '),
        year: r.year,
        href: `oers/details.html?id=${encodeURIComponent(r.id || r.title || '')}`,
        image: r.image || 'assets/img/placeholder/placeholder.png',
        ts: parseDate(r.added || r.added_date),
        cta: 'View Details',
        external: false
      }));

      return [...datasets, ...models]
        .filter(item => item.title && item.href)
        .sort((a, b) => {
          const aTime = a.ts || 0;
          const bTime = b.ts || 0;
          if (bTime !== aTime) return bTime - aTime;
          return (b.year || 0) - (a.year || 0);
        })
        .slice(0, 12);
    }

    function mountFeaturedStars(){
      if (!window.OCRecommend?.buttonHtml) return;
      grid.querySelectorAll('[data-featured-star]').forEach(slot => {
        if (slot.querySelector('[data-oc-recommend]')) return;
        slot.innerHTML = window.OCRecommend.buttonHtml({
          type: slot.dataset.resourceType,
          id: slot.dataset.resourceId,
          title: slot.dataset.resourceTitle,
          variant: 'card'
        });
      });
      window.OCRecommend.mount?.(grid);
    }

    window.OCFeaturedResources = { mountStars: mountFeaturedStars };

    function render(items){
      if (!items.length){
        grid.innerHTML = `
          <div class="featured-card">
            <div class="featured-body">
              <div class="featured-topline">
                <span class="featured-type">Catalog</span>
              </div>
              <p class="featured-meta">Featured resources will appear here as data loads.</p>
            </div>
          </div>`;
        return;
      }

      grid.innerHTML = items.map(item => `
        <article class="featured-card">
          <div class="featured-card-link" role="link" tabindex="0" data-href="${esc(item.href)}" data-external="${item.external ? 'true' : 'false'}">
            <div class="featured-media">
              <img src="${esc(item.image)}" alt=""
                   data-oc-image-fallback>
              ${contributorOverlayHtml(item.contributors)}
            </div>
            <div class="featured-body">
              <div class="featured-topline">
                <span class="featured-type">${esc(item.type)}</span>
                ${item.year ? `<span class="featured-year">${esc(item.year)}</span>` : ''}
              </div>
              <h3 class="featured-title">${esc(item.title)}</h3>
              <p class="featured-meta">${esc(item.meta || 'OpenConstruction catalog resource')}</p>
            </div>
          </div>
          <div class="featured-card-actions">
            <span class="featured-card-star"
                  data-featured-star
                  data-resource-type="${esc(item.resourceType)}"
                  data-resource-id="${esc(item.resourceId)}"
                  data-resource-title="${esc(item.title)}"></span>
          </div>
        </article>
      `).join('');
      mountFeaturedStars();
    }

    function openFeaturedCard(cardLink){
      const href = cardLink && cardLink.dataset ? cardLink.dataset.href : '';
      if (!href) return;
      if (cardLink.dataset.external === 'true') {
        window.open(href, '_blank', 'noopener');
        return;
      }
      window.location.href = href;
    }

    const prevBtn = document.getElementById('featuredPrevBtn');
    const nextBtn = document.getElementById('featuredNextBtn');
    const leftFade = document.getElementById('featuredLeftFade');
    const rightFade = document.getElementById('featuredRightFade');

    function featuredCardStep(){
      if (!grid) return 0;
      const firstCard = grid.querySelector('.featured-card');
      if (!firstCard) return 0;
      const styles = window.getComputedStyle(grid);
      const gap = parseFloat(styles.columnGap || styles.gap || '0') || 0;
      return firstCard.getBoundingClientRect().width + gap;
    }

    function updateFeaturedControls(){
      if (!grid || !prevBtn || !nextBtn) return;
      const maxScroll = Math.max(0, grid.scrollWidth - grid.clientWidth);
      const atStart = grid.scrollLeft <= 4;
      const atEnd = grid.scrollLeft >= maxScroll - 4 || maxScroll <= 0;
      prevBtn.disabled = atStart;
      nextBtn.disabled = atEnd;
      if (leftFade) leftFade.classList.toggle('is-hidden', atStart);
      if (rightFade) rightFade.classList.toggle('is-hidden', atEnd);
    }

    function scrollFeatured(direction){
      if (!grid) return;
      const step = featuredCardStep();
      if (!step) return;
      grid.scrollBy({ left: direction * step, behavior: 'smooth' });
      window.setTimeout(updateFeaturedControls, 220);
    }

    if (prevBtn) prevBtn.addEventListener('click', () => scrollFeatured(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => scrollFeatured(1));
    if (grid){
      grid.addEventListener('scroll', () => window.requestAnimationFrame(updateFeaturedControls), { passive:true });
      grid.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return;
        const cardLink = event.target.closest('.featured-card-link');
        if (cardLink) openFeaturedCard(cardLink);
      });
      grid.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target.closest('a, button')) return;
        const cardLink = event.target.closest('.featured-card-link');
        if (!cardLink) return;
        event.preventDefault();
        openFeaturedCard(cardLink);
      });
      window.addEventListener('resize', updateFeaturedControls);
    }

    (async function(){
      try{
        const [datasetsJson, modelsJson, usecasesJson, oersJson] = await Promise.all([
          fetchFirst(['data/datasets.json','assets/datasets.json','datasets.json']),
          fetchFirst(['data/models.json','assets/models.json','models.json']),
          fetchFirst([
            'data/use-cases.json','assets/deployments.json','deployments.json',
            'data/usecases.json','assets/usecases.json','usecases.json'
          ]),
          fetchFirst(['data/oer.json','assets/oer.json','oer.json'])
        ]);
        wireSearch(buildSearchIndex(datasetsJson, modelsJson, usecasesJson, oersJson));
        render(pickItems(datasetsJson, modelsJson, usecasesJson, oersJson));
        updateFeaturedControls();
      }catch(_){
        wireSearch([]);
        render([]);
        updateFeaturedControls();
      }
    })();
  })();
