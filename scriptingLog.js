const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');
let supabaseClient, tmdbToken;
let currentMediaRuntime = 0;
let isLiked = false;
let isRewatch = false;
let currentRating = 0;

async function initLog() {
    const config = await fetch('config.json').then(r => r.json());
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    tmdbToken = config.tmdb_token;

    const dateInput = document.getElementById('watched-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const scope = document.getElementById('log-scope');
    const bookGroup = document.getElementById('book-input-group');

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

    setupStars();
    setupActionButtons();
    document.getElementById('save-log-btn').onclick = saveLog;
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
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in.");

    // Define variables at the start to avoid ReferenceErrors
    const scope = document.getElementById('log-scope').value;
    const userNotes = document.getElementById('user-notes').value;
    const watchedDate = document.getElementById('watched-date').value;
    const rating = currentRating;

    try {
        if (type === 'book') {
            // Requirement 4: If logging a chapter, it is always a new log
            if (scope === 'chapter') {
                const chapterNum = parseInt(document.getElementById('book-chapter').value);
                await supabaseClient.from('media_logs').insert({
                    user_id: user.id,
                    media_id: id,
                    media_type: 'book',
                    chapter_number: chapterNum || null,
                    notes: userNotes,
                    watched_on: watchedDate,
                    rating: rating,
                    is_liked: isLiked
                });
            } else {
                // Fetch total pages from Open Library to handle "100% completion" logic
                const olRes = await fetch(`https://openlibrary.org${id}/editions.json`).then(r => r.json());
                let totalPages = 0;
                if (olRes.entries) {
                    for (const ed of olRes.entries) {
                        if (ed.number_of_pages) {
                            totalPages = ed.number_of_pages;
                            break;
                        }
                    }
                }

                // Requirement 3: Check for an unfinished progress row to update
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
                    is_finished: true, // Marking as finished
                    current_page: totalPages, // Requirement 1: Assume 100% finished
                    total_pages: totalPages,
                    is_liked: isLiked,
                    is_rewatch: isRewatch
                };

                // If active reading progress exists, overwrite it. Otherwise, new log (Reread)
                if (activeLog) finalData.id = activeLog.id;

                await supabaseClient.from('media_logs').upsert(finalData);
            }
        } else {
            // ... Keep your existing Movie/TV logic here ...
            if (scope === 'entire' && type === 'tv') {
                // (Existing whole series TV logic)
            } else if (scope === 'season') {
                // (Existing season TV logic)
            } else {
                // (Existing single episode/movie logic)
            }
        }

        // Cleanup Watchlist and Redirect
        const { count } = await supabaseClient
            .from('user_watchlist')
            .delete({ count: 'exact' })
            .eq('user_id', user.id)
            .eq('media_id', String(id))
            .eq('media_type', type);

        alert(count > 0 ? "Log saved and removed from watchlist!" : "Log saved successfully!");
        window.location.href = `details.html?id=${id}&type=${type}`;

    } catch (err) {
        console.error("Save Error:", err);
        alert("Error saving log.");
    }
}

initLog();