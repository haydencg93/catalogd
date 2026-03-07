// 1. Grab your HTML elements
const searchInput = document.getElementById('search-input');
const resultsGrid = document.getElementById('results-grid');
const loader = document.getElementById('loader');

let TMDB_TOKEN = ''; // We will fill this from config.json

// 2. This runs as soon as the page loads
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error("File not found");
        
        const config = await response.json();
        TMDB_TOKEN = config.tmdb_token; // Use the name from your config.json
        
        // Enable the UI
        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, or books...";
        
        // Load the trending movies/TV immediately
        fetchTrending(); 
    } catch (err) {
        console.error("Could not load config.json.", err);
        loader.textContent = "Error: Check your config.json file and Local Server.";
    }
}

// 3. The function to get Trending Data
async function fetchTrending() {
    const url = `https://api.themoviedb.org/3/trending/all/day`;
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}` // Bearer token auth
        }
    };

    try {
        const res = await fetch(url, options); // Must pass options!
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
    } catch (err) {
        console.error("Trending fetch failed:", err);
    }
}

// 4. The function to Search (Movie, TV, and Books)
async function unifiedSearch(query) {
    if (!query || !TMDB_TOKEN) return;
    
    loader.style.display = 'block';
    loader.textContent = "Exploring the archives...";
    resultsGrid.innerHTML = '';

    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}`
        }
    };

    try {
        // Fetch from TMDB and OpenLibrary (Books) at the same time
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
    } catch (err) {
        console.error("Search failed:", err);
    }
}

// 5. Helper function for Books (OpenLibrary doesn't need a key)
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
        // Add a click event to redirect to a details page
        card.onclick = () => {
            window.location.href = `details.html?id=${item.id}&type=${item.type}`;
        };
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
        resultsGrid.appendChild(card);
    });
}

// Start the app
loadConfig();