const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const WebSocket = require('ws'); 

const config = require('../config.json');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(config.supabase_url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'Catalogd-AI-Seeder/1.0 (haydencg93apis@gmail.com)' 
};

function generateBookId(olKey) {
    const rawNumber = parseInt(olKey.replace(/\D/g, ''), 10);
    return rawNumber + 100000000; 
}

async function fetchOpenLibraryBookDetails(workKey) {
    try {
        const res = await fetch(`https://openlibrary.org${workKey}.json`, { 
            headers: HEADERS,
            signal: AbortSignal.timeout(8000) 
        });
        
        if (!res.ok) {
            console.log(`[E] Open Library returned status: ${res.status}`);
            return null;
        }
        
        const data = await res.json();
        
        let overview = '';
        if (data.description) {
            overview = typeof data.description === 'string' ? data.description : data.description.value;
        }

        let tags = [];
        if (data.subjects) {
            tags = data.subjects.map(s => typeof s === 'string' ? s : s.name || '');
        }
        const combinedTags = tags.filter(Boolean).slice(0, 15).join(', ');

        return {
            overview: overview || 'No description available.',
            tags: combinedTags
        };
    } catch (error) {
        console.error(`[E] Error fetching Book details for ${workKey}:`, error.message);
        return null;
    }
}

async function runBookSeeder() {
    console.log("[I] Starting Safe Dual-Genre Open Library Pipeline...");
    
    const START_PAGE = 1;
    const END_PAGE = 500; 
    let totalSaved = 0;

    // The new target array for our outer loop
    const targetSubjects = ['fiction', 'non-fiction'];

    for (let s = 0; s < targetSubjects.length; s++) {
        const currentSubject = targetSubjects[s];
        console.log(`\n[I] ==========================================`);
        console.log(`[I] INITIATING SUBJECT SEARCH: ${currentSubject.toUpperCase()}`);
        console.log(`[I] ==========================================\n`);

        for (let page = START_PAGE; page <= END_PAGE; page++) {
            console.log(`\n[I] Fetching ${currentSubject} Page ${page}/${END_PAGE}...`);
            
            try {
                // Dynamically injecting the current subject into the API URL
                const searchUrl = `https://openlibrary.org/search.json?q=subject:${currentSubject}+language:eng&sort=editions&page=${page}&limit=20`;
                
                const discoverRes = await fetch(searchUrl, { 
                    headers: HEADERS,
                    signal: AbortSignal.timeout(30000)
                });
                
                if (!discoverRes.ok) {
                    console.error(`[E] Failed to fetch page ${page}. Status: ${discoverRes.status}`);
                    await sleep(5000); 
                    continue; 
                }

                const discoverData = await discoverRes.json();
                const books = discoverData.docs;

                if (!books || books.length === 0) break;

                for (let i = 0; i < books.length; i++) {
                    const book = books[i];
                    
                    if (!book.key) continue;

                    const universalId = generateBookId(book.key);
                    const enrichedData = await fetchOpenLibraryBookDetails(book.key);
                    
                    if (enrichedData && enrichedData.tags.length > 0) {
                        const { error } = await supabase
                            .from('global_movies') 
                            .upsert({
                                tmdb_id: universalId, 
                                title: book.title,
                                release_year: book.first_publish_year ? book.first_publish_year.toString() : null,
                                popularity: book.edition_count || 0, 
                                overview: enrichedData.overview,
                                tags: enrichedData.tags,
                                media_type: 'book', 
                                is_embedded: false 
                            }, { onConflict: 'tmdb_id' }); 

                        if (error) {
                            console.error(`[E] DB Error on ${book.title}:`, error.message);
                        } else {
                            totalSaved++;
                            console.log(`[S] (${totalSaved}) Saved Book: ${book.title}`);
                        }
                    }

                    await sleep(1000); 
                }

            } catch (err) {
                console.error(`[E] Network Error on page ${page}:`, err.message);
                await sleep(5000); 
            }
        }
    }
    
    console.log(`\n[S] Dual-Genre Book Seeding Complete! Total books imported to Supabase: ${totalSaved}`);
    console.log(`[I] Run 'node generate_embeddings.js' to translate these into Qdrant vectors!`);
}

runBookSeeder();