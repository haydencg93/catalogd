import { getAnimeClassification, matchesMediaFilter, applyMediaFilter } from "../core/media.js";

import { calculateWeight, evaluateProviderAvailability } from "./index-logic.js";

export const INDEX_TRENDING_LIMIT = 20;
export const INDEX_FOR_YOU_LIMIT = 12;

const tmdbTypes = ["movie", "tv"];

// Terms excluded exclusively from Anime taste scoring.
const noMedium =
    /\b(?:anime|animation|animated)\b|\bbased\s+on\s+(?:a\s+)?(?:manga|novel\s+or\s+book)\b/i;

// TMDB Movies and TV use different genre IDs.
// Map equivalent genres for cross-format recommendations.

const genreIds = {
    movie: {
        action: 28,
        adventure: 12,
        animation: 16,
        comedy: 35,
        crime: 80,
        documentary: 99,
        drama: 18,
        family: 10751,
        fantasy: 14,
        history: 36,
        horror: 27,
        music: 10402,
        mystery: 9648,
        romance: 10749,
        "science fiction": 878,
        "tv movie": 10770,
        thriller: 53,
        war: 10752,
        western: 37,
    },

    tv: {
        action: 10759,
        adventure: 10759,
        animation: 16,
        comedy: 35,
        crime: 80,
        documentary: 99,
        drama: 18,
        family: 10751,
        kids: 10762,
        mystery: 9648,
        news: 10763,
        reality: 10764,
        "science fiction": 10765,
        fantasy: 10765,
        soap: 10766,
        talk: 10767,
        war: 10768,
        politics: 10768,
        western: 37,
    },
};

// =========================================
// INDEX FILTER SCOPE
// =========================================

export function indexScope(category, subtype = "all") {
    const types =
        category === "anime" ? (tmdbTypes.includes(subtype) ? [subtype] : tmdbTypes) : [category];

    return {
        category,
        types,

        vibeKey: category === "anime" && types.length === 1 ? `anime_${types[0]}` : category,
    };
}

export function matchesIndexScope(item, scope) {
    return (
        scope.types.includes(item.media_type || item.type) &&
        matchesMediaFilter(item, scope.category)
    );
}

export function mediaKey(item) {
    return `${item.media_type || item.type}_${item.media_id ?? item.id}`;
}

// =========================================
// NETWORK REQUESTS
// =========================================

function abortCheck(signal) {
    signal?.throwIfAborted();
}

async function json(url, signal) {
    for (let attempt = 0; attempt < 3; attempt++) {
        abortCheck(signal);

        const res = await fetch(url, { signal });

        if (res.ok) {
            return res.json();
        }

        if (res.status !== 429 || attempt === 2) {
            throw new Error(`HTTP ${res.status}: ${url}`);
        }

        await new Promise((resolve) =>
            setTimeout(
                resolve,

                Math.min(
                    5000,

                    1000 * (Number(res.headers.get("retry-after")) || attempt + 1),
                ),
            ),
        );
    }
}

async function safeJson(url, signal) {
    try {
        return await json(url, signal);
    } catch (err) {
        abortCheck(signal);

        console.warn("Index metadata request failed:", err);

        return null;
    }
}

async function batches(items, fn) {
    const output = [];

    for (let i = 0; i < items.length; i += 6) {
        output.push(...(await Promise.all(items.slice(i, i + 6).map(fn))));
    }

    return output;
}

function detail(proxy, type, id, signal, append = "") {
    return safeJson(
        `${proxy}/api/tmdb/${type}/${encodeURIComponent(id)}${
            append ? `?append_to_response=${append}` : ""
        }`,

        signal,
    );
}

// =========================================
// CLASSIFY TMDB RESULTS
// =========================================

