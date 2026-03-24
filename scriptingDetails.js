const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');
let supabaseClient = null;

async function initDetails() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

        const tmdbOptions = { 
            headers: { Authorization: `Bearer ${config.tmdb_token}` } 
        };

        let data;
        if (type === 'book') {
            // 1. Fetch the general Work data
            const res = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json());
            
            // 2. Fetch the list of Editions to find an ISBN
            const editionsRes = await fetch(`https://openlibrary.org${id}/editions.json`).then(r => r.json());
            
            // 3. Loop through editions to grab the first available ISBN
            let foundIsbn = null;
            if (editionsRes.entries) {
                for (const edition of editionsRes.entries) {
                    const isbn13 = edition.isbn_13?.[0];
                    const isbn10 = edition.isbn_10?.[0];
                    if (isbn13 || isbn10) {
                        foundIsbn = isbn13 || isbn10;
                        break; 
                    }
                }
            }

            data = {
                title: res.title,
                overview: res.description?.value || res.description || "No description.",
                poster_path: res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-L.jpg` : null,
                meta: `Published: ${res.first_publish_date || 'Unknown'}`,
                isbn: foundIsbn // Pass this to your display function
            };

            let pageCount = null;
            if (editionsRes.entries) {
                for (const edition of editionsRes.entries) {
                    pageCount = pageCount || edition.number_of_pages;
                    if (pageCount) break; 
                }
            }
            data.pages = pageCount;

            // After the UI Injection section in initDetails
            if (type === 'book') {
                displayBookLinks(data.isbn);
                setupBookTracker(data.pages);
            }
        } else {
            const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, tmdbOptions).then(r => r.json());
            data = {
                title: res.title || res.name,
                overview: res.overview,
                poster_path: `https://image.tmdb.org/t/p/w500${res.poster_path}`,
                backdrop: res.backdrop_path ? `https://image.tmdb.org/t/p/original${res.backdrop_path}` : null,
                meta: `${(res.release_date || res.first_air_date || '').split('-')[0]} • ${res.genres?.map(g => g.name).join(', ')}`
            };
        }

        // UI Injection
        document.getElementById('media-title').textContent = data.title;
        document.getElementById('media-overview').textContent = data.overview;
        document.getElementById('media-meta').textContent = data.meta;
        document.getElementById('poster-area').innerHTML = `<img src="${data.poster_path}" alt="poster">`;
        if (data.backdrop) document.getElementById('backdrop-overlay').style.backgroundImage = `url(${data.backdrop})`;

        // Navigation to Log Page
        document.getElementById('go-to-log').onclick = () => {
            window.location.href = `log.html?id=${id}&type=${type}`;
        };

        if (type === 'tv') setupTVTracker(config, id);
        setupHeader();

        if (type === 'book') {
            displayBookLinks(data.isbn);
        } else {
            fetchWatchProviders(config);
        }

        if (type !== 'book') {
            fetchCredits(config, id, type);
        }

        fetchMediaHistory();
        setupWatchlist(id, type);
        setupListManager(id, type);
    } catch (err) { console.error(err); }
}

