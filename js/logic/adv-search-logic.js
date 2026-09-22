export function deduplicateResults(results) {
    const uniqueMap = new Map();
    results.forEach(item => uniqueMap.set(item.id, item));
    return Array.from(uniqueMap.values());
}

export function applyTextFilter(results, textQuery) {
    if (!textQuery) return results.sort((a, b) => b.popularity - a.popularity);
    
    return results.filter(item => 
        (item.title || item.name || '').toLowerCase().includes(textQuery) || 
        (item.overview || '').toLowerCase().includes(textQuery)
    ).sort((a, b) => {
        const aMatch = (a.title || a.name || '').toLowerCase().includes(textQuery);
        const bMatch = (b.title || b.name || '').toLowerCase().includes(textQuery);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return b.popularity - a.popularity;
    });
}

export function checkYearLocally(item, filters) {
    if (!filters.minYear && !filters.maxYear) return true;
    const year = parseInt((item.release_date || item.first_air_date || '').split('-')[0]);
    if (isNaN(year)) return true; // Let it pass if API data is missing
    
    if (filters.minYear && year < parseInt(filters.minYear)) return false;
    if (filters.maxYear && year > parseInt(filters.maxYear)) return false;
    return true;
}

export function checkLanguage(detailData, langRule, selectedIsos) {
    if (selectedIsos.length === 0) return true;
    const isOriginalMatch = selectedIsos.includes(detailData.original_language);
    if (langRule === 'original') return isOriginalMatch;
    
    const isTranslationMatch = detailData.translations?.translations?.some(t => selectedIsos.includes(t.iso_639_1));
    return isOriginalMatch || isTranslationMatch;
}

export function checkProviders(detailData, includeFree, activeProviderIds) {
    if (activeProviderIds.length === 0) return true;
    const usProviders = detailData['watch/providers']?.results?.US || {};
    
    const checkProvider = (arr) => arr?.some(p => activeProviderIds.includes(String(p.provider_id))) ?? false;
    
    const isOnSelectedServices = checkProvider(usProviders.flatrate) || checkProvider(usProviders.free) || checkProvider(usProviders.ads);
    if (includeFree) return isOnSelectedServices || (usProviders.free?.length > 0) || (usProviders.ads?.length > 0);
    
    return isOnSelectedServices;
}

export function getDurationParams(mediaType, filters) {
    const bounds = mediaType === 'movie' ? filters.movieBounds : filters.tvBounds;
    if (!bounds) return '';
    
    let params = '';
    if (bounds.min !== null) params += `&with_runtime.gte=${bounds.min}`;
    if (bounds.max !== null && bounds.max < 999) params += `&with_runtime.lte=${bounds.max}`;
    return params;
}

export function getProviderParams(filters) {
    if (!filters.providersStr) return '';
    return filters.includeFree 
        ? `&with_watch_monetization_types=flatrate|free|ads`
        : `&with_watch_providers=${filters.providersStr}&with_watch_monetization_types=flatrate|free|ads`;
}

export function buildBaseUrl(mediaType, filters, proxyUrl) {
    let url = `${proxyUrl}/api/tmdb/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US`;
    
    url += getProviderParams(filters);
    if (filters.keywordsStr) url += `&with_keywords=${filters.keywordsStr}`;
    if (filters.coreGenresStr) url += `&with_genres=${filters.coreGenresStr}`;
    if (filters.selectedIsos.length > 0 && filters.langRule === 'original') {
        url += `&with_original_language=${filters.selectedIsos.join('|')}`;
    }
    
    if (filters.minYear) {
        if (mediaType === 'movie') url += `&primary_release_date.gte=${filters.minYear}-01-01`;
        if (mediaType === 'tv') url += `&first_air_date.gte=${filters.minYear}-01-01`;
    }
    if (filters.maxYear) {
        if (mediaType === 'movie') url += `&primary_release_date.lte=${filters.maxYear}-12-31`;
        if (mediaType === 'tv') url += `&first_air_date.lte=${filters.maxYear}-12-31`;
    }

    url += getDurationParams(mediaType, filters);
    return url;
}

export function buildDiscoverUrls(mediaTypes, textQuery, filters, currentPage, proxyUrl) {
    const urls = [];
    const pages = textQuery ? [currentPage, currentPage + 1, currentPage + 2] : [currentPage];
    
    mediaTypes.forEach(mediaType => {
        if (textQuery) {
            // Use TMDB's specific Search API instead of Discover API when text is present
            const url = `${proxyUrl}/api/tmdb/search/${mediaType}?query=${encodeURIComponent(textQuery)}&language=en-US`;
            pages.forEach(page => urls.push({ url: `${url}&page=${page}`, type: mediaType }));
        } else {
            // Use Discover API for standard filter-based browsing
            const baseUrl = buildBaseUrl(mediaType, filters, proxyUrl);
            pages.forEach(page => urls.push({ url: `${baseUrl}&page=${page}`, type: mediaType }));
        }
    });
    return urls;
}