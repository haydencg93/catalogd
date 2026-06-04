const { createClient } = require('@supabase/supabase-js');
const { QdrantClient } = require('@qdrant/js-client-rest'); 
const path = require('path');
const WebSocket = require('ws'); 

const config = require('../config.json');
require('dotenv').config({ path: path.join(__dirname, '../misc/.env') });

const supabase = createClient(config.supabase_url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket } 
});

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
});

async function runUnifiedPipeline() {
    console.log("[I] Initializing Unified Vector Search Pipeline...");
    
    const TransformersApi = Function('return import("@xenova/transformers")')();
    
    // 1. Extract 'env' alongside 'pipeline'
    const { pipeline: transformersPipeline, env } = await TransformersApi;
    
    // 2. Bypass the GitHub Actions 429 IP ban by using a reliable mirror!
    env.remoteHost = 'https://hf-mirror.com';

    const generateEmbedding = await transformersPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("[S] Local ML Model loaded.");

    let keepRunning = true;
    let totalProcessed = 0;

    while (keepRunning) {
        // Fetching all the rich metadata so we can store it in Qdrant!
        const { data: movies, error: fetchError } = await supabase
            .from('global_movies')
            .select('tmdb_id, title, tags, overview, media_type, popularity, release_year')
            .not('tags', 'is', null)
            .eq('is_embedded', false)
            .limit(100); 

        if (fetchError) {
            console.error("[E] Error fetching from Supabase:", fetchError.message);
            return;
        }

        if (!movies || movies.length === 0) {
            console.log(`\n[S] SUCCESS! All items have been embedded with Rich Payloads!`);
            console.log(`[I] Total processed this session: ${totalProcessed}`);
            keepRunning = false;
            break;
        }

        console.log(`\n[I] Processing batch of ${movies.length} items...`);

        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            
            try {
                // 1. Generate the Math
                const output = await generateEmbedding(movie.tags, { pooling: 'mean', normalize: true });
                
                // 2. Push to Qdrant WITH the new Rich Payload
                await qdrant.upsert('movies', {
                    wait: true,
                    points: [{
                        id: movie.tmdb_id,
                        vector: Array.from(output.data),
                        payload: { 
                            title: movie.title,
                            overview: movie.overview,
                            media_type: movie.media_type,
                            popularity: movie.popularity,
                            release_year: movie.release_year
                        } 
                    }]
                });

                // 3. DELETE the item from Supabase to save storage space!
                const { error: deleteError } = await supabase
                    .from('global_movies')
                    .delete()
                    .eq('tmdb_id', movie.tmdb_id);

                if (deleteError) {
                    console.error(`[E] DB Deletion Error for ${movie.title}:`, deleteError.message);
                } else {
                    totalProcessed++;
                    console.log(`[S] (${totalProcessed}) Synced to Qdrant & Cleared from Queue: ${movie.title}`);
                }

            } catch (err) {
                console.error(`[E] Pipeline Error on ${movie.title}:`, err.message);
            }
        }
    }
}

runUnifiedPipeline();