async function fetchCredits(config, mediaId, mediaType) {
    const castList = document.getElementById('cast-list');
    const url = `https://api.themoviedb.org/3/${mediaType}/${mediaId}/credits`;
    
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.tmdb_token}` }
        }).then(r => r.json());

        // 1. Find the Director (or Showrunner/Exec Producer for TV)
        const director = res.crew.find(person => 
            person.job === 'Director' || 
            person.job === 'Executive Producer' && mediaType === 'tv'
        );
        
        // 2. Take top cast members
        const topCast = res.cast.slice(0, 11);

        // 3. Assemble the final list with Director at the start
        let finalDisplayList = [];
        
        if (director) {
            finalDisplayList.push({
                id: director.id,
                name: director.name,
                character: director.job, // Will display as "Director"
                profile_path: director.profile_path,
                isDirector: true
            });
        }
        
        // Add the rest of the cast
        topCast.forEach(actor => finalDisplayList.push(actor));

        // 4. Render to UI
        castList.innerHTML = finalDisplayList.map(person => `
            <div class="cast-card ${person.isDirector ? 'director-highlight' : ''}" 
                 onclick="window.location.href='cast.html?personId=${person.id}'">
                <img src="${person.profile_path ? 'https://image.tmdb.org/t/p/w185' + person.profile_path : 'https://via.placeholder.com/185x278?text=No+Photo'}" alt="${person.name}">
                <div class="cast-info">
                    <span class="cast-name">${person.name}</span>
                    <span class="cast-role">${person.character || 'Cast'} ${person.isDirector ? '🎬' : ''}</span>
                </div>
            </div>
        `).join('');

    } catch (err) { 
        console.error("Credits error:", err); 
    }
}

function setupBookTracker(totalPages) {
    const trackerSection = document.getElementById('tv-tracker');
    const list = document.getElementById('episode-list');
    
    trackerSection.style.display = 'block';
    trackerSection.querySelector('h3').textContent = "Reading Progress";
    
    const controls = document.querySelector('.tracker-controls');
    if (controls) controls.style.display = 'none';

    list.style.display = 'block'; 
    
    if (!totalPages) {
        list.innerHTML = `<p class="meta">Page count not available. Please log manually.</p>`;
        return;
    }

    // Injected UI with Input Field for direct marking
    list.innerHTML = `
        <div class="book-progress-container">
            <div class="quick-update-row">
                <input type="number" id="quick-page-input" placeholder="Current Page #" min="1" max="${totalPages}">
                <button onclick="updatePageProgress(${totalPages})" class="primary-btn">Update Progress</button>
            </div>
        </div>
    `;
    
    fetchBookProgress(totalPages); 
}

async function updatePageProgress(totalPages) {
    const input = document.getElementById('quick-page-input');
    const newPage = parseInt(input.value);

    // Requirement: Block 100% completion in quick tracker
    if (newPage >= totalPages) {
        alert("To mark a book as finished, please use the 'Log or Review' button to rate and review your experience.");
        input.value = '';
        return;
    }

    if (!newPage || newPage < 1) {
        return alert(`Enter a page between 1 and ${totalPages - 1}`);
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in.");

    const { data: activeLog } = await supabaseClient
        .from('media_logs')
        .select('id')
        .eq('user_id', user.id)
        .eq('media_id', id)
        .eq('is_finished', false)
        .maybeSingle();

    const logData = {
        user_id: user.id,
        media_id: id,
        media_type: 'book',
        current_page: newPage,
        total_pages: totalPages,
        is_finished: false, // Always false from this quick update
        watched_on: new Date().toISOString().split('T')[0]
    };

    if (activeLog) logData.id = activeLog.id;

    const { error } = await supabaseClient.from('media_logs').upsert(logData);

    if (!error) {
        input.value = '';
        fetchBookProgress(totalPages);
        fetchMediaHistory();
    }
}

async function fetchBookProgress(totalPages) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user || !totalPages) return;

    // Only show progress for the ACTIVE (unfinished) log
    const { data: logs } = await supabaseClient
        .from('media_logs')
        .select('current_page')
        .eq('user_id', user.id)
        .eq('media_id', id)
        .eq('is_finished', false)
        .order('created_at', { ascending: false })
        .limit(1);

    if (logs && logs.length > 0) {
        const currentPage = logs[0].current_page;
        updateUnifiedProgress(currentPage, totalPages, "pages read");
    } else {
        updateUnifiedProgress(0, totalPages, "pages read");
    }
}

function displayBookLinks(isbn) {
    const providerSection = document.getElementById('watch-providers');
    const list = document.getElementById('providers-list');
    
    // Update heading for books
    providerSection.querySelector('h4').textContent = "Get this Book";

    if (!isbn) {
        list.innerHTML = "<p class='meta'>No ISBN available for library/store links.</p>";
        return;
    }

    // Define the logos you provided
    const logos = {
        worldcat: "https://search.worldcat.org/favicons/android-chrome-192x192.png",
        bwb: "https://www.betterworldbooks.com/images/logos/favicon.ico",
        amazon: "https://www.amazon.com/favicon.ico"
    };

    list.innerHTML = `
        <div class="provider-group">
            <span class="provider-type-label">Check nearby libraries</span>
            <div class="book-link-list">
                <a href="https://www.worldcat.org/isbn/${isbn}" target="_blank" class="book-external-link">
                    <img src="${logos.worldcat}" alt="WorldCat"> <span>WorldCat</span>
                </a>
            </div>
        </div>
        <div class="provider-group">
            <span class="provider-type-label">Buy this book</span>
            <div class="book-link-list">
                <a href="https://www.betterworldbooks.com/search/results?q=${isbn}" target="_blank" class="book-external-link">
                    <img src="${logos.bwb}" alt="Better World Books"> <span>Better World Books</span>
                </a>
                <a href="https://www.amazon.com/s?k=${isbn}" target="_blank" class="book-external-link">
                    <img src="${logos.amazon}" alt="Amazon"> <span>Amazon</span>
                </a>
            </div>
        </div>
    `;
}

async function setupHeader() {
    const searchInput = document.getElementById('search-input');
    const loginBtn = document.getElementById('login-btn');
    const profileBtn = document.getElementById('profile-btn');

    // 1. Handle Search (Redirect to index with query)
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim() !== "") {
            // Redirect to index.html and pass the search term as a URL parameter
            window.location.href = `index.html?search=${encodeURIComponent(searchInput.value)}`;
        }
    });

    // 2. Handle Auth State (Sign In / Sign Out)
    const { data: { user } } = await supabaseClient.auth.getUser();
    
    if (user) {
        loginBtn.textContent = "Sign Out";
        loginBtn.onclick = async () => {
            await supabaseClient.auth.signOut();
            location.reload();
        };
        if (profileBtn) profileBtn.style.display = 'inline-block';
    } else {
        loginBtn.textContent = "Sign In";
        // Since the auth modal is on index.html, we redirect to sign in
        loginBtn.onclick = () => window.location.href = 'index.html'; 
        if (profileBtn) profileBtn.style.display = 'none';
    }
}

async function setupTVTracker(config, seriesId) {
    if (type !== 'tv') return;
    
    const trackerSection = document.getElementById('tv-tracker');
    trackerSection.style.display = 'block';
    
    const seasonSelector = document.getElementById('season-selector');
    const markBtn = document.getElementById('mark-season-btn'); // Get the button
    const clearBtn = document.getElementById('clear-season-btn'); // Get the clear button
    
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

    markBtn.onclick = () => markSeasonAsWatched();
    clearBtn.onclick = () => clearSeasonProgress();

    seasonSelector.onchange = () => loadEpisodes(config, seriesId, seasonSelector.value);
    loadEpisodes(config, seriesId, res.seasons[0].season_number);
}

async function fetchMediaHistory() {
    const historyList = document.getElementById('history-list');
    const { data: { user } } = await supabaseClient.auth.getUser();
    
    if (!user) {
        historyList.innerHTML = "<p class='meta'>Sign in to see history.</p>";
        return;
    }

    const { data: logs, error } = await supabaseClient
        .from('media_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('media_id', id)
        .order('watched_on', { ascending: false })
        .order('created_at', { ascending: false });

    if (error || !logs || logs.length === 0) {
        historyList.innerHTML = "<p class='meta'>No logs yet.</p>";
        return;
    }

    historyList.innerHTML = logs.map(log => {
        // Fix: Define the label based on media type and scope
        let displayLabel = type.charAt(0).toUpperCase() + type.slice(1); // e.g., "Movie"
        
        if (type === 'tv') {
            if (log.episode_number) {
                displayLabel = `S${log.season_number} E${log.episode_number}`;
            } else if (log.season_number) {
                displayLabel = `Season ${log.season_number}`;
            } else {
                displayLabel = `Entire Series`;
            }
        }

        // Calculate stars
        const fullStars = '★'.repeat(Math.floor(log.rating));
        const halfStar = (log.rating % 1 !== 0) ? '½' : '';
        
        // Icons for Like and Rewatch
        const likeIcon = log.is_liked ? ' <span style="color:#ff4d4d">❤</span>' : '';
        const rewatchIcon = log.is_rewatch ? ' <span style="color:#00e054; font-size: 0.7rem;">(Rewatch)</span>' : '';

        return `
            <div class="history-item" id="log-${log.id}">
                <div class="history-header">
                    <span class="history-label">${displayLabel}${likeIcon}</span>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <span class="history-stars">${fullStars}${halfStar}</span>
                        <span onclick="window.location.href='log.html?id=${id}&type=${type}&logId=${log.id}'" 
                            style="cursor:pointer; color:var(--accent); font-size:0.9rem;">✏️</span>
                        <span class="delete-icon" onclick="deleteLog('${log.id}')" 
                            style="cursor:pointer; color:#ff4d4d; font-size:0.9rem;">🗑️</span>
                    </div>
                </div>
                <div class="history-date">${log.watched_on} ${rewatchIcon}</div>
                ${log.notes ? `<p class="history-notes">"${log.notes}"</p>` : ''}
            </div>
        `;
    }).join('');
}

async function loadEpisodes(config, seriesId, seasonNum) {
    const list = document.getElementById('episode-list');
    list.innerHTML = 'Loading episodes...';

    try {
        const res = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNum}`, {
            headers: { Authorization: `Bearer ${config.tmdb_token}` }
        }).then(r => r.json());

        const { data: { user } } = await supabaseClient.auth.getUser();
        let watchedSet = new Set();
        let isSeasonReviewed = false;

        if (user) {
            // 1. Check if the WHOLE SEASON has been reviewed
            const { data: seasonReview } = await supabaseClient
                .from('media_logs')
                .select('id')
                .eq('user_id', user.id)
                .eq('media_id', seriesId)
                .eq('season_number', seasonNum)
                .is('episode_number', null)
                .maybeSingle();

            isSeasonReviewed = !!seasonReview;

            // 2. Get specific episode checkmarks
            const { data: watched } = await supabaseClient
                .from('episode_logs')
                .select('episode_number')
                .eq('series_id', seriesId)
                .eq('season_number', seasonNum)
                .eq('user_id', user.id);

            if (watched) watchedSet = new Set(watched.map(w => w.episode_number));

            // 3. Get specific episode REVIEWS
            const { data: reviewedEps } = await supabaseClient
                .from('media_logs')
                .select('episode_number')
                .eq('user_id', user.id)
                .eq('media_id', seriesId)
                .eq('season_number', seasonNum)
                .not('episode_number', 'is', null);

            if (reviewedEps) {
                reviewedEps.forEach(r => watchedSet.add(r.episode_number));
            }
        }

        const totalEpisodes = res.episodes.length;
        // If the whole season is reviewed, watchedCount = totalEpisodes
        const watchedCount = isSeasonReviewed ? totalEpisodes : watchedSet.size;
        const percentage = Math.round((watchedCount / totalEpisodes) * 100);

        list.innerHTML = res.episodes.map(ep => {
            // Check if this specific episode is reviewed or marked
            const isWatched = isSeasonReviewed || watchedSet.has(ep.episode_number);
            return `
            <div class="episode-item">
                <input type="checkbox" id="ep-${ep.episode_number}" 
                    ${isWatched ? 'checked' : ''} 
                    ${isSeasonReviewed ? 'disabled' : ''} 
                    onclick="toggleEpisode('${seriesId}', ${seasonNum}, ${ep.episode_number})">
                <label for="ep-${ep.episode_number}">E${ep.episode_number}: ${ep.name}</label>
            </div>
        `}).join('');

        updateUnifiedProgress(watchedCount, totalEpisodes, "episodes watched");

    } catch (err) {
        console.error("Error loading episodes:", err);
        list.innerHTML = "Error loading episodes.";
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
    const seasonNum = parseInt(document.getElementById('season-selector').value);
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) return alert("Please sign in to log progress.");

    // Fetch episodes for the selected season
    const configRes = await fetch('config.json');
    const config = await configRes.json();
    const res = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNum}`, {
        headers: { Authorization: `Bearer ${config.tmdb_token}` }
    }).then(r => r.json());

    // CRITICAL: Ensure series_id is a String and numbers are Integers
    const logs = res.episodes.map(ep => ({
        user_id: user.id,
        series_id: String(id), // Convert to String for DB text columns
        season_number: seasonNum,
        episode_number: ep.episode_number
    }));

    const { error } = await supabaseClient
        .from('episode_logs')
        .upsert(logs, { onConflict: 'user_id,series_id,season_number,episode_number' });

    if (error) {
        console.error("Upsert Error:", error);
        alert("Database Error: " + error.message);
    } else {
        // Refresh UI
        refreshProgressBar(id, seasonNum);
        // Re-check the boxes visually
        document.querySelectorAll('.episode-item input[type="checkbox"]').forEach(cb => cb.checked = true);
        alert(`Season ${seasonNum} marked as watched!`);
    }
}

async function refreshProgressBar(seriesId, seasonNum) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const totalEpisodes = document.querySelectorAll('.episode-item').length;

    // Check how many episodes are marked in episode_logs
    const { data: watched, error } = await supabaseClient
        .from('episode_logs')
        .select('episode_number')
        .eq('series_id', String(seriesId))
        .eq('season_number', parseInt(seasonNum))
        .eq('user_id', user.id);

    if (error) return console.error(error);

    const count = watched ? watched.length : 0;
    const percent = totalEpisodes > 0 ? Math.round((count / totalEpisodes) * 100) : 0;
    
    updateUnifiedProgress(count, totalEpisodes, "episodes watched");
}

// Helper function to keep code clean
function updateUnifiedProgress(current, total, unitLabel) {
    const barFill = document.getElementById('main-progress-fill');
    const statsText = document.getElementById('progress-stats-text');
    
    const percent = total > 0 ? Math.min(Math.round((current / total) * 100), 100) : 0;
    
    if (barFill) barFill.style.width = `${percent}%`;
    if (statsText) {
        statsText.textContent = `${current} / ${total} ${unitLabel} (${percent}%)`;
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
    if (type === 'book') return; 

    const url = `https://api.themoviedb.org/3/${type}/${id}/watch/providers`;
    const options = { 
        method: 'GET', 
        headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
    };

    try {
        const res = await fetch(url, options).then(r => r.json());
        const results = res.results?.US || {};
        
        const streaming = results.flatrate || [];
        const buying = results.buy || [];
        
        const container = document.getElementById('providers-list');
        container.innerHTML = ''; // Clear existing

        let html = '';

        // Handle Streaming Section
        if (streaming.length > 0) {
            // ... inside fetchWatchProviders loop ...
            html += `
                <div class="provider-group">
                    <span class="provider-type-label">Stream</span>
                    <div class="provider-icons">
                        ${streaming.map(p => `
                            <img src="https://image.tmdb.org/t/p/original${p.logo_path}" title="${p.provider_name}" class="provider-logo">
                        `).join('')}
                    </div>
                </div>`;
        }

        // Handle Buying Section
        if (buying.length > 0) {
            html += `<div class="provider-group">
                        <span class="provider-type-label">Buy</span>
                        <div class="provider-icons">
                            ${buying.map(p => `
                                <img src="https://image.tmdb.org/t/p/original${p.logo_path}" title="${p.provider_name}" class="provider-logo">
                            `).join('')}
                        </div>
                     </div>`;
        }

        if (html === '') {
            container.innerHTML = "<p class='meta'>Not available to stream or buy currently.</p>";
        } else {
            container.innerHTML = html;
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

async function setupWatchlist(mediaId, mediaType) {
    const watchlistBtn = document.getElementById('watchlist-btn');
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
        watchlistBtn.style.display = 'none';
        return;
    }

    // 1. Check if it's already in the new watchlist table
    const { data: existing } = await supabaseClient
        .from('user_watchlist')
        .select('id')
        .eq('user_id', user.id)
        .eq('media_id', String(mediaId))
        .eq('media_type', mediaType)
        .maybeSingle();

    if (existing) {
        watchlistBtn.classList.add('active');
        watchlistBtn.textContent = 'On Watchlist';
    }

    watchlistBtn.onclick = async () => {
        const isActive = watchlistBtn.classList.contains('active');
        
        if (!isActive) {
            // ADD to watchlist
            const { error } = await supabaseClient
                .from('user_watchlist')
                .insert({
                    user_id: user.id,
                    media_id: String(mediaId),
                    media_type: mediaType
                });

            if (!error) {
                watchlistBtn.classList.add('active');
                watchlistBtn.textContent = 'On Watchlist';
            }
        } else {
            // REMOVE from watchlist
            const { error } = await supabaseClient
                .from('user_watchlist')
                .delete()
                .eq('user_id', user.id)
                .eq('media_id', String(mediaId))
                .eq('media_type', mediaType);

            if (!error) {
                watchlistBtn.classList.remove('active');
                watchlistBtn.textContent = 'Add to Watchlist';
            }
        }
    };
}

window.deleteLog = async (logId) => {
    if (!confirm("Delete this log entry permanently?")) return;

    const { error } = await supabaseClient
        .from('media_logs')
        .delete()
        .eq('id', logId);

    if (error) {
        alert("Error deleting log: " + error.message);
    } else {
        // Remove from UI immediately
        document.getElementById(`log-${logId}`)?.remove();
        // Optional: refresh history to show "No logs yet" if empty
        fetchMediaHistory();
    }
};

async function setupListManager(mediaId, mediaType) {
    const addBtn = document.getElementById('add-to-list-btn');
    const modal = document.getElementById('list-modal');
    const closeBtn = document.getElementById('close-list-modal');
    const listContainer = document.getElementById('user-lists-selection');
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        addBtn.style.display = 'none';
        return;
    }

    addBtn.onclick = async () => {
        modal.style.display = 'flex';
        listContainer.innerHTML = '<p class="meta">Loading lists...</p>';
        
        // Fetch all of user's lists
        const { data: lists } = await supabaseClient
            .from('media_lists')
            .select('id, name');

        // Check which lists already contain this item
        const { data: existingEntries } = await supabaseClient
            .from('list_items')
            .select('list_id')
            .eq('media_id', String(mediaId));

        const existingListIds = new Set(existingEntries.map(e => e.list_id));

        if (lists.length === 0) {
            listContainer.innerHTML = '<p class="meta">No lists found. Create one in your profile!</p>';
            return;
        }

        listContainer.innerHTML = lists.map(list => {
            const isAdded = existingListIds.has(list.id);
            return `
                <div class="list-select-item">
                    <span>${list.name}</span>
                    <button class="${isAdded ? 'danger-btn' : 'primary-btn'}" 
                            onclick="toggleListItem('${list.id}', '${mediaId}', '${mediaType}', ${isAdded})">
                        ${isAdded ? 'Remove' : 'Add'}
                    </button>
                </div>
            `;
        }).join('');
    };

    closeBtn.onclick = () => modal.style.display = 'none';
}

// Helper to add/remove items
window.toggleListItem = async (listId, mediaId, mediaType, isCurrentlyAdded) => {
    try {
        if (isCurrentlyAdded) {
            await supabaseClient.from('list_items')
                .delete()
                .eq('list_id', listId)
                .eq('media_id', String(mediaId));
        } else {
            await supabaseClient.from('list_items')
                .insert({
                    list_id: listId, 
                    media_id: String(mediaId), 
                    media_type: mediaType
                });
        }
        
        // Instead of triggering a click (which can be glitchy), 
        // just call the refresh part of the setup function
        const addBtn = document.getElementById('add-to-list-btn');
        if (addBtn) {
            // Re-trigger the logic to update the button labels (Add/Remove)
            addBtn.dispatchEvent(new Event('click'));
        }
        
    } catch (err) {
        console.error("Error toggling list item:", err);
    }
};

initDetails();