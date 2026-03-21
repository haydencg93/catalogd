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
        header: true,
        skipEmptyLines: true,
        complete: (results) => processAdvancedData(type, results.data, user.id)
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

async function resolveMedia(title, year) {
    if (!title) return null;
    
    // Search TMDB for Movies (default for Letterboxd)
    const query = encodeURIComponent(title);
    const url = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${year || ''}`;
    
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        if (res.results && res.results.length > 0) {
            return { id: res.results[0].id, type: 'movie' };
        }
        
        // Fallback: search TV if no movie found (Letterboxd sometimes has miniseries)
        const tvUrl = `https://api.themoviedb.org/3/search/tv?query=${query}&first_air_date_year=${year || ''}`;
        const tvRes = await fetch(tvUrl, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        if (tvRes.results && tvRes.results.length > 0) {
            return { id: tvRes.results[0].id, type: 'tv' };
        }
    } catch (e) {
        return null;
    }
    return null;
}

initSettings();