export async function classifyIndexItems(items, proxy, signal) {
    return batches(items, async (item) => {
        abortCheck(signal);

        const type = item.media_type || item.type;

        if (!tmdbTypes.includes(type)) {
            return item;
        }

        let anime = getAnimeClassification({
            ...item,
            media_type: type,
        });

        const animated =
            item.genre_ids?.some((id) => Number(id) === 16) ||
            item.genres?.some((g) => Number(g.id) === 16);

        // Search and trending metadata may omit
        // the title's origin country.

        if (
            typeof item.is_anime !== "boolean" &&
            (anime === null || (animated && anime !== true && !Array.isArray(item.origin_country)))
        ) {
            const data = await detail(proxy, type, item.media_id ?? item.id, signal);

            anime = data?.id
                ? getAnimeClassification({
                      ...data,
                      media_type: type,
                  })
                : null;
        }

        return {
            ...item,
            media_type: type,
            is_anime: anime,
        };
    });
}

// =========================================
// NORMALIZED MEDIA CARD
// =========================================

function card(item, extra = {}) {
    return {
        title: item.title || item.name || "Unknown title",

        year: (item.release_date || item.first_air_date || "").split("-")[0],

        image: item.poster_path
            ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
            : "https://placehold.co/500x750/1b2228/9ab?text=No+Image",

        type: item.media_type,

        id: item.id,

        is_anime: item.is_anime,

        ...extra,
    };
}

// =========================================
// DISCOVERY URL CONSTRUCTION
// =========================================

function discoverUrls(proxy, type, params, anime) {
    const make = (extra) =>
        `${proxy}/api/tmdb/discover/${type}?${new URLSearchParams({
            language: "en-US",
            sort_by: "popularity.desc",
            ...params,
            ...extra,
        })}`;

    if (!anime) {
        return [make({})];
    }

    // Anime always requires the Animation genre.
    // This is classification, NOT taste scoring.

    const genres = params.with_genres ? `16,${params.with_genres}` : "16";

    return [
        make({
            with_genres: genres,
            with_origin_country: "JP",
        }),

        make({
            with_genres: genres,
            with_original_language: "ja",
        }),
    ];
}

// =========================================
// TRENDING AND POPULAR CONTENT
// =========================================

export async function fetchIndexTrending(proxy, scope, signal, limit = INDEX_TRENDING_LIMIT) {
    const output = new Map();

    async function add(urls, label) {
        const pages = await Promise.all(
            urls.map(async ({ url, type }) => {
                const data = await safeJson(url, signal);

                return (data?.results || []).map((item) => ({
                    ...item,
                    media_type: type,
                }));
            }),
        );

        const candidates = await classifyIndexItems(pages.flat(), proxy, signal);

        candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        for (const item of candidates) {
            if (matchesIndexScope(item, scope) && !output.has(mediaKey(item))) {
                output.set(
                    mediaKey(item),

                    card(item, {
                        isTrending: true,
                        trendingLabel: label,
                    }),
                );
            }
        }
    }

    // First: genuine daily and weekly trending.

    for (const period of ["day", "week"]) {
        for (let page = 1; page <= 3 && output.size < limit; page++) {
            await add(
                scope.types.map((type) => ({
                    type,

                    url: `${proxy}/api/tmdb/trending/${type}/${period}` + `?page=${page}`,
                })),

                period === "day" ? "Trending Today" : "Trending This Week",
            );
        }
    }

    // Second: fill any remaining spaces with
    // popularity-sorted discovery results.

    for (let page = 1; page <= 5 && output.size < limit; page++) {
        await add(
            scope.types.flatMap((type) =>
                discoverUrls(proxy, type, { page: String(page) }, scope.category === "anime").map(
                    (url) => ({
                        type,
                        url,
                    }),
                ),
            ),

            "Popular",
        );
    }

    return [...output.values()].slice(0, limit);
}

// =========================================
// USER VIEWING HISTORY
// =========================================

function scopedLogs(client, userId, scope, fields) {
    let query = client.from("media_logs").select(fields).eq("user_id", userId);

    query = applyMediaFilter(query, scope.category);

    if (scope.category === "anime" && scope.types.length === 1) {
        query = query.eq("media_type", scope.types[0]);
    }

    return query;
}

