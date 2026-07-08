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
let customImgsMap = new Map();
// Provider IDs (TMDB watch/providers ids, as strings) the user picked in Settings > Your Services > Streaming.
// Populated in checkUserStatus(). Empty array = no filtering (user hasn't set services yet).
let userStreamingProviderIds = [];

/*
* Fetches configuration variables, initializes external APIs (Supabase, TMDB, Last.fm),
*   sets up initial event listeners for the search bar, and dictates the initial
*   UI state based on URL parameters or trending defaults.
* @async
* @throws {Error} If config.json cannot be fetched.
*/
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error("config.json not found");
        const config = await response.json();
        
        TMDB_TOKEN = config.tmdb_token;
        LASTFM_KEY = config.lastfm_key;
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        UNSPLASH_KEY = config.unsplash_key;
        
        await checkUserStatus(); 

        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, books, authors, ...";
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') unifiedSearch(searchInput.value);
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

async function checkUserStatus() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const profileMenu = document.getElementById('profile-menu');
    const loginBtn = document.getElementById('login-btn');
    
    if (user) {
        const { data: customImgs } = await supabaseClient
            .from('custom_imgs')
            .select('*')
            .eq('user_id', user.id);
            
        if (customImgs) {
            customImgs.forEach(img => {
                customImgsMap.set(`${img.media_type}_${img.media_id}`, img);
            });
        }

        // Load the user's preferred streaming services (Settings > Your Services) so
        // "For You" recommendations can be filtered to what they can actually watch.
        try {
            const { data: profileServices } = await supabaseClient
                .from('profiles')
                .select('services')
                .eq('id', user.id)
                .single();
            userStreamingProviderIds = ((profileServices && profileServices.services && profileServices.services.streaming) || []).map(String);
        } catch (e) {
            console.warn("Could not load streaming services:", e);
            userStreamingProviderIds = [];
        }

        loginBtn.textContent = "Sign Out";
        loginBtn.onclick = async () => {
            await supabaseClient.auth.signOut();
            location.reload();
        };
        if (profileBtn) profileBtn.style.display = 'inline-block';

        loginBtn.style.display = 'none'; // Hide Sign In
        profileMenu.style.display = 'block'; // Show Dropdown
        
        // Ensure avatar is set (Optional: fetch from Supabase user metadata)
        const avatar = document.getElementById('nav-avatar');
        if (user.user_metadata.avatar_url) avatar.src = user.user_metadata.avatar_url;
    } else {
        loginBtn.style.display = 'block'; 
        profileMenu.style.display = 'none';
        
        loginBtn.textContent = "Sign In";
        loginBtn.onclick = function() {
            openAuthModal();
        }
    }
}

async function handleAuth() {
    const email = authEmail.value;
    const password = authPassword.value;

    if (isSignUpMode) {
        const name = authName.value;
        const username = authUsername.value;
        const retype = authRetype.value;

        if (!email || !password || !name || !username) return alert("Please fill in all fields.");
        if (password !== retype) return alert("Passwords do not match!");
        if (password.length < 6) return alert("Password must be at least 6 characters.");

        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: { display_name: name, username: username }
                }
            });
            if (error) throw error;
            alert("Success! Check your email for a confirmation link.");
            closeAuthModal();
        } catch (err) {
            alert(err.message);
        }
    } else {
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            closeAuthModal();
            await checkUserStatus();
        } catch (err) {
            alert(err.message);
        }
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

