import { loadConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';
import { normalizeOpenLibraryId } from './core/media.js';

let supabaseClient, tmdbToken;

const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');
let currentMediaRuntime = 0;
let isLiked = false;
let isRewatch = false;
let currentRating = 0;
const logId = params.get('logId');
let albumTracks = [];
let currentTags = [];
let mediaReleaseYear = null;

async function initLog() {
    const config = await loadConfig();
    supabaseClient = await getSupabaseClient();
    tmdbToken = config.tmdb_token;
    await customElements.whenDefined('app-header');
    await document.querySelector('app-header')?.initializeAuth(supabaseClient);

    const dateInput = document.getElementById('watched-date');
    if (dateInput) {
        const today = new Date();
        // Calculate the timezone offset in milliseconds and subtract it from the current time
        const offset = today.getTimezoneOffset();
        const localDate = new Date(today.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0];
        
        dateInput.value = localDate;
    }

    const scope = document.getElementById('log-scope');
    const bookGroup = document.getElementById('book-input-group');
    const youtubeGroup = document.getElementById('youtube-input-group');
    const trackGroup = document.getElementById('track-input-group');

    const backBtn = document.getElementById('back-to-details-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            const discard = confirm("Are you sure you want to discard this log?\n\nClick 'OK' to discard your changes and go back, or 'Cancel' to finish your log.");
            if (discard) {
                // Routes them back to the exact media they were looking at
                window.location.href = `details.html?id=${id}&type=${type}`;
            }
        };
    }

    if (type === 'book') {
        const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(id)}.json`).then(r => r.json());
        document.getElementById('media-title').textContent = res.title;
        
        // Capture book release year (just grabbing the first 4 characters/digits if it exists)
        mediaReleaseYear = res.first_publish_date ? res.first_publish_date.match(/\d{4}/)?.[0] || null : null;

        // Show banners and specific inputs
        const banner = document.getElementById('stats-warning-banner');
        if (banner) {
            banner.style.display = 'block';
            document.getElementById('stats-warning-text').textContent = "Note: For book stats (Total Books and Pages Read), you must log the Entire Book. Chapter/Progress logs do not count towards overall stats.";
        }
        
        bookGroup.style.display = 'block';
        scope.style.display = 'block'; 
        
        scope.innerHTML = `
            <option value="entire">Entire Book</option>
            <option value="chapter">Specific Chapter</option>
            <option value="progress">Specific Page</option>
        `;
        
        // Add listener to toggle inputs based on selection
        scope.onchange = () => {
            const isChapter = scope.value === 'chapter';
            const isProgress = scope.value === 'progress';
            const isEntire = scope.value === 'entire';
            
            document.getElementById('book-chapter').style.display = isChapter ? 'block' : 'none';
            document.getElementById('book-page').style.display = isProgress ? 'block' : 'none';
            document.getElementById('progress-label').style.display = isProgress || isChapter ? 'block' : 'none';
            document.getElementById('book-entire-group').style.display = isEntire ? 'block' : 'none';
        };
        
        // Trigger onchange once to set initial state
        scope.onchange();
        
        currentMediaRuntime = 0;
    } else if (type === 'youtube') {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`).then(r => r.json());
        document.getElementById('media-title').textContent = res.title || 'YouTube Video';

        mediaReleaseYear = null;
        
        if (youtubeGroup) youtubeGroup.style.display = 'block';
        scope.innerHTML = `<option value="entire">Entire Video</option>`;
        
        currentMediaRuntime = 0;
    } else if (type === 'album') {
        const decodedId = decodeURIComponent(id);
        const [artistName, albumName] = decodedId.split('|||');
        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
        
        document.getElementById('media-title').textContent = res.album.name;

        if (res.album?.wiki?.published) {
            const yearMatch = res.album.wiki.published.match(/\d{4}/);
            if (yearMatch) mediaReleaseYear = yearMatch[0];
        }
        
        // FIX: Force raw track data into an array so .map() doesn't break on singles
        const rawTracks = res.album.tracks?.track;
        albumTracks = rawTracks ? (Array.isArray(rawTracks) ? rawTracks : [rawTracks]) : [];
        
        scope.innerHTML = `
            <option value="entire">Entire Album</option>
            <option value="track">Specific Track</option>
        `;
        
        setupAlbumDropdowns();
    } else {
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        document.getElementById('media-title').textContent = res.title || res.name;
        
        // Capture Movie/TV release year
        mediaReleaseYear = (res.release_date || res.first_air_date || '').split('-')[0] || null;

        bookGroup.style.display = 'none';

        if (type === 'movie') {
            currentMediaRuntime = res.runtime || 0;
            scope.innerHTML = `<option value="entire">Entire Movie</option>`;
        } else if (type === 'tv') {
            const banner = document.getElementById('stats-warning-banner');
            if (banner) {
                banner.style.display = 'block';
                document.getElementById('stats-warning-text').textContent = "Note: For TV show stats (Total Shows, Seasons, and Episodes), you must log the Entire Show. Individual season/episode logs do not count towards the overall series stats count.";
            }

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

    const rewatchBtn = document.getElementById('rewatch-btn');
    if (rewatchBtn) {
        if (type === 'book') rewatchBtn.textContent = "Mark as Reread";
        else if (type === 'album') rewatchBtn.textContent = "Mark as Relisten";
        else rewatchBtn.textContent = "Mark as Rewatch";
    }

    // Only run this check if we are creating a brand new log
    if (!logId) {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
            const { data: previousLog } = await supabaseClient
                .from('media_logs')
                .select('id')
                .eq('user_id', user.id)
                .eq('media_id', id)
                .limit(1);

            if (previousLog && previousLog.length > 0) {
                isRewatch = true;
                if (rewatchBtn) rewatchBtn.classList.add('active');
            }
        }
    }

    setupStars();
    setupTagsInput();
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

        // Fill Notes, Date, & Tags
        document.getElementById('user-notes').value = log.notes || '';
        document.getElementById('watched-date').value = log.watched_on;
        
        currentTags = log.tags || [];
        renderTags();

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

function setupTagsInput() {
    const tagInput = document.getElementById('log-tags-input');
    
    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();

            // This trims whitespace, makes it lowercase, and replaces spaces with hyphens
            const newTag = tagInput.value.trim().toLowerCase().replace(/\s+/g, '-');
            
            if (newTag && !currentTags.includes(newTag)) {
                currentTags.push(newTag);
                tagInput.value = '';
                renderTags();
            } else if (currentTags.includes(newTag)) {
                tagInput.value = ''; 
            }
        }
    });
}

