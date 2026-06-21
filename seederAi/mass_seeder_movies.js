const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const WebSocket = require('ws'); 

// Load configuration and environment variables
const config = require('../config.json');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(config.supabase_url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket }
});

const TMDB_TOKEN = config.tmdb_token; 

if (!TMDB_TOKEN) {
    console.error("[E] ERROR: Could not find TMDB_TOKEN in config.json.");
    process.exit(1);
}

// The Rate-Limiting Safety Valve
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTmdbDetails(tmdbId) {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}`
        }
    };

    try {
        // Fetch base details AND keywords in one single optimized API call
        const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?append_to_response=keywords,credits`, options);
        
        if (!res.ok) {
            // Safety Catch: If TMDB rate-limits us, pause heavily
            if (res.status === 429) {
                console.log("[E] TMDB Rate Limit Hit! Pausing for 5 seconds...");
                await sleep(5000);
            }
            return null;
        }
        
        const data = await res.json();
        
        const genres = data.genres ? data.genres.map(g => g.name) : [];
        const keywords = data.keywords && data.keywords.keywords ? data.keywords.keywords.map(k => k.name) : [];
        const combinedTags = [...genres, ...keywords].join(', ');
        const characters = data.credits && data.credits.cast 
            ? data.credits.cast.map(c => c.character).filter(Boolean).slice(0, 15).join(', ') 
            : '';

        return {
            title: data.title,
            release_year: data.release_date ? data.release_date.split('-')[0] : null,
            popularity: data.popularity,
            overview: data.overview,
            tags: combinedTags,
            characters: characters // 3. Return the string
        };
    } catch (error) {
        console.error(`[E] Error fetching TMDB ID ${tmdbId}:`, error.message);
        return null;
    }
}

async function runMassSeeder() {
    console.log("[I] Starting Safe TMDB Mass Discovery Pipeline...");
    
    // TMDB allows paginating up to page 500 (20 results per page = 10,000 movies)
    const START_PAGE = 1;
    const END_PAGE = 500; 

    let totalSaved = 0;

    for (let page = START_PAGE; page <= END_PAGE; page++) {
        console.log(`\n[I] Fetching Discover Page ${page}/${END_PAGE}...`);
        
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: `Bearer ${TMDB_TOKEN}`
            }
        };

        try {
            // 1. Fetch the 20 most popular movies on this specific page
            const discoverRes = await fetch(`https://api.themoviedb.org/3/discover/movie?include_adult=false&language=en-US&sort_by=popularity.desc&page=${page}`, options);
            
            if (!discoverRes.ok) {
                console.error(`[E] Failed to fetch page ${page}. Status: ${discoverRes.status}`);
                await sleep(2000);
                continue; 
            }

            const discoverData = await discoverRes.json();
            const movies = discoverData.results;

            if (!movies || movies.length === 0) break;

            // 2. Loop through the 20 movies and enrich them with tags
            for (let i = 0; i < movies.length; i++) {
                const tmdbId = movies[i].id;
                
                const enrichedData = await fetchTmdbDetails(tmdbId);
                
                // Only save movies that actually have data and tags to build vectors from
                if (enrichedData && enrichedData.tags.length > 0) {
                    const { error } = await supabase
                        .from('global_movies')
                        .upsert({
                            tmdb_id: tmdbId,
                            title: enrichedData.title,
                            release_year: enrichedData.release_year,
                            popularity: enrichedData.popularity,
                            overview: enrichedData.overview,
                            tags: enrichedData.tags,
                            characters: enrichedData.characters, // Push to Supabase!
                            is_embedded: false 
                        }, { onConflict: 'tmdb_id' });

                    if (error) {
                        console.error(`[E] DB Error on ${enrichedData.title}:`, error.message);
                    } else {
                        totalSaved++;
                        console.log(`[I] (${totalSaved}) Saved: ${enrichedData.title}`);
                    }
                }

                // THE SAFETY VALVE: Pause 50ms between every single movie
                await sleep(50);
            }

        } catch (err) {
            console.error(`[E] Network Error on page ${page}:`, err.message);
            await sleep(2000); 
        }
    }
    
    console.log(`\n [S] Mass Seeding Complete! Total movies imported to Supabase: ${totalSaved}`);
    console.log(`[I] Run 'node generate_embeddings.js' to translate these into Qdrant vectors!`);
}

runMassSeeder();