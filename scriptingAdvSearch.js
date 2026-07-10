let TMDB_TOKEN = '';
let supabaseClient = null;
let configData = null;

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
        configData = await response.json();
        
        TMDB_TOKEN = configData.tmdb_token;
        supabaseClient = supabase.createClient(configData.supabase_url, configData.supabase_key);

        await fetchTopProviders();
        await setupHeaderAndProfile();

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

        providersContainer.innerHTML = allProviders.map(p => {
            const isActive = activeProviders.has(String(p.provider_id)) ? 'active' : '';
            return `
                <div class="pill ${isActive}" data-id="${p.provider_id}" onclick="togglePill(this, 'provider')">
                    <img src="https://image.tmdb.org/t/p/w45${p.logo_path}" class="pill-logo">
                    ${p.provider_name}
                </div>
            `;
        }).join('');

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

    // Fetch values for standard TMDB search
    const textQuery = document.getElementById('text-search-input').value.toLowerCase().trim(); 
    
    // Logic for Core Genres
    const coreLogic = document.querySelector('input[name="core-genre-logic"]:checked').value;
    const coreJoinChar = coreLogic === 'all' ? ',' : '|';
    const coreGenresStr = Array.from(activeCoreGenres).join(coreJoinChar);

    // Logic for Specific Themes
    const themeLogic = document.querySelector('input[name="theme-logic"]:checked').value;
    const themeJoinChar = themeLogic === 'all' ? ',' : '|';
    const keywordsStr = Array.from(activeKeywords.keys()).join(themeJoinChar);

    const includeFree = document.getElementById('include-free-checkbox') ? document.getElementById('include-free-checkbox').checked : false;
    const providersStr = Array.from(activeProviders).join('|');

    // ==========================================
    // DEBUG LOGS: EVERY INPUT VALUE
    // ==========================================
    console.log("=== [DEBUG] SEARCH STARTED ===");
    console.log("[DEBUG] INPUT - Formats:", Array.from(activeTypes));
    console.log("[DEBUG] INPUT - Text Query:", textQuery ? `"${textQuery}"` : "(none)");
    console.log("[DEBUG] INPUT - Movie Durations:", Array.from(activeMovieDurations));
    console.log("[DEBUG] INPUT - TV Durations:", Array.from(activeTvDurations));
    console.log("[DEBUG] INPUT - Providers:", Array.from(activeProviders));
    console.log("[DEBUG] INPUT - Include Free:", includeFree);
    console.log("[DEBUG] INPUT - Core Genres (Logic: " + coreLogic + "):", Array.from(activeCoreGenres));
    console.log("[DEBUG] INPUT - Themes (Logic: " + themeLogic + "):", Array.from(activeKeywords.keys()));
    // ==========================================

    // 1. Check for a Character Query
    const characterQuery = document.getElementById('character-search-input') ? document.getElementById('character-search-input').value.trim() : '';
    let characterFallbackActive = false;

    if (characterQuery && !isLoadMore) {
        try {
            const qdrantSuccess = await executeCharacterSearch(characterQuery);
            if (qdrantSuccess) return; 
        } catch (err) {
            console.error("[Qdrant Fallback] Character search failed:", err.message);
            characterFallbackActive = true; 
        }
    }

    // Min/Max for Movie Ranges
    let movieRuntimeMin = null, movieRuntimeMax = null;
    if (activeMovieDurations.size > 0) {
        const durations = Array.from(activeMovieDurations).map(id => {
            const el = document.querySelector(`.pill[data-id="${id}"]`);
            return { min: parseInt(el.dataset.min), max: parseInt(el.dataset.max) };
        });
        movieRuntimeMin = Math.min(...durations.map(d => d.min));
        movieRuntimeMax = Math.max(...durations.map(d => d.max));
        console.log(`[DEBUG] CALCULATED - Movie Runtime API Bounds: Min=${movieRuntimeMin}, Max=${movieRuntimeMax}`);
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
        console.log(`[DEBUG] CALCULATED - TV Runtime API Bounds: Min=${tvRuntimeMin}, Max=${tvRuntimeMax}`);
    }

    try {
        const fetchPromises = [];
        const pagesToFetch = textQuery ? [currentPage, currentPage + 1, currentPage + 2, currentPage + 3, currentPage + 4] : [currentPage];

        console.log(`[DEBUG] Fetching pages:`, pagesToFetch);

        for (let mediaType of activeTypes) {
            let baseUrl = `https://api.themoviedb.org/3/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US`;
            
            if (activeProviders.size > 0) {
                if (includeFree) {
                    baseUrl += `&with_watch_monetization_types=flatrate|free|ads`;
                } else {
                    baseUrl += `&with_watch_providers=${providersStr}&with_watch_monetization_types=flatrate|free|ads`;
                }
            }

            if (keywordsStr) baseUrl += `&with_keywords=${keywordsStr}`;
            if (coreGenresStr) baseUrl += `&with_genres=${coreGenresStr}`;

            if (mediaType === 'movie') {
                if (movieRuntimeMin !== null) baseUrl += `&with_runtime.gte=${movieRuntimeMin}`;
                if (movieRuntimeMax !== null && movieRuntimeMax < 999) baseUrl += `&with_runtime.lte=${movieRuntimeMax}`;
            } else if (mediaType === 'tv') {
                if (tvRuntimeMin !== null) baseUrl += `&with_runtime.gte=${tvRuntimeMin}`;
                if (tvRuntimeMax !== null && tvRuntimeMax < 999) baseUrl += `&with_runtime.lte=${tvRuntimeMax}`;
            }

            pagesToFetch.forEach(page => {
                fetchPromises.push(
                    fetch(`${baseUrl}&page=${page}`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } })
                    .then(r => r.json())
                    .then(data => (data.results || []).map(item => ({ ...item, media_type: mediaType }))) 
                );
            });
        }

        if (textQuery) currentPage += 4;

        const resultsArrays = await Promise.all(fetchPromises);
        let combinedResults = resultsArrays.flat();

        const uniqueMap = new Map();
        combinedResults.forEach(item => uniqueMap.set(item.id, item));
        combinedResults = Array.from(uniqueMap.values());

        console.log(`[DEBUG] Pre-filter count from Discover API: ${combinedResults.length}`);

        // --- NEW: Accurate Real-time Provider & Strict Duration Checking ---
        console.log(`[DEBUG] Fetching detailed data for ${combinedResults.length} items to verify providers and strict duration...`);
        const detailPromises = combinedResults.map(item => 
            // We changed this to pull the main details AND the providers in one go!
            fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.id}?append_to_response=watch/providers`, {
                headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
            })
            .then(r => r.json())
            .catch(() => null)
        );
        const detailsResults = await Promise.all(detailPromises);

        combinedResults = combinedResults.filter((item, index) => {
            const detailData = detailsResults[index];
            if (!detailData) return false;

            // 1. STRICT DURATION CHECK
            if (item.media_type === 'movie' && activeMovieDurations.size > 0) {
                const runtime = detailData.runtime || 0;
                // Check if the exact runtime falls into AT LEAST ONE of the strictly selected duration buckets
                const matchesDuration = Array.from(activeMovieDurations).some(id => {
                    const el = document.querySelector(`.pill[data-id="${id}"]`);
                    return runtime >= parseInt(el.dataset.min) && runtime <= parseInt(el.dataset.max);
                });
                if (!matchesDuration) return false;
            } 
            else if (item.media_type === 'tv' && activeTvDurations.size > 0) {
                const runtimes = detailData.episode_run_time || [];
                const avgRuntime = runtimes.length > 0 ? Math.round(runtimes.reduce((a,b)=>a+b,0)/runtimes.length) : 0;
                
                if (avgRuntime === 0) return false; // Drop if TMDB has no runtime data

                const matchesDuration = Array.from(activeTvDurations).some(id => {
                    const el = document.querySelector(`.pill[data-id="${id}"]`);
                    return avgRuntime >= parseInt(el.dataset.min) && avgRuntime <= parseInt(el.dataset.max);
                });
                if (!matchesDuration) return false;
            }

            // 2. PROVIDER CHECK
            const usProviders = (detailData['watch/providers'] && detailData['watch/providers'].results && detailData['watch/providers'].results.US) || {};
            
            const flatrateIds = (usProviders.flatrate || []).map(p => String(p.provider_id));
            const freeIds = (usProviders.free || []).map(p => String(p.provider_id));
            const adsIds = (usProviders.ads || []).map(p => String(p.provider_id));

            if (activeProviders.size > 0) {
                const isOnSelectedServices = [...flatrateIds, ...freeIds, ...adsIds].some(id => activeProviders.has(id));
                
                if (includeFree) {
                    const isFreeAnywhere = freeIds.length > 0;
                    const isFreeWithAdsAnywhere = adsIds.length > 0;
                    return isOnSelectedServices || isFreeAnywhere || isFreeWithAdsAnywhere;
                }
                
                return isOnSelectedServices;
            }
            
            return true; 
        });

        console.log(`[DEBUG] Post-filter count (Providers + Strict Duration): ${combinedResults.length}`);

        // --- Client-side Text Filtering and Custom Sort ---
        if (textQuery) {
            combinedResults = combinedResults.filter(item => {
                const title = (item.title || item.name || '').toLowerCase();
                const overview = (item.overview || '').toLowerCase();
                return title.includes(textQuery) || overview.includes(textQuery);
            });

            combinedResults.sort((a, b) => {
                const aTitleMatch = (a.title || a.name || '').toLowerCase().includes(textQuery);
                const bTitleMatch = (b.title || b.name || '').toLowerCase().includes(textQuery);

                if (aTitleMatch && !bTitleMatch) return -1;
                if (!aTitleMatch && bTitleMatch) return 1;

                return b.popularity - a.popularity;
            });
            console.log(`[DEBUG] Count after Text Query ("${textQuery}") filter: ${combinedResults.length}`);
        } else {
            combinedResults.sort((a, b) => b.popularity - a.popularity);
        }

        if (combinedResults.length === 0 && !isLoadMore) {
            resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">No matches found. Try widening your filters!</p>';
        } else if (combinedResults.length > 0) {
            renderResults(combinedResults);
            
            if (combinedResults.length >= (textQuery ? 5 : 10)) loadMoreBtn.style.display = 'inline-block';
        }
    } catch (err) {
        if (!isLoadMore) resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">Search failed.</p>';
        console.error("=== [DEBUG] SEARCH FAILED ===", err);
    } finally {
        loader.style.display = 'none';
        console.log("=== [DEBUG] SEARCH COMPLETED ===");
        
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
// Basic Auth, Profile Data & Header Setup
// ----------------------------------------
async function setupHeaderAndProfile() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const loginBtn = document.getElementById('login-btn');
    const profileMenu = document.getElementById('profile-menu');
    
    if (user) {
        loginBtn.style.display = 'none'; 
        profileMenu.style.display = 'inline-block';
        if (user.user_metadata?.avatar_url) {
            document.getElementById('nav-avatar').src = user.user_metadata.avatar_url;
        }

        // Fetch the user's saved services
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('services')
            .eq('id', user.id)
            .single();

        if (profile && profile.services) {
            // Merge both streaming and buying preferences into string IDs
            const savedProviders = [
                ...(profile.services.streaming || []), 
                ...(profile.services.buying || [])
            ].map(String);
            
            // Create an array of strictly the IDs that are currently visible on the UI
            const visibleProviderIds = allProviders.map(p => String(p.provider_id));
            
            // INTERSECTION: Only keep saved providers that are ALSO in the visible top 25
            const validActiveProviders = savedProviders.filter(id => visibleProviderIds.includes(id));
            
            // Auto-populate the activeProviders Set AND manually update the UI pills
            validActiveProviders.forEach(id => {
                activeProviders.add(id);
                const pillEl = document.querySelector(`.pill[data-id="${id}"]`);
                if (pillEl) pillEl.classList.add('active');
            });
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

async function executeCharacterSearch(characterQuery) {
    resultsGrid.innerHTML = '';
    loader.style.display = 'block';
    loadMoreBtn.style.display = 'none';

    try {
        // 1. Fetch from Qdrant
        const response = await fetch(`${configData.supabase_url}/functions/v1/search-characters`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${configData.supabase_key}` 
            },
            body: JSON.stringify({ query: characterQuery })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`Edge Function Failed: ${data.error}`);
        }

        let matches = data.results || [];

        // 2. Filter locally by Media Type
        matches = matches.filter(m => activeTypes.has(m.media_type));

        // 3. Filter locally by Core Genres & Themes
        const requiredTags = [...Array.from(activeCoreGenres).map(id => document.querySelector(`.pill[data-id="${id}"]`).innerText), ...Array.from(activeKeywords.values())].map(t => t.toLowerCase());
        
        if (requiredTags.length > 0) {
            matches = matches.filter(m => {
                const payloadTags = (m.tags || '').toLowerCase();
                // Simple logic: Does the Qdrant tag payload contain at least one of the selected themes?
                return requiredTags.some(tag => payloadTags.includes(tag)); 
            });
        }

        if (matches.length === 0) {
            resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">No matches found for that character with your current filters.</p>';
            return;
        }

        // 4. Render using the Lazy Poster approach
        renderQdrantResults(matches);

    } catch (err) {
        console.error("Character Search Error:", err);
        resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">Failed to fetch character data.</p>';
    } finally {
        loader.style.display = 'none';
        document.getElementById('results-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderQdrantResults(items) {
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.setAttribute('data-type', item.media_type);
        
        card.onclick = () => {
            window.location.href = `details.html?id=${encodeURIComponent(item.id)}&type=${item.media_type}`;
        };
        
        const imgId = `poster-${item.id}`;

        // Create the card with a loading placeholder
        card.innerHTML = `
            <div class="poster-wrapper">
                <img id="${imgId}" src="https://via.placeholder.com/500x750/1b2228/9ab?text=Loading..." alt="${item.title}">
                <span class="badge badge-${item.media_type}">${item.media_type}</span>
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                <div class="meta">${item.release_year || ''}</div>
            </div>`;
        
        resultsGrid.appendChild(card);

        // Tell the background script to go find the actual image!
        fetchDynamicPoster(item, imgId);
    });
}

// Brought over from scriptingRecs.js
async function fetchDynamicPoster(rec, imgElementId) {
    const imgEl = document.getElementById(imgElementId);
    if (!imgEl) return;

    try {
        if (rec.media_type === 'movie' || rec.media_type === 'tv') {
            const res = await fetch(`https://api.themoviedb.org/3/${rec.media_type}/${rec.id}`, {
                headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
            }).then(r => r.json());
            
            if (res.poster_path) {
                imgEl.src = `https://image.tmdb.org/t/p/w500${res.poster_path}`;
            } else {
                imgEl.src = 'https://via.placeholder.com/500x750/1b2228/9ab?text=No+Poster';
            }
        } 
    } catch (e) {
        imgEl.src = 'https://via.placeholder.com/500x750/1b2228/ff4d4d?text=Error';
    }
}

initAdvSearch();