export function splitProviders(providerArray) {
    const buyingIds = new Set([2, 3, 7, 10, 68, 192, 358, 48]);
    const providerMap = new Map();
    
    providerArray.forEach(p => {
        if (!providerMap.has(p.provider_id)) providerMap.set(p.provider_id, p);
    });
    
    const sortedProviders = Array.from(providerMap.values())
        .sort((a, b) => (a.display_priorities?.US ?? 99) - (b.display_priorities?.US ?? 99));

    const streamingProviders = [];
    const buyingProviders = [];

    sortedProviders.forEach(p => {
        if (buyingIds.has(p.provider_id)) {
            buyingProviders.push(p);
        } else {
            streamingProviders.push(p);
        }
    });

    return {
        topStreaming: streamingProviders.slice(0, 30),
        topBuying: buyingProviders.slice(0, 10)
    };
}

export function sortLanguages(languagesArray) {
    return [...languagesArray].sort((a, b) => a.english_name.localeCompare(b.english_name));
}

export function parseYouTubeId(query) {
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = query.match(ytRegex);
    return match ? match[1] : null;
}

export function buildFavsCsvArray(favoritesObj, customImgMap) {
    const favsData = [["Type", "Title", "ID", "Rank", "Custom Poster", "Custom Background"]];
    if (!favoritesObj) return favsData;
    
    for (const [type, list] of Object.entries(favoritesObj)) {
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const custom = customImgMap.get(`${type}_${item.id}`) || { poster: "", bg: "" };
            favsData.push([type, item.title, item.id, i + 1, custom.poster || "", custom.bg || ""]);
        }
    }
    return favsData;
}

export function parseLetterboxdListCsv(rawData) {
    if (!rawData || rawData.length < 3) return { error: "Invalid CSV format" };
    
    const listName = rawData[2][1] || "Imported List";
    const listDescription = rawData[2][4] || "";
    
    const headerRowIndex = rawData.findIndex(row => row.includes("Position") && row.includes("Name"));
    if (headerRowIndex === -1) return { error: "Could not find movie data in CSV." };
    
    const movieRows = rawData.slice(headerRowIndex + 1);
    
    return { listName, listDescription, movieRows };
}

export function parseAdvancedCsv(data) {
    if (!data || data.length < 2) return [];
    const headers = data[0];
    return data.slice(1).map(row => {
        let obj = {};
        headers.forEach((h, i) => obj[h] = row[i]);
        return obj;
    });
}

export function buildImportPayload(userId, mediaInfo, title, watchedDate, rowRating, isRewatch, existingId) {
    const payload = {
        user_id: userId,
        media_id: String(mediaInfo.id),
        media_type: mediaInfo.type,
        media_title: title,
        rating: rowRating,
        watched_on: watchedDate,
        runtime: mediaInfo.runtime || 0,
        is_rewatch: isRewatch,
        created_at: new Date().toISOString()
    };
    if (existingId) {
        payload.id = existingId;
    }
    return payload;
}