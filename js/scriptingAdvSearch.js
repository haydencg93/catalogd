import { loadConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';

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
let activeLanguages = new Set();
let languageIsoMap = {}; // Maps 'English' -> 'en'

// Global Data & Pagination
let allProviders = [];
let searchTimeout = null;
let currentPage = 1;

// ----------------------------------------
// Initizalization
// ----------------------------------------
async function initAdvSearch() {
    try {
        configData = await loadConfig();
        
        TMDB_TOKEN = configData.tmdb_token;
        supabaseClient = await getSupabaseClient();

        // Initialize the AppHeader Web Component so it catches the auth state
        await customElements.whenDefined('app-header');
        const header = document.querySelector('app-header');
        let currentUser = null;
        if (header) {
            currentUser = await header.initializeAuth(supabaseClient);
        }

        await fetchTopProviders();
        await fetchCoreGenres();
        await fetchLanguages();

        // Load and apply the user's saved preferences
        if (currentUser) {
            await loadUserPreferences(currentUser);
        }

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
        
        // Event Delegation for all interactive pills
        document.querySelector('.adv-search-container').addEventListener('click', (e) => {
            const pill = e.target.closest('.pill');
            if (!pill) return;
            
            // Handle Keywords vs Standard Filters
            if (pill.closest('#genres-search-results') || pill.closest('#genres-selected-container')) {
                toggleKeywordPill(pill);
            } else {
                const group = pill.dataset.group;
                if (group) togglePill(pill, group);
            }
        });
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
                 <button type="button" class="pill ${isActive}" data-id="${p.provider_id}" data-group="provider">
                     <img src="https://image.tmdb.org/t/p/w45${p.logo_path}" class="pill-logo" alt="">
                     ${p.provider_name}
                 </button>
             `;
         }).join('');
     } catch (e) {
        console.error("Error loading providers:", e);
        providersContainer.innerHTML = '<p class="meta">Failed to load providers.</p>';
    }
}

async function fetchLanguages() {
    try {
        const langRes = await fetch(`https://api.themoviedb.org/3/configuration/languages`, { 
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` } 
        }).then(r => r.json());

        const sortedLangs = langRes.sort((a, b) => a.english_name.localeCompare(b.english_name));
        
        sortedLangs.forEach(lang => {
            languageIsoMap[lang.english_name] = lang.iso_639_1;
        });

        document.getElementById('languages-container').innerHTML = sortedLangs.map(lang => `
            <button type="button" class="pill" data-id="${lang.english_name}" data-group="language")">
                ${lang.english_name}
            </button>
        `).join('');
    } catch (e) {
        console.error("Error loading languages:", e);
        document.getElementById('languages-container').innerHTML = '<p class="meta">Failed to load languages.</p>';
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
            <button type="button" class="pill" data-id="${g.id}" data-group="core-genre">
                ${g.name}
            </button>
        `).join('');
    } catch (e) {
        console.error("Error loading genres:", e);
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
                return `<button type="button" class="pill ${isActive}" data-id="${k.id}" data-name="${k.name}" data-group="${this}">${k.name}</button>`;
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
            <button type="button" class="pill active" data-id="${id}" data-name="${name}" data-keyword-pill>
                ${name} <span style="margin-left:5px;">×</span>
            </button>
        `;
    });
    
    genresSelectedContainer.innerHTML = html;
    genresSelectedContainer.style.display = 'flex';
    genresSelectedContainer.querySelectorAll('[data-keyword-pill]').forEach((pill) => {
        pill.addEventListener('click', () => window.toggleKeywordPill(pill));
    });
}

// ----------------------------------------
// Pill Toggling Logic
// ----------------------------------------

function updateDurationVisibility() {
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

window.togglePill = function(element, type) {
    const id = element.dataset.id;
    
    let set;
    if (type === 'type') set = activeTypes;
    else if (type === 'movie-duration') set = activeMovieDurations;
    else if (type === 'tv-duration') set = activeTvDurations;
    else if (type === 'provider') set = activeProviders;
    else if (type === 'core-genre') set = activeCoreGenres; 
    else if (type === 'language') set = activeLanguages; // <-- CRITICAL: This was missing!

    if (set.has(id)) {
        set.delete(id);
        element.classList.remove('active');
    } else {
        set.add(id);
        element.classList.add('active');
    }

    if (type === 'type') updateDurationVisibility();
};

window.toggleKeywordPill = function(element) {
    const id = String(element.dataset.id);
    const name = element.dataset.name;

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
function checkDuration(item, detailData) {
    if (item.media_type === 'movie' && activeMovieDurations.size > 0) {
        const runtime = detailData.runtime || 0;
        return Array.from(activeMovieDurations).some(id => {
            const el = document.querySelector(`.pill[data-id="${id}"]`);
            return runtime >= Number.parseInt(el.dataset.min) && runtime <= Number.parseInt(el.dataset.max);
        });
    }
    if (item.media_type === 'tv' && activeTvDurations.size > 0) {
        const runtimes = detailData.episode_run_time || [];
        const avgRuntime = runtimes.length > 0 ? Math.round(runtimes.reduce((a,b)=>a+b,0)/runtimes.length) : 0;
        if (avgRuntime === 0) return false;
        return Array.from(activeTvDurations).some(id => {
            const el = document.querySelector(`.pill[data-id="${id}"]`);
            return avgRuntime >= Number.parseInt(el.dataset.min) && avgRuntime <= Number.parseInt(el.dataset.max);
        });
    }
    return true;
}

function checkLanguage(detailData, langRule, selectedIsos) {
    if (activeLanguages.size === 0) return true;
    const isOriginalMatch = selectedIsos.includes(detailData.original_language);
    if (langRule === 'original') return isOriginalMatch;
    
    const isTranslationMatch = detailData.translations?.translations?.some(t => selectedIsos.includes(t.iso_639_1));
    return isOriginalMatch || isTranslationMatch;
}

function checkProviders(detailData, includeFree) {
    if (activeProviders.size === 0) return true;
    const usProviders = detailData['watch/providers']?.results?.US || {};
    const checkProvider = (arr) => arr?.some(p => activeProviders.has(String(p.provider_id)));
    
    const isOnSelectedServices = checkProvider(usProviders.flatrate) || checkProvider(usProviders.free) || checkProvider(usProviders.ads);
    if (includeFree) return isOnSelectedServices || (usProviders.free?.length > 0) || (usProviders.ads?.length > 0);
    
    return isOnSelectedServices;
}

function evaluateItemDetail(item, detailData, langRule, selectedIsos, includeFree) {
    if (!detailData) return false;
    return checkDuration(item, detailData) && 
           checkLanguage(detailData, langRule, selectedIsos) && 
           checkProviders(detailData, includeFree);
} 

// --- URL Builder Helpers (Fixes S3776) ---
function getDurationParams(mediaType, filters) {
    const bounds = mediaType === 'movie' ? filters.movieBounds : filters.tvBounds;
    if (!bounds) return '';
    
    let params = '';
    if (bounds.min !== null) params += `&with_runtime.gte=${bounds.min}`;
    if (bounds.max !== null && bounds.max < 999) params += `&with_runtime.lte=${bounds.max}`;
    return params;
}

function getProviderParams(filters) {
    if (!filters.providersStr) return '';
    return filters.includeFree 
        ? `&with_watch_monetization_types=flatrate|free|ads`
        : `&with_watch_providers=${filters.providersStr}&with_watch_monetization_types=flatrate|free|ads`;
}

function buildBaseUrl(mediaType, filters) {
    let url = `https://api.themoviedb.org/3/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US`;
    
    url += getProviderParams(filters);
    if (filters.keywordsStr) url += `&with_keywords=${filters.keywordsStr}`;
    if (filters.coreGenresStr) url += `&with_genres=${filters.coreGenresStr}`;
    if (filters.selectedIsos.length > 0 && filters.langRule === 'original') {
        url += `&with_original_language=${filters.selectedIsos.join('|')}`;
    }
    
    url += getDurationParams(mediaType, filters);
    return url;
}

