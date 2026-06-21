// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import { QdrantClient } from "npm:@qdrant/js-client-rest";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    // 1. The CORS Preflight Handshake (Explicit 200 Status)
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders, status: 200 });
    }

    try {
        const { query, limit = 50 } = await req.json();

        // 2. Connect to your Qdrant database
        const qdrant = new QdrantClient({
            url: Deno.env.get('QDRANT_URL'),
            apiKey: Deno.env.get('QDRANT_API_KEY'),
            checkCompatibility: false // <-- Add this line!
        });

        // 3. Search the specific text index we built earlier
        const response = await qdrant.scroll('movies', {
            limit: limit,
            with_payload: true,
            with_vector: false, // Don't need the heavy math here, just exact text matches!
            filter: {
                must: [
                    { key: 'characters', match: { text: query } }
                ]
            }
        });

        // 4. Clean up the response to send back to your frontend
        const results = response.points.map(p => ({
            id: p.id,
            ...p.payload
        }));

        return new Response(JSON.stringify({ results }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 500, 
            headers: corsHeaders 
        });
    }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/search-characters' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
