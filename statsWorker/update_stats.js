const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../misc/.env') });

const { createClient } = require('@supabase/supabase-js');
if (!globalThis.WebSocket) {
    globalThis.WebSocket = require('ws');
}

// Load shared overrides (Adjust the path based on where you put the JSON file!)
const vibeMappings = require('../vibes/vibe_overrides.json'); 

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY 
);

const configPath = path.resolve(__dirname, '../config.json');
const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const TMDB_TOKEN = configData.tmdb_token;
const LASTFM_KEY = configData.lastfm_key;

const OPENVERSE_CLIENT_ID = process.env.OPENVERSE_CLIENT_ID;
const OPENVERSE_CLIENT_SECRET = process.env.OPENVERSE_CLIENT_SECRET;

const delay = ms => new Promise(res => setTimeout(res, ms));

// --- VIBE LOGIC (Mirrors update_vibes.js) ---

function translateKeyword(query) {
    if (!query) return "landscape";
    let q = query.toLowerCase().trim();

    // 1. Broad Catch-Alls
    for (const [key, value] of Object.entries(vibeMappings.includes)) {
        if (q.includes(key)) return value;
    }

    // 2. Direct Overrides
    if (vibeMappings.exact[q]) return vibeMappings.exact[q];
    
    // 3. Fallback Cleanup
    q = q.replaceAll("based on", "");
    return q.trim();
}

let openverseToken = null;
let openverseTokenExpiresAt = 0;

async function getOpenverseToken() {
    if (!OPENVERSE_CLIENT_ID || !OPENVERSE_CLIENT_SECRET) return null;
    if (openverseToken && Date.now() < openverseTokenExpiresAt) return openverseToken;

    try {
        const res = await fetch('https://api.openverse.org/v1/auth_tokens/token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: OPENVERSE_CLIENT_ID,
                client_secret: OPENVERSE_CLIENT_SECRET
            })
        });

        if (!res.ok) return null;
        const data = await res.json();
        openverseToken = data.access_token;
        openverseTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
        return openverseToken;
    } catch (err) {
        console.error("Openverse Token Error:", err.message);
        return null;
    }
}

function buildAttribution(result) {
    const license = (result.license || '').toUpperCase();
    const version = result.license_version ? ` ${result.license_version}` : '';
    const creator = result.creator || 'Unknown creator';
    const source = result.source || result.provider || 'Openverse';

    if (license === 'CC0' || license === 'PDM') {
        return { text: `Public domain via ${source}`, url: result.foreign_landing_url || null };
    }
    return {
        text: `Photo by ${creator} / ${source}, licensed CC ${license}${version}`,
        url: result.foreign_landing_url || null
    };
}

async function fetchImage(query) {
    const visualSearchTerm = translateKeyword(query);
    
    async function searchOpenverse(extraParams, headers) {
        const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(visualSearchTerm)}&license_type=commercial&category=photograph&aspect_ratio=wide&size=large&page_size=3&mature=false${extraParams}`;
        const res = await fetch(url, { headers });
        if (res.status === 429) return { rateLimited: true };
        if (!res.ok) return { rateLimited: false, result: null };
        const data = await res.json();
        return { rateLimited: false, result: data.results?.[0] || null };
    }

    try {
        const token = await getOpenverseToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        let { rateLimited, result } = await searchOpenverse('&source=stocksnap,rawpixel', headers);

        if (!rateLimited && !result) {
            ({ result } = await searchOpenverse('', headers));
        }

        if (result) {
            return { url: result.url, attribution: buildAttribution(result) };
        }

        // TMDB Fallback
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` } 
        });
        const tmdbData = await tmdbRes.json();
        
        if (tmdbData.results?.[0]?.backdrop_path) {
            return {
                url: `https://image.tmdb.org/t/p/w1280${tmdbData.results[0].backdrop_path}`,
                attribution: { text: 'Image data provided by TMDB', url: 'https://www.themoviedb.org/' }
            };
        }

        return { url: null, attribution: null };
    } catch (err) {
        console.error("Image Fetch Error:", err.message);
        return { url: null, attribution: null };
    }
}

