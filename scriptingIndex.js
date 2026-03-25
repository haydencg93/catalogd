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
let supabaseClient = null; // Use a unique name for the connection
let isSignUpMode = false;

// 3. Initialize App
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error("config.json not found");
        const config = await response.json();
        
        TMDB_TOKEN = config.tmdb_token;
        
        // Initialize the client using the unique variable name
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        
        // Check if user is already logged in
        await checkUserStatus(); 

        // Setup Search UI
        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, books, cast members, ...";
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') unifiedSearch(searchInput.value);
        });

        const urlParams = new URLSearchParams(window.location.search);
        const searchQuery = urlParams.get('search');

        if (searchQuery) {
            // If a search query exists, run the search and skip trending
            searchInput.value = searchQuery;
            unifiedSearch(searchQuery);
        } else {
            // Only load trending content if there is no active search
            fetchTrending('movie');
        }

    } catch (err) {
        console.error("Critical Start Error:", err);
        loader.textContent = "Error: " + err.message;
    }
}

// 4. Authentication Logic
// Add this to your "Elements" section at the top of the file
const profileBtn = document.getElementById('profile-btn');

async function checkUserStatus() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    
    if (user) {
        loginBtn.textContent = "Sign Out";
        loginBtn.onclick = async () => {
            await supabaseClient.auth.signOut();
            location.reload();
        };
        
        // REVEAL the profile button if it exists on this page
        if (profileBtn) profileBtn.style.display = 'inline-block';
        
    } else {
        loginBtn.textContent = "Sign In";
        loginBtn.onclick = openAuthModal;
        
        // HIDE the profile button if logged out
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

        // Validation
        if (!email || !password || !name || !username) return alert("Please fill in all fields.");
        if (password !== retype) return alert("Passwords do not match!");
        if (password.length < 6) return alert("Password must be at least 6 characters.");

        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        display_name: name,
                        username: username
                    }
                }
            });
            if (error) throw error;
            alert("Success! Check your email for a confirmation link.");
            closeAuthModal();
        } catch (err) {
            alert(err.message);
        }
    } else {
        // Sign In Logic
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

// 5. Modal UI Handlers
function openAuthModal() { authModal.style.display = 'flex'; }
function closeAuthModal() { authModal.style.display = 'none'; }

function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    modalTitle.textContent = isSignUpMode ? "Create Account" : "Welcome Back";
    authConfirmBtn.textContent = isSignUpMode ? "Sign Up" : "Sign In";
    authSwitch.textContent = isSignUpMode ? "Already have an account? Sign In" : "Need an account? Sign Up";

    // Show or hide registration-specific fields
    signupFields.style.display = isSignUpMode ? "block" : "none";
    authRetype.style.display = isSignUpMode ? "block" : "none";
}

// 6. Existing App Functions (Trending, Search, Render)
// 1. Add this to your Global Variables
let currentTab = 'movie';

// 2. Replace your fetchTrending function
async function fetchTrending(type = 'movie') {
    resultsGrid.innerHTML = '';
    loader.style.display = 'block';
    loader.textContent = `Fetching trending ${type}s...`;

    try {
        if (type === 'book') {
            // Fetch trending books from Open Library
            const res = await fetch(`https://openlibrary.org/trending/daily.json?limit=15`);
            const data = await res.json();
            const books = (data.works || []).map(work => ({
                title: work.title,
                year: work.first_publish_year,
                image: work.cover_edition_key ? `https://covers.openlibrary.org/b/olid/${work.cover_edition_key}-M.jpg` : '',
                type: 'book',
                id: work.key
            }));
            renderResults(books, true);
        } else {
            // Fetch trending Movies or TV from TMDB
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

// 3. Add the switchTab function
window.switchTab = function(type) {
    currentTab = type;
    
    // Update UI buttons
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${type}`).classList.add('active');
    
    // Clear search and fetch
    searchInput.value = '';
    fetchTrending(type);
};

async function unifiedSearch(query) {
    if (!query || query.trim() === "") {
        searchInput.value = '';
        const url = new URL(window.location);
        url.searchParams.delete('search');
        window.history.pushState({}, '', url);
        fetchTrending('movie'); 
        return;
    }

    loader.style.display = 'block';
    loader.textContent = "Exploring the archives...";
    resultsGrid.innerHTML = '';

    const options = {
        method: 'GET',
        headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` }
    };

    try {
        const tmdbUrl = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`;
        const [tmdbRes, bookData] = await Promise.all([
            fetch(tmdbUrl, options).then(res => res.json()),
            fetchBooks(query)
        ]);

        const seenPeople = new Set();
        const tmdbResults = (tmdbRes.results || [])
            .map(item => {
                if (item.media_type === 'person') {
                    // Filter: Only show the main Acting/Directing profiles, skip obscure crew duplicates
                    if (seenPeople.has(item.name)) return null; 
                    seenPeople.add(item.name);

                    return {
                        title: item.name,
                        year: item.known_for_department || 'Person',
                        // High-quality placeholder if image is missing
                        image: item.profile_path 
                            ? `https://image.tmdb.org/t/p/w500${item.profile_path}` 
                            : `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=1b2228&color=9ab&size=512`,
                        type: 'person',
                        id: item.id
                    };
                } else if (item.poster_path) {
                    return {
                        title: item.title || item.name,
                        year: (item.release_date || item.first_air_date || '').split('-')[0],
                        image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                        type: item.media_type,
                        id: item.id
                    };
                }
                return null;
            }).filter(Boolean);

        const combined = [...tmdbResults, ...bookData];
        
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
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.docs || [])
        .filter(doc => doc.cover_i)
        .map(doc => ({
            title: doc.title,
            year: doc.first_publish_year,
            image: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`,
            type: 'book',
            id: doc.key
        }));
}

function renderResults(items, isTrending = false) {
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        
        card.onclick = () => {
            if (item.type === 'person') {
                window.location.href = `cast.html?personId=${item.id}`;
            } else {
                window.location.href = `details.html?id=${item.id}&type=${item.type}`;
            }
        };
        
        const trendingBadge = isTrending ? `<div class="trending-label">Trending Today</div>` : '';

        card.innerHTML = `
            <div class="poster-wrapper">
                ${trendingBadge}
                <img src="${item.image}" 
                     alt="${item.title}" 
                     loading="lazy" 
                     onerror="this.onerror=null; this.src='https://via.placeholder.com/500x750?text=No+Image';">
                <span class="badge badge-${item.type}">${item.type}</span>
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                <div class="meta">${item.year || 'Unknown'}</div>
            </div>`;
        resultsGrid.appendChild(card);
    });
}

// Add this function to Section 4: Authentication Logic
async function handleForgotPassword() {
    const email = authEmail.value;

    if (!email) {
        alert("Please enter your email address first so we know where to send the link.");
        authEmail.focus();
        return;
    }

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            // This is where the user is sent after clicking the email link
            // We send them to settings.html where they can type a new password
            redirectTo: window.location.origin + '/settings.html',
        });

        if (error) throw error;

        alert("Success! Check your email for a password reset link.");
        closeAuthModal();
    } catch (err) {
        alert("Error: " + err.message);
    }
}

// 7. Event Listeners & Start
authConfirmBtn.addEventListener('click', handleAuth);
closeModal.addEventListener('click', closeAuthModal);
window.toggleAuthMode = toggleAuthMode;

loadConfig();