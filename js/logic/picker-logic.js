export function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export function isAnime(item) {
    const isAnimation = (item.genres || []).some(genre => genre.id === 16)
        || (item.genre_ids || []).includes(16);
    const isJapanese = (item.origin_country || []).includes('JP')
        || item.original_language === 'ja';
    return isAnimation && isJapanese;
}

export function getActionLabel(type) {
    if (type === 'book') return 'Mark as Currently Reading';
    if (type === 'album') return 'Mark as Currently Listening';
    return 'Mark as Currently Watching';
}

export function evaluatePickerProviderConstraints(type, requireServices, userStreamingProviderIds, providersData) {
    const flatrate = (providersData.flatrate || []);
    const free = (providersData.free || []);
    const ads = (providersData.ads || []);
    
    let isAvailable = false;
    let availableProvidersList = [];

    if (!['movie', 'tv'].includes(type)) {
        isAvailable = true;
    } else if (!requireServices) {
        isAvailable = true;
        availableProvidersList = [...flatrate, ...free, ...ads];
    } else {
        const flatrateIds = flatrate.map(p => String(p.provider_id));
        const freeIds = free.map(p => String(p.provider_id));
        const adsIds = ads.map(p => String(p.provider_id));

        const isOnUserServices = [...flatrateIds, ...freeIds, ...adsIds].some(pid => userStreamingProviderIds.includes(pid));
        const isFreeAnywhere = freeIds.length > 0;
        const isFreeWithAdsAnywhere = adsIds.length > 0;

        if (isOnUserServices || isFreeAnywhere || isFreeWithAdsAnywhere) {
            isAvailable = true;
            availableProvidersList = [
                ...flatrate.filter(p => userStreamingProviderIds.includes(String(p.provider_id))),
                ...free,
                ...ads
            ];
        }
    }

    return { isAvailable, availableProvidersList };
}