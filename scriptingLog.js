const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');
let supabaseClient, tmdbToken;
let currentMediaRuntime = 0;
let isLiked = false;
let isRewatch = false;
let currentRating = 0;
const logId = params.get('logId');
let albumTracks = [];

async function initLog() {
    const config = await fetch('config.json').then(r => r.json());
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    tmdbToken = config.tmdb_token;

    const dateInput = document.getElementById('watched-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const scope = document.getElementById('log-scope');
    const bookGroup = document.getElementById('book-input-group');
    const youtubeGroup = document.getElementById('youtube-input-group');
    const trackGroup = document.getElementById('track-input-group');

    if (type === 'book') {
        const res = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json());
        document.getElementById('media-title').textContent = res.title;
        
        // Show book inputs
        bookGroup.style.display = 'block';
        scope.style.display = 'block'; 
        
        // Set book-specific options
        scope.innerHTML = `
            <option value="entire">Entire Book (Finished)</option>
            <option value="chapter">Specific Chapter</option>
            <option value="progress">Reading Progress (Page #)</option>
        `;

        // Add listener to toggle inputs based on selection
        scope.onchange = () => {
            const isChapter = scope.value === 'chapter';
            const isProgress = scope.value === 'progress';
            document.getElementById('book-chapter').style.display = isChapter ? 'block' : 'none';
            document.getElementById('book-page').style.display = isProgress ? 'block' : 'none';
        };
        
        currentMediaRuntime = 0;
    } else if (type === 'youtube') {
        // --- NEW YOUTUBE LOGIC ---
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`).then(r => r.json());
        document.getElementById('media-title').textContent = res.title || 'YouTube Video';
        
        if (youtubeGroup) youtubeGroup.style.display = 'block';
        scope.innerHTML = `<option value="entire">Entire Video</option>`;
        
        currentMediaRuntime = 0;
    } else if (type === 'album') {
        // --- NEW ALBUM LOGIC ---
        const decodedId = decodeURIComponent(id);
        const [artistName, albumName] = decodedId.split('|||');
        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
        
        document.getElementById('media-title').textContent = res.album.name;
        albumTracks = res.album.tracks?.track || [];
        
        scope.innerHTML = `
            <option value="entire">Entire Album</option>
            <option value="track">Specific Track</option>
        `;
        
        setupAlbumDropdowns();
    } else {
        // Existing Movie/TV Logic
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        document.getElementById('media-title').textContent = res.title || res.name;
        bookGroup.style.display = 'none';

        if (type === 'movie') {
            currentMediaRuntime = res.runtime || 0;
            scope.innerHTML = `<option value="entire">Entire Movie</option>`;
        } else if (type === 'tv') {
            currentMediaRuntime = (res.episode_run_time && res.episode_run_time[0]) || 30;
            scope.innerHTML = `
                <option value="entire">Entire Series</option>
                <option value="season">Specific Season</option>
                <option value="episode">Specific Episode</option>
            `;
            setupDropdowns(res.seasons);
        }
    }

    if (logId) {
        fetchExistingLogData();
    }

    // --- NEW: DYNAMIC REWATCH BUTTON TEXT ---
    const rewatchBtn = document.getElementById('rewatch-btn');
    if (rewatchBtn) {
        if (type === 'book') rewatchBtn.textContent = "Mark as Reread";
        else if (type === 'album') rewatchBtn.textContent = "Mark as Relisten";
        else rewatchBtn.textContent = "Mark as Rewatch";
    }

    setupStars();
    setupActionButtons();
    document.getElementById('save-log-btn').onclick = saveLog;
}

async function fetchExistingLogData() {
    const { data: log, error } = await supabaseClient
        .from('media_logs')
        .select('*')
        .eq('id', logId)
        .single();

    if (log) {
        // Fill Rating
        currentRating = log.rating;
        updateStarUI();
        document.getElementById('rating-display').textContent = `${currentRating.toFixed(1)} / 5.0`;

        // Fill Notes & Date
        document.getElementById('user-notes').value = log.notes || '';
        document.getElementById('watched-date').value = log.watched_on;

        // Fill Toggles
        isLiked = log.is_liked;
        isRewatch = log.is_rewatch;
        document.getElementById('like-btn').classList.toggle('active', isLiked);
        document.getElementById('rewatch-btn').classList.toggle('active', isRewatch);

        // Fill Scope (Limited for edits to prevent breaking relational data)
        const scope = document.getElementById('log-scope');
        
        if (log.media_type === 'youtube') {
            const ytInput = document.getElementById('youtube-duration');
            if (ytInput) ytInput.value = log.runtime || '';
        } else if (log.media_type === 'album' && log.episode_number) {
            scope.value = 'track';
            document.getElementById('track-input-group').style.display = 'block';
            document.getElementById('track-select').value = log.episode_number;
            currentMediaRuntime = log.runtime || 0;
        } else if (log.episode_number) {
            scope.value = 'episode';
            // Manually trigger visibility of dropdowns
            document.getElementById('dropdown-group').style.display = 'flex';
            document.getElementById('episode-select').style.display = 'block';
            
            // Set values (Note: This assumes the lists are already loaded)
            document.getElementById('season-select').value = log.season_number;
            await loadEpisodeList(); // Wait for episodes to load
            document.getElementById('episode-select').value = log.episode_number;
        } else if (log.season_number) {
            scope.value = 'season';
            document.getElementById('dropdown-group').style.display = 'flex';
            document.getElementById('season-select').value = log.season_number;
        }

        // Change Button Text
        document.getElementById('save-log-btn').textContent = "Update Journal Entry";
    }
}

function setupDropdowns(seasons) {
    const scope = document.getElementById('log-scope');
    const group = document.getElementById('dropdown-group');
    const sSelect = document.getElementById('season-select');
    const eSelect = document.getElementById('episode-select');

    sSelect.innerHTML = seasons.map(s => `<option value="${s.season_number}">${s.name}</option>`).join('');

    scope.onchange = () => {
        group.style.display = scope.value === 'entire' ? 'none' : 'flex';
        eSelect.style.display = scope.value === 'episode' ? 'block' : 'none';
        if (scope.value === 'episode') loadEpisodeList();
    };

    sSelect.onchange = loadEpisodeList;
}

async function loadEpisodeList() {
    const sNum = document.getElementById('season-select').value;
    const eSelect = document.getElementById('episode-select');
    const res = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${sNum}`, {
        headers: { Authorization: `Bearer ${tmdbToken}` }
    }).then(r => r.json());

    eSelect.innerHTML = res.episodes.map(e => `<option value="${e.episode_number}">E${e.episode_number}: ${e.name}</option>`).join('');
}

