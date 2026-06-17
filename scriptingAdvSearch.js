let TMDB_TOKEN = '';
let supabaseClient = null;

// Elements
const durationSection = document.getElementById('duration-section');
const movieDurationWrapper = document.getElementById('movie-duration-wrapper');
const tvDurationWrapper = document.getElementById('tv-duration-wrapper');
const providersContainer = document.getElementById('providers-container');
const genreSearchInput = document.getElementById('genre-search');
const genresSearchResults = document.getElementById('genres-search-results');
const genresSelectedContainer = document.getElementById('genres-selected-container');
const findBtn = document.getElementById('find-matches-btn');
const loadMoreBtn = document.getElementById('load-more-btn');
const resultsGrid = document.getElementById('results-grid');
const loader = document.getElementById('adv-search-loader');

// Active Selections
let activeTypes = new Set(['movie']); // Default to movie
let activeMovieDurations = new Set();
let activeTvDurations = new Set();
let activeProviders = new Set();
let activeKeywords = new Map();
let activeCoreGenres = new Set();
let allCoreGenres = [];

// Global Data & Pagination
let allProviders = [];
let searchTimeout = null;
let currentPage = 1;

async function initAdvSearch() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        TMDB_TOKEN = config.tmdb_token;
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

        await setupHeader();
        await fetchTopProviders();
        await fetchCoreGenres();

        genreSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchTimeout);
            
            if (query === '') {
                genresSearchResults.style.display = 'none';
                return;
            }
            searchTimeout = setTimeout(() => fetchKeywordResults(query), 300);
        });

        // Search Execution Listeners
        findBtn.addEventListener('click', () => executeSearch(false));
        loadMoreBtn.addEventListener('click', () => executeSearch(true));

    } catch (err) {
        console.error("Initialization Error:", err);
    }
}

// ----------------------------------------
// Data Fetching & UI Rendering
// ----------------------------------------

async function fetchTopProviders() {
    try {
        const [movieProvRes, tvProvRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/watch/providers/movie?language=en-US&watch_region=US`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json()),
            fetch(`https://api.themoviedb.org/3/watch/providers/tv?language=en-US&watch_region=US`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json())
        ]);

        const providerMap = new Map();
        [...(movieProvRes.results || []), ...(tvProvRes.results || [])].forEach(p => {
            if (!providerMap.has(p.provider_id)) providerMap.set(p.provider_id, p);
        });
        
        allProviders = Array.from(providerMap.values())
            .sort((a, b) => a.display_priorities.US - b.display_priorities.US)
            .slice(0, 25);

        providersContainer.innerHTML = allProviders.map(p => `
            <div class="pill" data-id="${p.provider_id}" onclick="togglePill(this, 'provider')">
                <img src="https://image.tmdb.org/t/p/w45${p.logo_path}" class="pill-logo">
                ${p.provider_name}
            </div>
        `).join('');

    } catch (e) {
        providersContainer.innerHTML = '<p class="meta">Failed to load providers.</p>';
    }
}

async function fetchCoreGenres() {
    try {
        const [movieGenRes, tvGenRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/genre/movie/list?language=en-US`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json()),
            fetch(`https://api.themoviedb.org/3/genre/tv/list?language=en-US`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json())
        ]);

        // Merge and deduplicate the core genres
        const genreMap = new Map();
        [...(movieGenRes.genres || []), ...(tvGenRes.genres || [])].forEach(g => {
            if (!genreMap.has(g.id)) genreMap.set(g.id, g);
        });
        
        // Sort alphabetically so it's easy to read
        allCoreGenres = Array.from(genreMap.values()).sort((a, b) => a.name.localeCompare(b.name));

        document.getElementById('core-genres-container').innerHTML = allCoreGenres.map(g => `
            <div class="pill" data-id="${g.id}" onclick="togglePill(this, 'core-genre')">
                ${g.name}
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('core-genres-container').innerHTML = '<p class="meta">Failed to load genres.</p>';
    }
}

async function fetchKeywordResults(query) {
    try {
        const res = await fetch(`https://api.themoviedb.org/3/search/keyword?query=${encodeURIComponent(query)}&page=1`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
        }).then(r => r.json());

        const matches = res.results || [];

        if (matches.length === 0) {
            genresSearchResults.innerHTML = `<p class="meta" style="margin:0;">No genres/themes found for "${query}".</p>`;
        } else {
            genresSearchResults.innerHTML = matches.slice(0, 10).map(k => {
                const isActive = activeKeywords.has(String(k.id)) ? 'active' : '';
                return `<div class="pill ${isActive}" data-id="${k.id}" data-name="${k.name}" onclick="toggleKeywordPill(this)">${k.name}</div>`;
            }).join('');
        }
        genresSearchResults.style.display = 'flex';
    } catch (e) {
        console.error("Keyword search error:", e);
    }
}

