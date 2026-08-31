import { loadConfig as fetchConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';
import { normalizeOpenLibraryId } from './core/media.js';

// 1. Elements
const searchInput = document.getElementById('search-input');
const resultsGrid = document.getElementById('results-grid');
const loader = document.getElementById('loader');
const loginBtn = document.getElementById('login-btn');
const authModal = document.getElementById('auth-modal');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authConfirmBtn = document.getElementById('auth-confirm-btn');
const authSwitch = document.getElementById('auth-switch');
const closeModal = document.getElementById('close-auth');
const modalTitle = document.getElementById('modal-title');
const authName = document.getElementById('auth-name');
const authUsername = document.getElementById('auth-username');
const authRetype = document.getElementById('auth-retype');
const signupFields = document.getElementById('signup-fields');
const profileBtn = document.getElementById('profile-btn');
const profileMenu = document.getElementById('profile-menu');

// 2. Global Variables
let TMDB_TOKEN = '';
let LASTFM_KEY = '';
let supabaseClient = null;
let isSignUpMode = false;
let currentTab = 'movie';
let contentRequestId = 0;
let activeContentController = null;
let customImgsMap = new Map();
// Provider IDs (TMDB watch/providers ids, as strings) the user picked in Settings > Your Services > Streaming.
// Populated in checkUserStatus(). Empty array = no filtering (user hasn't set services yet).
let userStreamingProviderIds = [];

function beginContentRequest() {
    activeContentController?.abort();
    activeContentController = new AbortController();
    return activeContentController;
}

function abortContentRequest() {
    activeContentController?.abort();
}

function contentFetch(url, options = {}) {
    return fetch(url, { ...options, signal: activeContentController?.signal });
}

function throwIfContentAborted() {
    if (activeContentController?.signal.aborted) throw new DOMException('Content request superseded', 'AbortError');
}

/*
* Fetches configuration variables, initializes external APIs (Supabase, TMDB, Last.fm),
*   sets up initial event listeners for the search bar, and dictates the initial
*   UI state based on URL parameters or trending defaults.
* @async
* @throws {Error} If config.json cannot be fetched.
*/
async function loadConfig() {
    try {
        const config = await fetchConfig();
        
        TMDB_TOKEN = config.tmdb_token;
        LASTFM_KEY = config.lastfm_key;
        supabaseClient = await getSupabaseClient();
        
        await checkUserStatus(); 

        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, books, authors, ...";
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') unifiedSearch(searchInput.value);
        });
        searchInput.addEventListener('input', () => {
            if (searchInput.value.trim()) abortContentRequest();
        });

        const searchFilter = document.getElementById('search-filter');
        searchFilter.addEventListener('change', () => {
            // If they change the filter while text is in the box, automatically research!
            if (searchInput.value.trim() !== "") {
                unifiedSearch(searchInput.value);
            }
        });

        const urlParams = new URLSearchParams(window.location.search);
        const searchQuery = urlParams.get('search');
        const filterQuery = urlParams.get('filter'); // NEW: Grab the filter from the URL

        // If a filter was passed from the details page, apply it to the dropdown!
        if (filterQuery) {
            document.getElementById('search-filter').value = filterQuery;
        }

        if (searchQuery) {
            searchInput.value = searchQuery;
            unifiedSearch(searchQuery);
        } else {
            loadTabContent('movie');
        }

    } catch (err) {
        console.error("Critical Start Error:", err);
        loader.textContent = "Error: " + err.message;
    }
}

async function ensureCatalogdFollow(user) {
    if (!user?.id || !supabaseClient) return;

    try {
        const { data: existingProfile, error: profileLookupError } = await supabaseClient
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();

        if (profileLookupError && profileLookupError.code !== 'PGRST116') {
            console.warn('Unable to verify user profile before auto-follow:', profileLookupError);
            return;
        }

        if (!existingProfile) {
            const usernameSeed = String(user.user_metadata?.username || user.user_metadata?.display_name || user.email || 'user')
                .trim()
                .replace(/^@/, '')
                .replace(/\s+/g, '')
                .toLowerCase();

            const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
            const { error: profileInsertError } = await supabaseClient
                .from('profiles')
                .upsert({
                    id: user.id,
                    username: usernameSeed,
                    display_name: displayName,
                    avatar_url: user.user_metadata?.avatar_url || null
                }, { onConflict: 'id' });

            if (profileInsertError) {
                console.warn('Unable to create profile row for auto-follow:', profileInsertError);
                return;
            }
        }

        const { data: profileRows, error: officialLookupError } = await supabaseClient
            .from('profiles')
            .select('id, username, display_name')
            .limit(200);

        if (officialLookupError) {
            console.warn('Unable to load profiles for official account lookup:', officialLookupError);
            return;
        }

        const normalizeHandle = (value) => String(value || '').toLowerCase().replace(/^@/, '').trim();
        const officialProfile = (profileRows || []).find((profile) => {
            const username = normalizeHandle(profile.username);
            const displayName = normalizeHandle(profile.display_name);
            return username === 'catalogd' || displayName === 'catalogd' || username === 'catalogd official' || displayName === 'catalogd official';
        });

        if (!officialProfile) return;

        const { data: existingFollow, error: followCheckError } = await supabaseClient
            .from('follows')
            .select('id')
            .eq('follower_id', user.id)
            .eq('following_id', officialProfile.id)
            .maybeSingle();

        if (followCheckError && followCheckError.code !== 'PGRST116') {
            console.warn('Unable to verify default Catalogd follow:', followCheckError);
            return;
        }

        if (existingFollow) return;

        const { error: followInsertError } = await supabaseClient
            .from('follows')
            .insert({ follower_id: user.id, following_id: officialProfile.id });

        if (followInsertError && followInsertError.code !== '23505') {
            console.warn('Unable to auto-follow Catalogd:', followInsertError);
        }
    } catch (err) {
        console.warn('Catalogd follow default failed:', err);
    }
}

