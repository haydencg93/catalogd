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

function isGuideNoiseText(value) {
    const text =
        cleanText(value);

    if (!text) {
        return true;
    }

    const lower =
        text.toLowerCase();

    /*
     * CDATA / inline script markers.
     */
    if (
        lower.includes('<![cdata[') ||
        lower.includes('/*<![cdata[') ||
        lower.includes('/*]]>*/') ||
        lower.includes('/*]]&gt;*/')
    ) {
        return true;
    }

    if (
        /\b(var|let|const)\s+[a-z_$][\w$]*\s*=/i.test(text) ||
        /\bfunction\s+[a-z_$][\w$]*\s*\(/i.test(text) ||
        /\bdocument\.(queryselector|getelementbyid|queryselectorall)\s*\(/i.test(text) ||
        /\baddEventListener\s*\(/i.test(text) ||
        /\bsetTimeout\s*\(/i.test(text) ||
        /\bclassList\.(toggle|add|remove)\s*\(/i.test(text)
    ) {
        return true;
    }

    const codeSignals = [
        text.includes('{'),
        text.includes('}'),
        text.includes(';'),
        text.includes('=>'),
        text.includes('='),
        text.includes('(') && text.includes(')')
    ].filter(Boolean).length;

    if (
        codeSignals >= 4 &&
        (
            lower.includes('document.') ||
            lower.includes('window.') ||
            lower.includes('.innertext') ||
            lower.includes('.disabled') ||
            lower.includes('.classlist')
        )
    ) {
        return true;
    }

    /*
     * CSS accidentally exposed as text.
     */
    if (
        /[.#][a-z0-9_-]+\s*\{[^}]*:[^}]*\}/i.test(text)
    ) {
        return true;
    }

    return false;
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

function isNoSourceMaterial(value) {
    const text =
        cleanText(value);

    if (!text) {
        return true;
    }

    return /^(?:n\/?a|na|none|unknown|—|-|not applicable)$/i
        .test(text);
}

function hasGuideSourceMaterial(value) {
    const text =
        cleanText(value);

    if (!text) {
        return false;
    }

    /*
     * NOVEL explicitly counts as source material.
     *
     * Numeric manga chapters obviously do too.
     * Other non-N/A source labels are preserved rather
     * than thrown away.
     */
    return !isNoSourceMaterial(text);
}

function getGuideExplicitType(rawTitle) {
    const title =
        cleanText(rawTitle);

    if (
        /\*\s*mixed\b/i.test(title)
    ) {
        return 'Mixed Canon/Filler';
    }

    if (
        /\*\s*filler\b/i.test(title)
    ) {
        return 'Filler';
    }

    return null;
}

function parseGuideEpisodeTitle(rawValue) {
    const rawTitle = cleanText(rawValue);

    let displayTitle = rawTitle;
    let guideNote = null;
    let explicitType = null;

    const mixedMatch =
        rawTitle.match(
            /\*\s*mixed\b(.*)$/i
        );

    if (mixedMatch) {
        explicitType =
            'Mixed Canon/Filler';

        guideNote =
            cleanText(
                mixedMatch[1]
                    .replace(
                        /^[,\-–—:\s]+/,
                        ''
                    )
            ) || null;

        displayTitle =
            cleanText(
                rawTitle.slice(
                    0,
                    mixedMatch.index
                )
            );
    } else {
        const fillerMatch =
            rawTitle.match(
                /\*\s*filler\b(.*)$/i
            );

        if (fillerMatch) {
            explicitType =
                'Filler';

            guideNote =
                cleanText(
                    fillerMatch[1]
                        .replace(
                            /^[,\-–—:\s]+/,
                            ''
                        )
                ) || null;

            displayTitle =
                cleanText(
                    rawTitle.slice(
                        0,
                        fillerMatch.index
                    )
                );
        }
    }

    /*
     * Protect against text-based strikethrough markers.
     * Actual HTML <del> / <s> tags are already converted
     * to text by Cheerio.
     */
    displayTitle =
        cleanText(
            displayTitle
                .replace(
                    /^~+|~+$/g,
                    ''
                )
        );

    return {
        raw_title:
            rawTitle,

        title:
            displayTitle ||
            rawTitle,

        guide_note:
            guideNote,

        explicit_type:
            explicitType
    };
}

function inferGuideCanonType(rawTitle, sourceMaterial) {
    const explicitType = getGuideExplicitType(rawTitle);
    /*
     * Explicit AFG labels have priority when AFL cannot
     * safely be used.
     */
    if (
        explicitType ===
        'Mixed Canon/Filler'
    ) {
        return 'Mixed Canon/Filler';
    }

    /*
     * Keep your original strict filler rule:
     *
     * *Filler + no manga/source backing => Filler.
     */
    if (
        explicitType === 'Filler' &&
        isNoSourceMaterial(sourceMaterial)
    ) {
        return 'Filler';
    }

    /*
     * A real manga chapter, chapter range, NOVEL, etc.
     * means source-backed.
     */
    if (
        hasGuideSourceMaterial(
            sourceMaterial
        )
    ) {
        return 'Manga Canon';
    }

    /*
     * Critical for Cowboy Bebop and other pages that
     * have no manga column:
     *
     * Missing chapters DOES NOT mean filler.
     */
    return 'Unknown';
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
function parseSeasonHeading(text, fallbackSeasonNumber = null) {
    const raw =
        cleanText(text);

    if (!raw) {
        return null;
    }

    const normalMatch =
        raw.match(
            /^season\s+(\d+)\b(.*)$/i
        );

    if (normalMatch) {
        const number =
            Number(
                normalMatch[1]
            );

        const remainder =
            cleanText(
                normalMatch[2]
                    .replace(
                        /^:\s*/,
                        ''
                    )
            );

        /*
         * Naruto-style:
         *
         * Season 1 (001-026)
         *
         * The range belongs in heading, but it isn't really
         * the season "name".
         */
        const rangeOnly =
            /^\(\s*\d+\s*[–—-]\s*\d+\s*\)$/i
                .test(
                    remainder
                );

        return {
            number,

            heading:
                raw,

            name:
                !remainder ||
                rangeOnly
                    ? `Season ${number}`
                    : remainder
        };
    }

    /*
     * Some AFG pages occasionally use season-equivalent
     * headings that end in an episode range without
     * literally beginning with "Season".
     *
     * Example:
     *
     * BLEACH: Thousand-Year Blood War (367-416)
     *
     * Treat these as the next season-like block.
     */
    if (
        fallbackSeasonNumber &&
        /\(\s*\d+\s*[–—-]\s*\d+\s*\)\s*$/i
            .test(raw)
    ) {
        return {
            number:
                fallbackSeasonNumber,

            heading:
                raw,

            name:
                raw
                    .replace(
                        /\s*\(\s*\d+\s*[–—-]\s*\d+\s*\)\s*$/i,
                        ''
                    )
                    .trim()
        };
    }

    return null;
}

function createGuideSeason({number, heading = null, name = null, synthetic = false}) {
    return {
        number,

        heading:
            heading ||
            `Season ${number}`,

        name:
            name ||
            `Season ${number}`,

        /*
         * Synthetic seasons are used for AFG pages that
         * don't actually have Season headings at all.
         *
         * Cowboy Bebop is the important example.
         */
        synthetic,

        description:
            null,

        episode_count:
            null,

        detected_episode_count:
            0,

        opening:
            null,

        ending:
            null,

        manga_range:
            null,

        episode_range:
            null,

        notes:
            [],

        markers:
            [],

        media:
            [],

        episodes:
            []
    };
}

function parseSeasonDescription(description) {
    const text = cleanText(description);

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
    const value =
        cleanText(text);

    if (!value) {
        return false;
    }

    return (
        /^<\s*[\-—–−_=←→]{2,}.+[\-—–−_=←→]{2,}\s*>$/i
            .test(value)
    );
}

function parseMediaMarker(text, seasonNumber, afterEpisode = null) {
    const raw =
        cleanText(text);

    const withoutArrows =
        cleanText(
            raw
                .replace(
                    /^<\s*[\-—–−_=←→\s]{2,}/,
                    ''
                )
                .replace(
                    /[\-—–−_=←→\s]{2,}\s*>$/,
                    ''
                )
        );

    /*
     * Media type is only convenience metadata.
     *
     * It never controls whether the item gets saved.
     */
    const normalized =
        withoutArrows
            .toLowerCase()
            .normalize('NFD')
            .replace(
                /[\u0300-\u036f]/g,
                ''
            );

    let type =
        'extra';

    if (
        /\b(movie|movies|film|films|pelicula|peliculas)\b/i
            .test(normalized)
    ) {
        type =
            'movie';
    } else if (
        /\b(ova|ovas)\b/i
            .test(normalized)
    ) {
        type =
            'ova';
    } else if (
        /\b(oad|oads)\b/i
            .test(normalized)
    ) {
        type =
            'oad';
    } else if (
        /\b(ona|onas)\b/i
            .test(normalized)
    ) {
        type =
            'ona';
    } else if (
        /\b(special|specials|episode special)\b/i
            .test(normalized)
    ) {
        type =
            'special';
    }

    return {
        raw_marker:
            raw,

        title:
            withoutArrows ||
            raw,

        media_type:
            type,

        season:
            seasonNumber ||
            null,

        after_episode:
            afterEpisode ||
            null,

        before_episode:
            null
    };
}

function getTableColumnMap($, table) {
    let headerCells = [];

    $(table)
        .find('tr')
        .each((_, row) => {
            if (
                headerCells.length
            ) {
                return;
            }

            const cells =
                $(row)
                    .find('th, td')
                    .map(
                        (__, cell) =>
                            cleanText(
                                $(cell).text()
                            )
                                .toLowerCase()
                    )
                    .get();

            /*
             * Title is the only column we actually require.
             *
             * Chapters/source material is optional.
             */
            if (
                cells.some(
                    cell =>
                        cell === 'title' ||
                        cell.includes('title')
                )
            ) {
                headerCells =
                    cells;
            }
        });

    if (
        !headerCells.length
    ) {
        return null;
    }

    const titleIndex =
        headerCells.findIndex(
            cell =>
                cell === 'title' ||
                cell.includes('title')
        );

    if (
        titleIndex < 0
    ) {
        return null;
    }

    const chaptersIndex =
        headerCells.findIndex(
            cell =>
                cell.includes('chapter') ||
                cell.includes('manga') ||
                cell.includes('source')
        );

    return {
        titleIndex,

        chaptersIndex:
            chaptersIndex >= 0
                ? chaptersIndex
                : null,

        globalNumberIndex:
            0,

        localNumberIndex:
            titleIndex > 1
                ? 1
                : null
    };
}

function looksLikeGuideSeparator(
    text
) {
    const value =
        cleanText(text);

    if (!value) {
        return false;
    }

    /*
     * Actual media uses < ... > and is handled separately.
     */
    if (
        looksLikeMediaMarker(value)
    ) {
        return false;
    }

    /*
     * Arrow/highlight separator.
     */
    if (
        /^[↓↑].*[↓↑]$/i.test(
            value
        )
    ) {
        return true;
    }

    /*
     * Generic arc / part labels.
     *
     * Examples:
     * Kyoto Arc
     * Nerima Arc
     * Part 1
     */
    if (
        /^(?:.+\s+arc|part\s+\d+)$/i
            .test(value)
    ) {
        return true;
    }

    return false;
}

function parseGuideSeparator(text, seasonNumber, afterEpisode = null) {
    const raw =
        cleanText(text);

    const title =
        cleanText(
            raw
                .replace(
                    /^[↓↑<>\-—–−_=\s]+/,
                    ''
                )
                .replace(
                    /[↓↑<>\-—–−_=\s]+$/,
                    ''
                )
        );

    return {
        title:
            title || raw,

        raw_marker:
            raw,

        season:
            seasonNumber || null,

        after_episode:
            afterEpisode || null,

        before_episode:
            null,

        marker_type:
            'section'
    };
}

function parseGuideRecommendationSection ($, root) {
    let result =
        null;

    const elements =
        $(root)
            .find(
                'h2, h3, h4, p, ul > li, ol > li'
            )
            .toArray();

    let capturing =
        false;

    let headingLevel =
        null;

    let paragraphs =
        [];

    let items =
        [];

    for (
        const element
        of elements
    ) {
        const tag =
            element.tagName
                ?.toLowerCase();

        const cleanElement =
            $(element).clone();

        cleanElement
            .find(
                'script, style, noscript, template'
            )
            .remove();

        const text =
            cleanText(
                cleanElement.text()
            );

        if (
            !text ||
            isGuideNoiseText(text)
        ) {
            continue;
        }

        if (
            /^h[234]$/.test(tag)
        ) {
            const level =
                Number(
                    tag.slice(1)
                );

            if (
                capturing &&
                level <= headingLevel
            ) {
                break;
            }

            if (
                /fillers?.*worth watching|worth watching.*fillers?/i
                    .test(text)
            ) {
                capturing =
                    true;

                headingLevel =
                    level;

                result = {
                    heading:
                        text,

                    paragraphs:
                        [],

                    items:
                        []
                };

                continue;
            }
        }

        if (!capturing) {
            continue;
        }

        if (tag === 'p') {
            paragraphs.push(
                text
            );
        }

        if (tag === 'li') {
            items.push(
                text
            );
        }
    }

    if (!result) {
        return null;
    }

    result.paragraphs =
        unique(paragraphs);

    result.items =
        unique(items);

        return result;
}

function parseGuideEpisodeList(
    $,
    list,
    season,
    lastEpisodeNumber = null
) {
    const episodes = [];
    const media = [];
    const markers = [];

    let runningLastEpisode =
        lastEpisodeNumber;

    $(list)
        .children('li')
        .each(
            (_, item) => {
                const text =
                    cleanText(
                        $(item).text()
                    );

                if (!text) {
                    return;
                }

                if (
                    looksLikeMediaMarker(
                        text
                    )
                ) {
                    media.push(
                        parseMediaMarker(
                            text,
                            season.number,
                            runningLastEpisode
                        )
                    );

                    return;
                }

                if (
                    looksLikeGuideSeparator(
                        text
                    )
                ) {
                    markers.push(
                        parseGuideSeparator(
                            text,
                            season.number,
                            runningLastEpisode
                        )
                    );

                    return;
                }

                /*
                 * Accept:
                 *
                 * 01. "Asteroid Blues"
                 * 01) "Asteroid Blues"
                 * 01 - "Asteroid Blues"
                 * 01: "Asteroid Blues"
                 */
                const match =
                    text.match(
                        /^(\d+(?:\.\d+)?)\s*(?:[.)]|-|:)\s*(.+)$/i
                    );

                if (!match) {
                    return;
                }

                const number =
                    normalizeEpisodeNumber(
                        match[1]
                    );

                let rawTitle =
                    cleanText(
                        match[2]
                    );

                rawTitle =
                    rawTitle
                        .replace(
                            /^[“"'‘]+/,
                            ''
                        )
                        .replace(
                            /[”"'’]+$/,
                            ''
                        )
                        .trim();

                const parsedTitle =
                    parseGuideEpisodeTitle(
                        rawTitle
                    );

                /*
                 * No manga/source column exists here.
                 *
                 * AFG alone therefore cannot claim
                 * "Manga Canon".
                 *
                 * AFL may still provide classification later
                 * if the complete episode numbering matches.
                 */
                const inferredType =
                    parsedTitle
                        .explicit_type ||
                    'Unknown';

                episodes.push({
                    number,

                    season_episode_number:
                        null,

                    season:
                        season.number,

                    season_name:
                        season.name,

                    raw_title:
                        parsedTitle.raw_title,

                    title:
                        parsedTitle.title,

                    normalized_title:
                        normalizeTitleForMatch(
                            parsedTitle.title
                        ),

                    manga_chapters:
                        null,

                    guide_note:
                        parsedTitle.guide_note,

                    guide_explicit_type:
                        parsedTitle.explicit_type,

                    guide_filler_marker:
                        parsedTitle
                            .explicit_type ===
                        'Filler',

                    guide_mixed_marker:
                        parsedTitle
                            .explicit_type ===
                        'Mixed Canon/Filler',

                    inferred_type:
                        inferredType,

                    type:
                        inferredType,

                    type_source:
                        'AnimeFillerGuide.com'
                });

                runningLastEpisode =
                    number;
            }
        );

    return {
        episodes,
        media,
        markers,

        lastEpisodeNumber:
            runningLastEpisode
    };
}

function parseGuideEpisodeTable($, table, season, lastEpisodeNumber = null) {
    const episodes = [];
    const media = [];
    const markers = [];

    let runningLastEpisode =
        lastEpisodeNumber;

    $(list)
        .children('li')
        .each((_, item) => {
            const text =
                cleanText(
                    $(item).text()
                );

            if (!text) {
                return;
            }

            if (
                looksLikeMediaMarker(
                    text
                )
            ) {
                media.push(
                    parseMediaMarker(
                        text,
                        season.number,
                        runningLastEpisode
                    )
                );

                return;
            }

            if (
                looksLikeGuideSeparator(
                    text
                )
            ) {
                markers.push(
                    parseGuideSeparator(
                        text,
                        season.number,
                        runningLastEpisode
                    )
                );

                return;
            }

            /*
             * Examples:
             *
             * 01. “Asteroid Blues”
             * 26. "The Real Folk Blues"
             */
            const match =
                text.match(
                    /^(\d+(?:\.\d+)?)\s*\.\s*(.+)$/i
                );

            if (!match) {
                return;
            }

            const number =
                normalizeEpisodeNumber(
                    match[1]
                );

            let rawTitle =
                cleanText(
                    match[2]
                );

            rawTitle =
                rawTitle
                    .replace(
                        /^[“"'‘]+/,
                        ''
                    )
                    .replace(
                        /[”"'’]+$/,
                        ''
                    )
                    .trim();

            const parsedTitle =
                parseGuideEpisodeTitle(
                    rawTitle
                );

            /*
             * There is NO chapter column.
             *
             * Do not infer canon.
             * AFL can still classify later if numbering matches.
             */
            const inferredType =
                parsedTitle.explicit_type ||
                'Unknown';

            episodes.push({
                number,

                season_episode_number:
                    null,

                season:
                    season.number,

                season_name:
                    season.name,

                raw_title:
                    parsedTitle.raw_title,

                title:
                    parsedTitle.title,

                normalized_title:
                    normalizeTitleForMatch(
                        parsedTitle.title
                    ),

                manga_chapters:
                    null,

                guide_note:
                    parsedTitle.guide_note,

                guide_explicit_type:
                    parsedTitle.explicit_type,

                guide_filler_marker:
                    parsedTitle.explicit_type ===
                    'Filler',

                guide_mixed_marker:
                    parsedTitle.explicit_type ===
                    'Mixed Canon/Filler',

                inferred_type:
                    inferredType,

                type:
                    inferredType,

                type_source:
                    'AnimeFillerGuide.com'
            });

            runningLastEpisode =
                number;
        });

    return {
        episodes,
        media,
        markers,
        lastEpisodeNumber:
            runningLastEpisode
    };
}

function parseGuideEpisodeTable($, table, season, lastEpisodeNumber = null) {
    const map =
        getTableColumnMap(
            $,
            table
        );

    if (!map) {
        return {
            episodes: [],
            media: [],
            markers: [],
            lastEpisodeNumber
        };
    }

    const episodes = [];
    const media = [];
    const markers = [];

    let runningLastEpisode =
        lastEpisodeNumber;

    let headerSeen =
        false;

    $(table)
        .find('tr')
        .each((_, row) => {
            const cells =
                $(row)
                    .find('th, td');

            if (
                !cells.length
            ) {
                return;
            }

            const values =
                cells
                    .map(
                        (__, cell) =>
                            cleanText(
                                $(cell).text()
                            )
                    )
                    .get();

            const lowerValues =
                values.map(
                    value =>
                        value.toLowerCase()
                );

            if (
                !headerSeen &&
                lowerValues.some(
                    value =>
                        value === 'title' ||
                        value.includes('title')
                )
            ) {
                headerSeen =
                    true;

                return;
            }

            const wholeRowText =
                cleanText(
                    values.join(' ')
                );

            if (!wholeRowText) {
                return;
            }

            /*
             * Movie / OVA / special markers.
             */
            if (
                looksLikeMediaMarker(
                    wholeRowText
                )
            ) {
                media.push(
                    parseMediaMarker(
                        wholeRowText,
                        season.number,
                        runningLastEpisode
                    )
                );

                return;
            }

            /*
             * Arc / part / visual separators.
             */
            if (
                looksLikeGuideSeparator(
                    wholeRowText
                )
            ) {
                markers.push(
                    parseGuideSeparator(
                        wholeRowText,
                        season.number,
                        runningLastEpisode
                    )
                );

                return;
            }

            const number =
                normalizeEpisodeNumber(
                    values[
                        map.globalNumberIndex
                    ]
                );

            /*
             * A one-cell non-numeric row inside an otherwise
             * valid episode table is also a section marker.
             *
             * This catches future AFG arc labels without
             * requiring us to know the name beforehand.
             */
            if (
                !number &&
                values.length <= 2
            ) {
                markers.push(
                    parseGuideSeparator(
                        wholeRowText,
                        season.number,
                        runningLastEpisode
                    )
                );

                return;
            }

            if (!number) {
                return;
            }

            const rawTitle =
                cleanText(
                    values[
                        map.titleIndex
                    ]
                );

            if (!rawTitle) {
                return;
            }

            const sourceMaterial =
                map.chaptersIndex !== null
                    ? cleanText(
                        values[
                            map.chaptersIndex
                        ]
                    )
                    : null;

            const localNumber =
                map.localNumberIndex !== null
                    ? normalizeEpisodeNumber(
                        values[
                            map.localNumberIndex
                        ]
                    )
                    : null;

            const parsedTitle =
                parseGuideEpisodeTitle(
                    rawTitle
                );

            const inferredType =
                inferGuideCanonType(
                    rawTitle,
                    sourceMaterial
                );

            episodes.push({
                number,

                season_episode_number:
                    localNumber,

                season:
                    season.number,

                season_name:
                    season.name,

                raw_title:
                    parsedTitle.raw_title,

                title:
                    parsedTitle.title,

                normalized_title:
                    normalizeTitleForMatch(
                        parsedTitle.title
                    ),

                manga_chapters:
                    sourceMaterial || null,

                guide_note:
                    parsedTitle.guide_note,

                guide_explicit_type:
                    parsedTitle.explicit_type,

                guide_filler_marker:
                    parsedTitle.explicit_type ===
                    'Filler',

                guide_mixed_marker:
                    parsedTitle.explicit_type ===
                    'Mixed Canon/Filler',

                inferred_type:
                    inferredType,

                type:
                    inferredType,

                type_source:
                    'AnimeFillerGuide.com'
            });

            runningLastEpisode =
                number;
        });

    return {
        episodes,
        media,
        markers,
        lastEpisodeNumber:
            runningLastEpisode
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
    const text =
        cleanText(
            $(root).text()
        );

    const patterns = [
        /\bhas\s+(\d+)\s+episodes?\b/i,
        /\bcontains\s+(\d+)\s+episodes?\b/i,
        /\bconsists\s+of\s+(\d+)\s+episodes?\b/i,
        /\bis\s+(?:an?\s+)?(\d+)[-\s]episode\s+anime\b/i,
        /\b(\d+)\s+episodes?\s+divided\s+into\b/i
    ];

    for (
        const pattern
        of patterns
    ) {
        const match =
            text.match(
                pattern
            );

        if (match) {
            return Number(
                match[1]
            );
        }
    }

    return null;
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

function finalizeOrderedPlacement(items, episodes) {
    const sortedEpisodeNumbers =
        episodes
            .map(
                episode =>
                    Number(
                        episode.number
                    )
            )
            .filter(
                Number.isFinite
            )
            .sort(
                (a, b) =>
                    a - b
            );

    return (
        items || []
    ).map(
        item => {
            const after =
                Number(
                    item.after_episode
                );

            const next =
                Number.isFinite(after)
                    ? sortedEpisodeNumbers.find(
                        number =>
                            number > after
                    )
                    : sortedEpisodeNumbers[0];

            return {
                ...item,

                before_episode:
                    next !== undefined
                        ? String(next)
                        : null
            };
        }
    );
}

function parseAnimeFillerGuideHtml (html, slug, url) {
    const $ =
        cheerio.load(html);

    const root =
        resolveGuideContentRoot($);

    root
        .find(
            'script, style, noscript, template'
        )
        .remove();

    const anime =
        extractGuideAnimeName($) ||
        slug;

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

    const recommendations =
        parseGuideRecommendationSection(
            $,
            root
        );

    const seasons = [];
    const allEpisodes = [];
    const allMedia = [];
    const allMarkers = [];

    let currentSeason =
        null;

    let currentSeasonDescriptionParts =
        [];

    let currentSeasonNotes =
        [];

    let currentSeasonHasEpisodes =
        false;

    let lastEpisodeNumber =
        null;

    const buildSeasonFromHeading =
        seasonHeading =>
            createGuideSeason({
                number:
                    seasonHeading.number,

                heading:
                    seasonHeading.heading,

                name:
                    seasonHeading.name,

                synthetic:
                    false
            });

    const buildSyntheticSeason =
        () =>
            createGuideSeason({
                number:
                    seasons.length + 1,

                heading:
                    `Season ${seasons.length + 1}`,

                name:
                    `Season ${seasons.length + 1}`,

                synthetic:
                    true
            });

    const finishCurrentSeason =
        () => {
            if (
                !currentSeason
            ) {
                return;
            }

            const cleanDescriptionParts =
                currentSeasonDescriptionParts
                    .map(
                        part =>
                            cleanText(part)
                    )
                    .filter(
                        part =>
                            !isGuideNoiseText(
                                part
                            )
                    );

            const parsedDescription =
                parseSeasonDescription(
                    cleanDescriptionParts
                        .join(' ')
                );

            Object.assign(
                currentSeason,
                parsedDescription
            );

            currentSeason.notes =
                unique(
                    currentSeasonNotes
                        .map(
                            note =>
                                cleanText(note)
                        )
                        .filter(
                            note =>
                                !isGuideNoiseText(
                                    note
                                )
                        )
                );

            const seasonEpisodes =
                allEpisodes.filter(
                    episode =>
                        episode.season ===
                        currentSeason.number
                );

            /*
             * Prevent unrelated tables from creating
             * empty synthetic seasons.
             */
            if (
                currentSeason.synthetic &&
                seasonEpisodes.length === 0
            ) {
                currentSeason =
                    null;

                currentSeasonDescriptionParts =
                    [];

                currentSeasonNotes =
                    [];

                currentSeasonHasEpisodes =
                    false;

                return;
            }

            currentSeason.episodes =
                seasonEpisodes;

            currentSeason.detected_episode_count =
                seasonEpisodes.length;

            currentSeason.episode_range =
                seasonEpisodes.length
                    ? {
                        start:
                            seasonEpisodes[0]
                                .number,

                        end:
                            seasonEpisodes[
                                seasonEpisodes.length - 1
                            ].number
                    }
                    : null;

            seasons.push(
                currentSeason
            );

            currentSeason =
                null;

            currentSeasonDescriptionParts =
                [];

            currentSeasonNotes =
                [];

            currentSeasonHasEpisodes =
                false;
        };

    root
        .find(
            'h2, h3, h4, p, blockquote, i, table, ul, ol'
        )
        .each(
            (_, element) => {
                const tag =
                    element.tagName
                        ?.toLowerCase();

                const cleanElement =
                    $(element).clone();

                cleanElement
                    .find(
                        'script, style, noscript, template'
                    )
                    .remove();

                const text =
                    cleanText(
                        cleanElement.text()
                    );

                if (
                    isGuideNoiseText(
                        text
                    )
                ) {
                    return;
                }

                /*
                 * -------------------------------
                 * HEADINGS
                 * -------------------------------
                 */
                if (
                    /^h[234]$/.test(
                        tag
                    )
                ) {
                    const fallbackNumber =
                        currentSeason
                            ? currentSeason.number + 1
                            : seasons.length + 1;

                    const seasonHeading =
                        parseSeasonHeading(
                            text,
                            fallbackNumber
                        );

                    if (
                        seasonHeading
                    ) {
                        finishCurrentSeason();

                        currentSeason =
                            buildSeasonFromHeading(
                                seasonHeading
                            );

                        return;
                    }

                    /*
                     * A new non-season H2 usually means we
                     * have left the episode/season area and
                     * entered recommendations, continuation,
                     * explanation, etc.
                     */
                    if (
                        tag === 'h2' &&
                        currentSeason
                    ) {
                        finishCurrentSeason();
                    }

                    return;
                }

                /*
                 * -------------------------------
                 * TABLE EPISODE LIST
                 * -------------------------------
                 */
                if (
                    tag === 'table'
                ) {
                    const targetSeason =
                        currentSeason ||
                        buildSyntheticSeason();

                    const parsed =
                        parseGuideEpisodeTable(
                            $,
                            element,
                            targetSeason,
                            lastEpisodeNumber
                        );

                    if (
                        parsed.episodes.length ||
                        parsed.media.length ||
                        parsed.markers.length
                    ) {
                        if (
                            !currentSeason
                        ) {
                            currentSeason =
                                targetSeason;
                        }

                        currentSeasonHasEpisodes =
                            currentSeasonHasEpisodes ||
                            parsed.episodes.length > 0;

                        allEpisodes.push(
                            ...parsed.episodes
                        );

                        allMedia.push(
                            ...parsed.media
                        );

                        allMarkers.push(
                            ...parsed.markers
                        );

                        lastEpisodeNumber =
                            parsed.lastEpisodeNumber ||
                            lastEpisodeNumber;
                    }

                    return;
                }

                /*
                 * -------------------------------
                 * LIST EPISODE LIST
                 * -------------------------------
                 *
                 * This covers Cowboy Bebop-style pages.
                 */
                if (
                    tag === 'ul' ||
                    tag === 'ol'
                ) {
                    const targetSeason =
                        currentSeason ||
                        buildSyntheticSeason();

                    const parsed =
                        parseGuideEpisodeList(
                            $,
                            element,
                            targetSeason,
                            lastEpisodeNumber
                        );

                    if (
                        parsed.episodes.length ||
                        parsed.media.length ||
                        parsed.markers.length
                    ) {
                        if (
                            !currentSeason
                        ) {
                            currentSeason =
                                targetSeason;
                        }

                        currentSeasonHasEpisodes =
                            currentSeasonHasEpisodes ||
                            parsed.episodes.length > 0;

                        allEpisodes.push(
                            ...parsed.episodes
                        );

                        allMedia.push(
                            ...parsed.media
                        );

                        allMarkers.push(
                            ...parsed.markers
                        );

                        lastEpisodeNumber =
                            parsed.lastEpisodeNumber ||
                            lastEpisodeNumber;
                    }

                    return;
                }

                /*
                 * -------------------------------
                 * TEXT / INFO BLOCKS
                 * -------------------------------
                 */
                if (
                    tag === 'p' ||
                    tag === 'blockquote' ||
                    tag === 'i'
                ) {
                    /*
                     * Do not process an <i> twice if it is
                     * nested inside another element whose text
                     * we already consume.
                     */
                    if (
                        tag === 'i'
                    ) {
                        const parentTag =
                            $(element)
                                .parent()
                                .prop(
                                    'tagName'
                                )
                                ?.toLowerCase();

                        if (
                            [
                                'p',
                                'blockquote',
                                'li',
                                'td',
                                'th'
                            ].includes(
                                parentTag
                            )
                        ) {
                            return;
                        }
                    }

                    if (!text) {
                        return;
                    }

                    /*
                     * Media markers can exist as paragraphs
                     * between episode tables.
                     */
                    if (
                        looksLikeMediaMarker(
                            text
                        )
                    ) {
                        if (
                            !currentSeason
                        ) {
                            currentSeason =
                                buildSyntheticSeason();
                        }

                        allMedia.push(
                            parseMediaMarker(
                                text,
                                currentSeason.number,
                                lastEpisodeNumber
                            )
                        );

                        return;
                    }

                    /*
                     * Arc / Part markers can also exist as
                     * highlighted standalone text.
                     */
                    if (
                        looksLikeGuideSeparator(
                            text
                        )
                    ) {
                        if (
                            !currentSeason
                        ) {
                            return;
                        }

                        allMarkers.push(
                            parseGuideSeparator(
                                text,
                                currentSeason.number,
                                lastEpisodeNumber
                            )
                        );

                        return;
                    }

                    /*
                     * Intro text before the first real season
                     * is article text, NOT season description.
                     */
                    if (
                        !currentSeason
                    ) {
                        return;
                    }

                    if (
                        currentSeasonHasEpisodes
                    ) {
                        /*
                         * Tokyo Ghoul-style <i> blocks and
                         * explanatory paragraphs after the
                         * episode table.
                         */
                        currentSeasonNotes.push(
                            text
                        );
                    } else {
                        /*
                         * Preserve the COMPLETE season
                         * description paragraph.
                         */
                        currentSeasonDescriptionParts.push(
                            text
                        );
                    }
                }
            }
        );

    finishCurrentSeason();

    /*
     * AnimeFillerGuide controls global numbering.
     *
     * De-duplicate any repeated/nested rows using the
     * global episode number.
     */
    const episodeMap =
        new Map();

    for (
        const episode
        of allEpisodes
    ) {
        episodeMap.set(
            String(
                episode.number
            ),
            episode
        );
    }

    const episodes =
        [...episodeMap.values()]
            .sort(
                episodeNumberSort
            );

    const media =
        finalizeOrderedPlacement(
            allMedia,
            episodes
        );

    const markers =
        finalizeOrderedPlacement(
            allMarkers,
            episodes
        );

    /*
     * Reattach finalized placement data to seasons.
     */
    const finalizedSeasons =
        seasons.map(
            season => ({
                ...season,

                episodes:
                    episodes.filter(
                        episode =>
                            episode.season ===
                            season.number
                    ),

                media:
                    media.filter(
                        item =>
                            item.season ===
                            season.number
                    ),

                markers:
                    markers.filter(
                        item =>
                            item.season ===
                            season.number
                    )
            })
        );

    if (
        episodes.length === 0
    ) {
        return null;
    }

    return {
        site:
            'AnimeFillerGuide.com',

        slug,
        url,
        anime,

        total_episodes:
            declaredEpisodeCount ||
            episodes.length,

        detected_episode_count:
            episodes.length,

        seasons:
            finalizedSeasons,

        episodes,

        media,

        markers,

        continuation,

        recommendations
    };
}

// ============================================================
// AnimeFillerGuide.com requests/discovery
// ============================================================
async function scrapeAnimeFillerGuideBySlug (slug) {
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

function findNumberDifferences (guideEpisodes, aflEpisodes) {
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

function mergeWithGuideAuthority (guide, afl) {
    if (!guide) {
        return null;
    }

    const aflByNumber =
        new Map(
            (afl?.episodes || [])
                .map(
                    episode => [
                        String(
                            episode.number
                        ),
                        episode
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
     * AnimeFillerList classification data is trusted
     * ONLY when the COMPLETE episode-number sets match.
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
                        episode =>
                            episode.number
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
                 * Classification priority:
                 *
                 * 1. AFL if numbering fully matches.
                 *
                 * 2. Otherwise AFG:
                 *      explicit *Mixed
                 *      explicit *Filler
                 *      manga/NOVEL backing
                 *
                 * 3. Otherwise Unknown.
                 */
                const type =
                    aflEpisode?.type ||
                    guideEpisode
                        .inferred_type ||
                    inferGuideCanonType(
                        guideEpisode.raw_title,
                        guideEpisode.manga_chapters
                    ) ||
                    'Unknown';

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

                    /*
                     * AFG title always wins.
                     */
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

                    guide_note:
                        guideEpisode
                            .guide_note ||
                        null,

                    guide_explicit_type:
                        guideEpisode
                            .guide_explicit_type ||
                        null,

                    guide_filler_marker:
                        !!guideEpisode
                            .guide_filler_marker,

                    guide_mixed_marker:
                        !!guideEpisode
                            .guide_mixed_marker,

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
        (guide.seasons || [])
            .map(
                season => ({
                    ...season,

                    episodes:
                        episodes.filter(
                            episode =>
                                episode.season ===
                                season.number
                        )
                })
            );

    return {
        anime:
            guide.anime,

        total_episodes:
            guide.total_episodes,

        detected_episode_count:
            guide.detected_episode_count,

        episodes,

        seasons,

        media:
            guide.media ||
            [],

        markers:
            guide.markers ||
            [],

        continuation:
            guide.continuation || {
                where_anime_ends:
                    null,

                where_to_start_reading:
                    null
            },

        recommendations:
            guide.recommendations ||
            null,

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

function buildAflOnlyResult (afl, animeSlug) {
    const episodes =
        afl.episodes.map(
            episode => ({
                number:
                    episode.number,

                season_episode_number:
                    null,

                season:
                    null,

                season_name:
                    null,

                title:
                    episode.title,

                raw_title:
                    episode.title,

                normalized_title:
                    episode.normalized_title,

                type:
                    episode.type,

                type_source:
                    'AnimeFillerList.com',

                manga_chapters:
                    null,

                guide_note:
                    null,

                guide_explicit_type:
                    null,

                guide_filler_marker:
                    false,

                guide_mixed_marker:
                    false,

                source_titles: {
                    anime_filler_guide:
                        null,

                    anime_filler_list:
                        episode.title
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

        markers: [],

        continuation: {
            where_anime_ends:
                null,

            where_to_start_reading:
                null
        },

        recommendations:
            null,

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

function buildStatusMessage (aflStatus, guideStatus) {
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
            : buildAflOnlyResult(afl, animeSlug);

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

                markers:
                    guide?.markers ||
                    [],

                continuation:
                    guide?.continuation ||
                    null,

                recommendations:
                    guide?.recommendations ||
                    null
            }
        }
    };
}

module.exports = {
    getFillerData
};