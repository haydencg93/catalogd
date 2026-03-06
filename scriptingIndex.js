const searchInput = document.getElementById('search-input');
const resultsGrid = document.getElementById('results-grid');
const loader = document.getElementById('loader');

let TMDB_KEY = '';

// Sample Data for initial visual
const samples = [
    { title: "Dead Poets Society", year: "1989", image: "https://imgs.search.brave.com/dq4yLcGh6xm8USFK2XkpE0unEyq5b0CQzBhlypmk1JE/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/NzFzYUorRXNDN0wu/anBn", type: "movie" },
    { title: "The Wind Rises", year: "2013", image: "https://imgs.search.brave.com/pHhaFoJAC1iYp1YbsRcAjCa_0RoaVD9ihBFTsA3qTXo/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL00v/TVY1Qk1UVTRORGcw/TXprek5WNUJNbDVC/YW5CblhrRnRaVGd3/T0RBM016YzFNREVA/LmpwZw", type: "movie" },
    { title: "The Imitation Game", year: "2014", image: "https://imgs.search.brave.com/8qjT1xrMfxcdejk3P9YgB4KY_DT7Zyuq5K2XVpn_dUs/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zdGF0/aWMud2lraWEubm9j/b29raWUubmV0L2Zp/bG1ndWlkZS9pbWFn/ZXMvYS9hMS9UaGVf/SW1pdGF0aW9uX0dh/bWUuanBnL3Jldmlz/aW9uL2xhdGVzdC9z/Y2FsZS10by13aWR0/aC1kb3duLzI2OD9j/Yj0yMDE1MDMxNzEy/Mzk1NQ", type: "movie" },
    { title: "Stranger Things", year: "2016", image: "https://m.media-amazon.com/images/M/MV5BNjRiMTA4NWUtNmE0ZC00NGM0LWJhMDUtZWIzMDM5ZDIzNTg3XkEyXkFqcGc@._V1_.jpg", type: "tv" },
    { title: "Hunter x Hunter", year: "2011", image: "https://imgs.search.brave.com/PC6FE_kHWyqDce0vEWmsQQFvC1LvIhm7DQbsQJtISSM/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL00v/TVY1Qll6WXhPVGxr/WXpjdE5HWTJNQzAw/TWpOakxXSXhPV010/WTJRd1lqY3haV0l3/TW1Fd1hrRXlYa0Zx/Y0djQC5qcGc", type: "tv" },
    { title: "Squid Game", year: "2021", image: "https://imgs.search.brave.com/mp68TYrnkeUtcRuP__jJSj9Ai4Eh56-46I54L7CWsDQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93YWxs/cGFwZXJjYXZlLmNv/bS93cC93cDk5Mzgz/NzAuanBlZw", type: "tv" },
    { title: "It", year: "1986", image: "https://ia600505.us.archive.org/view_archive.php?archive=/35/items/l_covers_0014/l_covers_0014_65.zip&file=0014651795-L.jpg", type: "book" },
    { title: "Hunter x Hunter, Vol. 1", year: "1998", image: "https://ia601407.us.archive.org/view_archive.php?archive=/11/items/olcovers86/olcovers86-L.zip&file=863552-L.jpg", type: "book" },
    { title: "Heartstopper, Vol. 1", year: "2019", image: "https://covers.openlibrary.org/b/id/15142913-L.jpg", type: "book" }
];

async function loadConfig() {
    try {
        // Render samples first so the page isn't empty
        renderResults(samples);

        const response = await fetch('config.json');
        if (!response.ok) throw new Error("File not found");
        
        const config = await response.json();
        TMDB_KEY = config.tmdb_key;
        
        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, or books...";
        loader.textContent = "Featured Collection";
    } catch (err) {
        console.error("Could not load config.json.", err);
        loader.textContent = "Sign in to search, or browse features below.";
        loader.style.color = "#9ab";
    }
}

loadConfig();

async function unifiedSearch(query) {
    if (!query || !TMDB_KEY) return;
    
    loader.style.display = 'block';
    loader.textContent = "Exploring the archives...";
    resultsGrid.innerHTML = '';

    try {
        const [tmdbData, bookData] = await Promise.all([
            fetchTMDB(query),
            fetchBooks(query)
        ]);

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

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') unifiedSearch(e.target.value);
});