async function checkUserStatus() {
    await customElements.whenDefined('app-header');
    const header = document.querySelector('app-header');
    
    // Call the component's method and pass the custom callback!
    const user = await header.initializeAuth(supabaseClient, () => openAuthModal());

    if (user) {
        await ensureCatalogdFollow(user);

        const { data: customImgs } = await supabaseClient.from('custom_imgs').select('*').eq('user_id', user.id);
        if (customImgs) {
            customImgs.forEach(img => customImgsMap.set(`${img.media_type}_${img.media_id}`, img));
        }

        try {
            const { data: profileServices } = await supabaseClient.from('profiles').select('services').eq('id', user.id).single();
            userStreamingProviderIds = ((profileServices && profileServices.services && profileServices.services.streaming) || []).map(String);
        } catch (e) {
            userStreamingProviderIds = [];
        }
    } 
}

async function performSignUp(email, password, name, username, retype) {
    if (!email || !password || !name || !username) return alert("Please fill in all fields.");
    if (password !== retype) return alert("Passwords do not match!");
    if (password.length < 6) return alert("Password must be at least 6 characters.");

    const { data: signUpData, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { display_name: name, username: username } }
    });
    if (error) throw error;

    if (signUpData?.user) {
        await ensureCatalogdFollow(signUpData.user);
    }

    alert("Success! Check your email for a confirmation link.");
    closeAuthModal();
}

async function performSignIn(email, password) {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    closeAuthModal();
    await checkUserStatus();
}

async function handleAuth() {
    const email = authEmail.value;
    const password = authPassword.value;

    try {
        if (isSignUpMode) {
            await performSignUp(email, password, authName.value, authUsername.value, authRetype.value);
        } else {
            await performSignIn(email, password);
        }
    } catch (err) {
        alert(err.message);
    }
}

function openAuthModal() { authModal.style.display = 'flex'; }
function closeAuthModal() { authModal.style.display = 'none'; }

function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    modalTitle.textContent = isSignUpMode ? "Create Account" : "Welcome Back";
    authConfirmBtn.textContent = isSignUpMode ? "Sign Up" : "Sign In";
    authSwitch.textContent = isSignUpMode ? "Already have an account? Sign In" : "Need an account? Sign Up";
    signupFields.style.display = isSignUpMode ? "block" : "none";
    authRetype.style.display = isSignUpMode ? "block" : "none";
}

// HELPER: Handles fetching and deduplicating items
async function fetchAndMergeTabItems(type) {
    let forYouItems = [];
    if (['movie', 'tv'].includes(type)) {
        forYouItems = await getForYouItems(type);
        maybeShowServicesNudge();
    }

    let trendingItems = await getTrendingItems(type);
    const forYouIds = new Set(forYouItems.map(item => String(item.id)));
    trendingItems = trendingItems.filter(item => !forYouIds.has(String(item.id)));

    return [...forYouItems, ...trendingItems];
}

async function loadTabContent(type) {
    beginContentRequest();
    const requestId = ++contentRequestId;
    const sectionTitle = document.getElementById('section-title');
    if (sectionTitle) sectionTitle.style.display = 'none'; 
    
    resultsGrid.innerHTML = '';
    loader.style.display = 'block';
    
    try {
        if (['youtube', 'user', 'person', 'author'].includes(type)) {
            document.querySelector('.vibe-container')?.remove();
        } else {
            calculateAndRenderVibe(type, requestId);
        }

        // STEP 1: Fetch and render Trending Items FIRST for instant UI feedback
        loader.textContent = `Fetching trending ${type}s...`;
        let trendingItems = await getTrendingItems(type);
        if (requestId !== contentRequestId) return;

        if (trendingItems.length === 0) {
            resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align: center;">No items found.</p>';
        } else {
            renderResults(trendingItems);
        }

        // STEP 2: Only attempt to calculate "For You" if they are signed in and on a supported tab
        if (['movie', 'tv'].includes(type)) {
            const { data: { user } } = await supabaseClient.auth.getUser();

            if (user) {
                if (requestId !== contentRequestId) return;
                // Keep the loader visible while the AI thinks
                loader.style.display = 'block';
                loader.textContent = `Calculating "For You" ${type}s...`;

                const forYouItems = await getForYouItems(type);
                if (requestId !== contentRequestId) return;
                maybeShowServicesNudge();

                if (forYouItems.length > 0) {
                    // Filter out any trending items that the AI already picked for you
                    const forYouIds = new Set(forYouItems.map(item => String(item.id)));
                    trendingItems = trendingItems.filter(item => !forYouIds.has(String(item.id)));

                    // Re-render the grid with the AI items injected at the very top!
                    const combined = [...forYouItems, ...trendingItems];
                    renderResults(combined);
                }
            }
        }
    } catch (err) {
        if (requestId !== contentRequestId) return;
        if (err.name === 'AbortError') return;
        console.error("Tab content load failed:", err);
        loader.textContent = "Failed to load content.";
        loader.style.display = 'block';
    } finally {
        if(loader.textContent.startsWith("Fetching") || loader.textContent.startsWith("Calculating")) {
            loader.style.display = 'none';
        }
    }
}

