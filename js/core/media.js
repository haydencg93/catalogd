// ==================================================
// OPEN LIBRARY UTILITIES
// ==================================================

export function normalizeOpenLibraryId(mediaId) {
    let value = decodeURIComponent(String(mediaId || '')).trim();

    if (!value) return '';

    try {
        if (
            value.startsWith('http://') ||
            value.startsWith('https://')
        ) {
            value = new URL(value).pathname;
        }
    } catch {
        return '';
    }

    if (/^OL\d+[A-Z]$/i.test(value)) {
        return `/works/${value}`;
    }

    if (/^\/?(works|books)\/OL\d+[A-Z]$/i.test(value)) {
        return value.startsWith('/') ? value : `/${value}`;
    }

    return value.startsWith('/') ? value : `/${value}`;
}


// ==================================================
// MEDIA CATEGORIES
// ==================================================

export const MEDIA_CATEGORIES = Object.freeze([
    'movie',
    'tv',
    'anime',
    'book',
    'album',
    'youtube'
]);


export const MEDIA_CATEGORY_LABELS = Object.freeze({
    movie: 'Movies',
    tv: 'TV Shows',
    anime: 'Anime',
    book: 'Books',
    album: 'Music Albums',
    youtube: 'YouTube Videos'
});


export const MEDIA_FILTER_LABELS = Object.freeze({
    all: 'All Media',
    ...MEDIA_CATEGORY_LABELS
});


// These subtype identifiers are ONLY used for badges.

export const MEDIA_BADGE_LABELS = Object.freeze({
    movie: 'Movie',
    tv: 'TV',
    anime: 'Anime',
    'anime-movie': 'Anime (M)',
    'anime-tv': 'Anime (TV)',
    book: 'Book',
    album: 'Album',
    youtube: 'YouTube',
    game: 'Video Game',
    art: 'Art'
});


// ==================================================
// ANIME CLASSIFICATION
// ==================================================

/**
 * true  = confirmed anime
 * false = confirmed non-anime
 * null  = insufficient metadata
 */
export function getAnimeClassification(item) {

    if (!item || typeof item !== 'object') {
        return null;
    }

    const type = getStorageMediaType(item);

    if (type && !['movie', 'tv'].includes(type)) {
        return false;
    }

    if (typeof item.is_anime === 'boolean') {
        return item.is_anime;
    }

    const genres = Array.isArray(item.genres)
        ? item.genres
        : null;

    const genreIds = Array.isArray(item.genre_ids)
        ? item.genre_ids
        : null;

    if (!genres && !genreIds) {
        return null;
    }

    const isAnimation =
        (genres || []).some(
            genre => Number(genre?.id) === 16
        ) ||
        (genreIds || []).some(
            id => Number(id) === 16
        );

    if (!isAnimation) {
        return false;
    }

    const originCountries =
        Array.isArray(item.origin_country)
            ? item.origin_country
            : [];

    const hasLanguage =
        typeof item.original_language === 'string' &&
        item.original_language.trim().length > 0;

    const hasOrigin = originCountries.length > 0;

    if (!hasLanguage && !hasOrigin) {
        return null;
    }

    return (
        originCountries.includes('JP') ||
        item.original_language === 'ja'
    );
}


/**
 * Boolean helper for existing Picker functionality.
 */
export function isAnime(item) {
    return getAnimeClassification(item) === true;
}


// ==================================================
// STORAGE TYPE AND MEDIA CATEGORY
// ==================================================

/**
 * The original storage/API type.
 * Anime titles remain movie or tv internally.
 */
export function getStorageMediaType(item) {

    if (typeof item === 'string') {
        return item;
    }

    return item?.media_type || item?.type || '';
}


/**
 * The actual user-facing media category.
 * Both forms of anime return 'anime'.
 */
export function getMediaCategory(item) {

    const type = getStorageMediaType(item);

    if (['movie', 'tv'].includes(type)) {

        const classification =
            getAnimeClassification(item);

        if (classification === true) {
            return 'anime';
        }

        if (classification === null) {
            return null;
        }
    }

    return type;
}


