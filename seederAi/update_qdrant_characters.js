const { QdrantClient } = require('@qdrant/js-client-rest');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const WebSocket = require('ws');

// Load configurations
const config = require('../config.json');
require('dotenv').config({ path: path.join(__dirname, '../misc/.env') });

const TMDB_TOKEN = config.tmdb_token;

if (!TMDB_TOKEN) {
    console.error("[E] ERROR: Could not find TMDB_TOKEN in config.json.");
    process.exit(1);
}

// Initialize Clients
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
});

const supabase = createClient(config.supabase_url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch Cast List from TMDB
async function fetchCharacters(tmdbId, mediaType) {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}`
        }
    };

    try {
        // Automatically route to /movie or /tv based on what Qdrant tells us it is
        const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits`, options);
        
        if (!res.ok) {
            if (res.status === 429) {
                console.log("[E] TMDB Rate Limit Hit! Pausing for 5 seconds...");
                await sleep(5000);
            }
            return null;
        }
        
        const data = await res.json();
        
        // Extract the top 15 character names
        const characters = data.cast 
            ? data.cast.map(c => c.character).filter(Boolean).slice(0, 15).join(', ') 
            : '';

        return characters;

    } catch (error) {
        console.error(`[E] Error fetching TMDB ID ${tmdbId}:`, error.message);
        return null;
    }
}

async function runCharacterUpdater() {
    console.log("[I] Starting Qdrant Surgical Payload Updater...");

    let keepRunning = true;
    let offset = null; // Used for Qdrant pagination
    let totalUpdated = 0;

    while (keepRunning) {
        // 1. Ask Qdrant to give us a batch of 100 items that are missing the 'characters' field
        const scrollResponse = await qdrant.scroll('movies', {
            limit: 100,
            offset: offset,
            with_payload: true,
            with_vector: false, // We don't need the heavy math vectors, saving bandwidth!
            filter: {
                must: [
                    {
                        is_empty: {
                            key: 'characters'
                        }
                    }
                ]
            }
        });

        const points = scrollResponse.points;

        if (!points || points.length === 0) {
            console.log(`\n[S] SUCCESS! All items in Qdrant have been updated with character strings!`);
            keepRunning = false;
            break;
        }

        console.log(`\n[I] Processing batch of ${points.length} items from Qdrant...`);

        // 2. Loop through the batch
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const tmdbId = point.id;
            const mediaType = point.payload.media_type; // 'movie' or 'tv'
            const title = point.payload.title;

            // Failsafe: Books don't have TMDB credits, so skip them
            if (mediaType === 'book') {
                await qdrant.setPayload('movies', {
                    payload: { characters: 'N/A' },
                    points: [tmdbId]
                });
                continue;
            }

            // 3. Get the characters from TMDB
            const charString = await fetchCharacters(tmdbId, mediaType);

            if (charString !== null) {
                // 4. Update Qdrant (Inject the payload without touching vectors)
                await qdrant.setPayload('movies', {
                    payload: { characters: charString },
                    points: [tmdbId]
                });

                // 5. Update Supabase (Keep the source of truth in sync!)
                const { error: dbError } = await supabase
                    .from('global_movies')
                    .update({ characters: charString })
                    .eq('tmdb_id', tmdbId);

                if (dbError) {
                    console.error(`[E] Supabase Error on ${title}:`, dbError.message);
                } else {
                    totalUpdated++;
                    console.log(`[S] (${totalUpdated}) Character Injection Complete: ${title}`);
                }
            }

            // Safety pause for TMDB
            await sleep(50);
        }

        // Advance to the next page of Qdrant results
        offset = scrollResponse.next_page_offset;
        
        if (!offset) {
            keepRunning = false;
            console.log(`\n[S] Reached the end of Qdrant records.`);
        }
    }
}

runCharacterUpdater();