// HELPER: Resolves book images without nested ternaries
function resolveBookImage(work) {
    if (work.cover_edition_key) return `https://covers.openlibrary.org/b/olid/${work.cover_edition_key}-M.jpg`;
    if (work.cover_i) return `https://covers.openlibrary.org/b/id/${work.cover_i}-M.jpg`;
    return 'https://placehold.co/500x750/1b2228/9ab?text=No+Cover';
}

async function fetchTrendingBooks() {
    let res = await contentFetch(`https://openlibrary.org/trending/daily.json?limit=15`);
    let text = await res.text();
    if (text.trim().startsWith('<')) {
        res = await contentFetch(`https://openlibrary.org/search.json?q=subject:fiction&sort=editions&limit=15`);
        text = await res.text();
    }
    const data = JSON.parse(text);
    const itemsList = data.works || data.docs || [];
    
    return itemsList.map(work => ({
        title: work.title,
        year: work.first_publish_year || work.publish_year?.[0] || '',
        author: work.author_name?.[0] || null,
        image: resolveBookImage(work),
        type: 'book',
        id: work.key,
        isTrending: true
    }));
}

async function fetchTrendingAlbums() {
    const res = await contentFetch(`https://ws.audioscrobbler.com/2.0/?method=tag.gettopalbums&tag=pop&api_key=${LASTFM_KEY}&format=json&limit=15`);
    const data = await res.json();
    return (data.albums.album || []).map(a => {
        let img = 'https://via.placeholder.com/500x750?text=No+Image';
        if (a.image?.[3]?.['#text']) img = a.image[3]['#text'];
        const compositeId = encodeURIComponent(`${a.artist.name}|||${a.name}`);
        
        return { 
            title: a.name, year: '', author: a.artist?.name || null, 
            image: img, type: 'album', id: compositeId, isTrending: true 
        };
    });
}