export async function indexHistory(client, userId, scope, allowBorrow = false) {
    async function rated(s) {
        const { data, error } = await scopedLogs(
            client,
            userId,
            s,
            "media_id,media_type,is_anime,rating",
        )
            .gte("rating", 4)

            .order("rating", {
                ascending: false,
            })

            .order("created_at", {
                ascending: false,
            })

            .limit(25);

        if (error) throw error;

        // Avoid letting repeated episode logs for
        // one series overwhelm the taste profile.

        const seen = new Set();

        return (data || []).filter((item) => {
            const key = mediaKey(item);

            if (seen.has(key)) return false;

            seen.add(key);

            return true;
        });
    }

    const logs = await rated(scope);

    if (logs.length || !allowBorrow || scope.category !== "anime" || scope.types.length !== 1) {
        return logs;
    }

    // IMPORTANT:
    // Check whether ANY title of this subtype has
    // been logged, including titles rated below 4.

    const { data, error } = await scopedLogs(client, userId, scope, "id").limit(1);

    if (error) throw error;

    if (data?.length) {
        return logs;
    }

    // Borrow from the other anime format ONLY
    // when there is absolutely no own history.

    return rated(
        indexScope(
            "anime",

            scope.types[0] === "movie" ? "tv" : "movie",
        ),
    );
}

// =========================================
// SHARED TASTE SCORING
// =========================================

function genreKeys(name) {
    const key = String(name || "")
        .toLowerCase()
        .trim();

    if (key === "action & adventure") {
        return ["action", "adventure"];
    }

    if (key === "sci-fi & fantasy") {
        return ["science fiction", "fantasy"];
    }

    if (key === "war & politics") {
        return ["war", "politics"];
    }

    return key ? [key] : [];
}

export async function indexTaste(logs, proxy, signal, anime) {
    const genres = new Map();
    const keywords = new Map();
    const names = new Map();
    const genreNames = new Map();

    const details = await batches(
        logs,

        (log) => detail(proxy, log.media_type, log.media_id, signal, "keywords"),
    );

    details.forEach((item, i) => {
        if (!item?.id) return;

        const weight = calculateWeight(Number(logs[i].rating));

        const keys = new Set();

        for (const g of item.genres || []) {
            // Never score Anime or Animation
            // as an Anime taste genre.

            if (anime && (Number(g.id) === 16 || noMedium.test(g.name))) {
                continue;
            }

            for (const key of genreKeys(g.name)) {
                keys.add(key);

                if (!genreNames.has(key)) {
                    genreNames.set(key, anime ? key : g.name);
                }
            }
        }

        for (const key of keys) {
            genres.set(key, (genres.get(key) || 0) + weight);
        }

        for (const k of item.keywords?.keywords || item.keywords?.results || []) {
            // Exclude Anime/Animation terminology
            // from themes and keywords as well.

            if (!k.name || (anime && noMedium.test(k.name))) {
                continue;
            }

            const id = String(k.id);

            keywords.set(id, (keywords.get(id) || 0) + weight);

            names.set(id, k.name);
        }
    });

    const ranked = (map) => [...map.keys()].sort((a, b) => map.get(b) - map.get(a));

    const topGenres = ranked(genres);
    const topKeywords = ranked(keywords);

    return {
        genres,
        keywords,
        topGenres,
        topKeywords,

        topGenre: genreNames.get(topGenres[0]) || "",

        topTheme: names.get(topKeywords[0]) || "",
    };
}

// =========================================
// ALREADY-LOGGED TITLES
// =========================================

async function loggedIds(client, userId, type, signal) {
    const ids = new Set();

    // Paginate to avoid Supabase's default
    // maximum-row limit on large diaries.

    for (let start = 0; ; start += 500) {
        abortCheck(signal);

        const { data, error } = await client

            .from("media_logs")
            .select("media_id")
            .eq("user_id", userId)
            .eq("media_type", type)
            .order("id")
            .range(start, start + 499);

        if (error) throw error;

        (data || []).forEach((log) => ids.add(String(log.media_id)));

        if (!data || data.length < 500) {
            return ids;
        }
    }
}

