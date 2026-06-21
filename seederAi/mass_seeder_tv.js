const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const WebSocket = require('ws'); 

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTmdbTvDetails(tmdbId) {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}`
        }
    };

    try {
        // ADDED: ,credits to the endpoint
        const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?append_to_response=keywords,credits`, options);
        
        if (!res.ok) {
            if (res.status === 429) {
                console.log("[E] TMDB Rate Limit Hit! Pausing for 5 seconds...");
                await sleep(5000);
            }
            return null;
        }
        
        const data = await res.json();
        
        const genres = data.genres ? data.genres.map(g => g.name) : [];
        const keywordArray = data.keywords && data.keywords.results ? data.keywords.results : (data.keywords && data.keywords.keywords ? data.keywords.keywords : []);
        const keywords = keywordArray.map(k => k.name);
        
        const combinedTags = [...genres, ...keywords].join(', ');

        // ADDED: Character extraction
        const characters = data.credits && data.credits.cast 
            ? data.credits.cast.map(c => c.character).filter(Boolean).slice(0, 15).join(', ') 
            : '';

        return {
            title: data.name, 
            release_year: data.first_air_date ? data.first_air_date.split('-')[0] : null,
            popularity: data.popularity,
            overview: data.overview,
            tags: combinedTags,
            characters: characters // Return the string
        };
    } catch (error) {
        console.error(`[E] Error fetching TMDB ID ${tmdbId}:`, error.message);
        return null;
    }
}

async function runTvSeeder() {
    console.log("[I] Starting Safe TMDB TV Discovery Pipeline...");
    
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
            // Hitting the TV discover endpoint
            const discoverRes = await fetch(`https://api.themoviedb.org/3/discover/tv?include_adult=false&language=en-US&sort_by=popularity.desc&page=${page}`, options);
            
            if (!discoverRes.ok) {
                console.error(`[E] Failed to fetch page ${page}. Status: ${discoverRes.status}`);
                await sleep(2000);
                continue; 
            }

            const discoverData = await discoverRes.json();
            const tvShows = discoverData.results;

            if (!tvShows || tvShows.length === 0) break;

            for (let i = 0; i < tvShows.length; i++) {
                const tmdbId = tvShows[i].id;
                
                const enrichedData = await fetchTmdbTvDetails(tmdbId);
                
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
                            characters: enrichedData.characters, // Push to Supabase
                            media_type: 'tv',
                            is_embedded: false 
                        }, { onConflict: 'tmdb_id' });

                    if (error) {
                        console.error(`[E] DB Error on ${enrichedData.title}:`, error.message);
                    } else {
                        totalSaved++;
                        console.log(`[I] (${totalSaved}) Saved: ${enrichedData.title}`);
                    }
                }

                await sleep(50);
            }

        } catch (err) {
            console.error(`[E] Network Error on page ${page}:`, err.message);
            await sleep(2000); 
        }
    }
    
    console.log(`\n[S] TV Seeding Complete! Total shows imported to Supabase: ${totalSaved}`);
    console.log(`[I] Next step: Run 'node generate_embeddings.js' to translate these into Qdrant vectors!`);
}

runTvSeeder();