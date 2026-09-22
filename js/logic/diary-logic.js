export function filterLogs(allLogs, filters) {
    return allLogs.filter(log => {
        const matchesType = filters.type === 'all' || log.media_type === filters.type;
        const matchesRating = filters.rating === 'all' || Math.floor(log.rating) === parseInt(filters.rating);
        const matchesLiked = filters.liked === 'all' || (filters.liked === 'liked' ? log.is_liked : !log.is_liked);
        const matchesReview = filters.review === 'all' || (filters.review === 'reviewed' ? (log.notes && log.notes.trim() !== '') : (!log.notes || log.notes.trim() === ''));
        const matchesRewatch = filters.rewatch === 'all' || (filters.rewatch === 'rewatch' ? log.is_rewatch : !log.is_rewatch);
        const matchesTag = filters.tag === 'all' || (log.tags && log.tags.includes(filters.tag));
        const matchesYear = filters.year === 'all' || 
            (filters.year === 'unknown' ? (!log.release_year || isNaN(log.release_year) || log.release_year.toString().trim() === '') :
            (filters.year.endsWith('s') ? 
                (log.release_year && log.release_year.toString().startsWith(filters.year.substring(0,3))) : 
                log.release_year == filters.year));
        const matchesSearch = filters.searchTerm === '' || (log.media_title && log.media_title.toLowerCase().includes(filters.searchTerm));

        return matchesType && matchesRating && matchesYear && matchesLiked && matchesReview && matchesRewatch && matchesTag && matchesSearch;
    });
}

export function sortLogs(logs, sortColumn, sortOrder) {
    return [...logs].sort((a, b) => {
        let valA, valB;
        if (sortColumn === 'date') {
            valA = a.watched_on ? new Date(a.watched_on).getTime() : 0;
            valB = b.watched_on ? new Date(b.watched_on).getTime() : 0;
        } else if (sortColumn === 'name') {
            valA = (a.media_title || '').toString().toLowerCase();
            valB = (b.media_title || '').toString().toLowerCase();
        } else if (sortColumn === 'released') {
            valA = parseInt(a.release_year);
            valB = parseInt(b.release_year);
        } else if (sortColumn === 'rating') {
            valA = parseFloat(a.rating) || 0;
            valB = parseFloat(b.rating) || 0;
        }
        if (typeof valA === 'number' && isNaN(valA)) valA = 0;
        if (typeof valB === 'number' && isNaN(valB)) valB = 0;

        if (valA === valB) return 0;
        if (valA < valB) return sortOrder === 'desc' ? 1 : -1;
        return sortOrder === 'desc' ? -1 : 1;
    });
}

export function calculateStats(filteredLogs) {
    const totalLogs = filteredLogs.length;
    const totalRatingSum = filteredLogs.reduce((acc, log) => acc + (log.rating || 0), 0);
    const avgRating = totalLogs > 0 ? (totalRatingSum / totalLogs).toFixed(1) : "0.0";
    const totalMovies = filteredLogs.filter(l => l.media_type === 'movie').length;
    const totalBooks = filteredLogs.filter(l => l.media_type === 'book' && l.is_finished === true).length;
    const totalMinutes = filteredLogs.reduce((acc, log) => acc + (log.runtime || 0), 0);
    
    return {
        totalLogs, avgRating, totalMovies, totalBooks, totalMinutes,
        days: Math.floor(totalMinutes / 1440),
        hours: Math.floor((totalMinutes % 1440) / 60),
        minutes: totalMinutes % 60
    };
}