async function getTrendingItems(type) {
    try {
        if (type === 'book') return await fetchTrendingBooks();
        if (type === 'album') return await fetchTrendingAlbums();

        const res = await contentFetch(`https://api.themoviedb.org/3/trending/${type}/day`, {
            headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` } 
        });
        const data = await res.json();
        
        return (data.results || []).map(item => ({
            title: item.title || item.name,
            year: (item.release_date || item.first_air_date || '').split('-')[0],
            image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
            type: type,
            id: item.id,
            isTrending: true
        }));
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.error("Trending fetch error:", e);
        return [];
    }
}

const fallbackGradient = 'linear-gradient(135deg, #2a2f3a, #1b1f27)';
function backgroundStyle(img) {
    return img ? `background-image: url('${img}'); background-size: cover; background-position: center;`
                : `background: ${fallbackGradient};`;
}
function attributionHtml(attr) {
    if (!attr?.text) return '';
    const style = 'position:absolute;bottom:6px;right:8px;font-size:10px;line-height:1.2;' +
        'color:rgba(255,255,255,0.65);background:rgba(0,0,0,0.35);padding:2px 6px;' +
        'border-radius:4px;text-decoration:none;pointer-events:auto;z-index:2;';
    return attr.url
        ? `<a href="${attr.url}" target="_blank" rel="noopener noreferrer" class="vibe-attribution-link" style="${style}">${attr.text}</a>`
        : `<div class="vibe-attribution" style="${style}">${attr.text}</div>`;
}

function renderVibeBox(genreName, themeName, genreImg, themeImg, genreAttr, themeAttr) {
    const vibeContainer = document.createElement('div');
    vibeContainer.className = 'vibe-container';
    
    if (themeName) {
        vibeContainer.innerHTML = `
            <div class="vibe-title">Your Vibe</div>
            <div class="vibe-box">
                <div class="vibe-half" style="${backgroundStyle(genreImg)}">
                    <span class="vibe-text">${genreName}</span>
                    ${attributionHtml(genreAttr)}
                </div>
                <div class="vibe-half" style="${backgroundStyle(themeImg)}">
                    <span class="vibe-text">${themeName}</span>
                    ${attributionHtml(themeAttr)}
                </div>
                <div class="vibe-blend"></div> 
             </div>
        `;
    } else {
        vibeContainer.innerHTML = `
            <div class="vibe-title">Your Vibe</div>
            <div class="vibe-box">
                <div class="vibe-half" style="${backgroundStyle(genreImg)}; flex: 100%;">
                    <span class="vibe-text">${genreName}</span>
                    ${attributionHtml(genreAttr)}
                </div>
             </div>
        `;
    }
    
    const existingVibe = document.querySelector('.vibe-container');
    if (existingVibe) existingVibe.remove();
    const filterNav = document.querySelector('.filter-nav');
    if (filterNav) filterNav.parentNode.insertBefore(vibeContainer, filterNav.nextSibling);
}

async function processVibeQueueUpdate(vibeData, mediaType, cleanGenre, cleanTheme) {
    const currentStoredGenre = vibeData.current_top_genre?.[mediaType] || '';
    const currentStoredTheme = vibeData.current_top_theme?.[mediaType] || '';
    
    const queuedGenre = vibeData.new_top_genre?.[mediaType] || '';
    const queuedTheme = vibeData.new_top_theme?.[mediaType] || '';

    const needsGenreQueue = (cleanGenre !== currentStoredGenre) && (cleanGenre !== queuedGenre);
    const needsThemeQueue = (cleanTheme !== currentStoredTheme) && (cleanTheme !== queuedTheme);
    
    if (needsGenreQueue || needsThemeQueue) {
        const updatedNewGenre = { ...(vibeData.new_top_genre || {}) };
        const updatedNewTheme = { ...(vibeData.new_top_theme || {}) };

        if (needsGenreQueue) updatedNewGenre[mediaType] = cleanGenre;
        if (needsThemeQueue) updatedNewTheme[mediaType] = cleanTheme;

        await supabaseClient.from('vibes_control').update({
            needs_update: true,
            new_top_genre: updatedNewGenre,
            new_top_theme: updatedNewTheme
        }).eq('id', vibeData.id);
    }
}

async function updateAndRenderVibeFromDB(mediaType, genreName, themeName) {
    if (!genreName) {
        document.querySelector('.vibe-container')?.remove();
        return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const cleanGenre = genreName.replace(/\b\w/g, l => l.toUpperCase());
    const cleanTheme = themeName ? themeName.replace(/\b\w/g, l => l.toUpperCase()) : '';

    try {
        const { data: vibeData } = await supabaseClient
            .from('vibes_control')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        let genreImg = '', themeImg = '';
        let genreAttr = null, themeAttr = null;

        if (!vibeData) {
            await supabaseClient.from('vibes_control').insert({
                user_id: user.id,
                needs_update: true,
                new_top_genre: { [mediaType]: cleanGenre },
                new_top_theme: { [mediaType]: cleanTheme },
                current_top_genre: null,
                current_top_theme: null,
                image_genre: null,
                image_theme: null,
                image_genre_attribution: null,
                image_genre_attribution_url: null,
                image_theme_attribution: null,
                image_theme_attribution_url: null
            });
        } else {
            await processVibeQueueUpdate(vibeData, mediaType, cleanGenre, cleanTheme);

            genreImg = vibeData.image_genre?.[mediaType] || '';
            themeImg = vibeData.image_theme?.[mediaType] || '';
            
            const genreAttrText = vibeData.image_genre_attribution?.[mediaType];
            const genreAttrUrl = vibeData.image_genre_attribution_url?.[mediaType];
            if (genreAttrText) {
                genreAttr = { text: genreAttrText, url: genreAttrUrl || null };
            }

            const themeAttrText = vibeData.image_theme_attribution?.[mediaType];
            const themeAttrUrl = vibeData.image_theme_attribution_url?.[mediaType];
            if (themeAttrText) {
                themeAttr = { text: themeAttrText, url: themeAttrUrl || null };
            }
        }

        renderVibeBox(cleanGenre, cleanTheme, genreImg, themeImg, genreAttr, themeAttr);
    } catch (e) {
        console.error("Failed to fetch vibe from DB:", e);
    }
}

function calculateWeight(rating) {
    if (rating === 5) return 5;
    if (rating >= 4.5) return 2.5;
    return 1;
}

// --- CALCULATE AND RENDER VIBE HELPERS ---
async function tallyMovieTvVibe(logs, mediaType) {
    let genreCounts = {}, keywordCounts = {}, genreNames = {}, keywordNames = {};
    const analyzePromises = logs.slice(0, 15).map(item => 
        contentFetch(`https://api.themoviedb.org/3/${mediaType}/${item.media_id}?append_to_response=keywords`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
        }).then(r => r.json()).catch((error) => {
            if (error.name === 'AbortError') throw error;
            return null;
        })
    );
    
    const analyzedItems = await Promise.all(analyzePromises);
    
    analyzedItems.forEach((res, index) => {
        if (!res) return;
        const r = logs[index].rating;
        const w = calculateWeight(r);
        
        (res.genres || []).forEach(g => {
            genreCounts[g.id] = (genreCounts[g.id] || 0) + w;
            genreNames[g.id] = g.name;
        });
        
        const kw = mediaType === 'tv' ? (res.keywords?.results || []) : (res.keywords?.keywords || []);
        kw.forEach(k => {
            keywordCounts[k.id] = (keywordCounts[k.id] || 0) + w;
            keywordNames[k.id] = k.name;
        });
    });
    
    const topGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]);
    const topKeywords = Object.keys(keywordCounts).sort((a, b) => keywordCounts[b] - keywordCounts[a]);
    
    return {
        topGenre: topGenres.length > 0 ? genreNames[topGenres[0]] : '',
        topTheme: topKeywords.length > 0 ? keywordNames[topKeywords[0]] : ''
    };
}

async function tallyBookVibe(logs) {
    let bookCounts = {};
    const bookPromises = logs.map(log => 
        contentFetch(`https://openlibrary.org${normalizeOpenLibraryId(log.media_id)}.json`).then(r => r.json()).catch((error) => {
            if (error.name === 'AbortError') throw error;
            return null;
        })
    );
    const booksData = await Promise.all(bookPromises);
    
    booksData.forEach((book, index) => {
        if (book?.subjects) {
            const r = logs[index].rating;
            const w = calculateWeight(r);
            book.subjects.forEach(s => {
                const subjectName = typeof s === 'string' ? s : (s.name || '');
                if (subjectName) {
                    const cleanName = subjectName.toLowerCase().trim();
                    bookCounts[cleanName] = (bookCounts[cleanName] || 0) + w;
                }
            });
        }
    });
    const sortedBooks = Object.keys(bookCounts).sort((a, b) => bookCounts[b] - bookCounts[a]);
    return sortedBooks.length > 0 ? sortedBooks[0] : '';
}

