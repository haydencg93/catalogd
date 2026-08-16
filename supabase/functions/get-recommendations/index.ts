import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { QdrantClient } from "npm:@qdrant/js-client-rest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Extract math complexity out of the main block
function calculateAverageVector(qdrantPoints: any[], vectorLength: number): number[] {
    const targetVector = new Array(vectorLength).fill(0);
    let hasValidVector = false;

    for (const point of qdrantPoints) {
        if (point.vector?.length === vectorLength) {
            hasValidVector = true;
            for (let i = 0; i < vectorLength; i++) {
                targetVector[i] += point.vector[i];
            }
        }
    }

    if (!hasValidVector) {
        throw new Error("Could not extract valid mathematical vectors for the selected items.");
    }

    for (let i = 0; i < vectorLength; i++) {
        targetVector[i] = targetVector[i] / qdrantPoints.length;
    }

    return targetVector;
}

// Extract error formatting logic
function formatErrorMessage(error: any): string {
    if (error.data) {
        return `Qdrant Error: ${JSON.stringify(error.data)}`;
    }
    if (error.cause) {
        return `Error: ${error.message} - Cause: ${error.cause}`;
    }
    return error.message;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { favoriteIds, desiredOutputs } = await req.json();

    if (!favoriteIds || favoriteIds.length === 0 || !desiredOutputs) {
        throw new Error("Missing required inputs.");
    }

    const qdrant = new QdrantClient({
        url: Deno.env.get('QDRANT_URL'),
        apiKey: Deno.env.get('QDRANT_API_KEY'),
    });

    // 1. Fetch Vectors from Qdrant
    const qdrantPoints = await qdrant.retrieve('movies', {
        ids: favoriteIds,
        with_vector: true
    });

    if (!qdrantPoints || qdrantPoints.length === 0) {
        throw new Error("None of the selected items exist in your AI Taste Graph yet. Try picking a more popular item!");
    }

    // 2. Create Target Vibe with Safety Checks (Uses Helper)
    const targetVector = calculateAverageVector(qdrantPoints, 384);

    // 3. Bulletproof Filter Syntax
    const typeConditions = desiredOutputs.map((type: string) => ({
        key: "media_type",
        match: { value: type }
    }));

    const searchResults = await qdrant.search('movies', {
        vector: targetVector,
        limit: 25, 
        filter: {
            must: [
                {
                    should: typeConditions
                }
            ],
            must_not: [
                {
                    has_id: favoriteIds
                }
            ]
        },
        with_payload: true
    });

    // 4. Format the output directly from Qdrant's payload
    const finalRecs = searchResults.map(res => ({
        id: res.id,
        title: res.payload?.title || "Unknown Title",
        media_type: res.payload?.media_type || "movie",
        overview: res.payload?.overview || "No overview available.",
        match_percentage: (res.score * 100).toFixed(1)
    }));

    return new Response(JSON.stringify({ recommendations: finalRecs }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    // 5. Deep Error Extraction (Uses Helper)
    const errorMsg = formatErrorMessage(error);
    
    return new Response(JSON.stringify({ error: errorMsg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});