function buildDiscoverUrls(mediaTypes, textQuery, filters) {
    const urls = [];
    const pages = textQuery ? [currentPage, currentPage + 1, currentPage + 2, currentPage + 3, currentPage + 4] : [currentPage];
    
    mediaTypes.forEach(mediaType => {
        const baseUrl = buildBaseUrl(mediaType, filters);
        pages.forEach(page => urls.push({ url: `${baseUrl}&page=${page}`, type: mediaType }));
    });
    return urls;
}

// --- Search Execution Helpers (Fixes S3776) ---
function deduplicateResults(results) {
    const uniqueMap = new Map();
    results.forEach(item => uniqueMap.set(item.id, item));
    return Array.from(uniqueMap.values());
}

async function fetchDetailedResults(results) {
    return Promise.all(results.map(item => 
        fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.id}?append_to_response=watch/providers,translations`, { 
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` } 
        }).then(r => r.json()).catch(() => null)
    ));
}

function applyTextFilter(results, textQuery) {
    if (!textQuery) return results.sort((a, b) => b.popularity - a.popularity);
    
    return results.filter(item => 
        (item.title || item.name || '').toLowerCase().includes(textQuery) || 
        (item.overview || '').toLowerCase().includes(textQuery)
    ).sort((a, b) => {
        const aMatch = (a.title || a.name || '').toLowerCase().includes(textQuery);
        const bMatch = (b.title || b.name || '').toLowerCase().includes(textQuery);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return b.popularity - a.popularity;
    });
}