function setupStars() {
    const stars = document.querySelectorAll('.star');
    const display = document.getElementById('rating-display');

    stars.forEach(star => {
        star.onclick = (e) => {
            const rect = star.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const starValue = parseInt(star.dataset.value);
            
            // Determine if the user is clicking the left or right half
            const isLeftHalf = clickX < rect.width / 2;
            const clickedRating = isLeftHalf ? starValue - 0.5 : starValue;

            // If the user clicks exactly what is already set, we can either 
            // leave it or reset it. Most users expect "Tap 3, then tap 3 again 
            // to get 2.5".
            if (currentRating === starValue && !isLeftHalf) {
                // If 3 is active and you tap the right side of 3 again, drop to 2.5
                currentRating = starValue - 0.5;
            } else {
                currentRating = clickedRating;
            }

            updateStarUI();
            display.textContent = `${currentRating.toFixed(1)} / 5.0`;
        };
    });
}

function updateStarUI() {
    const stars = document.querySelectorAll('.star');
    
    stars.forEach(s => {
        const val = parseInt(s.dataset.value);
        
        // Reset both classes first
        s.classList.remove('active');
        s.classList.remove('half-active');

        if (val <= currentRating) {
            // Full star: rating is equal or higher than star value
            s.classList.add('active');
        } else if (val - 0.5 === currentRating) {
            // Half star: rating is exactly 0.5 less than star value
            s.classList.add('half-active');
        }
    });
}

function setupActionButtons() {
    const likeBtn = document.getElementById('like-btn');
    const watchlistBtn = document.getElementById('watchlist-btn');
    const rewatchBtn = document.getElementById('rewatch-btn');

    likeBtn.onclick = () => {
        isLiked = !isLiked;
        likeBtn.classList.toggle('active', isLiked);
    };

    rewatchBtn.onclick = () => {
        isRewatch = !isRewatch;
        rewatchBtn.classList.toggle('active', isRewatch);
    };
}

