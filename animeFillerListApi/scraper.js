const axios = require('axios');
const cheerio = require('cheerio');
const { slugify } = require('../js/core/utils');

const AFL_BASE_URL = 'https://www.animefillerlist.com';
const AFG_BASE_URL = 'https://www.animefillerguide.com';
const REQUEST_TIMEOUT_MS = 20000;

const HTTP_OPTIONS = {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CatalogdAnimeScraper/2.0; +https://www.animefillerlist.com/)',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    }
};

function cleanText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function normalizeEpisodeNumber(value) {
    const match = cleanText(value).match(/\d+(?:\.\d+)?/);
    if (!match) return null;

    const number = Number(match[0]);
    if (!Number.isFinite(number)) return null;

    return Number.isInteger(number) ? String(number) : String(number);
}

function episodeNumberSort(a, b) {
    const aNum = Number(a.number);
    const bNum = Number(b.number);

    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
}

function normalizeTitleForMatch(title) {
    return cleanText(title)
        .replace(/\*\s*filler\b/ig, '')
        .normalize('NFKD')
        .replace(/[’‘`´]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[×✕✖]/g, 'x')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function cleanGuideDisplayTitle(rawTitle) {
    // Only the *Filler marker is presentation-only.
    // Other asterisk annotations are intentionally preserved.
    return cleanText(rawTitle)
        .replace(/\s*\*\s*filler\b\s*/ig, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function isGuideFiller(rawTitle, mangaChapters) {
    const hasFillerMarker = /\*\s*filler\b/i.test(cleanText(rawTitle));
    const hasNoMangaChapters = /^(?:n\/?a|na|none|—|-|not applicable)$/i.test(
        cleanText(mangaChapters)
    );

    return hasFillerMarker && hasNoMangaChapters;
}

function inferGuideCanonType(rawTitle, mangaChapters) {
    // AnimeFillerGuide can only infer Filler or Manga Canon.
    // Mixed Canon/Filler is reserved for AnimeFillerList.
    return isGuideFiller(rawTitle, mangaChapters)
        ? 'Filler'
        : 'Manga Canon';
}

function normalizeAflType(type) {
    const value = cleanText(type);
    const lower = value.toLowerCase();

    if (lower.includes('mixed')) return 'Mixed Canon/Filler';
    if (lower.includes('filler')) return 'Filler';
    if (lower.includes('canon')) return 'Manga Canon';

    return value || null;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function parseSlugFromUrlOrSlug(value, site) {
    const input = cleanText(value);
    if (!input) return null;

    try {
        const url = new URL(input);
        const expectedHost = site === 'afl'
            ? 'animefillerlist.com'
            : 'animefillerguide.com';

        if (!url.hostname.toLowerCase().endsWith(expectedHost)) {
            return null;
        }

        const pattern = site === 'afl'
            ? /\/shows\/([^\/?#]+)/i
            : /\/anime\/([^\/?#]+)/i;

        const match = url.pathname.match(pattern);

        return match?.[1]
            ? decodeURIComponent(match[1])
            : null;
    } catch (_) {
        // Not a URL; treat as a supplied slug/path.
        const pattern = site === 'afl'
            ? /(?:^|\/shows\/)([^\/?#]+)\/?$/i
            : /(?:^|\/anime\/)([^\/?#]+)\/?$/i;

        const match = input.match(pattern);

        return match?.[1]
            ? decodeURIComponent(match[1])
            : input.replace(/^\/+|\/+$/g, '');
    }
}

function buildSourceStatus({
    status,
    url = null,
    slug = null,
    error = null,
    totalEpisodes = null
}) {
    return {
        status,
        url,
        slug,
        error,
        total_episodes: totalEpisodes
    };
}

// ============================================================
// AnimeFillerList.com
// ============================================================

async function scrapeAnimeFillerListBySlug(slug) {
    if (!slug) return null;

    const url = `${AFL_BASE_URL}/shows/${encodeURIComponent(slug)}`;

    try {
        const { data } = await axios.get(url, HTTP_OPTIONS);
        const $ = cheerio.load(data);

        const episodes = [];

        $('table.EpisodeList tr').each((i, el) => {
            const number = normalizeEpisodeNumber(
                $(el).find('td.Number').text()
            );

            const title = cleanText(
                $(el).find('td.Title a').first().text() ||
                $(el).find('td.Title').text()
            );

            const rawType = cleanText(
                $(el).find('td.Type span').first().text() ||
                $(el).find('td.Type').text()
            );

            const type = normalizeAflType(rawType);

            if (number && title) {
                episodes.push({
                    number,
                    title,
                    normalized_title: normalizeTitleForMatch(title),
                    type: type || rawType || null
                });
            }
        });

        if (episodes.length === 0) {
            return null;
        }

        episodes.sort(episodeNumberSort);

        return {
            site: 'AnimeFillerList.com',
            slug,
            url,
            total_episodes: episodes.length,
            episodes
        };
    } catch (error) {
        console.warn(
            `AnimeFillerList scrape exception for ${slug}: ${error.message}`
        );

        return null;
    }
}

async function scrapeAnimeFillerList(animeSlug, manualSlug = null) {
    const manual = parseSlugFromUrlOrSlug(manualSlug, 'afl');

    if (manualSlug && !manual) {
        return {
            result: null,
            status: buildSourceStatus({
                status: 'failed',
                error: 'The supplied AnimeFillerList URL/slug is invalid.'
            })
        };
    }

    const candidates = manual
        ? [manual]
        : unique([
            parseSlugFromUrlOrSlug(animeSlug, 'afl'),
            slugify(animeSlug)
        ]);

    for (const candidate of candidates) {
        console.log(`AnimeFillerList: attempting ${candidate}`);

        const result = await scrapeAnimeFillerListBySlug(candidate);

        if (result) {
            return {
                result,
                status: buildSourceStatus({
                    status: 'success',
                    url: result.url,
                    slug: result.slug,
                    totalEpisodes: result.total_episodes
                })
            };
        }
    }

    return {
        result: null,
        status: buildSourceStatus({
            status: 'failed',
            slug: manual || candidates[0] || null,
            error: manual
                ? 'User-provided AnimeFillerList page was invalid, unavailable, or did not contain an episode table.'
                : 'AnimeFillerList page was not found or its episode table could not be parsed.'
        })
    };
}

// ============================================================
// AnimeFillerGuide.com parsing helpers
// ============================================================

function parseSeasonHeading(text) {
    const raw = cleanText(text);

    const match = raw.match(
        /^season\s+(\d+)(?:\s*:\s*(.+))?$/i
    );

    if (!match) {
        return null;
    }

    return {
        number: Number(match[1]),
        heading: raw,
        name: cleanText(match[2]) || `Season ${Number(match[1])}`
    };
}

function parseSeasonDescription(description) {
    const text = cleanText(description);

    /*
     * IMPORTANT:
     *
     * `description` remains the COMPLETE season paragraph.
     *
     * The fields below are only convenience metadata
     * extracted from that full original paragraph.
     */

    const episodeCountMatch = text.match(
        /\b(?:has|contains|consists of)\s+(\d+)\s+episodes?\b/i
    );

    const openingMatch = text.match(
        /\bopenings?\s+(?:used\s+)?(?:is|are)\s+(.+?)(?=;\s*the\s+endings?\b|\.\s*~|\s+~\s+adapted|$)/i
    );

    const endingMatch = text.match(
        /\bendings?\s+(?:used\s+)?(?:is|are)\s+(.+?)(?=\.\s*~|\s+~\s+adapted|$)/i
    );

    const mangaMatch = text.match(
        /~?\s*adapted\s+from\s+manga\s+(.+?)(?=\.(?:\s|$)|$)/i
    );

    return {
        /*
         * WHOLE paragraph.
         */
        description:
            text || null,

        /*
         * Parsed convenience fields.
         */
        episode_count:
            episodeCountMatch
                ? Number(
                    episodeCountMatch[1]
                )
                : null,

        opening:
            openingMatch
                ? cleanText(
                    openingMatch[1]
                )
                : null,

        ending:
            endingMatch
                ? cleanText(
                    endingMatch[1]
                )
                : null,

        manga_range:
            mangaMatch
                ? cleanText(
                    mangaMatch[1]
                )
                : null
    };
}

function looksLikeMediaMarker(text) {
    const value = cleanText(text);

    if (!value) return false;

    /*
     * AnimeFillerGuide places movies / OVAs / specials /
     * other watch-order items inside arrow markers like:
     *
     * <——————— Movie 1: ... ———————>
     * <——————— Pelicula 2: ... ———————>
     *
     * We intentionally DO NOT care what the text says.
     *
     * If AnimeFillerGuide surrounds something with its
     * arrow-marker format, it is an ordered media/extra
     * item and should be preserved.
     */
    return (
        /^<[\-—–−_=]{2,}.+[\-—–−_=]{2,}>$/i.test(value)
    );
}

function parseMediaMarker(
    text,
    seasonNumber,
    afterEpisode = null
) {
    const raw = cleanText(text);

    /*
     * Strip only AnimeFillerGuide's surrounding arrows.
     * Keep the complete meaningful text inside.
     */
    const withoutArrows = cleanText(
        raw
            .replace(
                /^<[\-—–−_=\s]{2,}/,
                ''
            )
            .replace(
                /[\-—–−_=\s]{2,}>$/,
                ''
            )
    );

    /*
     * Media type is only metadata.
     *
     * Detection of the marker itself DOES NOT depend
     * on one of these words being present.
     */
    const normalized =
        withoutArrows
            .toLowerCase()
            .normalize('NFD')
            .replace(
                /[\u0300-\u036f]/g,
                ''
            );

    let type = 'extra';

    if (
        /\b(movie|movies|film|films|pelicula|peliculas)\b/i.test(
            normalized
        )
    ) {
        type = 'movie';
    }
    else if (
        /\b(ova|ovas)\b/i.test(
            normalized
        )
    ) {
        type = 'ova';
    }
    else if (
        /\b(oad|oads)\b/i.test(
            normalized
        )
    ) {
        type = 'oad';
    }
    else if (
        /\b(ona|onas)\b/i.test(
            normalized
        )
    ) {
        type = 'ona';
    }
    else if (
        /\b(special|specials|episode special)\b/i.test(
            normalized
        )
    ) {
        type = 'special';
    }

    return {
        raw_marker: raw,

        /*
         * Full text from between the arrows.
         */
        title:
            withoutArrows || raw,

        media_type:
            type,

        season:
            seasonNumber || null,

        after_episode:
            afterEpisode || null,

        before_episode:
            null
    };
}

function getTableColumnMap($, table) {
    let headerCells = [];

    $(table).find('tr').each((_, row) => {
        if (headerCells.length) return;

        const cells = $(row)
            .find('th, td')
            .map((__, cell) =>
                cleanText($(cell).text()).toLowerCase()
            )
            .get();

        if (
            cells.some(cell => cell === 'title') &&
            cells.some(cell => cell.includes('chapter'))
        ) {
            headerCells = cells;
        }
    });

    if (!headerCells.length) {
        return null;
    }

    const titleIndex = headerCells.findIndex(
        cell => cell === 'title'
    );

    const chaptersIndex = headerCells.findIndex(
        cell => cell.includes('chapter')
    );

    if (titleIndex < 0 || chaptersIndex < 0) {
        return null;
    }

    return {
        titleIndex,
        chaptersIndex,

        // AnimeFillerGuide's first numeric column is the global
        // episode number.
        globalNumberIndex: 0,

        // Some tables contain:
        // Global Episode | Season Episode | Title | Chapters
        localNumberIndex: titleIndex > 1
            ? 1
            : null
    };
}

function parseGuideEpisodeTable(
    $,
    table,
    season,
    lastEpisodeNumber = null
) {
    const map = getTableColumnMap($, table);

    if (!map) {
        return {
            episodes: [],
            media: [],
            lastEpisodeNumber
        };
    }

    const episodes = [];
    const media = [];

    let runningLastEpisode = lastEpisodeNumber;
    let headerSeen = false;

    $(table).find('tr').each((_, row) => {
        const cells = $(row).find('th, td');

        if (!cells.length) return;

        const values = cells
            .map((__, cell) => cleanText($(cell).text()))
            .get();

        const lowerValues = values.map(
            value => value.toLowerCase()
        );

        if (
            !headerSeen &&
            lowerValues.some(value => value === 'title') &&
            lowerValues.some(value => value.includes('chapter'))
        ) {
            headerSeen = true;
            return;
        }

        const wholeRowText = cleanText(values.join(' '));

        if (looksLikeMediaMarker(wholeRowText)) {
            media.push(
                parseMediaMarker(
                    wholeRowText,
                    season.number,
                    runningLastEpisode
                )
            );

            return;
        }

        const number = normalizeEpisodeNumber(
            values[map.globalNumberIndex]
        );

        const rawTitle = cleanText(
            values[map.titleIndex]
        );

        const mangaChapters = cleanText(
            values[map.chaptersIndex]
        );

        if (!number || !rawTitle) {
            return;
        }

        const localNumber =
            map.localNumberIndex !== null
                ? normalizeEpisodeNumber(
                    values[map.localNumberIndex]
                )
                : null;

        const title = cleanGuideDisplayTitle(rawTitle);

        const inferredType = inferGuideCanonType(
            rawTitle,
            mangaChapters
        );

        episodes.push({
            number,
            season_episode_number: localNumber,

            season: season.number,
            season_name: season.name,

            raw_title: rawTitle,
            title,

            normalized_title:
                normalizeTitleForMatch(title),

            manga_chapters:
                mangaChapters || null,

            guide_filler_marker:
                /\*\s*filler\b/i.test(rawTitle),

            inferred_type: inferredType,

            type: inferredType,

            type_source:
                'AnimeFillerGuide.com'
        });

        runningLastEpisode = number;
    });

    return {
        episodes,
        media,
        lastEpisodeNumber: runningLastEpisode
    };
}

function parseContinuationTable($, root) {
    let continuation = null;

    $(root).find('table').each((_, table) => {
        if (continuation) return;

        const rows = $(table)
            .find('tr')
            .toArray();

        if (rows.length < 2) {
            return;
        }

        const firstRow = $(rows[0])
            .find('th, td')
            .map((__, cell) =>
                cleanText($(cell).text())
            )
            .get();

        const joinedHeader = firstRow
            .join(' | ')
            .toLowerCase();

        if (
            !joinedHeader.includes(
                'where does the anime end'
            ) ||
            !joinedHeader.includes(
                'where should i start reading'
            )
        ) {
            return;
        }

        for (let i = 1; i < rows.length; i++) {
            const values = $(rows[i])
                .find('th, td')
                .map((__, cell) =>
                    cleanText($(cell).text())
                )
                .get();

            if (
                values.length >= 2 &&
                (values[0] || values[1])
            ) {
                continuation = {
                    where_anime_ends:
                        values[0] || null,

                    where_to_start_reading:
                        values[1] || null
                };

                break;
            }
        }
    });

    return continuation || {
        where_anime_ends: null,
        where_to_start_reading: null
    };
}

function extractDeclaredGuideEpisodeCount($, root) {
    const text = cleanText($(root).text());

    const match = text.match(
        /\bhas\s+(\d+)\s+episodes?\b/i
    );

    return match
        ? Number(match[1])
        : null;
}

function extractGuideAnimeName($) {
    const heading = cleanText(
        $('h1').first().text()
    );

    if (!heading) {
        return null;
    }

    return cleanText(
        heading
            .replace(
                /\s+Filler\s+List.*$/i,
                ''
            )
            .replace(
                /\s+Filler\s+Episodes.*$/i,
                ''
            )
    ) || heading;
}

function resolveGuideContentRoot($) {
    const selectors = [
        '.entry-content',
        '.td-post-content',
        '.post-content',
        'article .content',
        'article'
    ];

    for (const selector of selectors) {
        const node = $(selector).first();

        if (
            node.length &&
            cleanText(node.text()).length > 100
        ) {
            return node;
        }
    }

    return $('body');
}

function finalizeMediaPlacement(
    media,
    episodes
) {
    const sortedEpisodeNumbers = episodes
        .map(ep => Number(ep.number))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    return media.map(item => {
        const after = Number(
            item.after_episode
        );

        const next = Number.isFinite(after)
            ? sortedEpisodeNumbers.find(
                number => number > after
            )
            : sortedEpisodeNumbers[0];

        return {
            ...item,

            before_episode:
                next !== undefined
                    ? String(next)
                    : null
        };
    });
}

function parseAnimeFillerGuideHtml(
    html,
    slug,
    url
) {
    const $ = cheerio.load(html);

    const root =
        resolveGuideContentRoot($);

    const anime =
        extractGuideAnimeName($) || slug;

    const declaredEpisodeCount =
        extractDeclaredGuideEpisodeCount(
            $,
            root
        );

    const continuation =
        parseContinuationTable(
            $,
            root
        );

    const seasons = [];
    const allEpisodes = [];
    const allMedia = [];

    let currentSeason = null;
    let currentSeasonDescriptionParts = [];
    let currentSeasonHasEpisodeTable = false;
    let lastEpisodeNumber = null;

    const finishCurrentSeason = () => {
        if (!currentSeason) {
            return;
        }

        const parsedDescription =
            parseSeasonDescription(
                currentSeasonDescriptionParts.join(
                    ' '
                )
            );

        Object.assign(
            currentSeason,
            parsedDescription
        );

        const seasonEpisodes =
            allEpisodes.filter(
                ep =>
                    ep.season ===
                    currentSeason.number
            );

        currentSeason.episodes =
            seasonEpisodes;

        currentSeason.detected_episode_count =
            seasonEpisodes.length;

        if (seasonEpisodes.length) {
            currentSeason.episode_range = {
                start:
                    seasonEpisodes[0].number,

                end:
                    seasonEpisodes[
                        seasonEpisodes.length - 1
                    ].number
            };
        } else {
            currentSeason.episode_range = null;
        }

        seasons.push(currentSeason);

        currentSeason = null;
        currentSeasonDescriptionParts = [];
        currentSeasonHasEpisodeTable = false;
    };

    root
        .find('h2, h3, h4, p, table')
        .each((_, element) => {
            const tag =
                element.tagName?.toLowerCase();

            const text = cleanText(
                $(element).text()
            );

            if (/^h[234]$/.test(tag)) {
                const seasonHeading =
                    parseSeasonHeading(text);

                if (seasonHeading) {
                    finishCurrentSeason();

                    currentSeason = {
                        ...seasonHeading,

                        description: null,

                        episode_count: null,

                        detected_episode_count: 0,

                        opening: null,

                        ending: null,

                        manga_range: null,

                        episode_range: null,

                        episodes: []
                    };

                    return;
                }

                if (
                    tag === 'h2' &&
                    currentSeason
                ) {
                    // AnimeFillerGuide commonly moves
                    // into continuation/watch-order
                    // sections using H2 headings.
                    finishCurrentSeason();
                }

                return;
            }

            if (!currentSeason) {
                return;
            }

            if (tag === 'p') {
                if (
                    looksLikeMediaMarker(text)
                ) {
                    allMedia.push(
                        parseMediaMarker(
                            text,
                            currentSeason.number,
                            lastEpisodeNumber
                        )
                    );

                    return;
                }

                if (
                    !currentSeasonHasEpisodeTable &&
                    text
                ) {
                    currentSeasonDescriptionParts.push(
                        text
                    );
                }

                return;
            }

            if (tag === 'table') {
                const parsed =
                    parseGuideEpisodeTable(
                        $,
                        element,
                        currentSeason,
                        lastEpisodeNumber
                    );

                if (
                    parsed.episodes.length ||
                    parsed.media.length
                ) {
                    currentSeasonHasEpisodeTable =
                        currentSeasonHasEpisodeTable ||
                        parsed.episodes.length > 0;

                    allEpisodes.push(
                        ...parsed.episodes
                    );

                    allMedia.push(
                        ...parsed.media
                    );

                    lastEpisodeNumber =
                        parsed.lastEpisodeNumber ||
                        lastEpisodeNumber;
                }
            }
        });

    finishCurrentSeason();

    // De-duplicate unusual/nested table rows.
    // AnimeFillerGuide remains authoritative
    // for every global episode number.
    const episodeMap = new Map();

    for (const episode of allEpisodes) {
        episodeMap.set(
            String(episode.number),
            episode
        );
    }

    const episodes =
        [...episodeMap.values()]
            .sort(episodeNumberSort);

    const media =
        finalizeMediaPlacement(
            allMedia,
            episodes
        );

    if (episodes.length === 0) {
        return null;
    }

    return {
        site: 'AnimeFillerGuide.com',

        slug,
        url,
        anime,

        total_episodes:
            declaredEpisodeCount ||
            episodes.length,

        detected_episode_count:
            episodes.length,

        seasons,

        episodes,

        media,

        continuation
    };
}

// ============================================================
// AnimeFillerGuide.com requests/discovery
// ============================================================

async function scrapeAnimeFillerGuideBySlug(
    slug
) {
    if (!slug) return null;

    const url =
        `${AFG_BASE_URL}/anime/${encodeURIComponent(slug)}/`;

    try {
        const { data } =
            await axios.get(
                url,
                HTTP_OPTIONS
            );

        return parseAnimeFillerGuideHtml(
            data,
            slug,
            url
        );
    } catch (error) {
        console.warn(
            `AnimeFillerGuide scrape exception for ${slug}: ${error.message}`
        );

        return null;
    }
}

function scoreGuideCandidate(
    target,
    candidateSlug
) {
    const targetTokens =
        normalizeTitleForMatch(
            String(target || '')
                .replace(/-/g, ' ')
        )
            .split(' ')
            .filter(Boolean);

    const candidateTokens =
        normalizeTitleForMatch(
            String(candidateSlug || '')
                .replace(/-/g, ' ')
        )
            .split(' ')
            .filter(Boolean);

    if (
        !targetTokens.length ||
        !candidateTokens.length
    ) {
        return 0;
    }

    const candidateSet =
        new Set(candidateTokens);

    const overlap =
        targetTokens.filter(
            token =>
                candidateSet.has(token)
        ).length;

    return overlap /
        targetTokens.length;
}

async function discoverAnimeFillerGuideSlugs(
    animeSlug
) {
    const searchText = cleanText(
        String(animeSlug || '')
            .replace(/-/g, ' ')
    );

    if (!searchText) {
        return [];
    }

    const found = [];

    // Try the WordPress REST API first.
    try {
        const restUrl =
            `${AFG_BASE_URL}/wp-json/wp/v2/search`;

        const { data } =
            await axios.get(
                restUrl,
                {
                    ...HTTP_OPTIONS,

                    params: {
                        search: searchText,
                        per_page: 20,
                        type: 'post'
                    }
                }
            );

        if (Array.isArray(data)) {
            for (const item of data) {
                const slug =
                    parseSlugFromUrlOrSlug(
                        item.url,
                        'afg'
                    );

                if (slug) {
                    found.push(slug);
                }
            }
        }
    } catch (error) {
        console.warn(
            `AnimeFillerGuide REST discovery failed: ${error.message}`
        );
    }

    // Fallback to the public site search.
    if (found.length === 0) {
        try {
            const { data } =
                await axios.get(
                    `${AFG_BASE_URL}/`,
                    {
                        ...HTTP_OPTIONS,
                        params: {
                            s: searchText
                        }
                    }
                );

            const $ =
                cheerio.load(data);

            $('a[href*="/anime/"]')
                .each((_, anchor) => {
                    const href =
                        $(anchor).attr(
                            'href'
                        );

                    const slug =
                        parseSlugFromUrlOrSlug(
                            href,
                            'afg'
                        );

                    if (slug) {
                        found.push(slug);
                    }
                });
        } catch (error) {
            console.warn(
                `AnimeFillerGuide HTML discovery failed: ${error.message}`
            );
        }
    }

    return unique(found)
        .map(slug => ({
            slug,

            score:
                scoreGuideCandidate(
                    searchText,
                    slug
                )
        }))
        .filter(
            candidate =>
                candidate.score > 0
        )
        .sort(
            (a, b) =>
                b.score - a.score
        )
        .map(
            candidate =>
                candidate.slug
        )
        .slice(0, 10);
}

async function scrapeAnimeFillerGuide(
    animeSlug,
    manualGuideSlug = null
) {
    const manual =
        parseSlugFromUrlOrSlug(
            manualGuideSlug,
            'afg'
        );

    if (
        manualGuideSlug &&
        !manual
    ) {
        return {
            result: null,

            status:
                buildSourceStatus({
                    status: 'failed',

                    error:
                        'The supplied AnimeFillerGuide URL/slug is invalid.'
                })
        };
    }

    const directCandidates =
        manual
            ? [manual]
            : unique([
                parseSlugFromUrlOrSlug(
                    animeSlug,
                    'afg'
                ),

                slugify(animeSlug)
            ]);

    for (
        const candidate
        of directCandidates
    ) {
        console.log(
            `AnimeFillerGuide: attempting ${candidate}`
        );

        const result =
            await scrapeAnimeFillerGuideBySlug(
                candidate
            );

        if (result) {
            return {
                result,

                status:
                    buildSourceStatus({
                        status: 'success',

                        url: result.url,

                        slug: result.slug,

                        totalEpisodes:
                            result.total_episodes
                    })
            };
        }
    }

    if (!manual) {
        const discoveredCandidates =
            await discoverAnimeFillerGuideSlugs(
                animeSlug
            );

        for (
            const candidate
            of discoveredCandidates
        ) {
            if (
                directCandidates.includes(
                    candidate
                )
            ) {
                continue;
            }

            console.log(
                `AnimeFillerGuide: attempting discovered slug ${candidate}`
            );

            const result =
                await scrapeAnimeFillerGuideBySlug(
                    candidate
                );

            if (result) {
                return {
                    result,

                    status:
                        buildSourceStatus({
                            status: 'success',

                            url: result.url,

                            slug: result.slug,

                            totalEpisodes:
                                result.total_episodes
                        })
                };
            }
        }
    }

    return {
        result: null,

        status:
            buildSourceStatus({
                status: 'failed',

                slug:
                    manual ||
                    directCandidates[0] ||
                    null,

                error:
                    manual
                        ? 'User-provided AnimeFillerGuide page was invalid, unavailable, or did not contain parseable episode data.'
                        : 'AnimeFillerGuide page was not found or its episode data could not be parsed.'
            })
    };
}

// ============================================================
// Source comparison / merge
// ============================================================

function getEpisodeNumberSet(
    episodes
) {
    return new Set(
        (episodes || []).map(
            ep => String(ep.number)
        )
    );
}

function setsEqual(a, b) {
    if (a.size !== b.size) {
        return false;
    }

    for (const value of a) {
        if (!b.has(value)) {
            return false;
        }
    }

    return true;
}

function findNumberDifferences(
    guideEpisodes,
    aflEpisodes
) {
    const guideSet =
        getEpisodeNumberSet(
            guideEpisodes
        );

    const aflSet =
        getEpisodeNumberSet(
            aflEpisodes
        );

    return {
        guide_only:
            [...guideSet]
                .filter(
                    number =>
                        !aflSet.has(number)
                )
                .sort(
                    (a, b) =>
                        Number(a) - Number(b)
                ),

        anime_filler_list_only:
            [...aflSet]
                .filter(
                    number =>
                        !guideSet.has(number)
                )
                .sort(
                    (a, b) =>
                        Number(a) - Number(b)
                )
    };
}

function mergeWithGuideAuthority(
    guide,
    afl
) {
    if (!guide) {
        return null;
    }

    const aflByNumber =
        new Map(
            (afl?.episodes || []).map(
                ep => [
                    String(ep.number),
                    ep
                ]
            )
        );

    const guideSet =
        getEpisodeNumberSet(
            guide.episodes
        );

    const aflSet =
        getEpisodeNumberSet(
            afl?.episodes || []
        );

    /*
     * IMPORTANT:
     *
     * AnimeFillerList classification data is used ONLY
     * when the entire episode-number set matches.
     *
     * If even one episode is missing/extra/different,
     * AnimeFillerGuide becomes authoritative for the
     * whole merged list and AFL canon classifications
     * are not shown/applied.
     */
    const numberingMatches =
        !!afl &&
        setsEqual(
            guideSet,
            aflSet
        );

    const numberDifferences =
        afl
            ? findNumberDifferences(
                guide.episodes,
                afl.episodes
            )
            : {
                guide_only:
                    guide.episodes.map(
                        ep => ep.number
                    ),

                anime_filler_list_only:
                    []
            };

    const episodes =
        guide.episodes.map(
            guideEpisode => {
                const aflEpisode =
                    numberingMatches
                        ? aflByNumber.get(
                            String(
                                guideEpisode.number
                            )
                        )
                        : null;

                /*
                 * If numbering matches:
                 * AFL controls canonity.
                 *
                 * If numbering does NOT match:
                 * AFL is ignored and AFG determines
                 * Filler/Manga Canon from its own data.
                 */
                const type =
                    aflEpisode?.type ||
                    guideEpisode.inferred_type ||
                    inferGuideCanonType(
                        guideEpisode.raw_title,
                        guideEpisode.manga_chapters
                    );

                return {
                    number:
                        guideEpisode.number,

                    season_episode_number:
                        guideEpisode
                            .season_episode_number,

                    season:
                        guideEpisode.season,

                    season_name:
                        guideEpisode.season_name,

                    // AnimeFillerGuide title wins.
                    title:
                        guideEpisode.title,

                    raw_title:
                        guideEpisode.raw_title,

                    normalized_title:
                        guideEpisode
                            .normalized_title,

                    type,

                    type_source:
                        aflEpisode
                            ? 'AnimeFillerList.com'
                            : 'AnimeFillerGuide.com',

                    manga_chapters:
                        guideEpisode
                            .manga_chapters,

                    guide_filler_marker:
                        guideEpisode
                            .guide_filler_marker,

                    source_titles: {
                        anime_filler_guide:
                            guideEpisode.raw_title,

                        anime_filler_list:
                            aflEpisode?.title ||
                            null
                    },

                    title_match:
                        aflEpisode
                            ? guideEpisode
                                .normalized_title ===
                              aflEpisode
                                .normalized_title
                            : null
                };
            }
        );

    const seasons =
        guide.seasons.map(
            season => ({
                ...season,

                episodes:
                    episodes.filter(
                        ep =>
                            ep.season ===
                            season.number
                    )
            })
        );

    return {
        anime:
            guide.anime,

        // AnimeFillerGuide controls total episode count.
        total_episodes:
            guide.total_episodes,

        detected_episode_count:
            guide.detected_episode_count,

        episodes,

        seasons,

        media:
            guide.media,

        continuation:
            guide.continuation,

        source_alignment: {
            numbering_matches:
                numberingMatches,

            anime_filler_list_classifications_used:
                numberingMatches,

            differences:
                numberDifferences,

            warning:
                afl &&
                !numberingMatches
                    ? 'Episode numbering differs between AnimeFillerGuide.com and AnimeFillerList.com. AnimeFillerGuide.com is authoritative, so AnimeFillerList.com episode classifications were not applied.'
                    : null
        }
    };
}

function buildAflOnlyResult(
    afl,
    animeSlug
) {
    const episodes =
        afl.episodes.map(
            ep => ({
                number:
                    ep.number,

                season_episode_number:
                    null,

                season:
                    null,

                season_name:
                    null,

                title:
                    ep.title,

                raw_title:
                    ep.title,

                normalized_title:
                    ep.normalized_title,

                type:
                    ep.type,

                type_source:
                    'AnimeFillerList.com',

                manga_chapters:
                    null,

                guide_filler_marker:
                    false,

                source_titles: {
                    anime_filler_guide:
                        null,

                    anime_filler_list:
                        ep.title
                },

                title_match:
                    null
            })
        );

    return {
        anime:
            animeSlug,

        total_episodes:
            afl.total_episodes,

        detected_episode_count:
            afl.total_episodes,

        episodes,

        seasons: [],

        media: [],

        continuation: {
            where_anime_ends:
                null,

            where_to_start_reading:
                null
        },

        source_alignment: {
            numbering_matches:
                null,

            anime_filler_list_classifications_used:
                true,

            differences:
                null,

            warning:
                'AnimeFillerGuide.com data was unavailable, so this result contains AnimeFillerList.com episode data only.'
        }
    };
}

function buildStatusMessage(
    aflStatus,
    guideStatus
) {
    const aflOk =
        aflStatus.status === 'success';

    const guideOk =
        guideStatus.status === 'success';

    if (
        aflOk &&
        guideOk
    ) {
        return 'Scrape from AnimeFillerList.com succeeded and scrape from AnimeFillerGuide.com succeeded.';
    }

    if (
        aflOk &&
        !guideOk
    ) {
        return 'Scrape from AnimeFillerList.com succeeded but scrape from AnimeFillerGuide.com failed.';
    }

    if (
        !aflOk &&
        guideOk
    ) {
        return 'Scrape from AnimeFillerGuide.com succeeded but scrape from AnimeFillerList.com failed.';
    }

    return 'Scrape from AnimeFillerList.com failed and scrape from AnimeFillerGuide.com failed.';
}

/**
 * Scrape and merge:
 *
 * AnimeFillerList.com
 * +
 * AnimeFillerGuide.com
 *
 * Authority rules:
 *
 * 1. AnimeFillerGuide controls:
 *    - episode count
 *    - episode numbers
 *    - episode titles
 *    - seasons
 *    - manga chapters
 *    - media placement
 *    - continuation information
 *
 * 2. AnimeFillerList controls:
 *    - Manga Canon
 *    - Mixed Canon/Filler
 *    - Filler
 *
 *    BUT ONLY if the COMPLETE episode-number
 *    set matches AnimeFillerGuide.
 *
 * 3. If episode-number sets differ AT ALL,
 *    AnimeFillerList episode information is
 *    not applied to the displayed merged list.
 *
 * 4. In that mismatch case, AnimeFillerGuide
 *    classifies:
 *
 *      *Filler + N/A -> Filler
 *
 *      everything else with chapter backing
 *      -> Manga Canon
 *
 *    Mixed Canon/Filler can never be inferred
 *    from AnimeFillerGuide.
 *
 * 5. If one website fails, the successful
 *    scrape is still saved as a partial result.
 */
async function getFillerData(
    animeSlug,
    manualSlug = null,
    manualGuideSlug = null
) {
    const [
        aflAttempt,
        guideAttempt
    ] = await Promise.all([
        scrapeAnimeFillerList(
            animeSlug,
            manualSlug
        ),

        scrapeAnimeFillerGuide(
            animeSlug,
            manualGuideSlug
        )
    ]);

    const afl =
        aflAttempt.result;

    const guide =
        guideAttempt.result;

    const statusMessage =
        buildStatusMessage(
            aflAttempt.status,
            guideAttempt.status
        );

    /*
     * Both sources failed.
     */
    if (
        !afl &&
        !guide
    ) {
        return {
            error:
                statusMessage,

            schema_version:
                2,

            partial:
                false,

            source_status_message:
                statusMessage,

            sources: {
                anime_filler_list:
                    aflAttempt.status,

                anime_filler_guide:
                    guideAttempt.status
            }
        };
    }

    /*
     * Prefer AnimeFillerGuide as the merge backbone.
     *
     * If AnimeFillerGuide failed entirely, fall back
     * to AnimeFillerList-only compatibility data.
     */
    const merged =
        guide
            ? mergeWithGuideAuthority(
                guide,
                afl
            )
            : buildAflOnlyResult(
                afl,
                animeSlug
            );

    const partial =
        !(afl && guide);

    return {
        schema_version:
            2,

        ...merged,

        partial,

        source_status_message:
            statusMessage,

        sources: {
            anime_filler_list: {
                ...aflAttempt.status,

                // Keep source-specific raw-ish data
                // for debugging and future migrations.
                episodes:
                    afl?.episodes ||
                    []
            },

            anime_filler_guide: {
                ...guideAttempt.status,

                anime:
                    guide?.anime ||
                    null,

                detected_episode_count:
                    guide?.detected_episode_count ||
                    null,

                seasons:
                    guide?.seasons ||
                    [],

                episodes:
                    guide?.episodes ||
                    [],

                media:
                    guide?.media ||
                    [],

                continuation:
                    guide?.continuation ||
                    null
            }
        }
    };
}

module.exports = {
    getFillerData
};