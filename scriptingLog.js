const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');
let supabaseClient, tmdbToken;
let currentMediaRuntime = 0;

async function initLog() {
    const config = await fetch('config.json').then(r => r.json());
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    tmdbToken = config.tmdb_token;

    const dateInput = document.getElementById('watched-date');
    if (dateInput) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    // Load basic info and runtime
    if (type !== 'book') {
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        document.getElementById('media-title').textContent = res.title || res.name;

        // Fetch runtime based on media type
        if (type === 'movie') {
            currentMediaRuntime = res.runtime || 0;
        } else if (type === 'tv') {
            // Use the first episode runtime or default to 30 mins
            currentMediaRuntime = (res.episode_run_time && res.episode_run_time[0]) || 30;
            setupDropdowns(res.seasons);
        }
    } else {
        // Books logic: set runtime to 0 or leave it out
        const res = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json());
        document.getElementById('media-title').textContent = res.title;
        document.getElementById('log-scope').style.display = 'none';
        currentMediaRuntime = 0;
    }

    setupStars();
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
    document.querySelectorAll('.star').forEach(star => {
        star.onclick = () => {
            const val = star.dataset.value;
            document.querySelectorAll('.star').forEach(s => s.classList.toggle('active', s.dataset.value <= val));
        };
    });
}

async function saveLog() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in.");

    const scope = document.getElementById('log-scope').value;
    const userNotes = document.getElementById('user-notes').value;
    const watchedDate = document.getElementById('watched-date').value;
    const rating = document.querySelectorAll('.star.active').length;

    try {
        if (scope === 'entire' && type === 'tv') {
            // 1. Fetch the full series data to get all seasons
            const res = await fetch(`https://api.themoviedb.org/3/tv/${id}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            const seasons = res.seasons.filter(s => s.season_number > 0); // Ignore Specials
            const lastSeason = seasons[seasons.length - 1].season_number;
            const footer = `\n\n[REVIEWED AS WHOLE SERIES FOR SEASON(S) 1-${lastSeason}]`;

            // 2. Loop and log each season individually
            for (const s of seasons) {
                await supabaseClient.from('media_logs').upsert({
                    user_id: user.id,
                    media_id: id,
                    media_type: type,
                    rating: rating,
                    notes: userNotes + footer,
                    watched_on: watchedDate,
                    season_number: s.season_number,
                    episode_number: null,
                    runtime: (res.episode_run_time[0] || 30) * s.episode_count, // Total time for the season
                    ep_count_in_season: s.episode_count // Accurate episode counting
                }, { onConflict: 'user_id,media_id,media_type,season_number,episode_number' });
            }
            alert("Entire series logged by season!");

        } else if (scope === 'season') {
            // Log a single specific season with its episode count
            const sNum = document.getElementById('season-select').value;
            const sRes = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${sNum}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            await supabaseClient.from('media_logs').upsert({
                user_id: user.id,
                media_id: id,
                media_type: type,
                rating: rating,
                notes: userNotes,
                watched_on: watchedDate,
                season_number: parseInt(sNum),
                episode_number: null,
                runtime: currentMediaRuntime * sRes.episodes.length,
                ep_count_in_season: sRes.episodes.length
            }, { onConflict: 'user_id,media_id,media_type,season_number,episode_number' });
            alert("Season logged!");

        } else {
            // Standard Episode or Movie/Book log
            const logData = {
                user_id: user.id,
                media_id: id,
                media_type: type,
                rating: rating,
                notes: userNotes,
                watched_on: watchedDate,
                season_number: scope === 'episode' ? parseInt(document.getElementById('season-select').value) : null,
                episode_number: scope === 'episode' ? parseInt(document.getElementById('episode-select').value) : null,
                runtime: currentMediaRuntime,
                ep_count_in_season: 0
            };
            await supabaseClient.from('media_logs').upsert(logData, {
                onConflict: 'user_id,media_id,media_type,season_number,episode_number'
            });
            alert("Log saved!");
        }
        window.location.href = `details.html?id=${id}&type=${type}`;
    } catch (err) {
        console.error(err);
        alert("Error saving log.");
    }
}

initLog();