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
    const slug = slugify(originalName);
    console.log(`--- Processing: ${slug} ---`);

    const fillerResult = await getFillerData(slug);

    if (fillerResult.error) {
        console.error(`Scrape Failed for ${slug}: ${fillerResult.error}`);
        
        // If this came from a Supabase request, update the row with the error
        if (requestId) {
            await supabase
                .from('filler_list_mgnt')
                .update({ notes: fillerResult.error })
                .eq('id', requestId);
        }
        return;
    }

    // Success: Ensure data directory exists
    const dir = './data';
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Save the JSON file
    const filePath = path.join(dir, `${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fillerResult, null, 2));
    console.log(`File Saved: ${filePath}`);

    // Update Supabase to mark as existing
    // Using an 'upsert' here ensures that even manual runs update the management table
    await supabase
        .from('filler_list_mgnt')
        .upsert({ 
            name: slug, 
            filler_exists: true, 
            notes: 'Successfully scraped' 
        }, { onConflict: 'name' });

    console.log(`Database Updated: ${slug}`);
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