const { QdrantClient } = require('@qdrant/js-client-rest'); 
const path = require('path');

// Make sure this path matches where your .env is!
require('dotenv').config({ path: path.join(__dirname, '../misc/.env'), override: true });

if (!process.env.QDRANT_URL) {
    console.error("[E] FATAL: Missing Environment Variables!");
    process.exit(1);
}

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
});

async function buildIndex() {
    console.log("[I] Optimizing Qdrant indices...");
    
    try {
        // 1. Your existing index for filtering by media type
        await qdrant.createPayloadIndex('movies', {
            field_name: 'media_type',
            field_schema: 'keyword', // 'keyword' tells Qdrant this is for exact string matching
            wait: true
        });
        console.log("[S] Created 'keyword' index for media_type.");

        // 2. The NEW Character Index
        await qdrant.createPayloadIndex('movies', {
            field_name: 'characters',
            field_schema: 'text', // 'text' enables full-text substring matching (e.g., "Iron" matches "Iron Man")
            wait: true
        });
        console.log("[S] Created 'text' index for characters.");
        
        console.log("[S] SUCCESS! Qdrant is now fully optimized for filtering and character searches.");
    } catch (err) {
        console.error("[E] Failed to create index:", err.message);
    }
}

buildIndex();