async function processCombinedResults(fetchPromises, textQuery, filters) {
    let combinedResults = deduplicateResults((await Promise.all(fetchPromises)).flat());
    const detailsResults = await fetchDetailedResults(combinedResults);
    
    combinedResults = combinedResults.filter((item, index) => 
        evaluateItemDetail(item, detailsResults[index], filters.langRule, filters.selectedIsos, filters.includeFree)
    );

    return applyTextFilter(combinedResults, textQuery);
}

async function executeSearch(isLoadMore = false) {
    if (activeTypes.size === 0) return alert("Please select at least one format (Movie or TV Show).");
    
    if (!isLoadMore) {
        currentPage = 1;
        resultsGrid.innerHTML = '';
    } else {
        currentPage++;
    }
    
    loader.style.display = 'block';
    loadMoreBtn.style.display = 'none';

    const textQuery = document.getElementById('text-search-input').value.toLowerCase().trim();
    const characterQuery = document.getElementById('character-search-input') ? document.getElementById('character-search-input').value.trim() : '';
    
    if (characterQuery && !isLoadMore) {
        try {
            if (await executeCharacterSearch(characterQuery)) return;
        } catch (err) {
            console.error("[Qdrant Fallback] Character search failed:", err.message);
        }
    }

    const filters = {
        coreGenresStr: Array.from(activeCoreGenres).join(document.querySelector('input[name="core-genre-logic"]:checked').value === 'all' ? ',' : '|'),
        keywordsStr: Array.from(activeKeywords.keys()).join(document.querySelector('input[name="theme-logic"]:checked').value === 'all' ? ',' : '|'),
        providersStr: Array.from(activeProviders).join('|'),
        includeFree: document.getElementById('include-free-checkbox')?.checked || false,
        langRule: document.querySelector('input[name="lang-rule"]:checked').value,
        selectedIsos: Array.from(activeLanguages).map(name => languageIsoMap[name]),
        movieBounds: getDurationBounds(activeMovieDurations),
        tvBounds: getDurationBounds(activeTvDurations)
    };

    try {
        const requests = buildDiscoverUrls(activeTypes, textQuery, filters);
        const fetchPromises = requests.map(req => 
            fetch(req.url, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } })
                .then(r => r.json())
                .then(data => (data.results || []).map(item => ({ ...item, media_type: req.type })))
        );
        
        if (textQuery) currentPage += 4;
        
        const finalResults = await processCombinedResults(fetchPromises, textQuery, filters);

        if (finalResults.length === 0 && !isLoadMore) {
            resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">No matches found. Try widening your filters!</p>';
        } else if (finalResults.length > 0) {
            renderResults(finalResults);
            if (finalResults.length >= (textQuery ? 5 : 10)) loadMoreBtn.style.display = 'inline-block';
        }
    } catch (err) {
        if (!isLoadMore) resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">Search failed.</p>';
        console.error("=== [DEBUG] SEARCH FAILED ===", err);
    } finally {
        loader.style.display = 'none';
        if (!isLoadMore) document.getElementById('results-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function getDurationBounds(durationSet) {
    if (durationSet.size === 0) return null;
    const durations = Array.from(durationSet).map(id => {
        const el = document.querySelector(`.pill[data-id="${id}"]`);
        return { min: Number.parseInt(el.dataset.min), max: Number.parseInt(el.dataset.max) };
    });
    return { min: Math.min(...durations.map(d => d.min)), max: Math.max(...durations.map(d => d.max)) };
}

function renderResults(items) {
    items.forEach(item => {
        if (!item.poster_path) return;

        const card = document.createElement('div');
        const mediaType = item.media_type;
        card.className = 'media-card';
        card.dataset.type = mediaType;
        
        card.onclick = () => {
            window.location.href = `details.html?id=${encodeURIComponent(item.id)}&type=${mediaType}`;
        };
        
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        
        // XSS Prevention: Safely encode text strings before injecting into HTML
        const safeTitle = document.createElement('div');
        safeTitle.textContent = item.title || item.name;

        card.innerHTML = `
            <div class="poster-wrapper">
                <img src="https://image.tmdb.org/t/p/w500${item.poster_path}" 
                     alt="${safeTitle.innerHTML}" 
                     loading="lazy" 
                    >
                <span class="badge badge-${mediaType}">${mediaType}</span>
            </div>
            <div class="media-info">
                <div class="title">${safeTitle.innerHTML}</div>
                <div class="meta">${year}</div>
            </div>`;
        resultsGrid.appendChild(card);
        const image = card.querySelector('img');
        image?.addEventListener('error', () => {
            image.src = 'https://via.placeholder.com/500x750?text=No+Image';
        }, { once: true });
    });
}

async function executeCharacterSearch(characterQuery) {
    resultsGrid.innerHTML = '';
    loader.style.display = 'block';
    loadMoreBtn.style.display = 'none';

    try {
        // 1. Build Supabase query against `global_movies`
        let query = supabaseClient
            .from('global_movies')
            .select('tmdb_id, title, release_year, popularity, overview, tags, media_type, characters')
            .ilike('characters', `%${characterQuery}%`)
            .order('popularity', { ascending: false })
            .limit(40);

        // 2. Filter by selected media type(s) ('movie' / 'tv')
        if (activeTypes.size > 0) {
            query = query.in('media_type', Array.from(activeTypes));
        }

        const { data: movies, error } = await query;

        if (error) throw error;

        let matches = (movies || []).map(m => ({
            id: m.tmdb_id,
            title: m.title,
            release_year: m.release_year,
            media_type: m.media_type || 'movie',
            characters: m.characters,
            tags: m.tags
        }));

        // 3. Filter locally by selected Core Genres & Themes if active
        const requiredTags = [
            ...Array.from(activeCoreGenres).map(id => document.querySelector(`.pill[data-id="${id}"]`)?.innerText?.trim()),
            ...Array.from(activeKeywords.values())
        ].filter(Boolean).map(t => t.toLowerCase());

        if (requiredTags.length > 0) {
            const isAllLogic = document.querySelector('input[name="theme-logic"]:checked')?.value === 'all';
            
            matches = matches.filter(m => {
                const payloadTags = (m.tags || '').toLowerCase();
                return isAllLogic
                    ? requiredTags.every(tag => payloadTags.includes(tag))
                    : requiredTags.some(tag => payloadTags.includes(tag));
            });
        }

        // 4. Handle empty state
        if (matches.length === 0) {
            resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">No matches found for that character with your current filters.</p>';
            return true;
        }

        // 5. Render results using dynamic TMDB poster loader
        renderQdrantResults(matches);
        return true;

    } catch (err) {
        console.error("Supabase Character Search Error:", err);
        resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align:center;">Failed to fetch character data.</p>';
        return false;
    } finally {
        loader.style.display = 'none';
        document.getElementById('results-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderQdrantResults(items) {
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.dataset.type = item.media_type;
        
        card.onclick = () => {
            window.location.href = `details.html?id=${encodeURIComponent(item.id)}&type=${item.media_type}`;
        };
        
        const imgId = `poster-${item.id}`;

        // XSS Prevention: Safely encode text strings
        const safeTitle = document.createElement('div');
        safeTitle.textContent = item.title;

        // Create the card with a loading placeholder
        card.innerHTML = `
            <div class="poster-wrapper">
                <img id="${imgId}" src="https://via.placeholder.com/500x750/1b2228/9ab?text=Loading..." alt="${safeTitle.innerHTML}">
                <span class="badge badge-${item.media_type}">${item.media_type}</span>
            </div>
            <div class="media-info">
                <div class="title">${safeTitle.innerHTML}</div>
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

async function loadUserPreferences(user) {
    if (!user) return;
    try {
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('services')
            .eq('id', user.id)
            .single();

        // Using optional chaining here!
        if (profile?.services) {
            // 1. Autofill Streaming Providers
            const userProviders = profile.services.streaming || [];
            userProviders.forEach(providerId => {
                const pill = document.querySelector(`.pill[data-id="${providerId}"][data-group="provider"]`);
                if (pill) {
                    activeProviders.add(String(providerId));
                    pill.classList.add('active');
                }
            });

            // 2. Autofill Preferred Languages
            const userLanguages = profile.services.languages || [];
            userLanguages.forEach(langName => {
                const pill = document.querySelector(`.pill[data-id="${langName}"][data-group="language"]`);
                if (pill) {
                    activeLanguages.add(langName);
                    pill.classList.add('active');
                }
            });
        }
    } catch (err) {
        console.warn("Could not load user preferences:", err);
    }
}

initAdvSearch();