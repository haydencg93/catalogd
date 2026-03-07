async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error("File not found");
        
        const config = await response.json();
        TMDB_KEY = config.tmdb_key;
        
        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, or books...";
        
        // Replace samples with actual trending data
        fetchTrending(); 
    } catch (err) {
        console.error("Could not load config.json.", err);
        renderResults(samples); // Fallback to samples if no API key
        loader.textContent = "Sign in to search, or browse features below.";
    }
}

async function fetchTrending() {
    loader.textContent = "Trending Today";
    // We use /trending/{media_type}/{time_window}
    const url = `https://api.themoviedb.org/3/trending/all/day?api_key=${TMDB_KEY}`;
    
    try {
        const res = await fetch(url);
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

        resultsGrid.innerHTML = ''; // Clear samples
        renderResults(trending);
    } catch (err) {
        console.error("Failed to fetch trending:", err);
    }
}