// --- STATS LOGIC ---
function isDateInPeriod(dateStr, depth, period) {
    if (!dateStr) return false;
    let d = new Date(dateStr);
    if (d.toISOString().length === 24) d = new Date(dateStr + "T12:00:00");
    if (depth === 'all-time') return true;
    if (depth === 'by-year') return d.getFullYear() === Number.parseInt(period);
    
    if (depth === 'by-season') {
        const parts = period.split(' ');
        const season = parts[0];
        let start, end;
        if (season === 'Winter') {
            const years = parts[1].split('-');
            start = new Date(years[0], 11, 1); 
            end = new Date(years[1], 2, 0, 23, 59, 59); 
        } else if (season === 'Spring') {
            start = new Date(parts[1], 2, 1); 
            end = new Date(parts[1], 5, 0, 23, 59, 59); 
        } else if (season === 'Summer') {
            start = new Date(parts[1], 5, 1); 
            end = new Date(parts[1], 8, 0, 23, 59, 59);
        } else if (season === 'Fall') {
            start = new Date(parts[1], 8, 1); 
            end = new Date(parts[1], 11, 0, 23, 59, 59);
        }
        return d >= start && d <= end;
    }
    return false;
}

function getTopItems(tallyDict, count = 3) {
    return Object.entries(tallyDict).sort((a, b) => b[1] - a[1]).slice(0, count).map(e => e[0]);
}

async function processTmdbItem(log, label, itemLabel, actorTally, directorTally, genreTally, themeTally) {
    console.log(`${label} — fetching TMDB data for ${itemLabel}`);
    try {
        if (!TMDB_TOKEN) console.error(`[I] TMDB_TOKEN is missing or undefined!`);
        const ep = log.media_type === 'tv' ? 'aggregate_credits' : 'credits';
        
        const creditsRes = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}/${ep}?language=en-US`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' }
        }).then(r => r.json());

        if (creditsRes.success === false) console.error(`[E] TMDB Error for ${itemLabel}:`, creditsRes.status_message);

        if (creditsRes.cast) creditsRes.cast.slice(0, 5).forEach(c => { actorTally[c.name] = (actorTally[c.name] || 0) + 1; });
        if (creditsRes.crew) creditsRes.crew.filter(c => c.job === 'Director' || (c.job === 'Executive Producer' && log.media_type === 'tv')).forEach(d => { directorTally[d.name] = (directorTally[d.name] || 0) + 1; });

        const detailsRes = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}?append_to_response=keywords`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' }
        }).then(r => r.json());

        if (detailsRes.genres) detailsRes.genres.forEach(g => { genreTally[g.name] = (genreTally[g.name] || 0) + 1; });
        const keywords = log.media_type === 'tv' ? detailsRes.keywords?.results : detailsRes.keywords?.keywords;
        if (keywords) keywords.forEach(k => { themeTally[k.name] = (themeTally[k.name] || 0) + 1; });
    } catch(e) {
        console.error(`[E] Fatal Fetch Error for ${itemLabel}:`, e.message);
    }
    await delay(100); 
}

async function processBookItem(log, label, itemLabel, themeTally) {
    console.log(`${label} — fetching OpenLibrary data for ${itemLabel}`);
    try {
        const bookRes = await fetch(`https://openlibrary.org${log.media_id}.json`).then(r => r.json());
        if (bookRes.subjects) {
            bookRes.subjects.forEach(s => {
                const name = typeof s === 'string' ? s : s.name;
                themeTally[name] = (themeTally[name] || 0) + 1;
            });
        }
    } catch(e) {
        console.warn(`${label} — OpenLibrary lookup failed for ${itemLabel}: ${e.message}`);
    }
    await delay(500); 
}

