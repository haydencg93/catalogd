export function buildLibraryArray(allStatuses, allUserLogs) {
    let libraryMap = new Map();
    let droppedKeys = new Set();

    if (allStatuses) {
        allStatuses.forEach(s => {
            const key = `${s.media_type}_${s.media_id}`;
            if (s.status === 'dropped') {
                droppedKeys.add(key);
            } else {
                libraryMap.set(key, {
                    media_id: s.media_id,
                    media_type: s.media_type,
                    media_title: s.media_title,
                    image_url: s.image_url,
                    first_added: s.created_at || s.updated_at
                });
            }
        });
    }

    if (allUserLogs) {
        allUserLogs.forEach(l => {
            const key = `${l.media_type}_${l.media_id}`;
            const logDate = new Date(l.watched_on || l.created_at);

            if (!droppedKeys.has(key)) {
                if (libraryMap.has(key)) {
                    const existing = libraryMap.get(key);
                    
                    if (new Date(l.created_at) < new Date(existing.first_added)) {
                        existing.first_added = l.created_at;
                    }
                    if (!existing.latest_log_date || logDate > existing.latest_log_date) {
                        existing.latest_log_date = logDate;
                        existing.rating = l.rating;
                        existing.is_liked = l.is_liked;
                    }
                    if (!existing.image_url && l.image_url) existing.image_url = l.image_url;
                    if (!existing.media_title && l.media_title) existing.media_title = l.media_title;
                } else {
                    libraryMap.set(key, {
                        media_id: l.media_id,
                        media_type: l.media_type,
                        media_title: l.media_title,
                        image_url: l.image_url,
                        first_added: l.created_at,
                        latest_log_date: logDate,
                        rating: l.rating,
                        is_liked: l.is_liked
                    });
                }
            }
        });
    }

    return Array.from(libraryMap.values()).sort((a, b) => new Date(b.first_added) - new Date(a.first_added));
}

export function calculateRevisitCandidates(allUserLogs, nowMs) {
    const thresholds = {
        movie: 365 * 24 * 60 * 60 * 1000,     // 1 Year
        tv: 365 * 24 * 60 * 60 * 1000,        // 1 Year
        book: 2 * 365 * 24 * 60 * 60 * 1000,  // 2 Years
        album: 180 * 24 * 60 * 60 * 1000      // 6 Months
    };

    const latestLogs = {};

    allUserLogs.forEach(log => {
        const key = `${log.media_type}_${log.media_id}`;
        const logDate = new Date(log.watched_on || log.created_at).getTime();
        
        if (!latestLogs[key] || logDate > latestLogs[key].dateMs) {
            latestLogs[key] = { ...log, dateMs: logDate, date: new Date(logDate) };
        }
    });

    const candidates = { movie: [], tv: [], book: [], album: [] };

    Object.values(latestLogs).forEach(log => {
        if (!thresholds[log.media_type]) return; 
        if (!log.rating || log.rating < 4) return;

        const timeDiff = nowMs - log.dateMs;
        if (timeDiff > thresholds[log.media_type]) {
            candidates[log.media_type].push(log);
        }
    });

    ['movie', 'tv', 'book', 'album'].forEach(type => {
        candidates[type].sort((a, b) => a.dateMs - b.dateMs);
    });

    return candidates;
}

export function sortTrackedEntities(entities, categoryKey, categoryValue) {
    return entities
        .filter(e => e[categoryKey] === categoryValue)
        .sort((a, b) => (a.rank || 0) - (b.rank || 0));
}