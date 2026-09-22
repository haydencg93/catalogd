export function buildYoutubeFallbackData(id) {
    const youtubeId = String(id || '').trim();
    const hasValidId = /^[A-Za-z0-9_-]{11}$/.test(youtubeId);

    return {
        title: 'Unknown YouTube video',
        overview: 'This video is unavailable, deleted, or no longer accessible. The YouTube metadata for it could not be loaded.',
        poster_path: 'https://placehold.co/500x750/1b2228/ff0000?text=YouTube',
        meta: 'YouTube Video',
        author_name: 'Unknown Channel',
        isUnavailable: true,
        youtubeId: youtubeId,
        isValidId: hasValidId
    };
}

export function getLogScopeLabel(log, mediaType, mediaData) {
    let label = mediaType.charAt(0).toUpperCase() + mediaType.slice(1); // Default to media mediaType
    
    if (mediaType === 'tv') {
        label = log.episode_number ? `S${log.season_number} E${log.episode_number}` : 
               (log.season_number ? `Season ${log.season_number}` : `Entire Series`);
    } else if (mediaType === 'album') {
        if (log.episode_number && mediaData && mediaData.tracks && mediaData.tracks[log.episode_number - 1]) {
            label = `Track ${log.episode_number}: ${mediaData.tracks[log.episode_number - 1].name}`;
        } else {
            label = 'Entire Album';
        }
    } else if (mediaType === 'book') {
        if (log.current_page && !log.is_finished) {
            label = `Page ${log.current_page}`;
        } else if (log.chapter_number) {
            label = `Chapter ${log.chapter_number}`;
        } else {
            label = 'Entire Book';
        }
    }
    return label;
}

export function categorizeProviders(results) {
    const flatrate = results.flatrate || [];
    const free = results.free || [];
    const ads = results.ads || [];
    const buy = results.buy || [];
    const rent = results.rent || [];

    const freeToWatchMap = new Map();
    [...free, ...ads].forEach(p => freeToWatchMap.set(p.provider_id, p));
    const freeToWatchList = Array.from(freeToWatchMap.values());

    const streamList = [...flatrate];

    const buyRentMap = new Map();
    [...buy, ...rent].forEach(p => buyRentMap.set(p.provider_id, p));
    const buyRentList = Array.from(buyRentMap.values());

    const handledIds = new Set([
        ...freeToWatchList.map(p => p.provider_id),
        ...streamList.map(p => p.provider_id),
        ...buyRentList.map(p => p.provider_id)
    ]);
    
    const otherList = [];
    for (const key in results) {
        if (Array.isArray(results[key])) {
            results[key].forEach(p => {
                if (!handledIds.has(p.provider_id)) {
                    otherList.push(p);
                    handledIds.add(p.provider_id); 
                }
            });
        }
    }

    return { freeToWatchList, streamList, buyRentList, otherList };
}

export function normalizeCredits(res, mediaType) {
    let fullCast = [];
    let fullCrew = [];

    if (mediaType === 'tv') {
        fullCast = res.cast.map(p => ({
            ...p,
            displayRole: p.roles && p.roles.length > 0 ? p.roles[0].character : 'Cast',
            epCountStr: p.total_episode_count ? `${p.total_episode_count} Ep${p.total_episode_count > 1 ? 's' : ''}` : ''
        }));

        fullCrew = res.crew.map(p => ({
            ...p,
            job: p.jobs && p.jobs.length > 0 ? p.jobs[0].job : 'Crew',
            displayRole: p.jobs && p.jobs.length > 0 ? p.jobs[0].job : 'Crew',
            epCountStr: p.total_episode_count ? `${p.total_episode_count} Ep${p.total_episode_count > 1 ? 's' : ''}` : ''
        }));
    } else {
        fullCast = res.cast.map(p => ({
            ...p,
            displayRole: p.character || 'Cast',
            epCountStr: ''
        }));

        fullCrew = res.crew.map(p => ({
            ...p,
            job: p.job,
            displayRole: p.job || 'Crew',
            epCountStr: ''
        }));
    }

    const director = fullCrew.find(person => 
        person.job === 'Director' || (person.job === 'Executive Producer' && mediaType === 'tv')
    );

    return { fullCast, fullCrew, director };
}