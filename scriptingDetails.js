const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');

let supabaseClient = null; // To be initialized in initDetails

async function initDetails() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

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
        
        if (type === 'book') {
            document.getElementById('poster-area').innerHTML = `<img src="${data.poster_path}" alt="${data.title}">`;
        } else {
            document.getElementById('poster-area').innerHTML = `<img src="${data.poster_path}" alt="${data.title}">`;
            if (data.backdrop) {
                document.getElementById('backdrop-overlay').style.backgroundImage = `url(${data.backdrop})`;
            }
        }
        
        setupRater();
    } catch (err) { 
        console.error("Initialization error:", err); 
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