async function saveLog() {
    // 1. Check Authentication
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in.");

    // 2. Capture Form Data
    const scopeValue = document.getElementById('log-scope').value;
    const userNotes = document.getElementById('user-notes').value;
    const watchedDate = document.getElementById('watched-date').value;
    const rating = currentRating;

    try {
        if (type === 'book') {
            // --- CORRECTED BOOK LOGIC ---
            if (scopeValue === 'chapter') {
                const chapterNum = parseInt(document.getElementById('book-chapter').value);
                const payload = {
                    user_id: user.id,
                    media_id: id,
                    media_type: 'book',
                    chapter_number: chapterNum || null,
                    notes: userNotes,
                    watched_on: watchedDate,
                    rating: rating,
                    is_liked: isLiked
                };

                // NEW: Check for logId to update existing chapter entry
                if (logId) {
                    payload.id = logId;
                }

                const { error } = await supabaseClient.from('media_logs').upsert(payload);
                if (error) throw error;
            } else {
                // Handle "Entire Book" or "Progress"
                const olRes = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json());
                const totalPages = olRes.number_of_pages || 0;

                const { data: activeLog } = await supabaseClient
                    .from('media_logs')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('media_id', id)
                    .eq('is_finished', false)
                    .maybeSingle();

                const finalData = {
                    user_id: user.id,
                    media_id: id,
                    media_type: 'book',
                    rating: rating,
                    notes: userNotes,
                    watched_on: watchedDate,
                    is_finished: true, 
                    current_page: totalPages,
                    total_pages: totalPages,
                    is_liked: isLiked,
                    is_rewatch: isRewatch
                };

                // Ensure we use the logId from the URL for updates, 
                // otherwise fallback to the active log ID if finishing a draft
                if (logId) {
                    finalData.id = logId;
                } else if (activeLog) {
                    finalData.id = activeLog.id;
                }

                const { error } = await supabaseClient.from('media_logs').upsert(finalData);
                if (error) throw error;
            }
        } else {
            // --- MOVIE & TV LOGIC ---
            let scopeValue = document.getElementById('log-scope').value; 
            
            if (type === 'youtube') {
                const ytDuration = document.getElementById('youtube-duration').value;
                currentMediaRuntime = parseInt(ytDuration) || 0;
            }

            const payload = {
                user_id: user.id,
                media_id: id,
                media_type: type,
                rating: rating,
                notes: userNotes,
                watched_on: watchedDate,
                is_liked: isLiked,
                is_rewatch: isRewatch,
                runtime: currentMediaRuntime 
            };

            // Capture TV-specific details
            if (type === 'tv') {
                const seasonSelect = document.getElementById('season-select');
                const episodeSelect = document.getElementById('episode-select');

                // FIX: If we are editing, force the scope based on the presence of select values
                if (logId) {
                    if (episodeSelect && episodeSelect.value) scopeValue = 'episode';
                    else if (seasonSelect && seasonSelect.value) scopeValue = 'season';
                }

                if (scopeValue === 'season' || scopeValue === 'episode') {
                    if (seasonSelect && seasonSelect.value) {
                        payload.season_number = parseInt(seasonSelect.value);
                    }
                }
                
                if (scopeValue === 'episode') {
                    if (episodeSelect && episodeSelect.value) {
                        payload.episode_number = parseInt(episodeSelect.value);
                    }
                }
            } else if (type === 'album') {
                const trackSelect = document.getElementById('track-select');
                if (logId && trackSelect && document.getElementById('track-input-group').style.display !== 'none') {
                    scopeValue = 'track';
                }
                
                if (scopeValue === 'track') {
                    payload.episode_number = parseInt(trackSelect.value); // Re-use episode_number to store track index
                }
            }

            if (logId) {
                payload.id = logId; 
            }

            try {
                // Use upsert to handle the update correctly using the ID
                const { error } = await supabaseClient
                    .from('media_logs')
                    .upsert(payload); 

                if (error) throw error;
                
                alert(logId ? "Entry updated!" : "Log saved successfully!");
                window.location.href = `details.html?id=${id}&type=${type}`;
            } catch (err) {
                alert("Error: " + err.message);
            }
        }
        } catch (err) {
        console.error("Save Error:", err);
        alert("Error saving log: " + err.message);
    }
}

function setupAlbumDropdowns() {
    const scope = document.getElementById('log-scope');
    const trackGroup = document.getElementById('track-input-group');
    const trackSelect = document.getElementById('track-select');

    // Populate track dropdown
    trackSelect.innerHTML = albumTracks.map((track, index) => {
        const duration = parseInt(track.duration) || 0;
        const mins = Math.floor(duration / 60);
        const secs = (duration % 60).toString().padStart(2, '0');
        return `<option value="${index + 1}">${index + 1}. ${track.name} (${mins}:${secs})</option>`;
    }).join('');

    const updateTotalRuntime = () => {
        const totalSecs = albumTracks.reduce((sum, track) => sum + (parseInt(track.duration) || 0), 0);
        currentMediaRuntime = Math.floor(totalSecs / 60);
    };

    const updateTrackRuntime = () => {
        const selectedTrackIndex = parseInt(trackSelect.value) - 1;
        const trackDuration = parseInt(albumTracks[selectedTrackIndex]?.duration) || 0;
        currentMediaRuntime = Math.floor(trackDuration / 60);
    };

    // Initialize runtime for entire album
    updateTotalRuntime();

    scope.onchange = () => {
        if (scope.value === 'track') {
            trackGroup.style.display = 'block';
            updateTrackRuntime();
        } else {
            trackGroup.style.display = 'none';
            updateTotalRuntime();
        }
    };

    trackSelect.onchange = () => {
        if (scope.value === 'track') updateTrackRuntime();
    };
}

initLog();