async function tallyAlbumVibe(logs) {
    let musicCounts = {};
    const musicPromises = logs.map(log => {
        const decodedId = decodeURIComponent(log.media_id);
        const [artist, album] = decodedId.split('|||');
        return contentFetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${LASTFM_KEY}&format=json`)
            .then(r => r.json()).catch(() => null);
    });
    const musicData = await Promise.all(musicPromises);
    
    musicData.forEach((res, index) => {
        if (res?.album?.tags?.tag) {
            const r = logs[index].rating;
            const w = calculateWeight(r);
            res.album.tags.tag.forEach(t => {
                if (t.name) {
                    const cleanName = t.name.toLowerCase().trim();
                    musicCounts[cleanName] = (musicCounts[cleanName] || 0) + w;
                }
            });
        }
    });
    const sortedMusic = Object.keys(musicCounts).sort((a, b) => musicCounts[b] - musicCounts[a]);
    return sortedMusic.length > 0 ? sortedMusic[0] : '';
}

async function calculateAndRenderVibe(mediaType, requestId) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    try {
        const { data: logs } = await supabaseClient
            .from('media_logs')
            .select('media_id, rating')
            .eq('user_id', user.id)
            .eq('media_type', mediaType)
            .gte('rating', 4)
            .order('rating', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(25);

        if (!logs || logs.length === 0) {
            const existingVibe = document.querySelector('.vibe-container');
            if (existingVibe) existingVibe.remove();
            return;
        }

        let topGenre = '';
        let topTheme = '';

        if (mediaType === 'movie' || mediaType === 'tv') {
            const result = await tallyMovieTvVibe(logs, mediaType);
            topGenre = result.topGenre;
            topTheme = result.topTheme;
            console.log(`[I] Top ${mediaType.toUpperCase()}...\n     | Genre: ${topGenre}\n     | Theme: ${topTheme}`);
        } else if (mediaType === 'book') {
            topGenre = await tallyBookVibe(logs);
            console.log(`[I] Top Book...\n     | Genre: ${topGenre}`);
        } else if (mediaType === 'album') {
            topGenre = await tallyAlbumVibe(logs);
            console.log(`[I] Top Music...\n     | Genre: ${topGenre}`);
        }

        if (requestId !== contentRequestId) return;
        updateAndRenderVibeFromDB(mediaType, topGenre, topTheme);
    } catch (e) {
        console.error("Vibe rendering failed:", e);
    }
}

// --- GET FOR YOU ITEMS HELPERS ---

function buildDiscoverUrls(mediaType, topGenres, topKeywords) {
    const providerParams = `&with_watch_monetization_types=flatrate|free|ads`;
    
    const keywordUrls = topKeywords.map(keywordId => {
        let url = `https://api.themoviedb.org/3/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US&page=1`;
        url += `&with_genres=${topGenres.join('|')}&with_keywords=${keywordId}${providerParams}`;
        return url;
    });

    const genreOnlyUrls = [1, 2].map(page => {
        let url = `https://api.themoviedb.org/3/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US&page=${page}`;
        url += `&with_genres=${topGenres.join('|')}${providerParams}`;
        return url;
    });

    return { keywordUrls, genreOnlyUrls };
}

function evaluateProviderAvailability(item, userStreamingProviderIds) {
    if (userStreamingProviderIds.length === 0) return true;
    
    const usProviders = item['watch/providers']?.results?.US || {};
    const flatrateIds = (usProviders.flatrate || []).map(p => String(p.provider_id));
    const freeIds = (usProviders.free || []).map(p => String(p.provider_id));
    const adsIds = (usProviders.ads || []).map(p => String(p.provider_id));

    const isOnUserServices = [...flatrateIds, ...freeIds, ...adsIds].some(id => userStreamingProviderIds.includes(id));
    const isFreeAnywhere = freeIds.length > 0 || adsIds.length > 0;

    return isOnUserServices || isFreeAnywhere;
}

const waitMs = ms => new Promise(res => setTimeout(res, ms));

async function processDiscoverCandidates(urls, requireTheme, contextData, uniqueRecs, seenCandidateIds) {
    const { topGenres, topKeywords, keywordCounts, genreCounts, loggedIds, userStreamingProviderIds, mediaType } = contextData;
    
    const pages = await Promise.all(
        urls.map(u => contentFetch(u, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json()).catch((error) => {
            if (error.name === 'AbortError') throw error;
            return {};
        }))
    );

    let rawRecommendations = [];
    pages.forEach(page => { if (page.results) rawRecommendations.push(...page.results); });

    const newIds = [...new Set(rawRecommendations.map(i => i.id))]
        .filter(id => !loggedIds.has(String(id)) && !seenCandidateIds.has(id));
    newIds.forEach(id => seenCandidateIds.add(id));

    if (newIds.length === 0) return;

    const detailedCandidates = [];
    for (const id of newIds) {
        try {
            throwIfContentAborted();
            const res = await contentFetch(`https://api.themoviedb.org/3/${mediaType}/${id}?append_to_response=keywords,watch/providers`, {
                headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
            });
            if (res.status === 429) {
                console.warn(`[WARNING] TMDB Rate Limit hit for item ID: ${id}. Waiting before retry...`);
                await waitMs(500); // Back off if a 429 slips through
                continue;
            }
            const data = await res.json();
            detailedCandidates.push(data);
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.error(`Failed fetching candidate details for ID ${id}:`, err);
            detailedCandidates.push(null);
        }
        await waitMs(50); // Safe 50ms pacing interval between external lookups
    }

    detailedCandidates.forEach(item => {
        if (!item?.id) return;

        const hasTopGenre = (item.genres || []).some(g => topGenres.includes(String(g.id)));
        if (!hasTopGenre) return;

        if (!evaluateProviderAvailability(item, userStreamingProviderIds)) return;

        let themeScore = 0;
        let genreScore = 0;

        const keywordsArray = item.keywords?.keywords || item.keywords?.results || [];
        keywordsArray.forEach(k => {
            if (topKeywords.includes(String(k.id))) {
                themeScore += keywordCounts[k.id];
            }
        });

        if (requireTheme && themeScore === 0) return;

        (item.genres || []).forEach(g => {
            if (topGenres.includes(String(g.id))) {
                genreScore += genreCounts[g.id];
            }
        });

        const finalScore = (themeScore * 1000) + genreScore + (item.popularity / 10000);
        uniqueRecs.set(item.id, { ...item, _score: finalScore });
    });
}