function updateSelectedKeywordsUI() {
    if (activeKeywords.size === 0) {
        genresSelectedContainer.style.display = 'none';
        genresSelectedContainer.innerHTML = '';
        return;
    }

    let html = '';
    activeKeywords.forEach((name, id) => {
        html += `
            <div class="pill active" data-id="${id}" data-name="${name}" onclick="toggleKeywordPill(this)">
                ${name} <span style="margin-left:5px;">×</span>
            </div>
        `;
    });
    
    genresSelectedContainer.innerHTML = html;
    genresSelectedContainer.style.display = 'flex';
}

// ----------------------------------------
// Pill Toggling Logic
// ----------------------------------------

window.togglePill = function(element, type) {
    const id = element.getAttribute('data-id');
    
    let set;
    if (type === 'type') set = activeTypes;
    else if (type === 'movie-duration') set = activeMovieDurations;
    else if (type === 'tv-duration') set = activeTvDurations;
    else if (type === 'provider') set = activeProviders;
    else if (type === 'core-genre') set = activeCoreGenres; // NEW LINE

    if (set.has(id)) {
        set.delete(id);
        element.classList.remove('active');
    } else {
        set.add(id);
        element.classList.add('active');
    }

    if (type === 'type') {
        const hasMovie = activeTypes.has('movie');
        const hasTv = activeTypes.has('tv');

        durationSection.style.display = (hasMovie || hasTv) ? 'block' : 'none';
        movieDurationWrapper.style.display = hasMovie ? 'block' : 'none';
        tvDurationWrapper.style.display = hasTv ? 'block' : 'none';

        if (!hasMovie) {
            activeMovieDurations.clear();
            movieDurationWrapper.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        }
        if (!hasTv) {
            activeTvDurations.clear();
            tvDurationWrapper.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        }
    }
};

window.toggleKeywordPill = function(element) {
    const id = String(element.getAttribute('data-id'));
    const name = element.getAttribute('data-name');

    if (activeKeywords.has(id)) {
        activeKeywords.delete(id);
    } else {
        activeKeywords.set(id, name);
        genreSearchInput.value = '';
        genresSearchResults.style.display = 'none';
    }

    const searchPill = genresSearchResults.querySelector(`.pill[data-id="${id}"]`);
    if (searchPill) {
        if (activeKeywords.has(id)) searchPill.classList.add('active');
        else searchPill.classList.remove('active');
    }

    updateSelectedKeywordsUI();
};

// ----------------------------------------
// Search Execution & Pagination
// ----------------------------------------

