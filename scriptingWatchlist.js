let supabaseClient = null;
let allWatchlistItems = []; // Store everything here
let tmdbToken = null;

async function initWatchlist() {
    const response = await fetch('config.json');
    const config = await response.json();
    tmdbToken = config.tmdb_token;
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { window.location.href = 'index.html'; return; }

    const { data: items } = await supabaseClient
        .from('user_watchlist')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    allWatchlistItems = items || [];
    filterWatchlist('all'); // Initial render
}

window.filterWatchlist = (type) => {
    // 1. Update Button UI
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`btn-${type === 'movie' ? 'movie' : type}`);
    if (activeBtn) activeBtn.classList.add('active');

    // 2. Filter Data
    const filtered = type === 'all' 
        ? allWatchlistItems 
        : allWatchlistItems.filter(item => item.media_type === type);

    // 3. Show Loading State immediately
    const grid = document.getElementById('watchlist-grid');
    const subtitle = document.getElementById('watchlist-subtitle');
    
    if (filtered.length > 0) {
        grid.innerHTML = '<div class="loading-spinner">Loading titles...</div>';
        subtitle.textContent = `Fetching ${filtered.length} ${type === 'all' ? 'items' : type + 's'}...`;
    } else {
        grid.innerHTML = "<p class='meta'>Your watchlist is empty.</p>";
        subtitle.textContent = "0 items saved.";
        return; // Don't call render if there's nothing to render
    }

    renderWatchlist(filtered, tmdbToken, type);
};

async function renderWatchlist(items, token, typeLabel) {
    const grid = document.getElementById('watchlist-grid');
    const subtitle = document.getElementById('watchlist-subtitle');

    try {
        const mediaPromises = items.map(async (item) => {
            let title, image;
            if (item.media_type === 'book') {
                const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json());
                title = res.title;
                image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'placeholder.png';
            } else {
                const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }).then(r => r.json());
                title = res.title || res.name;
                image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : 'placeholder.png';
            }
            return { ...item, title, image };
        });

        const fullItems = await Promise.all(mediaPromises);
        
        // Remove loading spinner and render cards
        grid.innerHTML = '';
        subtitle.textContent = `${fullItems.length} ${typeLabel === 'all' ? 'items' : typeLabel + 's'} saved.`;

        fullItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.onclick = () => window.location.href = `details.html?id=${item.media_id}&type=${item.media_type}`;
            card.innerHTML = `
                <img src="${item.image}" alt="${item.title}">
                <div class="media-info">
                    <div class="title" style="font-weight:bold;">${item.title}</div>
                    <div class="meta">
                        <span class="badge badge-${item.media_type}">${item.media_type}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (err) {
        console.error("Watchlist render error:", err);
        grid.innerHTML = "<p class='meta'>Error loading items. Please try again.</p>";
    }
}

initWatchlist();