function renderTags() {
    const container = document.getElementById('tags-display-container');
    container.innerHTML = currentTags.map((tag, index) => `
        <span class="tag-pill">
            ${tag} <span class="tag-remove" onclick="removeTag(${index})">×</span>
        </span>
    `).join('');
}

window.removeTag = function(index) {
    currentTags.splice(index, 1);
    renderTags();
};

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
    // 1. Grab the button and disable it immediately to prevent duplicate clicks
    const saveBtn = document.getElementById('save-log-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to Diary';
        return alert("Please sign in.");
    }

    const scopeValue = document.getElementById('log-scope').value;
    const userNotes = document.getElementById('user-notes').value;
    const watchedDate = document.getElementById('watched-date').value;
    const rating = currentRating;
    const mediaTitleStr = document.getElementById('media-title').textContent;
    const parsedTags = currentTags;

    try {
        if (type === 'book') {
            if (scopeValue === 'chapter') {
                const chapterNum = parseInt(document.getElementById('book-chapter').value);
                const payload = {
                    user_id: user.id,
                    media_id: id,
                    media_type: 'book',
                    chapter_number: chapterNum || null,
                    notes: userNotes,
                    tags: parsedTags,
                    watched_on: watchedDate,
                    rating: rating,
                    is_liked: isLiked,
                    release_year: mediaReleaseYear
                };

                if (logId) {
                    payload.id = logId;
                }

                const { error } = await supabaseClient.from('media_logs').upsert(payload);
                if (error) throw error;
            } else {
                const olRes = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(id)}.json`).then(r => r.json());
                let totalPages = olRes.number_of_pages || 0;
                
                // Override with custom pages if user inputted one
                const customPagesInput = document.getElementById('book-custom-pages').value;
                if (customPagesInput && parseInt(customPagesInput) > 0) {
                    totalPages = parseInt(customPagesInput);
                }

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
                    tags: parsedTags,
                    watched_on: watchedDate,
                    is_finished: true, 
                    current_page: totalPages,
                    total_pages: totalPages,
                    is_liked: isLiked,
                    is_rewatch: isRewatch
                };

                if (logId) {
                    finalData.id = logId;
                } else if (activeLog) {
                    finalData.id = activeLog.id;
                }

                const { error } = await supabaseClient.from('media_logs').upsert(finalData);
                if (error) throw error;
            }
        } else {
            let currentScopeValue = document.getElementById('log-scope').value; 
            
            if (type === 'youtube') {
                const ytDuration = document.getElementById('youtube-duration').value;
                currentMediaRuntime = parseInt(ytDuration) || 0;
            }

            const payload = {
                user_id: user.id,
                media_id: id,
                media_type: type,
                media_title: mediaTitleStr,
                rating: rating,
                notes: userNotes,
                tags: parsedTags,
                watched_on: watchedDate,
                is_liked: isLiked,
                is_rewatch: isRewatch,
                runtime: currentMediaRuntime 
            };

            if (type === 'tv') {
                // Trust the user's selected dropdown value entirely
                currentScopeValue = document.getElementById('log-scope').value;
                payload.log_level = currentScopeValue; 

                if (currentScopeValue === 'entire') {
                    // Fetch full TV details to grab total seasons and episodes
                    const tvData = await fetch(`https://api.themoviedb.org/3/tv/${id}`, {
                        headers: { Authorization: `Bearer ${tmdbToken}` }
                    }).then(r => r.json());
                    
                    payload.ep_count_in_season = tvData.number_of_episodes || 0;
                    payload.season_number = tvData.number_of_seasons || 0; 
                    payload.episode_number = null; // Ensure this is clear
                } else if (currentScopeValue === 'season') {
                    const seasonSelect = document.getElementById('season-select');
                    if (seasonSelect && seasonSelect.value) payload.season_number = parseInt(seasonSelect.value);
                    payload.episode_number = null;
                } else if (currentScopeValue === 'episode') {
                    const seasonSelect = document.getElementById('season-select');
                    const episodeSelect = document.getElementById('episode-select');
                    if (seasonSelect && seasonSelect.value) payload.season_number = parseInt(seasonSelect.value);
                    if (episodeSelect && episodeSelect.value) payload.episode_number = parseInt(episodeSelect.value);
                }
            } else if (type === 'album') {
                const trackSelect = document.getElementById('track-select');
                if (logId && trackSelect && document.getElementById('track-input-group').style.display !== 'none') {
                    currentScopeValue = 'track';
                }
                
                if (currentScopeValue === 'track') {
                    payload.episode_number = parseInt(trackSelect.value);
                }
            }

            if (logId) {
                payload.id = logId; 
            }

            try {
                const { error } = await supabaseClient
                    .from('media_logs')
                    .upsert(payload); 

                if (error) throw error;
            } catch (err) {
                alert("Error: " + err.message);
            }
        }
        alert(logId ? "Entry updated!" : "Log saved successfully!");
        window.location.href = `details.html?id=${id}&type=${type}`;
    } catch (err) {
        console.error("Save Error:", err);
        alert("Error saving log: " + err.message);
        
        // Re-enable the button if there was an error so the user can try again
        saveBtn.disabled = false;
        saveBtn.textContent = logId ? "Update Journal Entry" : "Save to Diary";
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