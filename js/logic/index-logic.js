export function calculateWeight(rating) {
    if (rating === 5) return 5;
    if (rating >= 4.5) return 2.5;
    return 1;
}

export function evaluateProviderAvailability(item, userStreamingProviderIds) {
    if (userStreamingProviderIds.length === 0) return true;
    
    const usProviders = item['watch/providers']?.results?.US || {};
    const flatrateIds = (usProviders.flatrate || []).map(p => String(p.provider_id));
    const freeIds = (usProviders.free || []).map(p => String(p.provider_id));
    const adsIds = (usProviders.ads || []).map(p => String(p.provider_id));

    const isOnUserServices = [...flatrateIds, ...freeIds, ...adsIds].some(id => userStreamingProviderIds.includes(id));
    const isFreeAnywhere = freeIds.length > 0 || adsIds.length > 0;

    return isOnUserServices || isFreeAnywhere;
}

export function sortSearchResults(combined, query) {
    const q = query.toLowerCase().trim();
    combined.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        if (aTitle === q && bTitle !== q) return -1;
        if (bTitle === q && aTitle !== q) return 1;
        const aStarts = aTitle.startsWith(q);
        const bStarts = bTitle.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        return 0; 
    });
}

export function resolveBookImage(work) {
    if (work.cover_edition_key) return `https://covers.openlibrary.org/b/olid/${work.cover_edition_key}-M.jpg`;
    if (work.cover_i) return `https://covers.openlibrary.org/b/id/${work.cover_i}-M.jpg`;
    return 'https://placehold.co/500x750/1b2228/9ab?text=No+Cover';
}

export function attributionHtml(attr) {
    if (!attr?.text) return '';
    const style = 'position:absolute;bottom:6px;right:8px;font-size:10px;line-height:1.2;' +
        'color:rgba(255,255,255,0.65);background:rgba(0,0,0,0.35);padding:2px 6px;' +
        'border-radius:4px;text-decoration:none;pointer-events:auto;z-index:2;';
    return attr.url
        ? `<a href="${attr.url}" target="_blank" rel="noopener noreferrer" class="vibe-attribution-link" style="${style}">${attr.text}</a>`
        : `<div class="vibe-attribution" style="${style}">${attr.text}</div>`;
}

export function buildDiscoverUrls(mediaType, topGenres, topKeywords, proxyUrl) {
    const providerParams = `&with_watch_monetization_types=flatrate|free|ads`;
    
    const keywordUrls = topKeywords.map(keywordId => {
        let url = `${proxyUrl}/api/tmdb/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US&page=1`;
        url += `&with_genres=${topGenres.join('|')}&with_keywords=${keywordId}${providerParams}`;
        return url;
    });

    const genreOnlyUrls = [1, 2].map(page => {
        let url = `${proxyUrl}/api/tmdb/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US&page=${page}`;
        url += `&with_genres=${topGenres.join('|')}${providerParams}`;
        return url;
    });

    return { keywordUrls, genreOnlyUrls };
}

export function backgroundStyle(img, fallbackGradient) {
    return img ? `background-image: url('${img}'); background-size: cover; background-position: center;`
                : `background: ${fallbackGradient};`;
}

export function extractYouTubeId(query) {
    const ytRegex = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|embed)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const ytMatch = query.match(ytRegex);
    return ytMatch ? ytMatch[1] : null;
}

export function normalizeUserItem(u) {
    return {
        title: u.display_name || u.username, 
        year: `@${u.username}`,
        image: u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name || u.username)}&background=1b2228&color=9ab&size=512`,
        type: 'user', 
        id: u.id
    };
}

export function normalizeTMDBItem(item, filterValue, seenNames) {
    if (item.media_type === 'person' || filterValue === 'person') {
        const nameKey = item.name.toLowerCase();
        if (seenNames.has(nameKey)) return null; 
        seenNames.add(nameKey);
        return {
            title: item.name, 
            year: item.known_for_department || 'Person',
            image: item.profile_path ? `https://image.tmdb.org/t/p/w500${item.profile_path}` : `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=1b2228&color=9ab&size=512`,
            type: 'person', 
            id: item.id
        };
    } else if (item.poster_path || item.backdrop_path) {
        return {
            title: item.title || item.name, 
            year: (item.release_date || item.first_air_date || '').split('-')[0],
            image: `https://image.tmdb.org/t/p/w500${item.poster_path || item.backdrop_path}`, 
            type: item.media_type || filterValue, 
            id: item.id
        };
    }
    return null;
}