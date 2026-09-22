export function buildWikidataQuery(propertyId, externalId) {
    const sparqlQuery = `
        SELECT ?article WHERE {
            ?item wdt:${propertyId} "${externalId}".
            ?article schema:about ?item ;
                     schema:isPartOf <https://en.wikipedia.org/> .
        } LIMIT 1
    `;
    return `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;
}

export function sortCollectionItems(items) {
    return items.sort((a, b) => {
        const yearA = parseInt(String(a.year || a.firstAired || a.releaseDate || '9999').split('-')[0]) || 9999;
        const yearB = parseInt(String(b.year || b.firstAired || b.releaseDate || '9999').split('-')[0]) || 9999;
        if (yearA !== yearB) return yearA - yearB;
        return (a.id || 0) - (b.id || 0);
    });
}

export function normalizeFandomCharacter(c, type) {
    let charName = c.character;
    if (type === 'tv' && c.roles && c.roles.length > 0) { charName = c.roles[0].character; }
    let cleanName = charName ? charName.replace(/\(voice\)/gi, '').trim() : "Unknown";
    cleanName = cleanName.split('/')[0].trim();
    
    return {
        name: cleanName,
        wikiId: cleanName.replace(/\s+/g, '_'), 
        tmdbImage: c.profile_path ? `https://image.tmdb.org/t/p/w300${c.profile_path}` : null
    };
}

export function processTVDBLists(lists) {
    const validLists = lists.filter(l => {
        const name = l.name.toLowerCase();
        return l.isOfficial || 
               name.includes('franchise') || 
               name.includes('saga') || 
               name.includes('universe') || 
               name.includes('collection');
    });

    const uniqueListsMap = new Map();
    validLists.forEach(l => {
        const nameKey = l.name.toLowerCase().trim();
        const existing = uniqueListsMap.get(nameKey);
        if (!existing || (l.isOfficial && !existing.isOfficial)) {
            uniqueListsMap.set(nameKey, l);
        }
    });

    return Array.from(uniqueListsMap.values()).sort((a, b) => {
        const getScore = (l) => {
            let score = 0;
            if (l.isOfficial) score += 10;
            const name = l.name.toLowerCase();
            if (name.includes('franchise')) score += 5;
            if (name.includes('saga')) score += 5;
            if (name.includes('universe')) score += 5;
            if (name.includes('collection')) score += 3;
            return score;
        };
        return getScore(b) - getScore(a);
    }).slice(0, 5);
}
