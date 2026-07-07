const path = require('path');
const fs = require('fs'); // <-- NEW: Allows us to read files
require('dotenv').config({ path: path.resolve(__dirname, '../misc/.env') });

const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const configPath = path.resolve(__dirname, '../config.json');
const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const TMDB_TOKEN = configData.tmdb_token;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;

// Tell Supabase to use your 'ws' package
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        persistSession: false
    },
    realtime: {
        transport: WebSocket
    }
});

async function fetchImage(query) {
    try {
        // 1. Try Unsplash
        const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&client_id=${UNSPLASH_KEY}&per_page=1&order_by=popular&orientation=landscape`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            return data.results[0].urls.regular;
        }

        // 2. Fallback to TMDB (Search for movies with this query as a keyword/genre and grab a backdrop)
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` } // Now successfully pulling from configData!
        });
        const tmdbData = await tmdbRes.json();
        if (tmdbData.results && tmdbData.results[0] && tmdbData.results[0].backdrop_path) {
            return `https://image.tmdb.org/t/p/w1280${tmdbData.results[0].backdrop_path}`;
        }

        // 3. Ultimate Fallback
        return 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1000&auto=format&fit=crop';
    } catch (err) {
        console.error(`Failed to fetch image for ${query}:`, err);
        return 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1000&auto=format&fit=crop';
    }
}

async function run() {
    console.log("Starting nightly vibe update...");
    
    // Fetch all users needing an update
    const { data: usersToUpdate, error } = await supabase
        .from('vibes_control')
        .select('*')
        .eq('needs_update', true);

    if (error) throw error;
    if (!usersToUpdate || usersToUpdate.length === 0) {
        console.log("No vibes need updating tonight.");
        return;
    }

    console.log(`Found ${usersToUpdate.length} users to update.`);

    for (const vibe of usersToUpdate) {
        const targetGenre = vibe.new_top_genre || vibe.current_top_genre;
        const targetTheme = vibe.new_top_theme || vibe.current_top_theme;

        const newGenreImg = await fetchImage(targetGenre);
        const newThemeImg = await fetchImage(targetTheme);

        await supabase.from('vibes_control').update({
            current_top_genre: targetGenre,
            current_top_theme: targetTheme,
            image_genre: newGenreImg,
            image_theme: newThemeImg,
            needs_update: false,
            new_top_genre: null,
            new_top_theme: null,
            updated_at: new Date().toISOString()
        }).eq('id', vibe.id);

        console.log(`Updated vibe for user ${vibe.user_id}`);
    }
}

run().catch(console.error);