async function getForYouItems(mediaType) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return [];

    try {
        const { data: highlyRated } = await supabaseClient
            .from('media_logs')
            .select('media_id, rating') 
            .eq('user_id', user.id)
            .eq('media_type', mediaType)
            .gte('rating', 4)
            .order('rating', { ascending: false })
            .limit(25);

        if (!highlyRated || highlyRated.length === 0) return [];

        let genreCounts = {}, keywordCounts = {}, genreNames = {}, keywordNames = {};
        const analyzePromises = highlyRated.map(item => 
            contentFetch(`https://api.themoviedb.org/3/${mediaType}/${item.media_id}?append_to_response=keywords`, {
                headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
            }).then(r => r.json()).catch((error) => {
                if (error.name === 'AbortError') throw error;
                return null;
            })
        );
        
        const analyzedItems = await Promise.all(analyzePromises);

        analyzedItems.forEach((res, index) => {
            if (!res) return;
            const itemRating = highlyRated[index].rating;
            let weight = itemRating === 5 ? 5 : (itemRating >= 4.5 ? 2.5 : 1);

            (res.genres || []).forEach(g => {
                genreCounts[g.id] = (genreCounts[g.id] || 0) + weight;
                genreNames[g.id] = g.name; 
            });
            const keywordsArray = res.keywords?.keywords || res.keywords?.results || [];
            keywordsArray.forEach(k => {
                keywordCounts[k.id] = (keywordCounts[k.id] || 0) + weight;
                keywordNames[k.id] = k.name; 
            });
        });

        const topGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]).slice(0, 3);
        const topKeywords = Object.keys(keywordCounts).sort((a, b) => keywordCounts[b] - keywordCounts[a]).slice(0, 5);

        if (topGenres.length === 0 || topKeywords.length === 0) return [];

        const { data: allDiary } = await supabaseClient
            .from('media_logs')
            .select('media_id')
            .eq('user_id', user.id)
            .eq('media_type', mediaType);
            
        const loggedIds = new Set((allDiary || []).map(d => String(d.media_id)));
        const { keywordUrls, genreOnlyUrls } = buildDiscoverUrls(mediaType, topGenres, topKeywords);

        const contextData = { topGenres, topKeywords, keywordCounts, genreCounts, loggedIds, userStreamingProviderIds, mediaType };
        const uniqueRecs = new Map();
        const seenCandidateIds = new Set();

        await processDiscoverCandidates(keywordUrls, true, contextData, uniqueRecs, seenCandidateIds);

        if (userStreamingProviderIds.length > 0 && uniqueRecs.size < 12) {
            await processDiscoverCandidates(genreOnlyUrls, false, contextData, uniqueRecs, seenCandidateIds);
        }

        return Array.from(uniqueRecs.values())
            .sort((a, b) => b._score - a._score)
            .slice(0, 12)
            .map(item => ({
                title: item.title || item.name,
                year: (item.release_date || item.first_air_date || '').split('-')[0],
                image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                type: mediaType,
                id: item.id,
                isForYou: true 
            }));
    } catch (err) {
        console.error("For you fetch error:", err);
        return [];
    }
}

// Shows a one-time, dismissible nudge asking the user to pick their streaming
// services in Settings so "For You" can be filtered to what they can actually watch.
// Only fires when: logged in, on Movies/TV tab, no streaming services saved yet,
// and the user hasn't already dismissed it this browser (localStorage flag).
function maybeShowServicesNudge() {
    if (userStreamingProviderIds.length > 0) return; // already configured
    if (localStorage.getItem('catalogd_services_nudge_dismissed') === 'true') return;
    if (document.getElementById('services-nudge-modal')) return; // already shown once this session

    supabaseClient.auth.getUser().then(({ data: { user } }) => {
        if (!user) return; // only nudge logged-in users

        const modal = document.createElement('div');
        modal.id = 'services-nudge-modal';
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="auth-card" style="max-width: 380px;">
                <h2 style="margin-top:0;">Get Picks You Can Watch</h2>
                <p class="meta" style="margin-bottom: 25px;">
                    Add your streaming services in Settings so your "For You" recommendations
                    only include movies and shows available on platforms you actually have.
                </p>
                <button id="services-nudge-goto" class="primary-btn">Go to Settings</button>
                <p id="services-nudge-dismiss" style="color:#9ab; cursor:pointer; font-size:0.8rem; margin-top:15px;">Maybe later</p>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('services-nudge-goto').onclick = () => {
            window.location.href = 'settings.html';
        };
        document.getElementById('services-nudge-dismiss').onclick = () => {
            localStorage.setItem('catalogd_services_nudge_dismissed', 'true');
            modal.remove();
        };
    }).catch((err) => { 
        console.warn("Nudge check failed:", err);
    });
}

