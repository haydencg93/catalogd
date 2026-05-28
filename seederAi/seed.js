const fs = require('fs');
const csv = require('csv-parser');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const WebSocket = require('ws'); // <-- 1. Require the new ws package

// 1. Load the public keys from config.json (up one level)
const config = require('../config.json');

// 2. Load the private keys from the anime API .env file
require('dotenv').config({ path: path.join(__dirname, '../animeFillerListApi/.env') });

// 3. Set up our connection variables
const supabaseUrl = config.supabase_url;
const TMDB_TOKEN = config.tmdb_token;

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
    console.error("[E] ERROR: Could not find SUPABASE_SERVICE_ROLE_KEY in the .env file.");
    process.exit(1);
}

// 4. Initialize Supabase with the SERVICE ROLE key AND the WebSocket transport
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        persistSession: false, // Good practice for backend scripts
        autoRefreshToken: false
    },
    realtime: {
        transport: WebSocket // <-- 2. Tell Supabase to use the ws package
    }
});

// Helper function to pause execution (respects TMDB API rate limits)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTmdbEnrichment(tmdbId) {
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}`
        }
    };

    try {
        // Fetch base details (for genres) AND keywords at the same time using append_to_response
        const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?append_to_response=keywords`, options);
        if (!res.ok) return null;
        
        const data = await res.json();
        
        // Extract genres (e.g., "Action", "Sci-Fi")
        const genres = data.genres ? data.genres.map(g => g.name) : [];
        
        // Extract keywords (e.g., "artificial intelligence", "dystopia")
        const keywords = data.keywords && data.keywords.keywords 
            ? data.keywords.keywords.map(k => k.name) 
            : [];

        // Combine them into one massive string for our ML model to read later
        const combinedTags = [...genres, ...keywords].join(', ');

        return {
            title: data.title,
            release_year: data.release_date ? data.release_date.split('-')[0] : null,
            popularity: data.popularity,
            overview: data.overview,
            tags: combinedTags
        };
    } catch (error) {
        console.error(`Error fetching TMDB ID ${tmdbId}:`, error.message);
        return null;
    }
}

async function runSeeder() {
    console.log("[I] Starting Data Enrichment Pipeline...");
    
    const results = [];
    const MAX_MOVIES = 500; // Let's test with just 500 first

    // 2. Read the Kaggle CSV
    fs.createReadStream('datasets/movies_metadata.csv')
        .pipe(csv())
        .on('data', (data) => {
            // Only grab valid TMDB IDs
            if (data.id && !isNaN(data.id) && results.length < MAX_MOVIES) {
                results.push(data.id);
            }
        })
        .on('end', async () => {
            console.log(`[I] Found ${results.length} movies to process. Commencing TMDB Enrichment...`);
            
            // 3. Loop through and enrich
            for (let i = 0; i < results.length; i++) {
                const tmdbId = results[i];
                console.log(`Processing ${i + 1}/${results.length}: TMDB ID ${tmdbId}`);
                
                const enrichedData = await fetchTmdbEnrichment(tmdbId);
                
                if (enrichedData) {
                    // 4. Push to Supabase
                    const { error } = await supabase
                        .from('global_movies')
                        .upsert({
                            tmdb_id: tmdbId,
                            title: enrichedData.title,
                            release_year: enrichedData.release_year,
                            popularity: enrichedData.popularity,
                            overview: enrichedData.overview,
                            tags: enrichedData.tags
                        }, { onConflict: 'tmdb_id' }); // Prevent duplicates

                    if (error) console.error(`[E] DB Error on ${enrichedData.title}:`, error.message);
                    else console.log(`[S] Saved: ${enrichedData.title}`);
                }

                // Pause for 100ms so we don't get banned by TMDB for spamming
                await sleep(100); 
            }
            
            console.log("[S] Seeding Complete!");
        });
}

runSeeder();