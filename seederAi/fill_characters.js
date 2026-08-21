const { createClient } = require('@supabase/supabase-js');
const path = require('node:path');
const WebSocket = require('ws'); 

// Load configuration and environment variables
const config = require('../config/config.json');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Initialize Supabase Client
const supabase = createClient(config.supabase_url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket } 
});

// Helper function to pause execution (Rate Limiting)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fillMissingCharacters() {
    console.log("[I] Starting TMDB Character Fetcher...");
    
    let keepRunning = true;
    let totalUpdated = 0;

    const tmdbOptions = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${config.tmdb_token}`
        }
    };

    while (keepRunning) {
        try {
            // 1. Fetch a batch of 50 items that are missing characters
            console.log("[I] Fetching next batch of 50 items from Supabase...");
            const { data: mediaItems, error: fetchError } = await supabase
                .from('global_movies')
                .select('tmdb_id, title, media_type')
                .is('characters', null)
                .in('media_type', ['movie', 'tv']) // Books don't use TMDB
                .limit(50);

            if (fetchError) {
                console.error("[E] Supabase Fetch Error:", fetchError.message);
                await delay(5000);
                continue;
            }

            if (!mediaItems || mediaItems.length === 0) {
                console.log(`\n[S] SUCCESS! No more missing characters found.`);
                console.log(`[I] Total rows updated: ${totalUpdated}`);
                break;
            }

            // 2. Process each item one by one to respect rate limits
            for (const item of mediaItems) {
                let characterString = 'None'; // Default if none found or error occurs

                try {
                    // Choose the correct endpoint (matching your frontend logic)
                    const endpoint = item.media_type === 'tv' ? 'aggregate_credits' : 'credits';
                    const url = `https://api.themoviedb.org/3/${item.media_type}/${item.tmdb_id}/${endpoint}?language=en-US`;

                    const response = await fetch(url, tmdbOptions);
                    
                    if (response.ok) {
                        const res = await response.json();
                        if (res && res.cast && res.cast.length > 0) {
                            // Map out the characters depending on the TV/Movie data structure
                            let characters = [];
                            if (item.media_type === 'tv') {
                                characters = res.cast.map(c => c.roles && c.roles.length > 0 ? c.roles[0].character : null);
                            } else {
                                characters = res.cast.map(c => c.character);
                            }
                            
                            // Filter out blanks, grab the top 15, and combine into a string
                            const cleanChars = characters.filter(Boolean).slice(0, 15);
                            if (cleanChars.length > 0) {
                                characterString = cleanChars.join(', ');
                            }
                        }
                    } else {
                        console.warn(`[W] TMDB returned ${response.status} for ${item.title}`);
                    }

                } catch (tmdbErr) {
                    console.error(`[E] TMDB Fetch Error for ${item.title}:`, tmdbErr.message);
                }

                // 3. Update the row in Supabase
                const { error: updateError } = await supabase
                    .from('global_movies')
                    .update({ characters: characterString })
                    .eq('tmdb_id', item.tmdb_id);

                if (updateError) {
                    console.error(`[E] Failed to save characters for ${item.title}:`, updateError.message);
                } else {
                    totalUpdated++;
                    console.log(`[S] (${totalUpdated}) Updated ${item.title}: ${characterString.substring(0, 40)}...`);
                }

                // 4. Rate Limiting: Wait 250ms before hitting TMDB and Supabase again
                // (This guarantees a maximum of 4 requests per second, which is ultra-safe)
                await delay(250);
            }

        } catch (err) {
            console.error("[E] Fatal Script Error during batch:", err.message);
            keepRunning = false;
        }
    }
}

fillMissingCharacters();