async function executeSearch(isLoadMore = false) {
    if (activeTypes.size === 0) {
        alert("Please select at least one format (Movie or TV Show).");
        return;
    }

    if (!isLoadMore) {
        currentPage = 1;
        resultsGrid.innerHTML = '';
    } else {
        currentPage++;
    }

    loader.style.display = 'block';
    loadMoreBtn.style.display = 'none';

    // Fetch values
    const providersStr = Array.from(activeProviders).join('|');
    const textQuery = document.getElementById('text-search-input').value.toLowerCase().trim(); // NEW
    
    // Logic for Core Genres
    const coreLogic = document.querySelector('input[name="core-genre-logic"]:checked').value;
    const coreJoinChar = coreLogic === 'all' ? ',' : '|';
    const coreGenresStr = Array.from(activeCoreGenres).join(coreJoinChar);

    // Logic for Specific Themes
    const themeLogic = document.querySelector('input[name="theme-logic"]:checked').value;
    const themeJoinChar = themeLogic === 'all' ? ',' : '|';
    const keywordsStr = Array.from(activeKeywords.keys()).join(themeJoinChar);

    // Min/Max for Movie Ranges
    let movieRuntimeMin = null, movieRuntimeMax = null;
    if (activeMovieDurations.size > 0) {
        const durations = Array.from(activeMovieDurations).map(id => {
            const el = document.querySelector(`.pill[data-id="${id}"]`);
            return { min: parseInt(el.dataset.min), max: parseInt(el.dataset.max) };
        });
        movieRuntimeMin = Math.min(...durations.map(d => d.min));
        movieRuntimeMax = Math.max(...durations.map(d => d.max));
    }

    // Min/Max for TV Ranges
    let tvRuntimeMin = null, tvRuntimeMax = null;
    if (activeTvDurations.size > 0) {
        const durations = Array.from(activeTvDurations).map(id => {
            const el = document.querySelector(`.pill[data-id="${id}"]`);
            return { min: parseInt(el.dataset.min), max: parseInt(el.dataset.max) };
        });
        tvRuntimeMin = Math.min(...durations.map(d => d.min));
        tvRuntimeMax = Math.max(...durations.map(d => d.max));
    }

    try {
        const fetchPromises = [];
        
        // If a text query is present, we fetch 5 pages at once (~100 items per format) 
        // to ensure we have a massive pool to filter words through.
        const pagesToFetch = textQuery ? [currentPage, currentPage + 1, currentPage + 2, currentPage + 3, currentPage + 4] : [currentPage];

        for (let mediaType of activeTypes) {
            let baseUrl = `https://api.themoviedb.org/3/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US`;
            
            if (providersStr) baseUrl += `&with_watch_providers=${providersStr}`;
            if (keywordsStr) baseUrl += `&with_keywords=${keywordsStr}`;
            if (coreGenresStr) baseUrl += `&with_genres=${coreGenresStr}`;

            if (mediaType === 'movie') {
                if (movieRuntimeMin !== null) baseUrl += `&with_runtime.gte=${movieRuntimeMin}`;
                if (movieRuntimeMax !== null && movieRuntimeMax < 999) baseUrl += `&with_runtime.lte=${movieRuntimeMax}`;
            } else if (mediaType === 'tv') {
                if (tvRuntimeMin !== null) baseUrl += `&with_runtime.gte=${tvRuntimeMin}`;
                if (tvRuntimeMax !== null && tvRuntimeMax < 999) baseUrl += `&with_runtime.lte=${tvRuntimeMax}`;
            }

            // Fetch all calculated pages simultaneously
            pagesToFetch.forEach(page => {
                fetchPromises.push(
                    fetch(`${baseUrl}&page=${page}`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } })
                    .then(r => r.json())
                    .then(data => (data.results || []).map(item => ({ ...item, media_type: mediaType }))) 
                );
            });
        }

        // Advance pagination based on how many pages we fetched
        if (textQuery) {
            currentPage += 4;
        }

        const resultsArrays = await Promise.all(fetchPromises);
        let combinedResults = resultsArrays.flat();

        // Deduplicate in case TMDB pagination overlapped
        const uniqueMap = new Map();
        combinedResults.forEach(item => uniqueMap.set(item.id, item));
        combinedResults = Array.from(uniqueMap.values());

        // --- Client-side Text Filtering and Custom Sort ---
        if (textQuery) {
            // 1. Filter out items that do not contain the word in title OR description
            combinedResults = combinedResults.filter(item => {
                const title = (item.title || item.name || '').toLowerCase();
                const overview = (item.overview || '').toLowerCase();
                return title.includes(textQuery) || overview.includes(textQuery);
            });

            // 2. Sort: Title matches first, then description matches, then by popularity
            combinedResults.sort((a, b) => {
                const aTitleMatch = (a.title || a.name || '').toLowerCase().includes(textQuery);
                const bTitleMatch = (b.title || b.name || '').toLowerCase().includes(textQuery);

                if (aTitleMatch && !bTitleMatch) return -1; // A gets prioritized
                if (!aTitleMatch && bTitleMatch) return 1;  // B gets prioritized

                return b.popularity - a.popularity; // Tie-breaker
            });
        } else {
            combinedResults.sort((a, b) => b.popularity - a.popularity);
        }

        if (combinedResults.length === 0 && !isLoadMore) {
            resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">No matches found. Try widening your filters!</p>';
        } else if (combinedResults.length > 0) {
            renderResults(combinedResults);
            
            // Show load more button based on the pool size left
            if (combinedResults.length >= (textQuery ? 5 : 10)) loadMoreBtn.style.display = 'inline-block';
        }
    } catch (err) {
        if (!isLoadMore) resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">Search failed.</p>';
        console.error(err);
    } finally {
        loader.style.display = 'none';
        
        if (!isLoadMore) {
            document.getElementById('results-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

function renderResults(items) {
    items.forEach(item => {
        if (!item.poster_path) return;

        const card = document.createElement('div');
        const mediaType = item.media_type;
        card.className = 'media-card';
        card.setAttribute('data-type', mediaType);
        
        card.onclick = () => {
            window.location.href = `details.html?id=${encodeURIComponent(item.id)}&type=${mediaType}`;
        };
        
        const year = (item.release_date || item.first_air_date || '').split('-')[0];

        card.innerHTML = `
            <div class="poster-wrapper">
                <img src="https://image.tmdb.org/t/p/w500${item.poster_path}" 
                     alt="${item.title || item.name}" 
                     loading="lazy" 
                     onerror="this.onerror=null; this.src='https://via.placeholder.com/500x750?text=No+Image';">
                <span class="badge badge-${mediaType}">${mediaType}</span>
            </div>
            <div class="media-info">
                <div class="title">${item.title || item.name}</div>
                <div class="meta">${year}</div>
            </div>`;
        resultsGrid.appendChild(card);
    });
}

// ----------------------------------------
// Basic Auth & Header Setup
// ----------------------------------------
async function setupHeader() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const loginBtn = document.getElementById('login-btn');
    const profileMenu = document.getElementById('profile-menu');
    
    if (user) {
        loginBtn.style.display = 'none'; 
        profileMenu.style.display = 'inline-block';
        if (user.user_metadata?.avatar_url) {
            document.getElementById('nav-avatar').src = user.user_metadata.avatar_url;
        }
    } else {
        loginBtn.style.display = 'inline-block';
        profileMenu.style.display = 'none';
        loginBtn.onclick = () => window.location.href = 'index.html'; 
    }
}

window.toggleProfileDropdown = function(event) {
    if (event) event.stopPropagation();
    const content = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    const isVisible = content.style.display === 'block';
    content.style.display = isVisible ? 'none' : 'block';
    trigger.classList.toggle('active', !isVisible);
}

window.onclick = function(event) {
    const dropdown = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
}

window.signOut = async function() {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
}

initAdvSearch();