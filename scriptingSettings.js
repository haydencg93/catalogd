let supabaseClient = null;
let tmdbToken = null;

async function initSettings() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    tmdbToken = config.tmdb_token;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { window.location.href = 'index.html'; return; }

    // Prefill current data
    const meta = user.user_metadata || {};
    document.getElementById('edit-name').value = meta.display_name || '';
    document.getElementById('edit-username').value = meta.username || '';
    document.getElementById('edit-avatar').value = meta.avatar_url || '';
    document.getElementById('edit-banner').value = meta.banner_url || '';

    // Update Profile
    document.getElementById('save-profile-btn').onclick = async () => {
        const { error } = await supabaseClient.auth.updateUser({
            data: { 
                display_name: document.getElementById('edit-name').value, 
                username: document.getElementById('edit-username').value,
                avatar_url: document.getElementById('edit-avatar').value,
                banner_url: document.getElementById('edit-banner').value
            }
        });

        if (error) alert(error.message);
        else alert("Profile updated successfully!");
    };

    // --- Change Password ---
    document.getElementById('change-password-btn').onclick = async () => {
        const pass = document.getElementById('new-password').value;
        const confirmPass = document.getElementById('confirm-new-password').value;

        if (pass !== confirmPass) return alert("Passwords do not match!");
        if (pass.length < 6) return alert("Password too short!");

        const { error } = await supabaseClient.auth.updateUser({ password: pass });

        if (error) alert(error.message);
        else {
            alert("Password changed!");
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-new-password').value = '';
        }
    };

    // --- Export Functionality ---
    const rangeSelect = document.getElementById('export-range-select');
    const dateInputs = document.getElementById('date-range-inputs');

    rangeSelect.onchange = async () => {
        const isRange = rangeSelect.value === 'range';
        // Use 'flex' instead of 'block' to respect the CSS we just added
        dateInputs.style.display = isRange ? 'flex' : 'none';
        
        if (isRange) {
            // Query for the oldest record to provide a smart default
            const { data: firstLog } = await supabaseClient
                .from('media_logs')
                .select('watched_on')
                .order('watched_on', { ascending: true })
                .limit(1)
                .single();

            // Default: Oldest entry found or empty
            document.getElementById('export-start-date').value = firstLog?.watched_on || '';
            // Default: Today
            document.getElementById('export-end-date').value = new Date().toISOString().split('T')[0];
        }
    };

    document.getElementById('start-export-btn').onclick = async () => {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return alert("Please sign in to export data.");
        
        const rangeType = rangeSelect.value;
        const startDate = document.getElementById('export-start-date').value;
        const endDate = document.getElementById('export-end-date').value;
        
        startLetterboxdExport(user.id, rangeType, startDate, endDate);
    };

    // --- Import Functionality ---
    const importBtn = document.getElementById('start-import-btn');
    const fileInput = document.getElementById('import-csv-input');
    
    importBtn.onclick = () => {
        const file = fileInput.files[0];
        if (!file) return alert("Please select a CSV file first.");
        
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => startImport(results.data, user.id)
        });
    };

    // --- Delete Account ---
    document.getElementById('final-delete-btn').onclick = async () => {
        const password = document.getElementById('delete-confirm-password').value;
        if (!password) return alert("Enter password to confirm deletion.");

        if (confirm("This will permanently delete your data. Continue?")) {
            // Re-auth check
            const { error: authErr } = await supabaseClient.auth.signInWithPassword({
                email: user.email,
                password: password
            });

            if (authErr) return alert("Incorrect password.");

            const { error: delErr } = await supabaseClient.rpc('delete_user_account');
            if (delErr) alert(delErr.message);
            else {
                await supabaseClient.auth.signOut();
                window.location.href = 'index.html';
            }
        }
    };
}

