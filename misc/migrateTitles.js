require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws'); 

// 1. Load Configurations
const configPath = path.join(__dirname, '..', 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
    console.error("❌ Could not find or read ../config.json. Make sure the path is correct.");
    process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TMDB_TOKEN = config.tmdb_token;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing Supabase credentials in .env file.");
    process.exit(1);
}

// Initialize Supabase with the Service Role key to bypass RLS, utilizing ws transport
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket }
});

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const titleCache = {}; 

async function fetchTmdbTitle(mediaId, mediaType) {
    const cacheKey = `${mediaType}_${mediaId}`;
    if (titleCache[cacheKey]) return titleCache[cacheKey];

    try {
        const response = await fetch(`https://api.themoviedb.org/3/${mediaType}/${mediaId}`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
        });

        if (!response.ok) {
            if (response.status === 429) {
                console.log(`⚠️ Rate limited by TMDB. Pausing for 2 seconds...`);
                await delay(2000);
                return fetchTmdbTitle(mediaId, mediaType);
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const title = data.title || data.name; 
        
        if (title) {
            titleCache[cacheKey] = title;
            return title;
        }
    } catch (err) {
        console.error(`⚠️ Failed to fetch TMDB data for ${mediaType} ${mediaId}:`, err.message);
    }
    return null;
}

async function runMigration() {
    console.log("🚀 PHASE 1: Migrating media_titles for user_characters...");
    
    let hasMore = true;
    let offset = 0;
    const limit = 1000;
    let updatedCharsCount = 0;

    while (hasMore) {
        const { data, error } = await supabase
            .from('user_characters')
            .select('id, media_id, media_type')
            .is('media_title', null)
            .not('media_id', 'is', null)
            .in('media_type', ['movie', 'tv']) 
            .range(offset, offset + limit - 1);

        if (error) {
            console.error("❌ Error fetching from user_characters:", error.message);
            break;
        }

        if (data.length === 0) {
            hasMore = false;
            break;
        }

        console.log(`⏳ Processing user_characters batch of ${data.length} records...`);

        for (const row of data) {
            const title = await fetchTmdbTitle(row.media_id, row.media_type);
            
            if (title) {
                const { error: updateErr } = await supabase
                    .from('user_characters')
                    .update({ media_title: title })
                    .eq('id', row.id);

                if (updateErr) {
                    console.error(`❌ Failed to update character row ${row.id}:`, updateErr.message);
                } else {
                    updatedCharsCount++;
                }
            }
            await delay(40); 
        }
        offset += limit;
    }
    console.log(`✅ Phase 1 Complete! Successfully updated ${updatedCharsCount} character records.\n`);

    // ---------------------------------------------------------
    
    console.log("🚀 PHASE 2: Cross-referencing source_media_title for list_items...");
    
    let hasMoreListItems = true;
    let listOffset = 0;
    let updatedListsCount = 0;
    const listCache = {}; // Cache character_id -> media_title to save database hits

    while (hasMoreListItems) {
        const { data, error } = await supabase
            .from('list_items')
            .select('id, media_id')
            .eq('media_type', 'character')
            .is('source_media_title', null)
            .range(listOffset, listOffset + limit - 1);

        if (error) {
            console.error("❌ Error fetching from list_items:", error.message);
            break;
        }

        if (data.length === 0) {
            hasMoreListItems = false;
            break;
        }

        console.log(`⏳ Processing list_items batch of ${data.length} records...`);

        for (const row of data) {
            let mediaTitle = listCache[row.media_id];

            // If we don't have the title cached locally, query user_characters for it
            if (!mediaTitle) {
                const { data: charData } = await supabase
                    .from('user_characters')
                    .select('media_title')
                    .eq('character_id', row.media_id)
                    .not('media_title', 'is', null)
                    .limit(1)
                    .maybeSingle();

                if (charData && charData.media_title) {
                    mediaTitle = charData.media_title;
                    listCache[row.media_id] = mediaTitle; // Cache it for the next loop
                }
            }
            
            if (mediaTitle) {
                const { error: updateErr } = await supabase
                    .from('list_items')
                    .update({ source_media_title: mediaTitle })
                    .eq('id', row.id);

                if (updateErr) {
                    console.error(`❌ Failed to update list_item row ${row.id}:`, updateErr.message);
                } else {
                    updatedListsCount++;
                }
            }
        }
        listOffset += limit;
    }

    console.log(`✅ Phase 2 Complete! Successfully updated ${updatedListsCount} list items.`);
    console.log(`\n🎉 All migrations finished successfully!`);
}

runMigration();