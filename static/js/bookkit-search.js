(() => {
  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
    'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'when',
    'where', 'which', 'why', 'with',
  ]);

  const asString = (value) => (value == null ? '' : String(value));
  const asList = (value) => {
    if (Array.isArray(value)) return value.map(asString);
    if (!value) return [];
    return [asString(value)];
  };

  const normalize = (value) => asString(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ' ')
    .replace(/[^a-z0-9_+#.-]+/g, ' ')
    .trim();

  const tokenize = (value) => normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((term) => term.length > 1 || term === 'r' || term === 'c')
    .filter((term) => !STOP_WORDS.has(term));

  const variantsFor = (term) => {
    const variants = new Set([term]);
    if (term.length > 4 && term.endsWith('ies')) variants.add(`${term.slice(0, -3)}y`);
    if (term.length > 4 && term.endsWith('es')) variants.add(term.slice(0, -2));
    if (term.length > 3 && term.endsWith('s')) variants.add(term.slice(0, -1));
    return [...variants];
  };

  const levenshteinAtMostOne = (left, right) => {
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1) return false;

    let i = 0;
    let j = 0;
    let edits = 0;

    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        i += 1;
        j += 1;
        continue;
      }

      edits += 1;
      if (edits > 1) return false;

      if (left.length > right.length) i += 1;
      else if (right.length > left.length) j += 1;
      else {
        i += 1;
        j += 1;
      }
    }

    if (i < left.length || j < right.length) edits += 1;
    return edits <= 1;
  };

  const metadataMatchScore = (tokens, variants, { exact = 10, prefix = 6, fuzzy = 3 } = {}) => {
    let best = 0;
    for (const variant of variants) {
      for (const token of tokens) {
        if (token === variant) best = Math.max(best, exact);
        else if (variant.length >= 3 && token.startsWith(variant)) best = Math.max(best, prefix);
        else if (variant.length >= 4 && levenshteinAtMostOne(token, variant)) best = Math.max(best, fuzzy);
      }
    }
    return best;
  };

  const initSearch = () => {
    const root = document.querySelector('[data-site-search]');
    const form = document.querySelector('[data-site-search-form]');
    const input = document.querySelector('[data-site-search-input]');
    const results = document.querySelector('[data-search-results]');
    const status = document.querySelector('[data-search-status]');
    const template = document.getElementById('site-search-result-template');
    const filters = [...document.querySelectorAll('[data-search-filter]')];

    if (!root || !form || !input || !results || !status || !template) return;

    const indexUrl = root.dataset.searchIndexUrl;
    if (!indexUrl) {
      status.textContent = 'Search index is not available.';
      return;
    }

    let activeFilter = 'All';
    const bookFilter = root.querySelector('[data-search-book]');
    const browse = root.hasAttribute('data-search-browse');
    const previous = root.querySelector('[data-search-prev]');
    const next = root.querySelector('[data-search-next]');
    let offset = 0;
    let records = [];
    let indexPromise = null;
    let renderVersion = 0;
    let inputTimer = null;

    const prepareRecord = (record) => {
      const title = asString(record.title);
      const type = asString(record.type);
      const series = asString(record.series);
      const description = asString(record.description);
      const tags = asList(record.tags);
      const categories = asList(record.categories);
      const keywords = asList(record.keywords);
      const terms = asList(record.terms).map(normalize).filter(Boolean);

      return {
        title,
        book: asString(record.book),
        url: asString(record.url),
        type,
        series,
        description,
        date: asString(record.date),
        tags,
        categories,
        keywords,
        priority: Number(record.priority) || 0,
        titleNormalized: normalize(title),
        seriesNormalized: normalize(series),
        descriptionNormalized: normalize(description),
        titleTokens: tokenize(title),
        seriesTokens: tokenize(series),
        typeTokens: tokenize(type),
        tagTokens: tokenize(tags.join(' ')),
        categoryTokens: tokenize(categories.join(' ')),
        keywordTokens: tokenize(keywords.join(' ')),
        descriptionTokens: tokenize(description),
        bodyTerms: new Set(terms),
      };
    };

    const loadIndex = () => {
      if (indexPromise) return indexPromise;

      status.textContent = 'Loading the search index…';
      indexPromise = fetch(indexUrl, { headers: { Accept: 'application/json' } })
        .then((response) => {
          if (!response.ok) throw new Error(`Search index returned ${response.status}`);
          return response.json();
        })
        .then((payload) => {
          const rawRecords = Array.isArray(payload) ? payload : payload.records;
          records = (Array.isArray(rawRecords) ? rawRecords : [])
            .filter((record) => record && typeof record === 'object')
            .map(prepareRecord)
            .filter((record) => record.title && record.url && record.type);
          return records;
        })
        .catch((error) => {
          console.error('Bookkit search index load failed', error);
          status.textContent = 'Search index could not be loaded. Please refresh the page and try again.';
          throw error;
        });

      return indexPromise;
    };

    const scoreRecord = (record, query) => {
      const terms = tokenize(query);
      if (!terms.length) return 0;

      let score = 0;
      let matchedTerms = 0;

      for (const term of terms) {
        const variants = variantsFor(term);
        let termScore = 0;

        if (variants.some((variant) => record.titleNormalized === variant)) termScore += 34;
        termScore += metadataMatchScore(record.titleTokens, variants, { exact: 22, prefix: 14, fuzzy: 9 });
        termScore += metadataMatchScore(record.seriesTokens, variants, { exact: 9, prefix: 6, fuzzy: 3 });
        termScore += metadataMatchScore(record.keywordTokens, variants, { exact: 9, prefix: 6, fuzzy: 3 });
        termScore += metadataMatchScore(record.tagTokens, variants, { exact: 8, prefix: 5, fuzzy: 3 });
        termScore += metadataMatchScore(record.categoryTokens, variants, { exact: 7, prefix: 4, fuzzy: 2 });
        termScore += metadataMatchScore(record.typeTokens, variants, { exact: 5, prefix: 3, fuzzy: 1 });
        termScore += metadataMatchScore(record.descriptionTokens, variants, { exact: 5, prefix: 3, fuzzy: 1 });

        if (variants.some((variant) => record.bodyTerms.has(variant))) termScore += 2;

        if (termScore > 0) {
          matchedTerms += 1;
          score += termScore;
        }
      }

      const minimumMatches = terms.length <= 2
        ? terms.length
        : Math.ceil(terms.length * 0.6);
      if (matchedTerms < minimumMatches) return 0;

      const phrase = normalize(query);
      if (phrase.length > 2 && record.titleNormalized.includes(phrase)) score += 28;
      if (phrase.length > 2 && record.seriesNormalized.includes(phrase)) score += 12;
      if (phrase.length > 2 && record.descriptionNormalized.includes(phrase)) score += 6;

      score += record.priority * 2;
      return score;
    };

    const clearResults = () => {
      while (results.firstChild) results.removeChild(results.firstChild);
    };

    const syncUrl = (query) => {
      const url = new URL(window.location.href);
      if (query) url.searchParams.set('q', query);
      else url.searchParams.delete('q');
      if (bookFilter?.value) url.searchParams.set('book', bookFilter.value);
      else url.searchParams.delete('book');
      window.history.replaceState({}, '', url);
    };

    const render = async ({ updateUrl = false } = {}) => {
      const version = ++renderVersion;
      const query = input.value.trim();
      clearResults();

      if (updateUrl) syncUrl(query);

      try {
        await loadIndex();
      } catch (_error) {
        return;
      }
      if (version !== renderVersion) return;

      if (!query && !browse) {
        status.textContent = `Search ${records.length} indexed resources across the library, including examples.`;
        return;
      }

      const allMatches = records
        .filter((record) => !bookFilter?.value || record.book === bookFilter.value)
        .filter((record) => activeFilter === 'All' || record.type === activeFilter)
        .map((record) => ({ record, score: query ? scoreRecord(record, query) : 1 }))
        .filter((item) => item.score > 0)
        .sort((a, b) => (
          b.score - a.score
          || (b.record.date || '').localeCompare(a.record.date || '')
          || a.record.title.localeCompare(b.record.title)
        ));
      if (offset >= allMatches.length) offset = 0;
      const matches = allMatches.slice(offset, offset + 80);
      if (previous) previous.hidden = offset === 0;
      if (next) next.hidden = offset + 80 >= allMatches.length;

      status.textContent = browse && !query
        ? `Showing ${allMatches.length ? offset + 1 : 0}–${offset + matches.length} of ${allMatches.length} examples.`
        : matches.length
        ? `${matches.length}${matches.length === 80 ? '+' : ''} result${matches.length === 1 ? '' : 's'} for “${query}”${activeFilter === 'All' ? '' : ` in ${activeFilter}`}.`
        : `No results for “${query}”${activeFilter === 'All' ? '' : ` in ${activeFilter}`}. Try fewer words or a broader term.`;

      matches.forEach(({ record }) => {
        const node = template.content.cloneNode(true);
        const type = node.querySelector('[data-result-type]');
        const series = node.querySelector('[data-result-series]');
        const date = node.querySelector('[data-result-date]');
        const link = node.querySelector('[data-result-link]');
        const description = node.querySelector('[data-result-description]');
        const action = node.querySelector('[data-result-action]');

        type.textContent = record.type;
        if (record.series) series.textContent = record.series;
        else series.remove();

        if (record.date && record.date !== '0001-01-01') {
          date.dateTime = record.date;
          date.textContent = record.date;
        } else {
          date.remove();
        }

        link.href = record.url;
        link.textContent = record.title;
        description.textContent = record.description || `Open this ${record.type.toLowerCase()} in the library.`;
        action.href = record.url;

        results.appendChild(node);
      });
    };

    previous?.addEventListener('click', () => { offset = Math.max(0, offset - 80); render(); });
    next?.addEventListener('click', () => { offset += 80; render(); });
    bookFilter?.addEventListener('change', () => { offset = 0; render({ updateUrl: true }); });

    filters.forEach((button) => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.searchFilter || 'All';
        offset = 0;
        filters.forEach((item) => item.classList.toggle('is-active', item === button));
        render();
      });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(inputTimer);
      offset = 0;
      render({ updateUrl: true });
    });

    input.addEventListener('input', () => {
      offset = 0;
      clearTimeout(inputTimer);
      inputTimer = window.setTimeout(() => render(), 120);
    });

    const params = new URLSearchParams(window.location.search);
    const initialQuery = params.get('q');
    if (initialQuery) input.value = initialQuery;
    if (bookFilter && params.get('book')) bookFilter.value = params.get('book');

    loadIndex()
      .then(() => render())
      .catch(() => {});
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearch, { once: true });
  } else {
    initSearch();
  }
})();
