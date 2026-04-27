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

// 2. Global Variables
let TMDB_TOKEN = '';
let LASTFM_KEY = '';
let supabaseClient = null; 
let isSignUpMode = false;
let currentTab = 'movie';

// 3. Initialize App
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error("config.json not found");
        const config = await response.json();
        
        TMDB_TOKEN = config.tmdb_token;
        LASTFM_KEY = config.lastfm_key;
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        
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
            fetchTrending('movie');
        }

    } catch (err) {
        console.error("Critical Start Error:", err);
        loader.textContent = "Error: " + err.message;
    }
}

// 4. Authentication Logic
const profileBtn = document.getElementById('profile-btn');

async function checkUserStatus() {
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
        loginBtn.onclick = openAuthModal;
        if (profileBtn) profileBtn.style.display = 'none';
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

async function fetchTrending(type = 'movie') {
    // NEW: Update the section title text based on the tab
    const sectionTitle = document.getElementById('section-title');
    if (sectionTitle) {
        let typeLabel = 'Movies';
        if (type === 'tv') typeLabel = 'TV Shows';
        if (type === 'book') typeLabel = 'Books';
        if (type === 'album') typeLabel = 'Music Albums'; // <--- ADDED THIS LINE
        sectionTitle.textContent = `Trending ${typeLabel}`;
    }

    resultsGrid.innerHTML = '';
    loader.style.display = 'block';
    loader.textContent = `Fetching trending ${type}s...`;

    try {
        if (type === 'book') {
            const res = await fetch(`https://openlibrary.org/trending/daily.json?limit=15`);
            const data = await res.json();
            const books = (data.works || []).map(work => ({
                title: work.title,
                year: work.first_publish_year,
                author: work.author_name ? work.author_name[0] : null,
                image: work.cover_edition_key ? `https://covers.openlibrary.org/b/olid/${work.cover_edition_key}-M.jpg` : 'https://via.placeholder.com/500x750?text=No+Image',
                type: 'book',
                id: work.key
            }));
            renderResults(books, true);
        } else if (type === 'album') {
            // --- NEW: LAST.FM TRENDING LOGIC ---
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=tag.gettopalbums&tag=pop&api_key=${LASTFM_KEY}&format=json&limit=15`);
            const data = await res.json();
            const albums = (data.albums.album || []).map(a => {
                let img = 'https://via.placeholder.com/500x750?text=No+Image';
                if (a.image && a.image.length > 3 && a.image[3]['#text']) {
                    img = a.image[3]['#text'];
                }
                const compositeId = encodeURIComponent(`${a.artist.name}|||${a.name}`);
                return {
                    title: a.name,
                    year: '', // <--- FIXED: Removed the word "Trending"
                    author: a.artist ? a.artist.name : null,
                    image: img,
                    type: 'album',
                    id: compositeId
                };
            });
            renderResults(albums, true);
        } else {
            const url = `https://api.themoviedb.org/3/trending/${type}/day`;
            const options = {
                method: 'GET',
                headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` }
            };
            const res = await fetch(url, options);
            const data = await res.json();
            const items = (data.results || []).map(item => ({
                title: item.title || item.name,
                year: (item.release_date || item.first_air_date || '').split('-')[0],
                image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                type: type,
                id: item.id
            }));
            renderResults(items, true);
        }
        loader.style.display = 'none';
    } catch (err) {
        console.error("Trending fetch failed:", err);
        loader.textContent = "Failed to load content.";
    }
}

window.switchTab = function(type) {
    currentTab = type;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${type}`).classList.add('active');
    searchInput.value = '';
    
    if (type === 'youtube') {
        searchInput.placeholder = "Paste a YouTube link here...";
        document.getElementById('section-title').textContent = "Add a YouTube Video";
        resultsGrid.innerHTML = '<p class="meta" style="grid-column: 1/-1; text-align: center;">Paste a valid YouTube URL in the search bar above to log it!</p>';
    } else if (type === 'album') {
        searchInput.placeholder = "Search for albums or artists...";
        fetchTrending(type);
    } else {
        searchInput.placeholder = "Search for movies, shows, books, authors, ...";
        fetchTrending(type);
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
        if (currentTab !== 'youtube') fetchTrending(currentTab); 
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
            renderResults(combined, false);
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

function renderResults(items, isTrending = false) {
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.setAttribute('data-type', item.type);
        
        card.onclick = () => {
            if (item.type === 'person') {
                window.location.href = `cast.html?personId=${item.id}`;
            } else if (item.type === 'author') {
                window.location.href = `cast.html?authorId=${item.id}`;
            } else if (item.type === 'user') {
                window.location.href = `profile.html?id=${item.id}`;
            } else {
                window.location.href = `details.html?id=${item.id}&type=${item.type}`;
            }
        };
        
        const trendingBadge = isTrending && item.type !== 'user' ? `<div class="trending-label">Trending Today</div>` : '';
        const userBadge = item.type === 'user' ? `<div class="trending-label">Member</div>` : '';

        card.innerHTML = `
            <div class="poster-wrapper">
                ${trendingBadge}
                ${userBadge}
                <img src="${item.image}" 
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
        resultsGrid.appendChild(card);
    });
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

authConfirmBtn.addEventListener('click', handleAuth);
closeModal.addEventListener('click', closeAuthModal);
window.toggleAuthMode = toggleAuthMode;

loadConfig();