async function startLetterboxdExport(userId, rangeType, startDate, endDate) {
    const statusDiv = document.getElementById('export-status');
    const progressBar = document.getElementById('export-progress-bar');
    const progressText = document.getElementById('export-text');
    const logList = document.getElementById('export-log-list');

    statusDiv.style.display = 'block';
    logList.innerHTML = '';
    
    const zip = new JSZip();
    const listsFolder = zip.folder("lists"); // Create the 'lists' directory

    // --- PART 1: DIARY EXPORT ---
    let diaryQuery = supabaseClient
        .from('media_logs')
        .select('*')
        .eq('user_id', userId)
        .eq('media_type', 'movie');

    if (rangeType === 'range') {
        if (startDate) diaryQuery = diaryQuery.gte('watched_on', startDate);
        if (endDate) diaryQuery = diaryQuery.lte('watched_on', endDate);
    }

    const { data: diaryLogs } = await diaryQuery;
    let diaryCsv = "tmdbID,Title,Year,Rating,WatchedDate,Rewatch,Tags,Review\n";

    if (diaryLogs && diaryLogs.length > 0) {
        for (let i = 0; i < diaryLogs.length; i++) {
            const log = diaryLogs[i];
            progressText.textContent = `Processing Diary: ${i + 1}/${diaryLogs.length}`;
            progressBar.style.width = `${((i + 1) / (diaryLogs.length * 1.5)) * 100}%`;

            try {
                const res = await fetch(`https://api.themoviedb.org/3/movie/${log.media_id}`, {
                    headers: { Authorization: `Bearer ${tmdbToken}` }
                }).then(r => r.json());

                const row = [
                    log.media_id,
                    `"${(res.title || "Unknown").replace(/"/g, '""')}"`,
                    (res.release_date || "").split('-')[0],
                    log.rating || "",
                    log.watched_on || log.created_at.split('T')[0],
                    log.is_rewatch ? 'Yes' : 'No',
                    'Catalogd',
                    `"${(log.notes || "").replace(/"/g, '""').replace(/\n/g, ' ')}"`
                ];
                diaryCsv += row.join(",") + "\n";
            } catch (e) { addExportLog(log.media_id, "Fetch failed", "error"); }
            await new Promise(r => setTimeout(r, 50));
        }
    }

    // --- PART 2: WATCHLIST EXPORT ---
    const { data: watchlistLogs } = await supabaseClient
        .from('user_watchlist')
        .select('*')
        .eq('user_id', userId)
        .eq('media_type', 'movie');

    let watchlistCsv = "tmdbID,Title,Year,Date\n";
    if (watchlistLogs) {
        for (const item of watchlistLogs) {
            try {
                const res = await fetch(`https://api.themoviedb.org/3/movie/${item.media_id}`, {
                    headers: { Authorization: `Bearer ${tmdbToken}` }
                }).then(r => r.json());
                const row = [item.media_id, `"${res.title}"`, (res.release_date || "").split('-')[0], item.created_at.split('T')[0]];
                watchlistCsv += row.join(",") + "\n";
            } catch (e) {}
        }
    }

    // --- PART 3: CUSTOM LISTS EXPORT ---
    progressText.textContent = `Fetching your lists...`;
    const { data: userLists } = await supabaseClient
        .from('media_lists')
        .select('*, list_items(*)')
        .eq('user_id', userId);

    if (userLists && userLists.length > 0) {
        for (const list of userLists) {
            progressText.textContent = `Exporting List: ${list.name}`;
            
            // Letterboxd List Import Format: Header starts with tmdbID or Title
            let listCsv = "tmdbID,Title,Year,URL,Description\n";
            
            for (const item of list.list_items) {
                if (item.media_type !== 'movie') continue; // Letterboxd only imports movies in lists

                try {
                    const res = await fetch(`https://api.themoviedb.org/3/movie/${item.media_id}`, {
                        headers: { Authorization: `Bearer ${tmdbToken}` }
                    }).then(r => r.json());

                    const row = [
                        item.media_id,
                        `"${(res.title || "Unknown").replace(/"/g, '""')}"`,
                        (res.release_date || "").split('-')[0],
                        `https://www.themoviedb.org/movie/${item.media_id}`,
                        "" // Description column
                    ];
                    listCsv += row.join(",") + "\n";
                } catch (e) { console.error("Error exporting list item", e); }
                await new Promise(r => setTimeout(r, 50));
            }
            // Add the individual list CSV to the 'lists' folder in the ZIP
            listsFolder.file(`${list.name.replace(/\s+/g, '_').toLowerCase()}.csv`, listCsv);
            addExportLog(list.name, `Exported ${list.list_items.length} items to folder`, "success");
        }
    }

    // --- PART 4: BUNDLE AND DOWNLOAD ---
    progressText.textContent = "Zipping files...";
    zip.file("catalogd_diary.csv", diaryCsv);
    zip.file("catalogd_watchlist.csv", watchlistCsv);

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Catalogd_Full_Export_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    progressText.textContent = "Export Complete! Check your downloads.";
}

