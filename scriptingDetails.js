const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');

let supabaseClient = null; // To be initialized in initDetails

async function initDetails() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        
        // 1. SELECT THE BUTTONS HERE
        const markSeasonBtn = document.getElementById('mark-season-btn');
        const clearSeasonBtn = document.getElementById('clear-season-btn');

        let data;
        
        if (type === 'book') {
            // Fetch from OpenLibrary API
            // The ID for books is the OpenLibrary key (e.g., /works/OL123W)
            const bookRes = await fetch(`https://openlibrary.org${id}.json`);
            const bookData = await bookRes.json();
            
            data = {
                title: bookData.title,
                overview: bookData.description?.value || bookData.description || "No description available.",
                poster_path: bookData.covers ? `https://covers.openlibrary.org/b/id/${bookData.covers[0]}-L.jpg` : null,
                meta: `Published: ${bookData.first_publish_date || 'Unknown'}`
            };
        } else {
            // Fetch from TMDB API
            const options = { 
                method: 'GET', 
                headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
            };
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, options);
            const tmdbData = await tmdbRes.json();
            
            data = {
                title: tmdbData.title || tmdbData.name,
                overview: tmdbData.overview,
                poster_path: `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`,
                backdrop: tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : null,
                meta: `${(tmdbData.release_date || tmdbData.first_air_date || '').split('-')[0]} • ${tmdbData.genres?.map(g => g.name).join(', ')}`
            };
        }

        // Render the normalized data to the UI
        document.getElementById('media-title').textContent = data.title;
        document.getElementById('media-overview').textContent = data.overview;
        document.getElementById('media-meta').textContent = data.meta;

        await fetchWatchProviders(config);
        
        // Render Poster/Backdrop
        document.getElementById('poster-area').innerHTML = `<img src="${data.poster_path}" alt="${data.title}">`;
        if (type !== 'book' && data.backdrop) {
            document.getElementById('backdrop-overlay').style.backgroundImage = `url(${data.backdrop})`;
        }

        if (markSeasonBtn) {
            markSeasonBtn.onclick = markSeasonAsWatched;
        }
        
        if (clearSeasonBtn) {
            clearSeasonBtn.onclick = clearSeasonProgress;
        }

        if (type === 'tv') {
            setupTVTracker(config, id);
        }
        
        setupRater();

    } catch (err) { 
        console.error("Initialization error:", err); 
    }
}

async function setupTVTracker(config, seriesId) {
    if (type !== 'tv') return;
    
    const trackerSection = document.getElementById('tv-tracker');
    trackerSection.style.display = 'block';
    
    const seasonSelector = document.getElementById('season-selector');
    
    // 1. Fetch Series Detail to get number of seasons
    const res = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}`, {
        headers: { Authorization: `Bearer ${config.tmdb_token}` }
    }).then(r => r.json());

    // 2. Populate Season Dropdown
    seasonSelector.innerHTML = res.seasons.map(s => 
        `<option value="${s.season_number}">${s.name}</option>`
    ).join('');

    seasonSelector.onchange = () => loadEpisodes(config, seriesId, seasonSelector.value);
    
    // Load first season by default
    loadEpisodes(config, seriesId, res.seasons[0].season_number);
}

async function loadEpisodes(config, seriesId, seasonNum) {
    const list = document.getElementById('episode-list');
    list.innerHTML = 'Loading episodes...';

    try {
        // 1. Get episode list from TMDB FIRST
        const res = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNum}`, {
            headers: { Authorization: `Bearer ${config.tmdb_token}` }
        }).then(r => r.json());

        // 2. Get user status and watched episodes SECOND
        const { data: { user } } = await supabaseClient.auth.getUser();
        let watchedSet = new Set();

        if (user) {
            const { data: watched } = await supabaseClient
                .from('episode_logs')
                .select('episode_number')
                .eq('series_id', seriesId)
                .eq('season_number', seasonNum)
                .eq('user_id', user.id);

            if (watched) watchedSet = new Set(watched.map(w => w.episode_number));
        }

        // 3. Now that 'res' and 'watchedSet' exist, do the math
        const totalEpisodes = res.episodes.length;
        const watchedCount = watchedSet.size;
        const percentage = Math.round((watchedCount / totalEpisodes) * 100);

        // 4. Render the list
        list.innerHTML = res.episodes.map(ep => `
            <div class="episode-item">
                <input type="checkbox" id="ep-${ep.episode_number}" 
                    ${watchedSet.has(ep.episode_number) ? 'checked' : ''} 
                    onclick="toggleEpisode('${seriesId}', ${seasonNum}, ${ep.episode_number})">
                <label for="ep-${ep.episode_number}">E${ep.episode_number}: ${ep.name}</label>
            </div>
        `).join('');

        // 5. Update the progress bar
        let progressContainer = document.getElementById('progress-container');
        
        // If the container doesn't exist yet, create it and insert it before the episode list
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.id = 'progress-container';
            list.parentNode.insertBefore(progressContainer, list);
        }

        progressContainer.innerHTML = `
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${percentage}%"></div>
            </div>
            <p class="meta">${watchedCount} / ${totalEpisodes} episodes watched (${percentage}%)</p>
        `;

    } catch (err) {
        console.error("Error loading episodes:", err);
        list.innerHTML = "Error loading episodes. Check console.";
    }
}

