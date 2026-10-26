// Copyright (c) 2024-2026 OpenConstruction Open Science Initiative
// SPDX-License-Identifier: Apache-2.0

(async function(){
  if (window.OCUsageAnalytics?.ready) return;
  const script = document.currentScript;
  const PAGE = cleanPage(script?.dataset?.page || pageFromLocation());
  const GEO_CACHE_KEY = 'oc_usage_geo_v1';
  const SESSION_KEY = 'oc_usage_session_v1';
  const VISIT_DEDUPE_KEY = 'oc_usage_page_visits_v1';
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  const VISIT_DEDUPE_MS = 30 * 60 * 1000;
  const USAGE_BATCH_SIZE = 5;
  const USAGE_BATCH_DELAY_MS = 2000;
  const FORM_IDS = new Set(['resourceSuggestionForm', 'skillProposalForm', 'reportIssueForm', 'emailSignInForm']);
  const loggedForms = new Set();
  const startedForms = new Set();
  const recentSearchEvents = new Map();
  const usageQueue = [];
  let usageFlushTimer = null;
  let usageFlushPromise = null;
  let authContextPromise = null;
  const pageStartedAt = Date.now();
  let engagementRecorded = false;
  const sb = window.OCAuth?.getClient?.() || (
    window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase?.createClient
      ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: 'oc-visit-logger-auth-token'
          }
        })
      : null
  );
  if (!sb) {
    console.warn('Supabase config missing; visit logger skipped');
    return;
  }

  function pageFromLocation(){
    const path = location.pathname.replace(/^\/+|\/+$/g, '');
    const withoutHtml = path.replace(/\.html$/i, '');
    return withoutHtml || 'index';
  }

  function cleanPage(value){
    const clean = String(value || 'index')
      .toLowerCase()
      .replace(/\.html$/g, '')
      .replace(/[^a-z0-9_/-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
    return clean || 'index';
  }

  function resourceContext(){
    const path = String(location.pathname || '').toLowerCase();
    const page = String(PAGE || '').replace(/\.html$/i, '').replace(/^\/+|\/+$/g, '').toLowerCase();
    const id = cleanText(new URLSearchParams(location.search).get('id'), 160);
    if (!id) return null;
    const type = (page === 'datasets/detail' || path.includes('/datasets/detail.html')) ? 'dataset'
      : (page === 'models/details' || path.includes('/models/details.html')) ? 'model'
      : (page === 'workflows/details' || path.includes('/workflows/details.html')) ? 'workflow'
      : (page === 'oers/details' || path.includes('/oers/details.html')) ? 'oer'
      : null;
    return type ? { resource_type: type, resource_id: id.toLowerCase() } : null;
  }

  function cleanText(value, limit){
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    return clean ? clean.slice(0, limit) : null;
  }

  function cleanUserAgent(value){
    const clean = cleanText(value, 500);
    return clean ? clean.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 500) || null : null;
  }

  function classifyClientKind(userAgent){
    const ua = String(userAgent || '').toLowerCase();
    if (!ua) return 'unknown';
    if (/(uptimerobot|pingdom|statuscake|healthcheck|checkly|better uptime|site24x7)/.test(ua)) return 'monitor';
    if (/(gptbot|chatgpt-user|oai-searchbot|claudebot|anthropic-ai|perplexitybot|google-extended|bytespider|meta-externalagent|amazonbot)/.test(ua)) return 'ai_fetcher';
    if (/(bot|crawler|spider|slurp|bingpreview|duckduckbot|baiduspider|yandex|semrush|ahrefs|petalbot|applebot|headlesschrome|python-requests|curl|wget)/.test(ua)) return 'crawler_or_bot';
    return 'browser_like';
  }

  function classifyTrafficSource(referrer){
    const value = String(referrer || '').trim().toLowerCase();
    if (!value) return 'direct_or_suppressed';
    let host = '';
    try {
      host = new URL(value).hostname.replace(/^www\./, '');
    } catch (_) {
      host = value;
    }
    if (host.endsWith('openconstruction.org')) return 'internal';
    if (/(chatgpt\.com|perplexity\.ai|claude\.ai|gemini\.google|copilot\.microsoft|poe\.com)/.test(host)) return 'ai_referrer';
    if (/(google\.|bing\.com|duckduckgo\.com|baidu\.com|yandex\.|yahoo\.|ecosia\.org)/.test(host)) return 'search';
    if (/(linkedin\.com|facebook\.com|twitter\.com|x\.com|reddit\.com|youtube\.com|t\.co)/.test(host)) return 'social';
    return 'external';
  }

  function finiteNumber(value){
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function numericText(element){
    const match = String(element?.textContent || '').match(/\d[\d,]*/);
    return match ? Number(match[0].replace(/,/g, '')) : null;
  }

  function currentResultCount(){
    return (numericText(document.getElementById('resultCount')) ??
      numericText(document.getElementById('globalSearchNote')) ??
      document.querySelectorAll(
        '#datasetGrid > *, #modelGrid > *, #oerGrid > *, #usecaseGrid > *, #benchmarkIndex > *, #applicationIndex > *'
      ).length) || null;
  }

  function nearestLabelText(element){
    const id = element?.id;
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) return label.textContent;
    }
    const group = element?.closest?.('.mb-3, .mb-1, .oc-filter-group, fieldset, .filters, .card-body');
    return group?.querySelector?.('legend, .form-label, .card-header, label')?.textContent || '';
  }

  function filterGroupFor(element){
    const container = element?.closest?.('[id^="filter-"], .facet-list, .filters, fieldset');
    return cleanText(
      nearestLabelText(element) ||
      container?.id?.replace(/^filter-/, '') ||
      element?.name ||
      element?.id ||
      'filter',
      80
    );
  }

  function filterValueFor(element){
    if (!element) return null;
    if (element.matches('select')) return cleanText(element.selectedOptions?.[0]?.textContent || element.value, 160);
    if (element.matches('input[type="checkbox"], input[type="radio"]')) {
      const label = element.closest('label')?.textContent || document.querySelector(`label[for="${CSS.escape(element.id || '')}"]`)?.textContent;
      return cleanText(label || element.value, 160);
    }
    if (element.matches('input[type="range"]')) return cleanText(`${element.id || element.name || 'range'}:${element.value}`, 160);
    return cleanText(element.value || element.textContent, 160);
  }

  function isSearchInput(element){
    if (!element?.matches?.('input, textarea')) return false;
    const type = String(element.getAttribute('type') || '').toLowerCase();
    if (['email', 'password', 'hidden', 'url', 'range', 'checkbox', 'radio'].includes(type)) return false;
    const idName = `${element.id || ''} ${element.name || ''} ${element.placeholder || ''} ${element.getAttribute('aria-label') || ''}`.toLowerCase();
    if (type === 'search') return true;
    return /\b(search|filter|ask|query|q)\b/.test(idName) &&
      !/\b(email|name|affiliation|license|doi|url|title|description|note|summary|details)\b/.test(idName);
  }

  function eventTypeForSearch(element){
    return element?.closest?.('.oc-ask-form, #ocAiForm, #anonymousAskForm') ? 'ai_search' : 'search';
  }

  function isCatalogSearchInput(element){
    const id = String(element?.id || '').toLowerCase();
    return id === 'q' || id === 'qdock' || id === 'homesearchinput' || element?.closest?.('.hero-search, .oc-catalog-search-wrap');
  }

  function isFacetSearchInput(element){
    if (!element || isCatalogSearchInput(element)) return false;
    return Boolean(element.closest?.('.filters, .facet-list, aside'));
  }

  function searchScopeFor(element){
    const form = element?.closest?.('form');
    const scope = form?.querySelector?.('select')?.value || element?.dataset?.scope || 'all';
    return cleanText(scope, 80) || 'all';
  }

  async function sha256hex(text){
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function getVisitorId(){
    const key = 'oc_visitor_id';
    let value = localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, value);
    }
    return value;
  }

  function getSessionId(){
    const now = Date.now();
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (stored?.id && Number(stored.lastSeen || 0) + SESSION_IDLE_MS > now) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: stored.id, lastSeen: now }));
        return stored.id;
      }
      const id = crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastSeen: now }));
      return id;
    } catch (_) {
      return `page-${now}`;
    }
  }

  function shouldRecordPageVisit(){
    const now = Date.now();
    const key = `${VISIT_DEDUPE_KEY}:${PAGE}`;
    try {
      const lastSeen = Number(sessionStorage.getItem(key) || 0);
      if (lastSeen && lastSeen + VISIT_DEDUPE_MS > now) return false;
    } catch (_) {}
    return true;
  }

  function markPageVisitRecorded(){
    try {
      sessionStorage.setItem(`${VISIT_DEDUPE_KEY}:${PAGE}`, String(Date.now()));
    } catch (_) {}
  }

  function getAuthContext(){
    if (!authContextPromise) {
      authContextPromise = Promise.resolve()
        .then(() => window.OCAuth?.getUser?.())
        .then(user => Boolean(user))
        .catch(() => false);
    }
    return authContextPromise;
  }

  async function getVisitorHash(){
    const geo = await geoPromise;
    const base = geo?.ip ? geo.ip : `vid:${getVisitorId()}`;
    return sha256hex(base);
  }

  function normalizeGeo(raw){
    if (!raw || raw.error) return null;
    const lat = finiteNumber(raw.latitude ?? raw.lat);
    const lon = finiteNumber(raw.longitude ?? raw.lon);
    const cleanGeo = {
      ip: cleanText(raw.ip, 80),
      lat,
      lon,
      city: cleanText(raw.city, 120),
      region: cleanText(raw.region || raw.regionName, 120),
      country: cleanText(raw.country_name || raw.country, 120)
    };
    return (cleanGeo.city || cleanGeo.region || cleanGeo.country || lat !== null || lon !== null)
      ? cleanGeo
      : null;
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 3200){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller?.signal
      });
      if (!response.ok) return null;
      return response.json();
    } catch (_) {
      return null;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  function cacheGeo(cleanGeo){
    if (!cleanGeo) return;
    try {
      sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify({
        expires: Date.now() + 6 * 60 * 60 * 1000,
        geo: cleanGeo
      }));
    } catch (_) {}
  }

  async function getGeo(){
    try {
      const cached = JSON.parse(sessionStorage.getItem(GEO_CACHE_KEY) || 'null');
      if (cached?.expires > Date.now()) return cached.geo || null;
    } catch (_) {}
    for (const url of ['https://get.geojs.io/v1/ip/geo.json', 'https://ipapi.co/json/']) {
      const cleanGeo = normalizeGeo(await fetchJsonWithTimeout(url));
      if (cleanGeo) {
        cacheGeo(cleanGeo);
        return cleanGeo;
      }
    }
    return null;
  }

  async function basePayload(extra = {}){
    const [geo, isAuthenticated] = await Promise.all([geoPromise, getAuthContext()]);
    return {
      page: PAGE,
      visitor_hash: await visitorHashPromise,
      session_id: getSessionId(),
      is_authenticated: isAuthenticated,
      country: geo?.country || null,
      region: geo?.region || null,
      county: geo?.county || null,
      city: geo?.city || null,
      lat: (geo && typeof geo.lat === 'number') ? geo.lat : null,
      lon: (geo && typeof geo.lon === 'number') ? geo.lon : null,
      ...extra
    };
  }

  async function insertUsageEvents(payloads, options = {}){
    if (!payloads.length) return;
    const legacyPayloads = payloads.map(stripAnalyticsColumns);
    if (options.keepalive && window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.fetch) {
      const endpoint = `${String(window.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/site_usage_events`;
      const response = await fetch(endpoint, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: window.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(payloads)
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (!isSchemaColumnError(body)) throw new Error(`usage event insert failed: ${response.status}`);
        const fallback = await fetch(endpoint, {
          method: 'POST',
          keepalive: true,
          headers: {
            apikey: window.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify(legacyPayloads)
        });
        if (!fallback.ok) throw new Error(`usage event insert failed: ${fallback.status}`);
      }
      return;
    }
    const { error } = await sb.from('site_usage_events').insert(payloads);
    if (!error) return;
    if (!isSchemaColumnError(error)) throw error;
    const fallback = await sb.from('site_usage_events').insert(legacyPayloads);
    if (fallback.error) throw fallback.error;
  }

  function stripAnalyticsColumns(payload){
    const { session_id, engagement_ms, is_authenticated, ...legacy } = payload || {};
    return legacy;
  }

  function isSchemaColumnError(error){
    const text = typeof error === 'string' ? error : [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
    return /column .* does not exist|schema cache|could not find the .* column|unknown field/i.test(text);
  }

  function scheduleUsageFlush(){
    if (usageFlushTimer || usageFlushPromise) return;
    usageFlushTimer = window.setTimeout(() => {
      usageFlushTimer = null;
      flushUsageEvents();
    }, USAGE_BATCH_DELAY_MS);
  }

  async function flushUsageEvents(options = {}){
    if (options.keepalive && usageFlushTimer) {
      window.clearTimeout(usageFlushTimer);
      usageFlushTimer = null;
    }
    if (usageFlushPromise) return usageFlushPromise;
    if (!usageQueue.length) return;
    const batch = usageQueue.splice(0, USAGE_BATCH_SIZE);
    usageFlushPromise = insertUsageEvents(batch, options)
      .catch(error => console.warn('usage event batch failed', error))
      .finally(() => {
        usageFlushPromise = null;
        if (usageQueue.length) {
          if (options.keepalive) flushUsageEvents(options);
          else scheduleUsageFlush();
        }
      });
    return usageFlushPromise;
  }

  function queueUsageEvent(payload, options = {}){
    usageQueue.push(payload);
    if (options.keepalive || usageQueue.length >= USAGE_BATCH_SIZE) return flushUsageEvents(options);
    scheduleUsageFlush();
    return Promise.resolve();
  }

  async function trackEvent(eventType, detail = {}, options = {}){
    try {
      const context = resourceContext();
      const payload = await basePayload({
        event_type: eventType,
        query: cleanText(detail.query, 240),
        filter_group: cleanText(detail.filter_group, 80),
        filter_value: cleanText(detail.filter_value, 160),
        result_count: Number.isFinite(detail.result_count) ? detail.result_count : null,
        engagement_ms: Number.isFinite(detail.engagement_ms) ? Math.max(0, Math.round(detail.engagement_ms)) : null,
        metadata: {
          ...(context || {}),
          ...(detail.metadata && typeof detail.metadata === 'object' ? detail.metadata : {}),
          session_id: getSessionId()
        }
      });
      await queueUsageEvent(payload, options);
    } catch (error) {
      console.warn('usage event failed', error);
    }
  }

  function recordSearchFromInput(input, action = 'input', options = {}){
    const query = cleanText(input?.value, 240);
    if (!query || query.length < 2) return Promise.resolve();
    if (isFacetSearchInput(input)) {
      const group = cleanText(`facet_search:${filterGroupFor(input) || input.id || 'facet'}`, 80);
      return trackEvent('filter', {
        filter_group: group,
        filter_value: query,
        result_count: currentResultCount(),
        metadata: {
          action,
          control_id: input.id || null,
          control_name: input.name || null,
          search_kind: 'facet_search'
        }
      }, options);
    }
    const scope = searchScopeFor(input);
    const eventType = eventTypeForSearch(input);
    const key = `${eventType}|${scope}|${query.toLowerCase()}`;
    const lastAt = recentSearchEvents.get(key);
    const now = Date.now();
    if (lastAt && now - lastAt < 5000) return Promise.resolve();
    recentSearchEvents.set(key, now);
    return trackEvent(eventType, {
      query,
      filter_group: 'search_scope',
      filter_value: scope,
      result_count: currentResultCount(),
      metadata: {
        action,
        control_id: input.id || null,
        control_name: input.name || null,
        form_id: input.closest?.('form')?.id || null,
        scope
      }
    }, options);
  }

  function bindSearchTracking(){
    document.addEventListener('submit', event => {
      const form = event.target;
      const input = form?.querySelector?.('input[type="search"], input[type="text"], textarea');
      if (!input || !isSearchInput(input)) return;
      recordSearchFromInput(input, 'submit', { keepalive: true });
    }, true);
  }

  function bindInitialCatalogStateTracking(){
    window.setTimeout(() => {
      const params = new URLSearchParams(location.search);
      const query = cleanText(params.get('q'), 240);
      const input = document.getElementById('q') || document.getElementById('qDock') || document.querySelector('.oc-catalog-search-wrap input, input[type="search"]');
      if (query && input && isSearchInput(input)) {
        if (!cleanText(input.value, 240)) input.value = query;
        recordSearchFromInput(input, 'initial_query');
      }
    }, 1800);
  }

  function bindFormTracking(){
    document.addEventListener('shown.bs.modal', event => {
      const form = event.target?.querySelector?.('form');
      if (!form?.id || !FORM_IDS.has(form.id) || loggedForms.has(`${form.id}:open`)) return;
      loggedForms.add(`${form.id}:open`);
      trackEvent('form_open', {
        filter_group: 'form',
        filter_value: form.id,
        metadata: { modal_id: event.target.id || null }
      });
    });
    document.addEventListener('input', event => {
      const form = event.target?.closest?.('form');
      if (!form?.id || !FORM_IDS.has(form.id) || startedForms.has(form.id)) return;
      startedForms.add(form.id);
      trackEvent('form_start', {
        filter_group: 'form',
        filter_value: form.id
      });
    }, true);
    document.addEventListener('submit', event => {
      const form = event.target;
      if (!form?.id || !FORM_IDS.has(form.id)) return;
      trackEvent('form_submit', {
        filter_group: 'form',
        filter_value: form.id
      });
    }, true);
  }

  async function recordPageEngagement(){
    if (engagementRecorded) return;
    const engagementMs = Date.now() - pageStartedAt;
    if (engagementMs < 10000) return;
    engagementRecorded = true;
    await trackEvent('page_engagement', { engagement_ms: engagementMs }, { keepalive: true });
  }

  function bindResourceClicks(){
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      const href = link?.getAttribute('href') || '';
      if (!link || !href || href.startsWith('#') || href.startsWith('mailto:')) return;
      if (link.closest('#maintainerRoot')) return;
      const text = cleanText([
        link.textContent,
        link.getAttribute('aria-label'),
        link.getAttribute('title'),
        link.getAttribute('download')
      ].filter(Boolean).join(' '), 160) || '';
      const cleanHref = href.split('#')[0];
      const isCatalogResource = /(datasets\/detail|models\/details|oers\/details|workflows\/details)\.html/i.test(href) ||
        Boolean(link.closest('.search-result, .featured-card, .related-link, .index-card, [data-resource-card]'));
      const isDownload = link.hasAttribute('download') ||
        link.matches('[data-license-gate]') ||
        /\.(zip|csv|json|geojson|pdf|xlsx?|parquet|las|laz|ply|pcd|ifc|rvt|gbxml)(?:[?#]|$)/i.test(href) ||
        /\b(download|source|code|repo|repository|github|paper|doi|dataset source|view code|view paper|open .* source)\b/i.test(text);
      const isExternal = /^https?:\/\//i.test(href) && !new URL(href, location.href).hostname.endsWith(location.hostname);
      const eventType = isDownload ? 'download_click' : isCatalogResource ? 'resource_click' : isExternal ? 'outbound_click' : '';
      if (!eventType) return;
      trackEvent(eventType, {
        filter_group: isDownload ? 'download' : isCatalogResource ? 'resource' : 'outbound',
        filter_value: cleanText(cleanHref, 160),
        metadata: {
          href,
          title: text,
          external: isExternal,
          target: link.target || null
        }
      }, { keepalive: true });
    }, true);
  }

  const geoPromise = getGeo();
  const visitorHashPromise = getVisitorHash();

  window.OCUsageAnalytics = {
    ready: true,
    trackEvent,
    recordSearchInput: (input, action = 'input', options = {}) => recordSearchFromInput(input, action, options),
    recordSearch: (query, resultCount, metadata = {}, options = {}) => trackEvent('search', { query, result_count: resultCount, metadata }, options),
    recordFilter: (filter_group, filter_value, resultCount, metadata = {}, options = {}) => trackEvent('filter', { filter_group, filter_value, result_count: resultCount, metadata }, options),
    recordDownload: (href, title, metadata = {}, options = {}) => trackEvent('download_click', { filter_group: 'download', filter_value: href, metadata: { title, ...metadata } }, options),
    recordAction: (label, metadata = {}, options = {}) => trackEvent('action_click', { filter_group: 'action', filter_value: label, metadata }, options),
    page: PAGE
  };

  bindSearchTracking();
  bindInitialCatalogStateTracking();
  bindFormTracking();
  bindResourceClicks();

  window.addEventListener('pagehide', () => {
    recordPageEngagement().finally(() => flushUsageEvents({ keepalive: true }));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      recordPageEngagement().finally(() => flushUsageEvents({ keepalive: true }));
    }
  });

  try {
    const geo = await geoPromise;
    const base = geo?.ip ? geo.ip : `vid:${getVisitorId()}`;
    const payload = {
      page: PAGE,
      session_id: getSessionId(),
      is_authenticated: await getAuthContext(),
      ip_hash: await sha256hex(base),
      city: geo?.city || null,
      region: geo?.region || null,
      country: geo?.country || null,
      lat: (geo && typeof geo.lat === 'number') ? geo.lat : null,
      lon: (geo && typeof geo.lon === 'number') ? geo.lon : null,
      ua: cleanUserAgent(navigator.userAgent),
      referrer: document.referrer || null,
      client_kind: classifyClientKind(navigator.userAgent),
      traffic_source: classifyTrafficSource(document.referrer)
    };

    if (shouldRecordPageVisit()) {
      const result = await sb.from('visits').insert(payload);
      if (result.error && isSchemaColumnError(result.error)) {
        const fallback = await sb.from('visits').insert(stripAnalyticsColumns(payload));
        if (fallback.error) console.error('visit logger insert error', fallback.error);
        else markPageVisitRecorded();
      } else if (result.error) {
        console.error('visit logger insert error', result.error);
      } else {
        markPageVisitRecorded();
      }
    }
  } catch (error) {
    console.error('visit logger failed', error);
  }
})();
