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
    console.log("[I] Telling Qdrant to index the 'media_type' field...");
    
    try {
        await qdrant.createPayloadIndex('movies', {
            field_name: 'media_type',
            field_schema: 'keyword', // 'keyword' tells Qdrant this is for exact string matching
            wait: true
        });
        
        console.log("[S] SUCCESS! Qdrant is now fully optimized for filtering.");
    } catch (err) {
        console.error("[E] Failed to create index:", err.message);
    }
}

buildIndex();