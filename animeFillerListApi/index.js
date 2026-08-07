const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../misc/.env') });

const { createClient } = require('@supabase/supabase-js');
const { getFillerData } = require('./scraper');
const { slugify } = require('./utils');

// 1. Initialize Supabase with Service Role Key (Private)
// These variables are pulled from GitHub Secrets or your local .env file
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("CRITICAL ERROR: Missing Supabase environment variables.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Main function to scrape data and update Supabase
 */
async function saveAnimeData(originalName, requestId = null, manualSlug = null) {
    console.log(`--- Processing: ${originalName} ---`);

    // 1. Pass both names to the scraper
    const fillerResult = await getFillerData(originalName, manualSlug);

    if (fillerResult.error) {
        console.error(`Scrape Failed for ${originalName}: ${fillerResult.error}`);
        
        if (requestId) {
            await supabase
                .from('filler_list_mgnt')
                .update({ notes: fillerResult.error })
                .eq('id', requestId);
        }
        return;
    }

    // 2. EXTRACT THE SUCCESSFUL SLUG
    const successSlug = fillerResult.anime;

    // 3. Update Supabase
    await supabase
        .from('filler_list_mgnt')
        .upsert({ 
            name: originalName, // Keep original DB key intact 
            filler_exists: true, 
            filler_content: fillerResult, 
            notes: 'Successfully scraped',
            manual_slug: null // Clear manual slug on success
        }, { onConflict: 'name' });

    console.log(`Database Updated: ${originalName}`);
}

/**
 * Worker Logic: Determines if we are processing a single input or the whole queue
 */
async function runWorker() {
    // Check if an argument was passed (e.g., node index.js "Naruto")
    const manualInput = process.argv[2];

    if (manualInput && manualInput.trim() !== "") {
        console.log(`Manual Input Detected: "${manualInput}"`);
        await saveAnimeData(manualInput);
    } else {
        console.log("No manual input. Checking Supabase queue for pending requests...");
    
        const { data: queue, error } = await supabase
            .from('filler_list_mgnt')
            .select('*')
            .is('notes', null);

        if (error) {
            console.error("Error fetching queue:", error);
            return;
        }

        if (!queue || queue.length === 0) {
            console.log("Queue is empty. Nothing to do.");
            return;
        }

        console.log(`Found ${queue.length} pending requests.`);
        for (const item of queue) {
            await saveAnimeData(item.name, item.id, item.manual_slug);
        }
        
        console.log("--- Worker Task Complete ---");
    }
}
// Start the process
runWorker();