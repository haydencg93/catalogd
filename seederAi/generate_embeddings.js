const { createClient } = require('@supabase/supabase-js');
const { QdrantClient } = require('@qdrant/js-client-rest'); 
const path = require('path');
const WebSocket = require('ws'); 

const config = require('../config.json');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(config.supabase_url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket } 
});

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
});

async function runSplitBrainPipeline() {
    console.log("[I] Initializing Automated Split-Brain Pipeline...");
    
    const TransformersApi = Function('return import("@xenova/transformers")')();
    const { pipeline: transformersPipeline } = await TransformersApi;
    const generateEmbedding = await transformersPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("[S] Local ML Model loaded.");

    let keepRunning = true;
    let totalProcessed = 0;

    while (keepRunning) {
        // Fetch the next batch of 100 unprocessed movies
        const { data: movies, error: fetchError } = await supabase
            .from('global_movies')
            .select('tmdb_id, title, tags')
            .not('tags', 'is', null)
            .eq('is_embedded', false)
            .limit(100); 

        if (fetchError) {
            console.error("[E] Error fetching from Supabase:", fetchError.message);
            return;
        }

        if (!movies || movies.length === 0) {
            console.log(`\n[S] SUCCESS! All movies have been embedded and synced!`);
            console.log(`[I] Total processed this session: ${totalProcessed}`);
            keepRunning = false;
            break;
        }

        console.log(`\n[I] Processing batch of ${movies.length} movies...`);

        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            
            try {
                // 1. Generate & Push to Qdrant
                const output = await generateEmbedding(movie.tags, { pooling: 'mean', normalize: true });
                
                await qdrant.upsert('movies', {
                    wait: true,
                    points: [{
                        id: movie.tmdb_id,
                        vector: Array.from(output.data),
                        payload: { title: movie.title } 
                    }]
                });

                // 2. Mark as complete in Supabase (Adding .select() to force verification)
                const { data: updatedData, error: updateError } = await supabase
                    .from('global_movies')
                    .update({ is_embedded: true })
                    .eq('tmdb_id', movie.tmdb_id)
                    .select(); // Forces Supabase to return the updated row data

                if (updateError) {
                    console.error(`[E] DB Sync Error for ${movie.title}:`, updateError.message);
                } else if (!updatedData || updatedData.length === 0) {
                    console.error(`[E] Supabase Mismatch: Could not find TMDB ID ${movie.tmdb_id} to update.`);
                } else {
                    totalProcessed++;
                    console.log(`[S] (${totalProcessed}) Synced to Qdrant & Supabase: ${movie.title}`);
                }

            } catch (err) {
                // If Qdrant rejects the push, it will be caught here
                console.error(`[E] Pipeline Error on ${movie.title}:`, err.message);
            }
        }
    }
}

runSplitBrainPipeline();