async function loadTabContent(type) {
    const sectionTitle = document.getElementById('section-title');
    if (sectionTitle) sectionTitle.style.display = 'none'; // Hide headers for normal browsing

    resultsGrid.innerHTML = '';
    loader.style.display = 'block';
    loader.textContent = `Fetching ${type}s...`;

    try {
        let forYouItems = [];
        // Only attempt For You if it is a Movie or TV show
        if (['movie', 'tv'].includes(type)) {
            forYouItems = await getForYouItems(type);
            maybeShowServicesNudge();
        }

        let trendingItems = await getTrendingItems(type);

        // Remove any trending items that are already in the For You array to prevent duplicates
        const forYouIds = new Set(forYouItems.map(item => String(item.id)));
        trendingItems = trendingItems.filter(item => !forYouIds.has(String(item.id)));

        // Combine them: For You items populate at the top of the grid!
        const combined = [...forYouItems, ...trendingItems];

        if (combined.length === 0) {
            resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align: center;">No items found.</p>';
        } else {
            renderResults(combined);
        }
    } catch (err) {
        console.error("Tab content load failed:", err);
        loader.textContent = "Failed to load content.";
    } finally {
        if(loader.textContent.startsWith("Fetching")) loader.style.display = 'none';
    }
}

async function getTrendingItems(type) {
    try {
        if (type === 'book') {
            let res = await fetch(`https://openlibrary.org/trending/daily.json?limit=15`);
            let text = await res.text();
            if (text.trim().startsWith('<')) {
                res = await fetch(`https://openlibrary.org/search.json?q=subject:fiction&sort=editions&limit=15`);
                text = await res.text();
            }
            const data = JSON.parse(text);
            const itemsList = data.works || data.docs || [];
            return itemsList.map(work => ({
                title: work.title,
                year: work.first_publish_year || (work.publish_year && work.publish_year[0]) || '',
                author: work.author_name ? work.author_name[0] : null,
                image: work.cover_edition_key ? `https://covers.openlibrary.org/b/olid/${work.cover_edition_key}-M.jpg` : (work.cover_i ? `https://covers.openlibrary.org/b/id/${work.cover_i}-M.jpg` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Cover'),
                type: 'book',
                id: work.key,
                isTrending: true // Flag for the badge
            }));
        } else if (type === 'album') {
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=tag.gettopalbums&tag=pop&api_key=${LASTFM_KEY}&format=json&limit=15`);
            const data = await res.json();
            return (data.albums.album || []).map(a => {
                let img = 'https://via.placeholder.com/500x750?text=No+Image';
                if (a.image && a.image.length > 3 && a.image[3]['#text']) img = a.image[3]['#text'];
                const compositeId = encodeURIComponent(`${a.artist.name}|||${a.name}`);
                return { title: a.name, year: '', author: a.artist ? a.artist.name : null, image: img, type: 'album', id: compositeId, isTrending: true };
            });
        } else {
            const res = await fetch(`https://api.themoviedb.org/3/trending/${type}/day`, { headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` } });
            const data = await res.json();
            return (data.results || []).map(item => ({
                title: item.title || item.name,
                year: (item.release_date || item.first_air_date || '').split('-')[0],
                image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                type: type,
                id: item.id,
                isTrending: true // Flag for the badge
            }));
        }
    } catch (e) {
        console.error("Trending fetch error:", e);
        return [];
    }
}

function renderVibeBox(genreName, themeName, genreImg, themeImg, genreAttr, themeAttr) {
    // No more external placeholder image — if there's nothing to show yet (e.g. brand new
    // user waiting on tonight's job), just fall back to a plain gradient background.
    const fallbackGradient = 'linear-gradient(135deg, #2a2f3a, #1b1f27)';

    function backgroundStyle(img) {
        return img ? `background-image: url('${img}'); background-size: cover; background-position: center;`
                    : `background: ${fallbackGradient};`;
    }

    // Builds a small, unobtrusive credit line for a CC-licensed image. Returns
    // an empty string if there's nothing to attribute (e.g. the fallback gradient,
    // or a public-domain image where we chose not to show a credit).
    function attributionHtml(attr) {
        if (!attr || !attr.text) return '';
        const style = 'position:absolute;bottom:6px;right:8px;font-size:10px;line-height:1.2;' +
            'color:rgba(255,255,255,0.65);background:rgba(0,0,0,0.35);padding:2px 6px;' +
            'border-radius:4px;text-decoration:none;pointer-events:auto;z-index:2;';
        const label = attr.url
            ? `<a href="${attr.url}" target="_blank" rel="noopener noreferrer" class="vibe-attribution-link" style="${style}">${attr.text}</a>`
            : `<div class="vibe-attribution" style="${style}">${attr.text}</div>`;
        return label;
    }

    const vibeContainer = document.createElement('div');
    vibeContainer.className = 'vibe-container';
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

    // 1. Remove any existing vibe box so they don't duplicate when switching tabs
    const existingVibe = document.querySelector('.vibe-container');
    if (existingVibe) {
        existingVibe.remove();
    }

    // 2. Insert it exactly where you requested: above the filter nav
    const filterNav = document.querySelector('.filter-nav');
    if (filterNav) {
        filterNav.parentNode.insertBefore(vibeContainer, filterNav);
    }
}

async function getForYouItems(mediaType) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return [];

    try {
        // 1. Fetch up to 25 highly-rated items
        const { data: highlyRated } = await supabaseClient
            .from('media_logs')
            .select('media_id, rating') 
            .eq('user_id', user.id)
            .eq('media_type', mediaType)
            .gte('rating', 4)
            .order('rating', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(25);

        if (!highlyRated || highlyRated.length === 0) return [];

        let genreCounts = {};
        let keywordCounts = {};
        let genreNames = {};
        let keywordNames = {};
        
        // 2. Fetch TMDB data for ALL 25 items simultaneously
        const analyzePromises = highlyRated.map(item => 
            fetch(`https://api.themoviedb.org/3/${mediaType}/${item.media_id}?append_to_response=keywords`, {
                headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
            }).then(r => r.json()).catch(() => null) 
        );
        
        const analyzedItems = await Promise.all(analyzePromises);

        // 3. Tally genres and keywords with aggressive weighting
        analyzedItems.forEach((res, index) => {
            if (!res) return;
            
            const itemRating = highlyRated[index].rating;
            
            let weight = 1; 
            if (itemRating === 5) weight = 5;       
            else if (itemRating >= 4.5) weight = 2.5; 

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

        // 4. STRICT EXTRACTION: Top 3 Genres and Top 5 Keywords
        const topGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]).slice(0, 3);
        const topKeywords = Object.keys(keywordCounts).sort((a, b) => keywordCounts[b] - keywordCounts[a]).slice(0, 5);

        console.log(`🎬 --- ${mediaType.toUpperCase()} TASTE PROFILE (TARGETED) --- 🎬`);
        console.log("Top 3 Genres");
        console.table(topGenres.map(id => ({ Genre: genreNames[id], Score: genreCounts[id] })));
        console.log("Top 5 Themes/Keywords");
        console.table(topKeywords.map(id => ({ Theme: keywordNames[id], Score: keywordCounts[id] })));
        console.log("-------------------------------------------------");

        if (topGenres.length === 0 || topKeywords.length === 0) return [];

        // 5. Fetch all logged items to prevent duplicate recommendations
        const { data: allDiary } = await supabaseClient
            .from('media_logs')
            .select('media_id')
            .eq('user_id', user.id)
            .eq('media_type', mediaType);
            
        const loggedIds = new Set((allDiary || []).map(d => String(d.media_id)));

        // 6. TARGETED DISCOVERY FETCH (+ provider filter + backfill)
        // Instead of one big OR search, we fetch page(s) SPECIFICALLY for each of your top 5 themes.
        // This guarantees the blockbusters in theme #5 can't crowd out the niche films in theme #1.
        // If the user has picked streaming services in Settings, we also constrain the discovery
        // itself to titles available (subscription OR free/ad-supported) on one of those platforms.
        const hasProviderFilter = userStreamingProviderIds.length > 0;
        // Ask TMDB for subscriptions, fully free, AND free-with-ads
        const providerParams = `&with_watch_monetization_types=flatrate|free|ads`;

        const buildKeywordUrl = (keywordId, page) => {
            let url = `https://api.themoviedb.org/3/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US&page=${page}`;
            url += `&with_genres=${topGenres.join('|')}`; // Must have a top genre
            url += `&with_keywords=${keywordId}`;          // MUST have THIS specific theme
            url += providerParams;
            return url;
        };

        const buildGenreOnlyUrl = (page) => {
            // Relaxed fallback used only when provider-filtering shrinks the pool too much:
            // drops the strict keyword requirement but keeps genre + provider constraints.
            let url = `https://api.themoviedb.org/3/discover/${mediaType}?language=en-US&sort_by=popularity.desc&watch_region=US&page=${page}`;
            url += `&with_genres=${topGenres.join('|')}`;
            url += providerParams;
            return url;
        };

        const TARGET_COUNT = 12;
        const MAX_KEYWORD_PAGES = 3; // cap API usage while backfilling
        const seenCandidateIds = new Set();
        const uniqueRecs = new Map();

        // 7 & 8 combined: fetch a batch of discover URLs, deep-fetch details (+ real-time
        // watch/providers availability in the SAME request), score, and verify availability.
        async function processDiscoverUrls(urls, requireTheme = true) {
            const pages = await Promise.all(
                urls.map(u => fetch(u, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json()).catch(() => ({})))
            );

            let rawRecommendations = [];
            pages.forEach(page => { if (page.results) rawRecommendations.push(...page.results); });

            const newIds = [...new Set(rawRecommendations.map(i => i.id))]
                .filter(id => !loggedIds.has(String(id)) && !seenCandidateIds.has(id));
            newIds.forEach(id => seenCandidateIds.add(id));

            if (newIds.length === 0) return;

            const detailedCandidates = await Promise.all(newIds.map(id =>
                fetch(`https://api.themoviedb.org/3/${mediaType}/${id}?append_to_response=keywords,watch/providers`, {
                    headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
                }).then(r => r.json()).catch(() => null)
            ));

            detailedCandidates.forEach(item => {
                if (!item || !item.id) return;

                // RULE 1: Must contain a top genre
                const hasTopGenre = (item.genres || []).some(g => topGenres.includes(String(g.id)));
                if (!hasTopGenre) return;

                // RULE 2 (only when the user has picked services): double-check the title is
                // ACTUALLY available (subscription or free/ad-supported, e.g. Tubi/Roku Channel)
                // on one of their chosen platforms right now, independent of the discover filter.
                if (hasProviderFilter) {
                    const usProviders = (item['watch/providers'] && item['watch/providers'].results && item['watch/providers'].results.US) || {};
                    
                    // Group availability into distinct monetization types
                    const flatrateIds = (usProviders.flatrate || []).map(p => String(p.provider_id));
                    const freeIds = (usProviders.free || []).map(p => String(p.provider_id));
                    const adsIds = (usProviders.ads || []).map(p => String(p.provider_id));

                    // Rule 1: Is it available on the user's selected streaming services?
                    const isOnUserServices = [...flatrateIds, ...freeIds, ...adsIds].some(id => userStreamingProviderIds.includes(id));

                    // Rule 2: If it's not on their services, is it $0 to watch somewhere else? 
                    // (This allows fully free OR free-with-ads like Tubi/Roku)
                    const isFreeAnywhere = freeIds.length > 0;
                    const isFreeWithAdsAnywhere = adsIds.length > 0;

                    // Enforce the rule: Must be on their services OR $0 to watch.
                    // Drops anything that requires a new paid subscription, rental, or purchase.
                    if (!isOnUserServices && !isFreeAnywhere && !isFreeWithAdsAnywhere) {
                        return; 
                    }
                }

                let themeScore = 0;
                let genreScore = 0;

                // Score Themes
                const keywordsArray = item.keywords?.keywords || item.keywords?.results || [];
                keywordsArray.forEach(k => {
                    if (topKeywords.includes(String(k.id))) {
                        themeScore += keywordCounts[k.id];
                    }
                });

                if (requireTheme && themeScore === 0) return;

                // Score Genres
                (item.genres || []).forEach(g => {
                    if (topGenres.includes(String(g.id))) {
                        genreScore += genreCounts[g.id];
                    }
                });

                // The Math: A movie with your #1 theme (40 pts -> 40,000) will easily beat
                // a movie with your #5 theme (30 pts -> 30,000), even if it's less popular.
                const finalScore = (themeScore * 1000) + genreScore + (item.popularity / 10000);

                uniqueRecs.set(item.id, { ...item, _score: finalScore });
            });
        }

        // Pass 1: page 1 for each top keyword (matches previous behavior)
        await processDiscoverUrls(topKeywords.map(k => buildKeywordUrl(k, 1)));

        // Backfill: only needed when provider-filtering shrinks the pool below target.
        if (hasProviderFilter) {
            for (let page = 2; page <= MAX_KEYWORD_PAGES && uniqueRecs.size < TARGET_COUNT; page++) {
                await processDiscoverUrls(topKeywords.map(k => buildKeywordUrl(k, page)));
            }

            // Last resort: relax the keyword requirement, keep genre + provider constraints only.
            for (let page = 1; page <= 2 && uniqueRecs.size < TARGET_COUNT; page++) {
                await processDiscoverUrls([buildGenreOnlyUrl(page)], false);
            }
        }

        const topGenreName = genreNames[topGenres[0]];
        const topThemeName = keywordNames[topKeywords[0]];

        if (topGenreName && topThemeName) {
            // 1. Fetch current vibe from DB
            const { data: vibeData } = await supabaseClient
                .from('vibes_control')
                .select('*')
                .eq('user_id', user.id)
                .maybeSingle();

            if (!vibeData) {
                // First time user! Insert a blank row and flag it for tonight's update.
                await supabaseClient.from('vibes_control').insert({
                    user_id: user.id,
                    needs_update: true,
                    new_top_genre: topGenreName,
                    new_top_theme: topThemeName
                });
                // Render a placeholder UI while they wait for tonight
                renderVibeBox(topGenreName, topThemeName, '', ''); 
            } else {
                // Compare calculated vibe to stored vibe
                const hasChanged = (vibeData.current_top_genre !== topGenreName) || (vibeData.current_top_theme !== topThemeName);
                
                if (hasChanged && !vibeData.needs_update) {
                    // Flag for update tonight
                    await supabaseClient.from('vibes_control').update({
                        needs_update: true,
                        new_top_genre: topGenreName,
                        new_top_theme: topThemeName
                    }).eq('id', vibeData.id);
                }

                // Render with whatever images we currently have in the database
                renderVibeBox(vibeData.current_top_genre || topGenreName, 
                            vibeData.current_top_theme || topThemeName, 
                            vibeData.image_genre, 
                            vibeData.image_theme,
                            { text: vibeData.image_genre_attribution, url: vibeData.image_genre_attribution_url },
                            { text: vibeData.image_theme_attribution, url: vibeData.image_theme_attribution_url });
            }
        }

        // 9. Sort and take the best 12
        const finalRecs = Array.from(uniqueRecs.values())
            .sort((a, b) => b._score - a._score)
            .slice(0, 12);

        return finalRecs.map(item => ({
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
    }).catch(() => {});
}

function renderResults(items, targetGrid = resultsGrid) {
    targetGrid.innerHTML = ''; 
    
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.setAttribute('data-type', item.type);
        
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
    } else if (type === 'album') {
        searchInput.placeholder = "Search for albums or artists...";
        loadTabContent(type);
    } else {
        searchInput.placeholder = "Search for movies, shows, books, authors, ...";
        loadTabContent(type);
    }
};

async function unifiedSearch(query) {
    const filterNav = document.querySelector('.filter-nav');
    const filterValue = document.getElementById('search-filter').value;
    const sectionTitle = document.getElementById('section-title');

    if (!query || query.trim() === "") {
        const url = new URL(window.location);
        url.searchParams.delete('search');
        window.history.pushState({}, '', url);
        
        filterNav.style.display = 'flex'; 
        if (currentTab !== 'youtube') loadTabContent(currentTab); 
        return;
    }

    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const ytMatch = query.match(ytRegex);

    if (ytMatch || currentTab === 'youtube') {
        if (ytMatch && ytMatch[1]) {
            // We found a valid 11-character video ID! Redirect immediately.
            window.location.href = `details.html?id=${ytMatch[1]}&type=youtube`;
        } else {
            loader.textContent = "Please enter a valid YouTube URL.";
            loader.style.display = 'block';
        }
        return; 
    }

    filterNav.style.display = 'none'; 
    if (sectionTitle) sectionTitle.textContent = `Search Results for "${query}"`;

    filterNav.style.display = 'none'; 
    if (sectionTitle) sectionTitle.textContent = `Search Results for "${query}"`; // Update title for search

    loader.style.display = 'block';
    loader.textContent = "Exploring the archives...";
    resultsGrid.innerHTML = '';

    const options = {
        method: 'GET',
        headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` }
    };

    try {
        let tmdbRes = { results: [] };
        let bookData = [];
        let authorData = [];
        let users = [];
        let lastfmAlbums = [];
        const fetchPromises = [];

        // 1. TMDB Data (Movies, TV, People)
        if (['all', 'movie', 'tv', 'person'].includes(filterValue)) {
            let endpoint = 'search/multi';
            if (filterValue === 'movie') endpoint = 'search/movie';
            if (filterValue === 'tv') endpoint = 'search/tv';
            if (filterValue === 'person') endpoint = 'search/person';
            
            fetchPromises.push(
                fetch(`https://api.themoviedb.org/3/${endpoint}?query=${encodeURIComponent(query)}`, options)
                    .then(r => r.json())
                    .then(d => tmdbRes = d)
            );
        }

        // 2. OpenLibrary Data (Books)
        if (['all', 'book'].includes(filterValue)) {
            fetchPromises.push(fetchBooks(query).then(d => bookData = d));
        }

        // 3. OpenLibrary Data (Authors)
        if (['all', 'author'].includes(filterValue)) {
            fetchPromises.push(fetchAuthors(query).then(d => authorData = d));
        }

        // 4. Supabase Data (Users)
        if (['all', 'user'].includes(filterValue)) {
            fetchPromises.push(
                supabaseClient
                    .from('profiles')
                    .select('id, username, display_name, avatar_url')
                    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
                    .limit(10)
                    .then(res => users = res.data || [])
            );
        }

        if (['all', 'album'].includes(filterValue)) {
            fetchPromises.push(
                fetch(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(query)}&api_key=${LASTFM_KEY}&format=json`)
                .then(r => r.json())
                .then(res => {
                    if (res.results && res.results.albummatches && res.results.albummatches.album) {
                        lastfmAlbums = res.results.albummatches.album.map(a => {
                            let img = 'https://via.placeholder.com/500x750?text=No+Image';
                            if (a.image && a.image.length > 3 && a.image[3]['#text']) {
                                img = a.image[3]['#text'];
                            }
                            const compositeId = encodeURIComponent(`${a.artist}|||${a.name}`);
                            return {
                                id: compositeId,
                                title: a.name,
                                type: 'album',
                                image: img,
                                author: a.artist
                            };
                        });
                    }
                })
                .catch(err => console.error("Last.fm search error:", err))
            );
        }

        // Run all required fetches simultaneously
        await Promise.all(fetchPromises);

        const seenNames = new Set();
        
        // Process Users
        const mappedUsers = users.map(u => ({
            title: u.display_name || u.username,
            year: `@${u.username}`,
            image: u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name || u.username)}&background=1b2228&color=9ab&size=512&font-size=0.33`,
            type: 'user',
            id: u.id
        }));

        // Process Authors
        const processedAuthors = authorData.filter(author => {
            const nameKey = author.title.toLowerCase();
            if (seenNames.has(nameKey)) return false;
            seenNames.add(nameKey);
            return true;
        });

        // Process TMDB
        const tmdbResults = (tmdbRes.results || [])
            .map(item => {
                if (item.media_type === 'person' || filterValue === 'person') {
                    const nameKey = item.name.toLowerCase();
                    if (seenNames.has(nameKey)) return null; 
                    seenNames.add(nameKey);
                    return {
                        title: item.name,
                        year: item.known_for_department || 'Person',
                        image: item.profile_path 
                            ? `https://image.tmdb.org/t/p/w500${item.profile_path}` 
                            : `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=1b2228&color=9ab&size=512`,
                        type: 'person',
                        id: item.id
                    };
                } else if (item.poster_path || item.backdrop_path) {
                    // TMDB multi-search returns media_type, specific endpoints (like search/movie) don't always, so we fallback to the filterValue
                    return {
                        title: item.title || item.name,
                        year: (item.release_date || item.first_air_date || '').split('-')[0],
                        image: `https://image.tmdb.org/t/p/w500${item.poster_path || item.backdrop_path}`,
                        type: item.media_type || filterValue, 
                        id: item.id
                    };
                }
                return null;
            }).filter(Boolean);

        // Combine and Sort
        let combined = [...mappedUsers, ...processedAuthors, ...tmdbResults, ...bookData, ...lastfmAlbums];
        
        // Force filter just to be safe (in case an API returned something weird)
        if (filterValue !== 'all') {
            combined = combined.filter(item => item.type === filterValue);
        }

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
        
        if (combined.length === 0) {
            loader.textContent = "No results found.";
        } else {
            renderResults(combined);
            loader.style.display = 'none';
        }
    } catch (err) { 
        console.error("Search failed:", err); 
        loader.textContent = "Search failed.";
    }
}

