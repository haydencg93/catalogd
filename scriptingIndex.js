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
        // 'supabase' (lowercase) is the library from the CDN
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        
        // Check if user is already logged in
        await checkUserStatus(); 

        // Setup Search UI
        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, or books...";
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') unifiedSearch(searchInput.value);
        });

        // Load trending content
        fetchTrending(); 
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

    if (!email || !password) return alert("Please fill in all fields.");

    try {
        let result;
        if (isSignUpMode) {
            result = await supabaseClient.auth.signUp({ email, password });
            if (result.error) throw result.error;
            alert("Check your email for a confirmation link!");
        } else {
            result = await supabaseClient.auth.signInWithPassword({ email, password });
            if (result.error) throw result.error;
        }

        if (!result.error) {
            closeAuthModal();
            await checkUserStatus();
        }
    } catch (err) {
        alert(err.message);
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
}

// 6. Existing App Functions (Trending, Search, Render)
async function fetchTrending() {
    const url = `https://api.themoviedb.org/3/trending/all/day`;
    const options = {
        method: 'GET',
        headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` }
    };

    try {
        const res = await fetch(url, options);
        const data = await res.json();
        const trending = (data.results || [])
            .filter(item => item.media_type !== 'person' && item.poster_path)
            .map(item => ({
                title: item.title || item.name,
                year: (item.release_date || item.first_air_date || '').split('-')[0],
                image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                type: item.media_type,
                id: item.id
            }));

        resultsGrid.innerHTML = ''; 
        renderResults(trending);
        loader.textContent = "Trending Today";
    } catch (err) { console.error("Trending fetch failed:", err); }
}

async function unifiedSearch(query) {
    if (!query || !TMDB_TOKEN) return;
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

        const tmdbResults = (tmdbRes.results || [])
            .filter(item => item.media_type !== 'person' && item.poster_path)
            .map(item => ({
                title: item.title || item.name,
                year: (item.release_date || item.first_air_date || '').split('-')[0],
                image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                type: item.media_type,
                id: item.id
            }));

        const combined = [...tmdbResults, ...bookData];
        if (combined.length === 0) {
            loader.textContent = "No results found.";
        } else {
            renderResults(combined);
            loader.style.display = 'none';
        }
    } catch (err) { console.error("Search failed:", err); }
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

function renderResults(items) {
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.onclick = () => window.location.href = `details.html?id=${item.id}&type=${item.type}`;
        card.innerHTML = `
            <div class="poster-wrapper">
                <img src="${item.image}" alt="${item.title}" loading="lazy">
                <span class="badge badge-${item.type}">${item.type}</span>
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                <div class="meta">${item.year || 'Unknown Year'}</div>
            </div>`;
        resultsGrid.appendChild(card);
    });
}

// 7. Event Listeners & Start
authConfirmBtn.addEventListener('click', handleAuth);
closeModal.addEventListener('click', closeAuthModal);
window.toggleAuthMode = toggleAuthMode;

loadConfig();