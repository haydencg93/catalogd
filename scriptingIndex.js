const searchInput = document.getElementById('search-input');
const resultsGrid = document.getElementById('results-grid');
const loader = document.getElementById('loader');

let TMDB_KEY = '';

/**
 * Loads the API key from the external config.json file.
 * This keeps the key separate from the main logic.
 */
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error("File not found");
        
        const config = await response.json();
        TMDB_KEY = config.tmdb_key;
        
        // Enable the UI once the key is ready
        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, or books...";
        loader.textContent = "Ready!";
        setTimeout(() => loader.style.display = 'none', 1000);
    } catch (err) {
        console.error("Could not load config.json. Make sure the file exists and has the correct format!", err);
        loader.textContent = "Configuration error. Check console.";
        loader.style.color = "#ff4444";
    }
}

// Initialize configuration on load
loadConfig();

/**
 * The main search coordinator. Fetches from both TMDB and Open Library.
 */
async function unifiedSearch(query) {
    if (!query || !TMDB_KEY) return;
    
    loader.style.display = 'block';
    loader.textContent = "Exploring the archives...";
    resultsGrid.innerHTML = '';

    try {
        // Fetch from both sources simultaneously for better performance
        const [tmdbData, bookData] = await Promise.all([
            fetchTMDB(query),
            fetchBooks(query)
        ]);

        // Merge the results into one array
        const combined = [...tmdbData, ...bookData];
        
        if (combined.length === 0) {
            loader.textContent = "No results found for '" + query + "'";
        } else {
            renderResults(combined);
            loader.style.display = 'none';
        }
    } catch (err) {
        console.error("Search failed:", err);
        loader.textContent = "An error occurred during search.";
    }
}

/**
 * Fetches Movies and TV Shows from TMDB.
 */
async function fetchTMDB(query) {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json();
    
    return (data.results || [])
        .filter(item => item.media_type !== 'person' && item.poster_path)
        .map(item => ({
            title: item.title || item.name,
            year: (item.release_date || item.first_air_date || '').split('-')[0],
            image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
            type: item.media_type,
            id: item.id
        }));
}

/**
 * Fetches Books from Open Library.
 */
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

/**
 * Creates and appends HTML cards to the grid.
 */
function renderResults(items) {
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.innerHTML = `
            <div class="poster-wrapper">
                <img src="${item.image}" alt="${item.title}" loading="lazy">
                <span class="badge badge-${item.type}">${item.type}</span>
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                <div class="meta">${item.year || 'Unknown Year'}</div>
            </div>
        `;
        
        // Add click listener for future "Details" view
        card.onclick = () => console.log(`Selected ${item.type}: ${item.title}`);
        
        resultsGrid.appendChild(card);
    });
}

// Listen for the 'Enter' key to trigger search
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') unifiedSearch(e.target.value);
});