async function fetchBooks(query) {
    // Increased limit to 50 and removed strict cover filter to improve discovery
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=50`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.docs || [])
        .map(doc => ({
            title: doc.title,
            year: doc.first_publish_year,
            author: doc.author_name ? doc.author_name[0] : null,
            image: doc.cover_i 
                ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` 
                : `https://via.placeholder.com/500x750?text=${encodeURIComponent(doc.title)}`,
            type: 'book',
            id: doc.key
        }));
}

async function fetchAuthors(query) {
    const url = `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=5`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        const seenAuthorNames = new Set();
        return (data.docs || [])
            .map(doc => {
                const nameKey = doc.name.toLowerCase();
                if (seenAuthorNames.has(nameKey)) return null;
                seenAuthorNames.add(nameKey);
                
                return {
                    title: doc.name,
                    year: 'Author',
                    image: doc.key ? `https://covers.openlibrary.org/a/olid/${doc.key}-M.jpg` : `https://ui-avatars.com/api/?name=${encodeURIComponent(doc.name)}&background=1b2228&color=9ab&size=512`,
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

function toggleProfileDropdown(event) {
    // Prevent the click from immediately bubbling up to the window.onclick listener
    if (event) event.stopPropagation();
    
    const content = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    
    const isVisible = content.style.display === 'block';
    content.style.display = isVisible ? 'none' : 'block';
    
    trigger.classList.toggle('active', !isVisible);
}

// Update the window click listener to be more specific
window.onclick = function(event) {
    const dropdown = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    
    // Only close if the click is NOT on the trigger and NOT inside the menu
    if (event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
}

async function signOut() {
    await supabaseClient.auth.signOut();
    location.reload();
}

authConfirmBtn.addEventListener('click', handleAuth);
closeModal.addEventListener('click', closeAuthModal);
window.toggleAuthMode = toggleAuthMode;

loadConfig();