export function calculateNewRating(currentRating, starValue, isLeftHalf) {
    const clickedRating = isLeftHalf ? starValue - 0.5 : starValue;
    if (currentRating === starValue && !isLeftHalf) {
        return starValue - 0.5;
    }
    return clickedRating;
}

export function formatTag(rawString) {
    return rawString.trim().toLowerCase().replace(/\s+/g, '-');
}

export function determineTotalPages(apiPages, customPagesStr) {
    const parsedCustom = parseInt(customPagesStr);
    if (parsedCustom && parsedCustom > 0) return parsedCustom;
    return parseInt(apiPages) || 0;
}

export function deriveTVScopePayload(scopeValue, seasonVal, episodeVal, totalEpisodes) {
    const payload = { log_level: scopeValue, ep_count_in_season: 0, season_number: null, episode_number: null };
    
    if (scopeValue === 'entire') {
        payload.ep_count_in_season = totalEpisodes || 0;
    } else if (scopeValue === 'season') {
        if (seasonVal) payload.season_number = parseInt(seasonVal);
    } else if (scopeValue === 'episode') {
        if (seasonVal) payload.season_number = parseInt(seasonVal);
        if (episodeVal) payload.episode_number = parseInt(episodeVal);
    }
    
    return payload;
}