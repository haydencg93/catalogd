let supabaseClient = null;
let tmdbToken = null;
let currentFavs = { movie: [], tv: [], book: [], all: [] };

async function initSettings() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
    tmdbToken = config.tmdb_token;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { window.location.href = 'index.html'; return; }

    // Fetch existing Bio/Website/Favs to prefill
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (profile) {
        document.getElementById('edit-bio').value = profile.bio || '';
        document.getElementById('edit-website').value = profile.website_url || '';
        currentFavs = profile.favorites || { movie: [], tv: [], book: [], all: [] };
        renderFavManager(); // Function to show current favs in settings
    }

    // Prefill current data
    const meta = user.user_metadata || {};
    document.getElementById('edit-name').value = meta.display_name || '';
    document.getElementById('edit-username').value = meta.username || '';
    document.getElementById('edit-avatar').value = meta.avatar_url || '';
    document.getElementById('edit-banner').value = meta.banner_url || '';

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
        dateInputs.style.display = isRange ? 'flex' : 'none';
        
        if (isRange) {
            // 1. Get Today's Date
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            // 2. Calculate One Week Ago
            const lastWeek = new Date();
            lastWeek.setDate(today.getDate() - 7);
            const lastWeekStr = lastWeek.toISOString().split('T')[0];

            // 3. Set the defaults in the UI
            document.getElementById('export-start-date').value = lastWeekStr;
            document.getElementById('export-end-date').value = todayStr;

            console.log(`📅 Default range set: ${lastWeekStr} to ${todayStr}`);
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

        const hash = window.location.hash;
        if (hash && hash.includes('type=recovery')) {
            alert("Password recovery mode active. Please enter your new password in the Security section.");
            document.getElementById('new-password').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('new-password').focus();
        }
    }
    setupFavoritesSearch();
}

// Function to handle the Favorites search
const favSearchInput = document.getElementById('fav-search-input');
const favSearchResults = document.getElementById('fav-search-results');

favSearchInput.oninput = async () => {
    const query = favSearchInput.value;
    if (query.length < 3) {
        favSearchResults.innerHTML = '';
        return;
    }

    // Search TMDB (Movies/TV)
    const options = { headers: { Authorization: `Bearer ${tmdbToken}` } };
    const res = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`, options);
    const data = await res.json();

    favSearchResults.innerHTML = '';
    favSearchResults.style.display = 'block';

    data.results.slice(0, 5).forEach(item => {
        if (item.media_type === 'person') return;
        
        const div = document.createElement('div');
        div.className = 'search-item-dropdown';
        div.style.padding = '10px';
        div.style.cursor = 'pointer';
        div.style.borderBottom = '1px solid #2c3440';
        div.innerHTML = `<strong>${item.title || item.name}</strong> (${item.media_type})`;
        
        div.onclick = () => {
            addFavorite({
                id: item.id,
                title: item.title || item.name,
                type: item.media_type,
                image: `https://image.tmdb.org/t/p/w500${item.poster_path}`
            });
            favSearchResults.innerHTML = '';
            favSearchInput.value = '';
        };
        favSearchResults.appendChild(div);
    });
};

// Update Profile
async function saveAllProfileData() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Session lost. Please log in again.");

    // 1. Get values from the UI
    const nameValue = document.getElementById('edit-name').value;
    const usernameValue = document.getElementById('edit-username').value;
    const avatarValue = document.getElementById('edit-avatar').value;
    const bannerValue = document.getElementById('edit-banner').value;
    const bioValue = document.getElementById('edit-bio').value;
    const websiteValue = document.getElementById('edit-website').value;

    // 2. Update Auth Metadata (Keep this for session consistency)
    const { error: authError } = await supabaseClient.auth.updateUser({
        data: { 
            display_name: nameValue, 
            username: usernameValue,
            avatar_url: avatarValue,
            banner_url: bannerValue
        }
    });

    // 3. FIX: Update Profiles Table with ALL fields including Avatar and Banner
    const { error: profileError } = await supabaseClient
        .from('profiles')
        .update({
            display_name: nameValue,  // Added this
            username: usernameValue,  // Added this
            avatar_url: avatarValue,  // FIX: This sends it to the DB table
            banner_url: bannerValue,  // FIX: This sends it to the DB table
            bio: bioValue,
            website_url: websiteValue,
            favorites: currentFavs 
        })
        .eq('id', user.id);

    if (authError || profileError) {
        alert("Error: " + (authError?.message || profileError?.message));
    } else {
        alert("Changes saved successfully!");
        // Optional: Refresh the page to show updated data
        window.location.reload();
    }
}

