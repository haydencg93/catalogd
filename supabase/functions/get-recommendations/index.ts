// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { QdrantClient } from "npm:@qdrant/js-client-rest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { favoriteIds, desiredOutputs } = await req.json();

    if (!favoriteIds || favoriteIds.length === 0 || !desiredOutputs) {
        throw new Error("Missing required inputs.");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false }
    });

    const qdrant = new QdrantClient({
        url: Deno.env.get('QDRANT_URL'),
        apiKey: Deno.env.get('QDRANT_API_KEY'),
    });

    // 1. Fetch Vectors from Qdrant using the pure Integer IDs sent from the frontend
    const qdrantPoints = await qdrant.retrieve('movies', {
        ids: favoriteIds,
        with_vector: true
    });

    if (!qdrantPoints || qdrantPoints.length === 0) {
        throw new Error("None of the selected items exist in your AI Taste Graph yet. Try picking a more popular item!");
    }

    // 2. Create Target Vibe
    const vectorLength = 384; 
    let targetVector = new Array(vectorLength).fill(0);

    for (const point of qdrantPoints) {
        for (let i = 0; i < vectorLength; i++) {
            targetVector[i] += point.vector ? point.vector[i] : 0;
        }
    }
    for (let i = 0; i < vectorLength; i++) {
        targetVector[i] = targetVector[i] / qdrantPoints.length;
    }

    // 3. Search Qdrant for 250 nearest neighbors (Increased to ensure we get 25 post-filter)
    const searchResults = await qdrant.search('movies', {
        vector: targetVector,
        limit: 250, 
        with_payload: false
    });

    const candidateIds = searchResults
        .filter(res => !favoriteIds.includes(Number(res.id)))
        .map(res => res.id);

    // 4. Filter via Supabase
    const { data: recommendations, error: recError } = await supabase
        .from('global_movies')
        .select('tmdb_id, title, overview, media_type')
        .in('tmdb_id', candidateIds)
        .in('media_type', desiredOutputs); 

    if (recError) {
        throw new Error("Error fetching recommendation metadata.");
    }

    // 5. Sort and format the top 25
    const finalRecs = [];
    for (const id of candidateIds) {
        const match = recommendations.find(r => r.tmdb_id === id);
        if (match) {
            const matchScoreData = searchResults.find(r => r.id === match.tmdb_id);
            const matchPercent = matchScoreData ? (matchScoreData.score * 100).toFixed(1) : 0;
            
            finalRecs.push({
                id: match.tmdb_id, // <-- NEW: Sending the ID back to the frontend!
                title: match.title,
                media_type: match.media_type,
                overview: match.overview,
                match_percentage: matchPercent
            });
        }
        if (finalRecs.length === 25) break; // <-- NEW: Increased to 25 recommendations
    }

    return new Response(JSON.stringify({ recommendations: finalRecs }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/get-recommendations' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