// =========================================
// PERSONALIZED FOR YOU RECOMMENDATIONS
// =========================================

export async function fetchIndexForYou(client, userId, proxy, scope, providerIds, signal) {
    const history = await indexHistory(client, userId, scope, true);

    const taste = await indexTaste(history, proxy, signal, scope.category === "anime");

    const topGenres = taste.topGenres.slice(0, 3);

    const topKeywords = taste.topKeywords.slice(0, 5);

    if (!topGenres.length && !topKeywords.length) {
        return [];
    }

    const results = [];

    for (const type of scope.types) {
        const logged = await loggedIds(client, userId, type, signal);

        const base = {
            watch_region: "US",

            with_watch_monetization_types: "flatrate|free|ads",

            page: "1",
        };

        const mappedGenres = [
            ...new Set(
                topGenres

                    .map((g) => genreIds[type][g])

                    .filter(Boolean),
            ),
        ];

        const urls = [
            ...topKeywords.flatMap((k) =>
                discoverUrls(
                    proxy,
                    type,
                    {
                        ...base,
                        with_keywords: k,
                    },
                    scope.category === "anime",
                ),
            ),

            ...mappedGenres.flatMap((g) =>
                [1, 2].flatMap((page) =>
                    discoverUrls(
                        proxy,
                        type,
                        {
                            ...base,
                            page: String(page),
                            with_genres: String(g),
                        },
                        scope.category === "anime",
                    ),
                ),
            ),
        ];

        const pages = await batches(
            [...new Set(urls)],

            (url) => safeJson(url, signal),
        );

        const raw = new Map();

        for (const page of pages) {
            for (const item of page?.results || []) {
                if (logged.has(String(item.id))) {
                    continue;
                }

                const animated = item.genre_ids?.some((id) => Number(id) === 16);

                if (scope.category === "anime" && Array.isArray(item.genre_ids) && !animated) {
                    continue;
                }

                if (
                    scope.category !== "anime" &&
                    getAnimeClassification({
                        ...item,
                        media_type: type,
                    }) === true
                ) {
                    continue;
                }

                raw.set(item.id, item);
            }
        }

        const candidates = [...raw.values()].sort(
            (a, b) => (b.popularity || 0) - (a.popularity || 0),
        );

        const ranked = [];

        for (let i = 0; i < candidates.length; i += 6) {
            const details = await batches(
                candidates.slice(i, i + 6),

                (item) => detail(proxy, type, item.id, signal, "keywords,watch/providers"),
            );

            for (const data of details) {
                if (!data?.id || !data.poster_path) {
                    continue;
                }

                const item = {
                    ...data,

                    media_type: type,

                    is_anime: getAnimeClassification({
                        ...data,
                        media_type: type,
                    }),
                };

                if (
                    !matchesIndexScope(item, scope) ||
                    !evaluateProviderAvailability(item, providerIds)
                ) {
                    continue;
                }

                const keys = new Set((item.genres || []).flatMap((g) => genreKeys(g.name)));

                const gs = topGenres.reduce(
                    (sum, g) => sum + (keys.has(g) ? taste.genres.get(g) : 0),

                    0,
                );

                const ks = new Set(
                    (item.keywords?.keywords || item.keywords?.results || []).map((k) =>
                        String(k.id),
                    ),
                );

                const ts = topKeywords.reduce(
                    (sum, k) => sum + (ks.has(k) ? taste.keywords.get(k) : 0),

                    0,
                );

                if (!gs && !ts) {
                    continue;
                }

                ranked.push(
                    card(item, {
                        isForYou: true,

                        _score: ts * 1000 + gs + (item.popularity || 0) / 10000,
                    }),
                );
            }

            // Gather a larger eligible candidate
            // pool before selecting the final 12.

            if (ranked.length >= 36) {
                break;
            }
        }

        results.push(...ranked);
    }

    return results

        .sort((a, b) => b._score - a._score)

        .slice(0, INDEX_FOR_YOU_LIMIT);
}
