export function getUniversalId(id, type) {
    if (type === 'movie' || type === 'tv') {
        return parseInt(id);
    }
    if (type === 'book') {
        return parseInt(String(id).replace(/\D/g, ''), 10) + 100000000;
    }
    return id;
}

export function validateVibeInput(currentInputs, newItem) {
    if (currentInputs.length >= 5) {
        return { valid: false, error: "You can only add up to 5 items to define your vibe." };
    }

    const isDuplicate = currentInputs.some(f => f.universalId === newItem.universalId);
    if (isDuplicate) {
        return { valid: false, error: null }; // Silent drop for duplicates
    }

    return { valid: true };
}

export function evaluateStreamingAvailability(providers, userStreamingServices) {
    let subscriptionProviderIds = [];
    let hasFreeOptions = false;

    if (providers) {
        if (providers.flatrate) {
            subscriptionProviderIds.push(...providers.flatrate.map(p => String(p.provider_id)));
        }
        if ((providers.free && providers.free.length > 0) || (providers.ads && providers.ads.length > 0)) {
            hasFreeOptions = true;
        }
    }

    return hasFreeOptions || subscriptionProviderIds.some(id => userStreamingServices.includes(id));
}