function addExportLog(title, message, type) {
    const logList = document.getElementById('export-log-list');
    const li = document.createElement('li');
    li.style.cssText = "margin-bottom: 5px; padding-bottom: 5px; border-bottom: 1px solid #2c3440;";
    
    let color = type === 'success' ? '#4CAF50' : '#ff4d4d';
    let icon = type === 'success' ? '🎬' : '❌';

    li.innerHTML = `<span style="color: ${color}">${icon} ${title}</span>: <span style="opacity: 0.7">${message}</span>`;
    logList.prepend(li);
}

async function startImport(data, userId) {
    const statusDiv = document.getElementById('import-status');
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-text');
    const logList = document.getElementById('import-log-list');
    const shouldOverwrite = document.getElementById('overwrite-toggle').checked;
    
    statusDiv.style.display = 'block';
    document.getElementById('import-log-container').style.display = 'block';
    logList.innerHTML = '';
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    let overwriteCount = 0;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const title = row.Name || "Unknown Title";
        const progress = Math.round(((i + 1) / data.length) * 100);
        
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `Processing ${i + 1}/${data.length}: ${title}`;

        try {
            const mediaInfo = await resolveMedia(title, row.Year);
            if (!mediaInfo) {
                addImportLog(title, "Could not find on TMDB", "error");
                failCount++;
                continue;
            }

            const watchedDate = row['Watched Date'] || row.Date;
            const rowRating = parseFloat(row.Rating) || 0;

            // 1. Look for an existing match
            const { data: existing } = await supabaseClient
                .from('media_logs')
                .select('id')
                .eq('user_id', userId)
                .eq('media_id', String(mediaInfo.id))
                .eq('watched_on', watchedDate)
                .maybeSingle();

            const payload = {
                user_id: userId,
                media_id: String(mediaInfo.id),
                media_type: mediaInfo.type,
                rating: rowRating,
                watched_on: watchedDate,
                runtime: mediaInfo.runtime, // ADD THIS LINE
                is_rewatch: row.Rewatch === 'Yes',
                created_at: new Date().toISOString()
            };

            if (existing) {
                if (shouldOverwrite) {
                    // 2. Overwrite mode: Include the existing ID to trigger an update
                    payload.id = existing.id; 
                    const { error } = await supabaseClient.from('media_logs').upsert(payload);
                    if (error) throw error;
                    
                    addImportLog(title, "Updated/Overwritten", "success");
                    overwriteCount++;
                } else {
                    // 3. Skip mode
                    addImportLog(title, "Already in Catalogd (Skipped)", "warning");
                    skipCount++;
                    continue;
                }
            } else {
                // 4. New entry
                const { error } = await supabaseClient.from('media_logs').insert(payload);
                if (error) throw error;
                successCount++;
            }

        } catch (err) {
            console.error(err);
            addImportLog(title, "Database error", "error");
            failCount++;
        }

        await new Promise(r => setTimeout(r, 200)); 
    }

    progressText.textContent = `Import Complete!`;
    alert(`Finished!\nNew: ${successCount}\nOverwritten: ${overwriteCount}\nSkipped: ${skipCount}\nFailed: ${failCount}`);
}