async function toggleEpisode(seriesId, seasonNum, epNum) {
    const isChecked = document.getElementById(`ep-${epNum}`).checked;
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (isChecked) {
        await supabaseClient.from('episode_logs').insert({
            user_id: user.id, series_id: seriesId, season_number: seasonNum, episode_number: epNum
        });
    } else {
        await supabaseClient.from('episode_logs').delete()
            .eq('user_id', user.id).eq('series_id', seriesId)
            .eq('season_number', seasonNum).eq('episode_number', epNum);
    }
    refreshProgressBar(seriesId, seasonNum);
}

async function markSeasonAsWatched() {
    const seasonNum = document.getElementById('season-selector').value;
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) return alert("Please sign in to log progress.");

    const configRes = await fetch('config.json');
    const config = await configRes.json();
    
    const res = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNum}`, {
        headers: { Authorization: `Bearer ${config.tmdb_token}` }
    }).then(r => r.json());

    // Ensure series_id is a String to match your table's 'text' format
    const logs = res.episodes.map(ep => ({
        user_id: user.id,
        series_id: String(id), 
        season_number: parseInt(seasonNum),
        episode_number: ep.episode_number
    }));

    const { error } = await supabaseClient
        .from('episode_logs')
        .upsert(logs, { 
            onConflict: 'user_id,series_id,season_number,episode_number' 
        });

    if (error) {
        console.error("Supabase Error Details:", error); // Check the browser console!
        alert("Error: " + error.message);
    } else {
        loadEpisodes(config, id, seasonNum);
        alert(`Season ${seasonNum} marked as watched!`);
    }

    // At the very end of markSeasonAsWatched()
    if (error) {
        console.error("Supabase Error Details:", error);
        alert("Error: " + error.message);
    } else {
        // Instead of forcing a full list reload, just update the boxes and the bar
        document.querySelectorAll('.episode-item input[type="checkbox"]').forEach(cb => cb.checked = true);
        refreshProgressBar(id, seasonNum); 
        alert(`Season ${seasonNum} marked as watched!`);
    }
}

async function refreshProgressBar(seriesId, seasonNum) {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return;

        // 1. Get current watched count from Supabase
        const { data: watched } = await supabaseClient
            .from('episode_logs')
            .select('episode_number')
            .eq('series_id', String(seriesId))
            .eq('season_number', seasonNum)
            .eq('user_id', user.id);

        const watchedCount = watched ? watched.length : 0;

        // 2. We need the total episode count for this season. 
        // We can grab this from the existing list in the UI.
        const totalEpisodes = document.querySelectorAll('.episode-item').length;
        
        if (totalEpisodes > 0) {
            const percentage = Math.round((watchedCount / totalEpisodes) * 100);

            // 3. Update the Progress Bar and Text
            const barFill = document.querySelector('.progress-bar-fill');
            const progressMeta = document.querySelector('#progress-container .meta');

            if (barFill) barFill.style.width = `${percentage}%`;
            if (progressMeta) {
                progressMeta.textContent = `${watchedCount} / ${totalEpisodes} episodes watched (${percentage}%)`;
            }
        }
    } catch (err) {
        console.error("Error updating progress bar:", err);
    }
}

async function clearSeasonProgress() {
    const seasonNum = document.getElementById('season-selector').value;
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) return alert("Please sign in to manage progress.");

    const confirmClear = confirm(`Are you sure you want to clear all progress for Season ${seasonNum}?`);
    if (!confirmClear) return;

    // 1. Delete all logs for this specific series and season from Supabase
    const { error } = await supabaseClient
        .from('episode_logs')
        .delete()
        .eq('user_id', user.id)
        .eq('series_id', String(id)) // Ensure it's a string to match 'text' column
        .eq('season_number', seasonNum);

    if (error) {
        console.error("Error clearing season:", error);
        alert("Failed to clear season progress.");
    } else {
        // 2. Dynamically update the UI: Uncheck all boxes
        document.querySelectorAll('.episode-item input[type="checkbox"]').forEach(cb => cb.checked = false);
        
        // 3. Reset the progress bar instantly
        refreshProgressBar(id, seasonNum);
        
        alert(`Season ${seasonNum} progress cleared!`);
    }
}

async function fetchWatchProviders(config) {
    if (type === 'book') return; // Books don't have streaming providers in TMDB

    const url = `https://api.themoviedb.org/3/${type}/${id}/watch/providers`;
    const options = { 
        method: 'GET', 
        headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
    };

    try {
        const res = await fetch(url, options).then(r => r.json());
        // We'll default to 'US' region, but you can change this
        const providers = res.results?.US?.flatrate || [];
        const container = document.getElementById('providers-list');

        if (providers.length > 0) {
            container.innerHTML = providers.map(p => `
                <img src="https://image.tmdb.org/t/p/original${p.logo_path}" title="${p.provider_name}" class="provider-logo">
            `).join('');
        } else {
            container.innerHTML = "<p class='meta'>Not available to stream currently.</p>";
        }
    } catch (err) { console.error("Providers error:", err); }
}