// Attach the function to BOTH buttons inside initSettings
document.getElementById('save-profile-btn').onclick = saveAllProfileData;
document.getElementById('save-favs-btn').onclick = saveAllProfileData;

function addFavorite(item) {
    if (currentFavs[item.type].length >= 5) {
        return alert("You can only have 5 favorites per category!");
    }
    
    currentFavs[item.type].push(item);
    updateTopAll(); // Syncs the #1s to the 'all' list
    renderFavManager(); // Refresh the UI
}

function updateTopAll() {
    // Take #1 from each category and put into 'all'
    const topMovie = currentFavs.movie[0];
    const topTv = currentFavs.tv[0];
    const topBook = currentFavs.book[0];
    
    currentFavs.all = [topMovie, topTv, topBook].filter(Boolean);
}

async function startLetterboxdExport(userId, rangeType, startDate, endDate) {
    const statusDiv = document.getElementById('export-status');
    const progressBar = document.getElementById('export-progress-bar');
    const progressText = document.getElementById('export-text');
    const logList = document.getElementById('export-log-list');
    const logContainer = document.getElementById('export-log-container');

    statusDiv.style.display = 'block';
    logContainer.style.display = 'block';
    logList.innerHTML = '';
    
    const zip = new JSZip();
    const listsFolder = zip.folder("lists"); 

    // Initialize CSV strings at the top to avoid ReferenceErrors
    let diaryCsv = "tmdbID,Title,Year,Rating,WatchedDate,Rewatch,Tags,Review\n";
    let watchlistCsv = "tmdbID,Title,Year,Date\n";

    // --- PART 1: DIARY EXPORT (Filtered by Date) ---
    let diaryQuery = supabaseClient
        .from('media_logs')
        .select('*')
        .eq('user_id', userId)
        .eq('media_type', 'movie');

    if (rangeType === 'range') {
        if (startDate && startDate !== "") {
            // Now filtering by the date the entry was created in the database
            diaryQuery = diaryQuery.gte('created_at', startDate); 
        }
        if (endDate && endDate !== "") {
            diaryQuery = diaryQuery.lte('created_at', endDate);
        }
    }

    const { data: diaryLogs } = await diaryQuery;

    // --- PART 2: WATCHLIST (Always All) ---
    const { data: watchlistLogs } = await supabaseClient
        .from('user_watchlist')
        .select('*')
        .eq('user_id', userId)
        .eq('media_type', 'movie');

    // --- PART 3: CUSTOM LISTS (Always All) ---
    const { data: userLists } = await supabaseClient
        .from('media_lists')
        .select('*, list_items(*)')
        .eq('user_id', userId);

    // Calculate totals for progress bar
    const totalDiary = diaryLogs?.length || 0;
    const totalWatchlist = watchlistLogs?.length || 0;
    const totalListItems = userLists?.reduce((acc, list) => acc + list.list_items.length, 0) || 0;
    const grandTotal = totalDiary + totalWatchlist + totalListItems;
    let processedCount = 0;

    if (grandTotal === 0) {
        progressText.textContent = "No data found to export.";
        progressBar.style.width = "100%";
        return;
    }

    // Process Diary
    for (let i = 0; i < totalDiary; i++) {
        const log = diaryLogs[i];
        processedCount++;
        progressText.textContent = `Verifying Diary: ${i + 1}/${totalDiary}`;
        progressBar.style.width = `${(processedCount / grandTotal) * 100}%`;

        try {
            const details = await fetch(`https://api.themoviedb.org/3/movie/${log.media_id}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            const targetTitle = details.title;
            const targetYear = (details.release_date || "").split('-')[0];

            const searchRes = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(targetTitle)}&year=${targetYear}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            const verified = searchRes.results.find(m => 
                m.title.toLowerCase() === targetTitle.toLowerCase() && 
                (m.release_date || "").startsWith(targetYear)
            );

            if (verified) {
                console.log(`🎬 Diary Item - ID: ${verified.id} | Name: ${verified.title} | Year: ${targetYear}`);
                addExportLog(verified.title, `Verified (${log.watched_on})`, "success");
                
                const row = [
                    verified.id,
                    `"${verified.title.replace(/"/g, '""')}"`,
                    targetYear,
                    log.rating || "",
                    log.watched_on || log.created_at.split('T')[0],
                    log.is_rewatch ? 'Yes' : 'No',
                    'Catalogd',
                    `"${(log.notes || "").replace(/"/g, '""').replace(/\n/g, ' ')}"`
                ];
                diaryCsv += row.join(",") + "\n";
            }
        } catch (e) { console.error(e); }
        await new Promise(r => setTimeout(r, 50));
    }

    // Process Watchlist
    if (totalWatchlist > 0) {
        for (const item of watchlistLogs) {
            processedCount++;
            progressText.textContent = `Processing Watchlist...`;
            progressBar.style.width = `${(processedCount / grandTotal) * 100}%`;

            try {
                const res = await fetch(`https://api.themoviedb.org/3/movie/${item.media_id}`, {
                    headers: { Authorization: `Bearer ${tmdbToken}` }
                }).then(r => r.json());
                
                const year = (res.release_date || "").split('-')[0];
                console.log(`📌 Watchlist Item - ID: ${res.id} | Name: ${res.title} | Year: ${year}`);
                addExportLog(res.title, "Added to Watchlist", "success");
                
                const row = [res.id, `"${res.title}"`, year, item.created_at.split('T')[0]];
                watchlistCsv += row.join(",") + "\n";
            } catch (e) { console.error(e); }
        }
    }

    // Process Custom Lists
    if (userLists) {
        for (const list of userLists) {
            if (!list.list_items || list.list_items.length === 0) continue;

            let listCsv = "tmdbID,Title,Year,URL,Description\n";
            let movieCountInList = 0;
            const safeListName = list.name.replace(/[\\/:*?"<>|]/g, '$').replace(/\s+/g, '_').toLowerCase();
            
            for (const item of list.list_items) {
                if (item.media_type !== 'movie') continue;
                processedCount++;
                progressBar.style.width = `${(processedCount / grandTotal) * 100}%`;
                
                try {
                    const res = await fetch(`https://api.themoviedb.org/3/movie/${item.media_id}`, {
                        headers: { Authorization: `Bearer ${tmdbToken}` }
                    }).then(r => r.json());

                    const year = (res.release_date || "").split('-')[0];
                    const row = [res.id, `"${res.title}"`, year, `https://www.themoviedb.org/movie/${res.id}`, ""];
                    listCsv += row.join(",") + "\n";
                    movieCountInList++;
                } catch (e) { console.error(e); }
                await new Promise(r => setTimeout(r, 50));
            }

            if (movieCountInList > 0) {
                listsFolder.file(`${safeListName}.csv`, listCsv);
                addExportLog(list.name, `List exported with ${movieCountInList} movies`, "success");
            }
        }
    }

    // Finalize ZIP
    progressText.textContent = "Zipping files...";
    zip.file("catalogd_diary.csv", diaryCsv);
    zip.file("catalogd_watchlist.csv", watchlistCsv);

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Catalogd_Export_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    progressText.textContent = "Export Complete!";
    progressBar.style.width = "100%";
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

// --- Favorites Search Logic ---
function setupFavoritesSearch() {
    const favSearchInput = document.getElementById('fav-search-input');
    const favSearchResults = document.getElementById('fav-search-results');

    favSearchInput.oninput = async () => {
        const query = favSearchInput.value;
        
        if (query.length < 3) {
            favSearchResults.innerHTML = '';
            favSearchResults.style.display = 'none';
            return;
        }

        const options = { headers: { Authorization: `Bearer ${tmdbToken}` } };

        try {
            // Fetch everything
            const [movieRes, tvRes, bookRes] = await Promise.all([
                fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`, options).then(r => r.json()),
                fetch(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}`, options).then(r => r.json()),
                fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`).then(r => r.json())
            ]);

            favSearchResults.innerHTML = '';
            favSearchResults.style.display = 'block';

            // TRACKER: Keep track of IDs we've already displayed
            const seenIds = new Set();

            const createSearchRow = (title, year, type, imageUrl, subtitle, clickAction) => {
                const div = document.createElement('div');
                div.className = 'search-item-dropdown';
                div.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 10px; cursor: pointer; border-bottom: 1px solid #2c3440;`;
                div.innerHTML = `
                    <img src="${imageUrl}" style="width: 40px; height: 60px; object-fit: cover; border-radius: 4px; background: #1a1d23;" alt="cover">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: baseline; gap: 6px;">
                            <strong style="font-size: 1rem;">${title}${year}</strong>
                            <span style="opacity:0.5; font-size: 0.7rem; text-transform: uppercase;">— ${type}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #9ab; margin-top: 2px;">${subtitle}</div>
                    </div>
                `;
                div.onclick = clickAction;
                return div;
            };

            // --- PROCESS MOVIES ---
            for (const item of movieRes.results.slice(0, 5)) {
                if (seenIds.has(item.id)) continue; // Skip if already seen
                seenIds.add(item.id);

                const year = item.release_date ? ` (${item.release_date.split('-')[0]})` : "";
                const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Image';
                
                const detail = await fetch(`https://api.themoviedb.org/3/movie/${item.id}?append_to_response=credits`, options).then(r => r.json());
                const director = detail.credits?.crew?.find(p => p.job === 'Director')?.name || "Unknown Director";

                favSearchResults.appendChild(createSearchRow(item.title, year, 'movie', img, director, () => {
                    addFavorite({ id: item.id, title: `${item.title}${year}`, type: 'movie', image: img.replace('w92', 'w500'), creator: director });
                    favSearchResults.innerHTML = ''; favSearchInput.value = '';
                }));
            }

            // --- PROCESS TV SHOWS ---
            for (const item of tvRes.results.slice(0, 5)) {
                if (seenIds.has(item.id)) continue; // Skip if already seen
                seenIds.add(item.id);

                const year = item.first_air_date ? ` (${item.first_air_date.split('-')[0]})` : "";
                const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Image';
                
                const detail = await fetch(`https://api.themoviedb.org/3/tv/${item.id}`, options).then(r => r.json());
                const creator = detail.created_by?.[0]?.name || "Various Creators";

                favSearchResults.appendChild(createSearchRow(item.name, year, 'tv', img, creator, () => {
                    addFavorite({ id: item.id, title: `${item.name}${year}`, type: 'tv', image: img.replace('w92', 'w500'), creator: creator });
                    favSearchResults.innerHTML = ''; favSearchInput.value = '';
                }));
            }

            // --- PROCESS BOOKS ---
            bookRes.docs.forEach(book => {
                // Book keys are strings (e.g., "/works/OL123W"), so they won't collide with TMDB numbers
                if (seenIds.has(book.key)) return; 
                seenIds.add(book.key);

                const year = book.first_publish_year ? ` (${book.first_publish_year})` : "";
                const img = book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : 'https://via.placeholder.com/92x138?text=No+Cover';
                const author = book.author_name ? book.author_name.join(', ') : "Unknown Author";

                favSearchResults.appendChild(createSearchRow(book.title, year, 'book', img, author, () => {
                    addFavorite({ id: book.key, title: `${book.title}${year}`, type: 'book', image: img, creator: author });
                    favSearchResults.innerHTML = ''; favSearchInput.value = '';
                }));
            });

        } catch (error) {
            console.error("Search error:", error);
        }
    };
}

// --- Render the Favorites Manager in Settings ---
function renderFavManager() {
    const container = document.getElementById('favorites-manager');
    container.innerHTML = ''; // Clear existing

    const categories = ['movie', 'tv', 'book'];
    
    categories.forEach(cat => {
        const section = document.createElement('div');
        section.className = 'fav-category-admin';
        section.style.marginBottom = '20px';
        
        const label = cat.charAt(0).toUpperCase() + cat.slice(1) + 's';
        section.innerHTML = `<h4 style="color: #9ab; margin-bottom: 10px;">Top 5 ${label}</h4>`;
        
        const list = currentFavs[cat] || [];
        
        const itemContainer = document.createElement('div');
        itemContainer.style.display = 'flex';
        itemContainer.style.gap = '10px';
        itemContainer.style.flexWrap = 'wrap';

        list.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.style.cssText = "background: #14181c; padding: 5px 10px; border-radius: 6px; display: flex; align-items: center; gap: 8px; border: 1px solid #2c3440;";
            itemDiv.innerHTML = `
                <span style="color: var(--accent); font-weight: bold;">#${index + 1}</span>
                <span style="font-size: 0.9rem;">${item.title}</span>
                <span onclick="removeFavorite('${cat}', ${index})" style="cursor: pointer; color: #ff4d4d; font-weight: bold;">×</span>
            `;
            itemContainer.appendChild(itemDiv);
        });

        if (list.length === 0) {
            itemContainer.innerHTML = `<p style="font-size: 0.8rem; opacity: 0.5;">No ${cat}s added yet.</p>`;
        }

        section.appendChild(itemContainer);
        container.appendChild(section);
    });
}

// --- Helper to Remove Favorites ---
window.removeFavorite = (type, index) => {
    currentFavs[type].splice(index, 1);
    updateTopAll();
    renderFavManager();
};

initSettings();