// Updated Helper for green "Success" logs
function addImportLog(title, message, type) {
    const logList = document.getElementById('import-log-list');
    const li = document.createElement('li');
    li.style.cssText = "margin-bottom: 5px; padding-bottom: 5px; border-bottom: 1px solid #2c3440;";
    
    let color = '#ffb347'; // Default Orange
    let icon = '⏭️';

    if (type === 'error') {
        color = '#ff4d4d'; // Red
        icon = '❌';
    } else if (type === 'success') {
        color = '#4CAF50'; // Green
        icon = '✅';
    }

    li.innerHTML = `<span style="color: ${color}">${icon} ${title}</span>: <span style="opacity: 0.7">${message}</span>`;
    logList.prepend(li);
}

// Add this to your scriptingSettings.js
window.handleAdvancedImport = async (type) => {
    const fileInput = document.getElementById(`import-${type}-input`);
    const file = fileInput.files[0];
    if (!file) return alert(`Please select the ${type} CSV file.`);

    const { data: { user } } = await supabaseClient.auth.getUser();

    Papa.parse(file, {
        header: false, // Set to false first to handle the Letterboxd metadata rows
        skipEmptyLines: true,
        complete: (results) => {
            if (type === 'list') {
                processListData(results.data, user.id);
            } else {
                // For other types, convert back to header-based format or adjust processAdvancedData
                const headers = results.data[0];
                const rows = results.data.slice(1).map(row => {
                    let obj = {};
                    headers.forEach((h, i) => obj[h] = row[i]);
                    return obj;
                });
                processAdvancedData(type, rows, user.id);
            }
        }
    });
};

async function processAdvancedData(importType, data, userId) {
    const statusDiv = document.getElementById('import-status');
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-text');
    const logList = document.getElementById('import-log-list');

    statusDiv.style.display = 'block';
    document.getElementById('import-log-container').style.display = 'block';
    logList.innerHTML = '';

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const title = row.Name || "Unknown";
        const progress = Math.round(((i + 1) / data.length) * 100);
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `Syncing ${importType}: ${title}`;

        try {
            const mediaInfo = await resolveMedia(title, row.Year);
            if (!mediaInfo) {
                addImportLog(title, "Not found on TMDB", "error");
                failCount++;
                continue;
            }

            if (importType === 'watchlist') {
                // WATCHLIST: Insert into user_watchlist table
                const { error } = await supabaseClient.from('user_watchlist').upsert({
                    user_id: userId,
                    media_id: String(mediaInfo.id),
                    media_type: mediaInfo.type
                }, { onConflict: 'user_id, media_id, media_type' }); // Prevents duplicates if constraint exists

                if (error) throw error;
                addImportLog(title, "Added to Watchlist", "success");
            } 
            else {
                // REVIEWS or LIKES: Update existing logs in media_logs
                const { data: existingLogs } = await supabaseClient
                    .from('media_logs')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('media_id', String(mediaInfo.id));

                if (!existingLogs || existingLogs.length === 0) {
                    addImportLog(title, "No existing diary log found to update", "warning");
                    failCount++;
                } else {
                    for (const log of existingLogs) {
                        let updateData = {};
                        if (importType === 'reviews') updateData.notes = row.Review;
                        if (importType === 'likes') updateData.is_liked = true;

                        await supabaseClient.from('media_logs').update(updateData).eq('id', log.id);
                    }
                    addImportLog(title, `Updated ${importType}`, "success");
                }
            }
            successCount++;
        } catch (err) {
            console.error(err);
            failCount++;
        }
        await new Promise(r => setTimeout(r, 150));
    }

    progressText.textContent = `${importType} sync complete!`;
    alert(`Import Finished!\nSuccess: ${successCount}\nFailed/Skipped: ${failCount}`);
}