async function setupRater() {
    const stars = document.querySelectorAll('.star');
    const message = document.getElementById('rating-message');
    const notesArea = document.getElementById('user-notes');
    const dateInput = document.getElementById('watched-date');
    const saveBtn = document.getElementById('save-log-btn');

    // Set default date to today
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // 1. Check if user is logged in
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
        message.textContent = "Sign in to save your ratings!";
        if (saveBtn) saveBtn.disabled = true;
        return;
    }

    // 2. Fetch existing log (Rating + Notes + Date)
    const { data: log } = await supabaseClient
        .from('media_logs')
        .select('rating, notes, watched_on')
        .eq('user_id', user.id)
        .eq('media_id', id)
        .maybeSingle();

    if (log) {
        if (log.rating) updateStars(log.rating);
        if (log.notes) notesArea.value = log.notes;
        if (log.watched_on) dateInput.value = log.watched_on;
    }

    // 3. Handle Star Clicks (Visual only, saves on button click)
    stars.forEach(star => {
        star.onclick = () => {
            const val = parseInt(star.getAttribute('data-value'));
            updateStars(val);
        };
    });

    // 4. The Save Button Logic
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const currentRating = document.querySelectorAll('.star.active').length;
            const currentNotes = notesArea.value;
            const selectedDate = dateInput.value;

            const { error } = await supabaseClient
                .from('media_logs')
                .upsert({ 
                    user_id: user.id, 
                    media_id: id, 
                    media_type: type, 
                    rating: currentRating,
                    notes: currentNotes,
                    watched_on: selectedDate
                }, { onConflict: 'user_id, media_id, media_type' });

            if (error) {
                console.error("Supabase Save Error:", error.message);
                alert("Error saving: " + error.message);
            } else {
                message.textContent = "Log saved successfully!";
                alert("Log saved successfully!");
            }
            if (!error) {
                alert("Journal entry updated!");
                deleteBtn.style.display = 'inline-block'; // Show it now that data exists
            }
        };
    }

    const deleteBtn = document.getElementById('delete-log-btn');

    // Existing check: only show delete if a log actually exists
    if (!log) {
        deleteBtn.style.display = 'none';
    }

    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            // Double-check with the user
            const confirmDelete = confirm("Are you sure you want to delete this log? This cannot be undone.");
            
            if (confirmDelete) {
                const { error } = await supabaseClient
                    .from('media_logs')
                    .delete()
                    .eq('user_id', user.id)
                    .eq('media_id', id)
                    .eq('media_type', type);

                if (error) {
                    console.error("Delete Error:", error.message);
                    alert("Error deleting: " + error.message);
                } else {
                    alert("Entry deleted.");
                    // Reset the UI to its original state
                    notesArea.value = '';
                    updateStars(0);
                    dateInput.value = new Date().toISOString().split('T')[0];
                    deleteBtn.style.display = 'none';
                    document.getElementById('rating-message').textContent = "Tap a star to rate";
                }
            }
        };
    }
}

function updateStars(rating) {
    document.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('active', parseInt(s.getAttribute('data-value')) <= rating);
    });
}

initDetails();