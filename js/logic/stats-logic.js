export function getSafeDate(log) {
    let d = log.watched_on || log.created_at;
    if (d && d.length === 10) d += "T12:00:00"; 
    return new Date(d);
}

export function checkIsOngoing(depth, period, now) {
    const currentYear = now.getFullYear();

    if (depth === 'all-time') return true; 
    
    if (depth === 'by-year') {
        return parseInt(period) === currentYear;
    }

    if (depth === 'by-season') {
        const parts = period.split(' ');
        const season = parts[0];
        let targetStart, targetEnd;

        if (season === 'Winter') {
            const years = parts[1].split('-');
            targetStart = new Date(years[0], 11, 1); 
            targetEnd = new Date(years[1], 2, 0, 23, 59, 59);    
        } else if (season === 'Spring') {
            targetStart = new Date(parts[1], 2, 1);  
            targetEnd = new Date(parts[1], 5, 0, 23, 59, 59);    
        } else if (season === 'Summer') {
            targetStart = new Date(parts[1], 5, 1);  
            targetEnd = new Date(parts[1], 8, 0, 23, 59, 59);    
        } else if (season === 'Fall') {
            targetStart = new Date(parts[1], 8, 1);  
            targetEnd = new Date(parts[1], 11, 0, 23, 59, 59);   
        }

        return now >= targetStart && now <= targetEnd;
    }
    return false;
}

export function filterStatsData(logs, filter, depth, period) {
    return logs.filter(log => {
        if (filter !== 'all' && log.media_type !== filter) return false;

        const date = getSafeDate(log);
        
        if (depth === 'by-year') {
            return date.getFullYear() === parseInt(period);
        } 
        else if (depth === 'by-season') {
            const parts = period.split(' ');
            const season = parts[0];
            let start, end;

            if (season === 'Winter') {
                const years = parts[1].split('-');
                start = new Date(years[0], 11, 1);
                end = new Date(years[1], 2, 0, 23, 59, 59); 
            } else if (season === 'Spring') {
                start = new Date(parts[1], 2, 1); 
                end = new Date(parts[1], 5, 0, 23, 59, 59); 
            } else if (season === 'Summer') {
                start = new Date(parts[1], 5, 1); 
                end = new Date(parts[1], 8, 0, 23, 59, 59);
            } else if (season === 'Fall') {
                start = new Date(parts[1], 8, 1); 
                end = new Date(parts[1], 11, 0, 23, 59, 59);
            }
            return date >= start && date <= end;
        }

        return true; 
    });
}

export function calculateBasicStats(logs) {
    const totalLogs = logs.length;
    const totalReviews = logs.filter(l => l.notes && l.notes.trim() !== '').length;
    const fiveStars = logs.filter(l => l.rating === 5).length;
    
    const entireTvLogs = logs.filter(l => l.media_type === 'tv' && (l.log_level === 'entire' || (!l.season_number && !l.episode_number)));
    const totalShows = entireTvLogs.length;
    const totalTvEpisodes = entireTvLogs.reduce((sum, l) => sum + (parseInt(l.ep_count_in_season) || 0), 0);
    const totalTvSeasons = entireTvLogs.reduce((sum, l) => sum + (parseInt(l.season_number) || 0), 0);

    const totalPages = logs.reduce((sum, l) => {
        if (l.media_type === 'book' && l.is_finished === true) {
            return sum + (parseInt(l.total_pages) || 0);
        }
        return sum;
    }, 0);

    const totalRuntimeMinutes = logs.reduce((sum, l) => {
        if (l.media_type === 'movie' || l.media_type === 'youtube' || l.media_type === 'album') {
            return sum + (parseInt(l.runtime) || 0);
        } else if (l.media_type === 'tv' && (l.log_level === 'entire' || (!l.season_number && !l.episode_number))) {
            const epRuntime = parseInt(l.runtime) || 30; 
            const epCount = parseInt(l.ep_count_in_season) || 1; 
            return sum + (epRuntime * epCount);
        }
        return sum;
    }, 0);
    
    const hoursWatched = (totalRuntimeMinutes / 60).toFixed(1);
    const sortedLogs = [...logs].sort((a, b) => getSafeDate(a) - getSafeDate(b));

    return {
        totalLogs, totalReviews, fiveStars, totalShows, totalTvEpisodes, 
        totalTvSeasons, totalPages, hoursWatched, sortedLogs
    };
}