// Robust year extraction from various Open Library data shapes
export function extractYear(item) {
    if (!item) return null;
    const dateSources = [item.first_publish_date, item.publish_date, item.created?.value, item.last_modified?.value];
    for (let dateStr of dateSources) {
        if (dateStr) {
            const match = String(dateStr).match(/\d{4}/);
            if (match) return match[0];
        }
    }
    return null;
}

export function formatPlays(numStr) {
    const num = parseInt(numStr);
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

export function deduplicateCredits(creditArray) {
    if (!Array.isArray(creditArray)) return [];
    
    const validCredits = creditArray.filter(item => item.poster_path);
    const uniqueCredits = [];
    const seenIds = new Set();
    
    validCredits.forEach(item => {
        if (!seenIds.has(item.id)) {
            uniqueCredits.push(item);
            seenIds.add(item.id);
        }
    });

    return uniqueCredits;
}

export function calculateKnownForScore(item) {
    if (!item || typeof item.vote_count === 'undefined') return 0;
    
    const typeWeight = item.media_type === 'movie' ? 2 : 1;
    return item.vote_count * typeWeight;
}