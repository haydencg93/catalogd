const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../misc/.env') });

const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const configPath = path.resolve(__dirname, '../config.json');
const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const TMDB_TOKEN = configData.tmdb_token;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 

const OPENVERSE_CLIENT_ID = process.env.OPENVERSE_CLIENT_ID;
const OPENVERSE_CLIENT_SECRET = process.env.OPENVERSE_CLIENT_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        persistSession: false
    },
    realtime: {
        transport: WebSocket
    }
});

const vibeMappings = require('./vibe_overrides.json');

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
    q = q.replace(/based on/g, "");
    return q.trim();
}

// Openverse OAuth2 client_credentials token, cached and refreshed only when it's
// close to expiring. Falls back to `null` (anonymous requests) if no creds are set,
// so this still works if you haven't registered an app yet.
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

        if (!res.ok) {
            console.warn(`[WARNING] Openverse token request failed (${res.status}). Falling back to anonymous requests.`);
            return null;
        }

        const data = await res.json();
        openverseToken = data.access_token;
        // Refresh a bit early to avoid using an expired token mid-run.
        openverseTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
        return openverseToken;
    } catch (err) {
        console.warn('[WARNING] Openverse token request errored:', err.message);
        return null;
    }
}

// Builds a plain-text credit line from Openverse's license metadata.
// CC0/PDM (public domain) technically need no attribution, but we still show a
// light-touch credit for transparency; CC BY/BY-SA legally require it.
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
    console.log(`[DEBUG] Translating TMDB tag "${query}" -> Openverse search "${visualSearchTerm}"`);

    // Runs one Openverse search and returns the first result, or null.
    async function searchOpenverse(extraParams, headers) {
        const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(visualSearchTerm)}` +
            `&license_type=commercial&category=photograph&aspect_ratio=wide&size=large` +
            `&page_size=3&mature=false${extraParams}`;
        const res = await fetch(url, { headers });

        if (res.status === 429) {
            console.warn("[WARNING] Openverse Rate Limit Hit!");
            return { rateLimited: true };
        }
        if (!res.ok) {
            console.warn(`[WARNING] Openverse request failed (${res.status}).`);
            return { rateLimited: false, result: null };
        }
        const data = await res.json();
        return { rateLimited: false, result: (data.results && data.results[0]) || null };
    }

    try {
        const token = await getOpenverseToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        // Pass 1: restrict to stocksnap/rawpixel. Both are staged/modeled stock photography
        // (all CC0), which avoids the Flickr/Wikimedia problem of surfacing photojournalism,
        // protest coverage, or portraits of real identifiable people for an unrelated "vibe" tag.
        let { rateLimited, result } = await searchOpenverse('&source=stocksnap,rawpixel', headers);

        // Pass 2: those two sources are a small slice of Openverse, so niche queries may come
        // up empty. Fall back to the full source pool rather than going straight to TMDB.
        if (!rateLimited && !result) {
            console.warn(`[WARNING] No stock-source results for "${visualSearchTerm}". Widening source pool.`);
            ({ rateLimited, result } = await searchOpenverse('', headers));
        }

        if (rateLimited) {
            console.warn("[WARNING] Falling back to TMDB due to rate limit.");
        } else if (result) {
            console.log(`[SUCCESS] Found Openverse image for "${visualSearchTerm}"`);
            return { url: result.url, attribution: buildAttribution(result) };
        } else {
            console.warn(`[WARNING] Openverse found 0 results for "${visualSearchTerm}".`);
        }

        // Fallback to TMDB
        console.log(`[DEBUG] Attempting TMDB fallback for "${query}"...`);
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` } 
        });
        const tmdbData = await tmdbRes.json();
        
        if (tmdbData.results && tmdbData.results[0] && tmdbData.results[0].backdrop_path) {
            console.log(`[SUCCESS] Found TMDB fallback for "${query}"`);
            return {
                url: `https://image.tmdb.org/t/p/w1280${tmdbData.results[0].backdrop_path}`,
                // TMDB's terms require this notice whenever their data/images are used.
                attribution: { text: 'Image data provided by TMDB', url: 'https://www.themoviedb.org/' }
            };
        }

        console.warn(`[FAILED] No images found anywhere for "${query}". Leaving image blank for the frontend's default styling.`);
        return { url: null, attribution: null };
        
    } catch (err) {
        console.error(`[ERROR] Fetch failed for ${query}:`, err.message);
        return { url: null, attribution: null };
    }
}

async function run() {
    console.log("Starting nightly vibe update...");
    
    // Fetch all users needing an update
    const { data: usersToUpdate, error } = await supabase
        .from('vibes_control')
        .select('*')
        .eq('needs_update', true);

    if (error) throw error;
    if (!usersToUpdate || usersToUpdate.length === 0) {
        console.log("No vibes need updating tonight.");
        return;
    }

    console.log(`Found ${usersToUpdate.length} users to update.`);

    for (const vibe of usersToUpdate) {
        const targetGenre = vibe.new_top_genre || vibe.current_top_genre;
        const targetTheme = vibe.new_top_theme || vibe.current_top_theme;

        const genreResult = await fetchImage(targetGenre);
        const themeResult = await fetchImage(targetTheme);

        await supabase.from('vibes_control').update({
            current_top_genre: targetGenre,
            current_top_theme: targetTheme,
            image_genre: genreResult.url,
            image_genre_attribution: genreResult.attribution ? genreResult.attribution.text : null,
            image_genre_attribution_url: genreResult.attribution ? genreResult.attribution.url : null,
            image_theme: themeResult.url,
            image_theme_attribution: themeResult.attribution ? themeResult.attribution.text : null,
            image_theme_attribution_url: themeResult.attribution ? themeResult.attribution.url : null,
            needs_update: false,
            new_top_genre: null,
            new_top_theme: null,
            updated_at: new Date().toISOString()
        }).eq('id', vibe.id);

        console.log(`Updated vibe for user ${vibe.user_id}`);
    }
}

run().catch(console.error);