async function processListData(rawData, userId) {
    const statusDiv = document.getElementById('import-status');
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-text');
    const logList = document.getElementById('import-log-list');

    statusDiv.style.display = 'block';
    document.getElementById('import-log-container').style.display = 'block';
    logList.innerHTML = '';

    // 1. Extract List Metadata (Letterboxd format)
    // Row 0 is often "Letterboxd list export v7"
    // Row 1 is "Date, Name, Tags, URL, Description"
    // Row 2 is the actual values for the list itself
    const listName = rawData[2][1] || "Imported List";
    const listDescription = rawData[2][4] || "";

    // 2. Find where the actual movie data starts (usually after "Position, Name, Year...")
    const headerRowIndex = rawData.findIndex(row => row.includes("Position") && row.includes("Name"));
    if (headerRowIndex === -1) return alert("Could not find movie data in CSV.");

    const movieRows = rawData.slice(headerRowIndex + 1);

    try {
        progressText.textContent = `Creating list: ${listName}...`;
        
        // 3. Create the List in media_lists
        const { data: newList, error: listError } = await supabaseClient
            .from('media_lists')
            .insert({
                user_id: userId,
                name: listName,
                description: listDescription,
                is_public: true
            })
            .select()
            .single();

        if (listError) throw listError;

        let successCount = 0;

        // 4. Process each movie
        for (let i = 0; i < movieRows.length; i++) {
            const row = movieRows[i];
            const title = row[1]; // Index 1 is 'Name'
            const year = row[2];  // Index 2 is 'Year'

            const progress = Math.round(((i + 1) / movieRows.length) * 100);
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `Adding to ${listName}: ${title}`;

            const mediaInfo = await resolveMedia(title, year);
            if (mediaInfo) {
                const { error: itemError } = await supabaseClient
                    .from('list_items')
                    .insert({
                        list_id: newList.id,
                        media_id: String(mediaInfo.id),
                        media_type: mediaInfo.type
                    });

                if (!itemError) {
                    addImportLog(title, "Added to list", "success");
                    successCount++;
                } else {
                    addImportLog(title, "Error adding to list", "error");
                }
            } else {
                addImportLog(title, "Not found on TMDB", "error");
            }
            // Small delay to respect TMDB rate limits
            await new Promise(r => setTimeout(r, 150));
        }

        progressText.textContent = "List import complete!";
        alert(`Imported "${listName}" with ${successCount} items.`);

    } catch (err) {
        console.error(err);
        alert("Failed to create list: " + err.message);
    }
}

async function resolveMedia(title, year) {
    if (!title) return null;
    
    const query = encodeURIComponent(title);
    const movieUrl = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${year || ''}`;
    
    try {
        const res = await fetch(movieUrl, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        if (res.results && res.results.length > 0) {
            const movieId = res.results[0].id;
            // Fetch full details to get the runtime
            const detailUrl = `https://api.themoviedb.org/3/movie/${movieId}?api_key=`; // Note: using Bearer token in headers is better
            const details = await fetch(`https://api.themoviedb.org/3/movie/${movieId}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            return { 
                id: movieId, 
                type: 'movie', 
                runtime: details.runtime || 0 // Movies use .runtime
            };
        }
        
        // Fallback for TV
        const tvUrl = `https://api.themoviedb.org/3/search/tv?query=${query}&first_air_date_year=${year || ''}`;
        const tvRes = await fetch(tvUrl, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        if (tvRes.results && tvRes.results.length > 0) {
            const tvId = tvRes.results[0].id;
            const details = await fetch(`https://api.themoviedb.org/3/tv/${tvId}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            return { 
                id: tvId, 
                type: 'tv', 
                // TV shows use episode_run_time (an array)
                runtime: details.episode_run_time ? details.episode_run_time[0] : 0 
            };
        }
    } catch (e) {
        console.error("TMDB Resolve Error:", e);
        return null;
    }
    return null;
}

initSettings();