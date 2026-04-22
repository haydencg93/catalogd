require('dotenv').config();
const path = require('path');
const fs = require('fs');
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
 * Main function to scrape data and update both local files and Supabase
 */
async function saveAnimeData(originalName, requestId = null) {
    console.log(`--- Processing: ${originalName} ---`);

    // 1. Pass the raw name to the scraper (it handles the retry logic internally)
    const fillerResult = await getFillerData(originalName);

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
    // This is the slug that actually worked on animefillerlist.com (e.g., "jujutsu-kaisen")
    const successSlug = fillerResult.anime;

    // Success: Ensure data directory exists
    const dir = './data';
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // 3. Save the JSON file using the SUCCESSFUL slug
    // This ensures your frontend fetch(`.../${successSlug}.json`) will work!
    const filePath = path.join(dir, `${successSlug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fillerResult, null, 2));
    console.log(`File Saved: ${filePath}`);

    // 4. Update Supabase using the successful slug
    await supabase
        .from('filler_list_mgnt')
        .upsert({ 
            name: successSlug, 
            filler_exists: true, 
            notes: 'Successfully scraped' 
        }, { onConflict: 'name' });

    console.log(`Database Updated: ${successSlug}`);
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
            .eq('filler_exists', false)
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
            await saveAnimeData(item.name, item.id);
        }
    }
    
    console.log("--- Worker Task Complete ---");
}

// Start the process
runWorker();