// ==================================================
// BADGE DISPLAY TYPE
// ==================================================

/**
 * ONLY use this function to determine badge labels
 * and badge CSS classes.
 *
 * Do not use it for filtering, storage,
 * recommendations or favorites categories.
 */
export function getDisplayMediaType(item) {

    const type = getStorageMediaType(item);

    if (['movie', 'tv'].includes(type)) {

        const classification =
            getAnimeClassification(item);

        if (classification === true) {
            return `anime-${type}`;
        }

        if (classification === null) {
            return 'unknown';
        }
    }

    return type;
}


// ==================================================
// MEDIA FILTERING
// ==================================================

export function matchesMediaFilter(
    item,
    filter = 'all',
    { includeAnimeInBaseTypes = false } = {}
) {

    if (!item) return false;

    if (!filter || filter === 'all') {
        return true;
    }

    // Only actual media categories are valid filters.
    if (!MEDIA_CATEGORIES.includes(filter)) {
        return false;
    }

    const type = getStorageMediaType(item);

    if (
        includeAnimeInBaseTypes &&
        ['movie', 'tv'].includes(filter)
    ) {
        return type === filter;
    }

    return getMediaCategory(item) === filter;
}


export function filterMediaItems(
    items,
    filter = 'all',
    options = {}
) {

    if (!Array.isArray(items)) {
        return [];
    }

    return items.filter(item =>
        matchesMediaFilter(item, filter, options)
    );
}


// ==================================================
// SUPABASE FILTERING
// ==================================================

export function applyMediaFilter(
    query,
    filter = 'all',
    { includeAnimeInBaseTypes = false } = {}
) {

    switch (filter) {

        case 'all':
        case '':
            return query;

        case 'anime':
            return query
                .in('media_type', ['movie', 'tv'])
                .eq('is_anime', true);

        case 'movie':
        case 'tv':

            query = query.eq('media_type', filter);

            if (!includeAnimeInBaseTypes) {
                query = query.eq('is_anime', false);
            }

            return query;

        default:

            if (!MEDIA_CATEGORIES.includes(filter)) {
                throw new Error(
                    `Unsupported media filter: ${filter}`
                );
            }

            return query.eq('media_type', filter);
    }
}


// ==================================================
// MEDIA BADGES
// ==================================================

export function getMediaBadgeLabel(item) {

    const displayType = getDisplayMediaType(item);

    return MEDIA_BADGE_LABELS[displayType] || 'Media';
}


export function getMediaBadgeClass(item) {

    const displayType = getDisplayMediaType(item);

    if (
        !Object.prototype.hasOwnProperty.call(
            MEDIA_BADGE_LABELS,
            displayType
        )
    ) {
        return 'badge';
    }

    return `badge badge-${displayType}`;
}


export function renderMediaBadge(item) {

    return `<span class="${getMediaBadgeClass(item)}">${getMediaBadgeLabel(item)}</span>`;
}


// ==================================================
// FAVORITES
// ==================================================

export const MAX_FAVORITES_PER_CATEGORY = 5;


export function createEmptyFavorites() {

    const favorites = Object.fromEntries(
        MEDIA_CATEGORIES.map(category => [
            category,
            []
        ])
    );

    favorites.all = [];

    return favorites;
}


export function buildTopAllFavorites(favorites) {

    return MEDIA_CATEGORIES
        .map(category => favorites?.[category]?.[0])
        .filter(Boolean);
}


export function normalizeFavorites(favorites) {

    const normalized = createEmptyFavorites();

    for (const category of MEDIA_CATEGORIES) {

        normalized[category] =
            Array.isArray(favorites?.[category])
                ? [...favorites[category]]
                : [];
    }

    // Remove confirmed anime from regular favorites.
    // Do not automatically migrate them into Anime.

    normalized.movie = normalized.movie.filter(
        item => getAnimeClassification(item) !== true
    );

    normalized.tv = normalized.tv.filter(
        item => getAnimeClassification(item) !== true
    );

    normalized.all = buildTopAllFavorites(normalized);

    return normalized;
}