async function processAlbumItem(log, label, itemLabel, themeTally) {
    console.log(`${label} — fetching Last.fm tags for ${itemLabel}`);
    try {
        if (!LASTFM_KEY) console.error(`[I] LASTFM_KEY is missing or undefined!`);
        const [artist, album] = decodeURIComponent(log.media_id).split('|||');

        if (artist && album) {
            const tagsRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.gettoptags&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${LASTFM_KEY}&format=json`)
                .then(r => r.json());

            if (tagsRes.error) console.error(`[E] Last.fm Error for ${itemLabel}:`, tagsRes.message);

            const rawTags = tagsRes.toptags?.tag;
            let tags = [];
            if (Array.isArray(rawTags)) {
                tags = rawTags;
            } else if (rawTags) {
                tags = [rawTags];
            }

            tags.slice(0, 5).forEach(t => { themeTally[t.name] = (themeTally[t.name] || 0) + 1; });
        } else {
            console.warn(`${label} — could not parse artist/album for ${itemLabel}`);
        }
    } catch(e) {
        console.warn(`${label} — Last.fm lookup failed for ${itemLabel}: ${e.message}`);
    }
    await delay(250);
}

async function tallyUserLogs(targetLogs, label, tallies) {
    const { actorTally, directorTally, genreTally, themeTally } = tallies;
    
    for (const [j, log] of targetLogs.entries()) {
        const itemNum = j + 1;
        const itemLabel = `${log.media_type} ${itemNum}`;
        const progressStr = `(${itemNum}/${targetLogs.length}) ${itemLabel}`;

        if (log.media_type === 'movie' || log.media_type === 'tv') {
            await processTmdbItem(log, label, progressStr, actorTally, directorTally, genreTally, themeTally);
        } else if (log.media_type === 'book') {
            await processBookItem(log, label, progressStr, themeTally);
        } else if (log.media_type === 'album') {
            await processAlbumItem(log, label, progressStr, themeTally);
        }
    }
}

async function buildUserVibe(config, topGenres, topThemes, label) {
    // Early exits to reduce nesting complexity
    if (config.media_type === 'youtube' || config.media_type === 'all') return null;
    if (topGenres.length === 0 && topThemes.length === 0) return null;

    const primaryGenre = topGenres[0] || null;
    const primaryTheme = topThemes[0] || null;
    
    console.log(`${label} — building vibe images for genre="${primaryGenre}" theme="${primaryTheme}"`);
    
    const genreImg = await fetchImage(primaryGenre);
    const themeImg = await fetchImage(primaryTheme);

    console.log(`${label} — vibe images resolved (genre image: ${genreImg.url ? 'found' : 'none'}, theme image: ${themeImg.url ? 'found' : 'none'})`);

    return {
        genre: primaryGenre,
        theme: primaryTheme,
        image_genre: genreImg.url,
        image_genre_attribution: genreImg.attribution?.text || null,
        image_genre_attribution_url: genreImg.attribution?.url || null,
        image_theme: themeImg.url,
        image_theme_attribution: themeImg.attribution?.text || null,
        image_theme_attribution_url: themeImg.attribution?.url || null
    };
}

async function processUserQueue(config, i, totalQueueLength) {
    const userNum = i + 1;
    const label = `[${userNum}/${totalQueueLength}] user ${userNum} type=${config.media_type} depth=${config.stat_depth} period=${config.stat_period}`;
    console.log(`\n${label} — starting`);
    
    try {
        let query = supabase.from('media_logs').select('*').eq('user_id', config.user_id);
        if (config.media_type !== 'all') query = query.eq('media_type', config.media_type);
        const { data: rawLogs } = await query;

        console.log(`${label} — fetched ${rawLogs ? rawLogs.length : 0} raw log(s)`);

        const targetLogs = (rawLogs || []).filter(log => isDateInPeriod(log.watched_on || log.created_at, config.stat_depth, config.stat_period));

        console.log(`${label} — ${targetLogs.length} log(s) fall within the target period`);

        // Use a wrapper object to pass tallies by reference
        const tallies = { actorTally: {}, directorTally: {}, genreTally: {}, themeTally: {} };
        await tallyUserLogs(targetLogs, label, tallies);

        const topGenres = getTopItems(tallies.genreTally, 3);
        const topThemes = getTopItems(tallies.themeTally, 3);

        console.log(`${label} — top genres: [${topGenres.join(', ')}] | top themes: [${topThemes.join(', ')}]`);

        // Extracted Vibe building logic
        const vibe = await buildUserVibe(config, topGenres, topThemes, label);

        const newHeavyStats = {
            top_actors: getTopItems(tallies.actorTally, 3),
            top_directors: getTopItems(tallies.directorTally, 3),
            top_genres: topGenres,
            top_themes: topThemes,
            vibe: vibe
        };

        const { error: updateError } = await supabase
            .from('user_stats')
            .update({ heavy_stats: newHeavyStats, needs_update: false, updated_at: new Date().toISOString() })
            .eq('id', config.id);

        if (updateError) {
            console.error(`${label} — failed to save: ${updateError.message}`);
        } else {
            console.log(`${label} — done, stats saved`);
        }

    } catch (err) {
        console.error(`${label} — failed: ${err.message}`);
    }
}

async function run() {
    console.log("Checking for queued stats updates...");

    const { data: queue, error } = await supabase
        .from('user_stats')
        .select('*')
        .eq('needs_update', true);

    if (error) {
        console.error("Error fetching queue:", error.message);
        return;
    }
    if (!queue || queue.length === 0) {
        console.log("No stats rows currently need an update.");
        return;
    }

    console.log(`Found ${queue.length} row(s) queued for update.`);

    for (const [i, config] of queue.entries()) {
        await processUserQueue(config, i, queue.length);
    }

    console.log(`\nFinished processing ${queue.length} row(s).`);
}

run();