function renderResults(items, targetGrid = resultsGrid) {
    targetGrid.innerHTML = ''; 
    
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.dataset.type = item.type;
        
        card.onclick = () => {
            if (item.type === 'person') window.location.href = `cast.html?personId=${item.id}`;
            else if (item.type === 'author') window.location.href = `cast.html?authorId=${item.id}`;
            else if (item.type === 'user') window.location.href = `profile.html?id=${item.id}`;
            else window.location.href = `details.html?id=${encodeURIComponent(item.id)}&type=${item.type}`;
        };
        
        let finalImage = item.image;
        const customArt = customImgsMap.get(`${item.type}_${String(item.id)}`);
        if (customArt && customArt.custom_poster) finalImage = customArt.custom_poster;

        // Display badges based on the flags embedded inside the item data
        const trendingBadge = item.isTrending && item.type !== 'user' ? `<div class="trending-label">Trending Today</div>` : '';
        const userBadge = item.type === 'user' ? `<div class="trending-label">Member</div>` : '';
        const forYouBadge = item.isForYou ? `<div class="foryou-label">For You</div>` : '';

        card.innerHTML = `
            <div class="poster-wrapper">
                ${trendingBadge}
                ${userBadge}
                ${forYouBadge}
                <img src="${finalImage}" 
                     alt="${item.title}" 
                     loading="lazy" 
                     onerror="this.onerror=null; this.src='https://via.placeholder.com/500x750?text=No+Image';">
                <span class="badge badge-${item.type}">${item.type}</span>
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                ${item.author ? `<div class="meta" style="color: var(--accent); font-weight: 500;">${item.author}</div>` : ''}
                <div class="meta">${item.year || ''}</div>
            </div>`;
        targetGrid.appendChild(card);
    });
}

window.switchTab = function(type) {
    currentTab = type;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${type}`).classList.add('active');
    searchInput.value = '';
    
    const sectionTitle = document.getElementById('section-title');
    
    if (type === 'youtube') {
        searchInput.placeholder = "Paste a YouTube link here...";
        if (sectionTitle) {
            sectionTitle.style.display = 'block';
            sectionTitle.textContent = "Add a YouTube Video";
        }
        document.getElementById('results-grid').innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align: center;">Paste a valid YouTube URL in the search bar above to log it!</p>';
        
        // Ensure the vibe box is removed since YouTube skips loadTabContent()
        const existingVibe = document.querySelector('.vibe-container');
        if (existingVibe) existingVibe.remove();

    } else if (type === 'album') {
        searchInput.placeholder = "Search for albums or artists...";
        loadTabContent(type);
    } else {
        searchInput.placeholder = "Search for movies, shows, books, authors, ...";
        loadTabContent(type);
    }
};

// --- UNIFIED SEARCH HELPERS ---

async function fetchSearchData(query, filterValue, payload) {
    const fetchPromises = [];
    const options = { method: 'GET', headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` } };

    if (['all', 'movie', 'tv', 'person'].includes(filterValue)) {
        let endpoint = filterValue === 'all' ? 'search/multi' : `search/${filterValue}`;
        fetchPromises.push(
            contentFetch(`https://api.themoviedb.org/3/${endpoint}?query=${encodeURIComponent(query)}`, options)
                .then(r => r.json()).then(d => payload.tmdbRes = d)
        );
    }
    if (['all', 'book'].includes(filterValue)) {
        fetchPromises.push(fetchBooks(query).then(d => payload.bookData = d));
    }
    if (['all', 'author'].includes(filterValue)) {
        fetchPromises.push(fetchAuthors(query).then(d => payload.authorData = d));
    }
    if (['all', 'user'].includes(filterValue)) {
        fetchPromises.push(
            supabaseClient.from('profiles').select('id, username, display_name, avatar_url')
                .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`).limit(10)
                .then(res => payload.users = res.data || [])
        );
    }
    if (['all', 'album'].includes(filterValue)) {
        fetchPromises.push(
            contentFetch(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(query)}&api_key=${LASTFM_KEY}&format=json`)
                .then(r => r.json()).then(res => {
                    if (res.results?.albummatches?.album) {
                        payload.lastfmAlbums = res.results.albummatches.album.map(a => ({
                            id: encodeURIComponent(`${a.artist}|||${a.name}`),
                            title: a.name, type: 'album', image: a.image?.[3]?.['#text'] || 'https://via.placeholder.com/500x750?text=No+Image', author: a.artist
                        }));
                    }
                }).catch(err => console.error("Last.fm search error:", err))
        );
    }
    await Promise.all(fetchPromises);
}

function sortSearchResults(combined, query) {
    const q = query.toLowerCase().trim();
    combined.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        if (aTitle === q && bTitle !== q) return -1;
        if (bTitle === q && aTitle !== q) return 1;
        const aStarts = aTitle.startsWith(q);
        const bStarts = bTitle.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        return 0; 
    });
}

