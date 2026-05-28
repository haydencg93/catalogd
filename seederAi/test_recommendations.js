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

async function runSplitBrainTest() {
    console.log("[I] Initiating Cross-Media Split-Brain Test...");

    // ==========================================
    // 1. CONFIGURATION ZONE
    // ==========================================
    
    // Define inputs. Use 'movie', 'tv', or 'book' to prevent title collisions.
    const favoriteInputs = [
        // { title: 'The Hunger Games', type: 'book' },
        { title: 'Stranger Things', type: 'tv' },
        { title: 'It', type: 'movie' }
        // { title: 'Star Wars', type: 'movie' }
    ];

    // Define outputs. Use any combination: ['movie'], ['tv', 'book'], or ['movie', 'tv', 'book'] for all.
    const desiredOutputs = ['tv']; 

    // ==========================================

    const inputTitles = favoriteInputs.map(f => f.title);
    console.log(`\n[I] User Profile:`);
    favoriteInputs.forEach(f => console.log(`    - [${f.type.toUpperCase()}] ${f.title}`));
    console.log(`[I] Desired Output Types: ${desiredOutputs.join(', ').toUpperCase()}`);

    // 2. Safely fetch exact IDs from Supabase to prevent Book/Movie collisions
    const { data: rawFavorites, error: fetchError } = await supabase
        .from('global_movies')
        .select('tmdb_id, title, media_type')
        .in('title', inputTitles);

    if (fetchError || !rawFavorites || rawFavorites.length === 0) {
        console.error("[E] Could not fetch favorites from Supabase.");
        return;
    }

    // Match exact title AND type
    const favoriteIds = [];
    for (const fav of favoriteInputs) {
        const match = rawFavorites.find(r => r.title.toLowerCase() === fav.title.toLowerCase() && r.media_type === fav.type);
        if (match) {
            favoriteIds.push(match.tmdb_id);
        } else {
            console.log(`[E] Warning: Could not find a [${fav.type.toUpperCase()}] titled "${fav.title}" in DB.`);
        }
    }

    if (favoriteIds.length === 0) {
        console.error("[E] Aborting: No valid TMDB IDs found for the provided inputs.");
        return;
    }

    console.log(`[S] Successfully located input items in Supabase.`);

    // 3. Fetch Vectors from Qdrant
    const qdrantPoints = await qdrant.retrieve('movies', {
        ids: favoriteIds,
        with_vector: true
    });

    if (!qdrantPoints || qdrantPoints.length === 0) {
        console.error("[E] Could not find vectors for these items in Qdrant.");
        return;
    }

    // 4. Create the Target Vibe (Average Vector)
    const vectorLength = 384; 
    let targetVector = new Array(vectorLength).fill(0);

    for (const point of qdrantPoints) {
        for (let i = 0; i < vectorLength; i++) {
            targetVector[i] += point.vector[i];
        }
    }
    for (let i = 0; i < vectorLength; i++) {
        targetVector[i] = targetVector[i] / qdrantPoints.length;
    }

    console.log("[S] Target Vibe Vector generated cleanly!");

    // 5. Query Qdrant for a large pool of raw math matches
    console.log("\n[I] Searching Qdrant for nearest mathematical neighbors...");
    const searchResults = await qdrant.search('movies', {
        vector: targetVector,
        limit: 500, // Fetching a large pool so we don't run out after Supabase filters them!
        with_payload: false
    });

    const candidateIds = searchResults
        .filter(res => !favoriteIds.includes(res.id))
        .map(res => res.id);

    // 6. Pass the Qdrant IDs to Supabase AND apply the media_type filter
    const { data: recommendations, error: recError } = await supabase
        .from('global_movies')
        .select('tmdb_id, title, overview, media_type')
        .in('tmdb_id', candidateIds)
        .in('media_type', desiredOutputs); // <-- The Magic Output Filter

    if (recError) {
        console.error("[E] Error fetching recommendation metadata:", recError.message);
        return;
    }

    // 7. Sort the filtered Supabase data to match the original mathematical order from Qdrant
    const finalRecs = [];
    for (const id of candidateIds) {
        const match = recommendations.find(r => r.tmdb_id === id);
        if (match) {
            finalRecs.push(match);
        }
        if (finalRecs.length === 5) break; // Stop once we have our top 5 filtered results
    }

    // 8. Display Results
    console.log("\n[S] TOP 5 RECOMMENDATIONS");
    console.log("--------------------------------------------------");

    if (finalRecs.length === 0) {
        console.log("[I] No recommendations found matching those media types.");
        return;
    }

    finalRecs.forEach((rec, index) => {
        const matchScoreData = searchResults.find(r => r.id === rec.tmdb_id);
        const matchPercent = (matchScoreData.score * 100).toFixed(1);

        console.log(`${index + 1}. [${rec.media_type.toUpperCase()}] ${rec.title} (${matchPercent}% Match)`);
        
        const shortOverview = rec.overview ? rec.overview.substring(0, 90) + '...' : 'No overview available.';
        console.log(`    - ${shortOverview}\n`);
    });
}

runSplitBrainTest();