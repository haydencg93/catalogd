export function processSearchResults(tmdb, books, albums, isTiered) {
    const results = [];
    const seenIds = new Set();

    (tmdb || []).filter(item => isTiered || item.media_type !== 'person').slice(0, 5).forEach(item => {
        if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            results.push({ id: item.id, type: item.media_type, title: item.title || item.name });
        }
    });

    (books || []).slice(0, 3).forEach(book => {
        if (!seenIds.has(book.key)) {
            seenIds.add(book.key);
            results.push({ id: book.key, type: 'book', title: book.title });
        }
    });

    (albums?.results?.albummatches?.album || []).slice(0, 3).forEach(a => {
        const compositeId = encodeURIComponent(`${a.artist}|||${a.name}`);
        if (!seenIds.has(compositeId)) {
            seenIds.add(compositeId);
            results.push({ id: compositeId, type: 'album', title: a.name });
        }
    });

    return results;
}

export function normalizeListItemDetails(item, apiResponse, customImgsMap) {
    let title = item.media_title || 'Unknown';
    let poster = 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';

    if (apiResponse) {
        title = apiResponse.title || apiResponse.name || title;
        poster = apiResponse.poster_path 
            ? `https://image.tmdb.org/t/p/w500${apiResponse.poster_path}` 
            : poster;
    }

    if (['character', 'author', 'artist'].includes(item.media_type)) {
        poster = `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=1b2228&color=9ab&size=300`;
    }

    const customArt = customImgsMap.get(`${item.media_type}_${String(item.media_id)}`);
    if (customArt && customArt.custom_poster) {
        poster = customArt.custom_poster;
    }

    return { title, poster };
}

export function calculateNewItemRank(currentItemsLength, isRanked, isTiered) {
    return {
        newRank: (isRanked || isTiered) ? currentItemsLength + 1 : null,
        newTierRank: isTiered ? 'NS' : 'NS'
    };
}