async function unifiedSearch(query) {
    beginContentRequest();
    const requestId = ++contentRequestId;
    const filterNav = document.querySelector('.filter-nav');
    const filterValue = document.getElementById('search-filter').value;
    const sectionTitle = document.getElementById('section-title');

    if (!query?.trim()) {
        const url = new URL(window.location);
        url.searchParams.delete('search');
        window.history.pushState({}, '', url);
        if (filterNav) filterNav.style.display = 'flex'; 
        if (currentTab !== 'youtube') loadTabContent(currentTab); 
        return;
    }

    const ytRegex = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|embed)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const ytMatch = query.match(ytRegex);

    if (ytMatch || currentTab === 'youtube') {
        if (ytMatch?.[1]) {
            window.location.href = `details.html?id=${ytMatch[1]}&type=youtube`;
        } else {
            loader.textContent = "Please enter a valid YouTube URL.";
            loader.style.display = 'block';
        }
        return; 
    }

    if (filterNav) filterNav.style.display = 'none'; 
    if (sectionTitle) sectionTitle.textContent = `Search Results for "${query}"`;

    loader.style.display = 'block';
    loader.textContent = "Exploring the archives...";
    resultsGrid.innerHTML = '';

    try {
        const payload = { tmdbRes: { results: [] }, bookData: [], authorData: [], users: [], lastfmAlbums: [] };
        await fetchSearchData(query, filterValue, payload);
        if (requestId !== contentRequestId) return;

        const seenNames = new Set();
        const mappedUsers = payload.users.map(u => ({
            title: u.display_name || u.username, year: `@${u.username}`,
            image: u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name || u.username)}&background=1b2228&color=9ab&size=512`,
            type: 'user', id: u.id
        }));

        const processedAuthors = payload.authorData.filter(author => {
            const nameKey = author.title.toLowerCase();
            if (seenNames.has(nameKey)) return false;
            seenNames.add(nameKey);
            return true;
        });

        const tmdbResults = (payload.tmdbRes.results || []).map(item => {
            if (item.media_type === 'person' || filterValue === 'person') {
                const nameKey = item.name.toLowerCase();
                if (seenNames.has(nameKey)) return null; 
                seenNames.add(nameKey);
                return {
                    title: item.name, year: item.known_for_department || 'Person',
                    image: item.profile_path ? `https://image.tmdb.org/t/p/w500${item.profile_path}` : `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=1b2228&color=9ab&size=512`,
                    type: 'person', id: item.id
                };
            } else if (item.poster_path || item.backdrop_path) {
                return {
                    title: item.title || item.name, year: (item.release_date || item.first_air_date || '').split('-')[0],
                    image: `https://image.tmdb.org/t/p/w500${item.poster_path || item.backdrop_path}`, type: item.media_type || filterValue, id: item.id
                };
            }
            return null;
        }).filter(Boolean);

        let combined = [...mappedUsers, ...processedAuthors, ...tmdbResults, ...payload.bookData, ...payload.lastfmAlbums];
        if (filterValue !== 'all') {
            combined = combined.filter(item => item.type === filterValue);
        }

        sortSearchResults(combined, query);
        
        if (combined.length === 0) {
            loader.textContent = "No results found.";
        } else {
            renderResults(combined);
            loader.style.display = 'none';
        }
    } catch (err) { 
        if (requestId !== contentRequestId) return;
        console.error("Search failed:", err); 
        loader.textContent = "Search failed.";
    }
}

async function fetchBooks(query) {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=50`;
    const res = await contentFetch(url);
    const data = await res.json();
    return (data.docs || [])
        .map(doc => {
            const author = doc.author_name?.[0] || null;
            const image = doc.cover_i 
                ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` 
                : `https://via.placeholder.com/500x750?text=${encodeURIComponent(doc.title)}`;
                
            return {
                title: doc.title,
                year: doc.first_publish_year,
                author: author,
                image: image,
                type: 'book',
                id: doc.key
            };
        });
}

async function fetchAuthors(query) {
    const url = `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=5`;
    try {
        const res = await contentFetch(url);
        const data = await res.json();
        
        const seenAuthorNames = new Set();
        return (data.docs || [])
            .map(doc => {
                const nameKey = doc.name.toLowerCase();
                if (seenAuthorNames.has(nameKey)) return null;
                seenAuthorNames.add(nameKey);
                
                const image = doc.key 
                    ? `https://covers.openlibrary.org/a/olid/${doc.key}-M.jpg` 
                    : `https://ui-avatars.com/api/?name=${encodeURIComponent(doc.name)}&background=1b2228&color=9ab&size=512`;

                return {
                    title: doc.name,
                    year: 'Author',
                    image: image,
                    type: 'author',
                    id: doc.key
                };
            })
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

async function handleForgotPassword() {
    const email = authEmail.value;
    if (!email) {
        alert("Please enter your email address first.");
        authEmail.focus();
        return;
    }
    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/settings.html',
        });
        if (error) throw error;
        alert("Success! Check your email for a password reset link.");
        closeAuthModal();
    } catch (err) {
        alert("Error: " + err.message);
    }
}

document.addEventListener('mousemove', (e) => {
    // Only run this animation if the screen width is greater than 768px (Desktop)
    if (window.innerWidth <= 768) return; 

    const cards = document.querySelectorAll('.media-card');
    
    cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left; // Mouse position inside card
        const y = e.clientY - rect.top;
        
        // Calculate tilt
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = (y - centerY) / 20; // Adjust 20 for intensity
        const rotateY = (centerX - x) / 20;
        
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
    });
});

// Reset tilt when mouse leaves
document.addEventListener('mouseleave', () => {
    // Only run this animation if the screen width is greater than 768px (Desktop)
    if (window.innerWidth <= 768) return;

    const cards = document.querySelectorAll('.media-card');
    cards.forEach(card => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
    });
});

authConfirmBtn.addEventListener('click', handleAuth);
closeModal.addEventListener('click', closeAuthModal);
document.querySelectorAll('[data-navigation]').forEach((button) => {
    button.addEventListener('click', () => {
        window.location.href = button.dataset.navigation;
    });
});
document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
});
document.getElementById('forgot-password-link')?.addEventListener('click', handleForgotPassword);
authSwitch.addEventListener('click', toggleAuthMode);

loadConfig();