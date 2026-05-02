let supabaseClient = null;
let allWatchlistItems = [];
let tmdbToken = null;
let lastfmKey = null;
let watchlistOwnerId = null;
let isViewerOwner = false;
let currentWatchlistPage = 1;
const WATCHLIST_PAGE_SIZE = 50;
let currentWatchlistFilter = 'all';

async function initWatchlist() {
    const response = await fetch('config.json');
    const config = await response.json();
    tmdbToken = config.tmdb_token;
    lastfmKey = config.lastfm_key;
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

    // 1. Identify whose watchlist to load
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('id');
    const { data: { session } } = await supabaseClient.auth.getSession();
    const loggedInUserId = session?.user?.id;

    watchlistOwnerId = urlId || loggedInUserId;
    isViewerOwner = (watchlistOwnerId === loggedInUserId);

    if (!watchlistOwnerId) {
        window.location.href = 'index.html';
        return;
    }

    // 2. UI Adjustments
    const pageTitle = document.querySelector('h1');
    const backBtn = document.querySelector('button[onclick*="profile.html"]');
    
    if (!isViewerOwner) {
        // Fetch owner name for a better title
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('display_name')
            .eq('id', watchlistOwnerId)
            .single();
        
        pageTitle.textContent = profile ? `${profile.display_name}'s Watchlist` : "Watchlist";
    } else {
        pageTitle.textContent = "My Watchlist";
    }

    // Dynamic Back Button
    if (backBtn) {
        backBtn.removeAttribute('onclick'); // Removes the hardcoded HTML link
        backBtn.onclick = () => {
            window.location.href = `profile.html?id=${watchlistOwnerId}`;
        };
    }

    // 3. Fetch items for the specific owner
    const { data: items } = await supabaseClient
        .from('user_watchlist')
        .select('*')
        .eq('user_id', watchlistOwnerId)
        .order('created_at', { ascending: false });

    allWatchlistItems = items || [];
    filterWatchlist('all'); 
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
            try {
                if (item.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json());
                    title = res.title;
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Cover';
                } else if (item.media_type === 'youtube') {
                    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${item.media_id}`).then(r => r.json());
                    title = res.title || 'YouTube Video';
                    image = res.thumbnail_url || 'https://placehold.co/500x750/1b2228/ff0000?text=YouTube';
                } else if (item.media_type === 'album') {
                    const decodedId = decodeURIComponent(item.media_id);
                    const [artist, albumName] = decodedId.split('|||');
                    title = albumName;
                    
                    // Fetch from Last.fm dynamically!
                    try {
                        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${lastfmKey}&format=json`).then(r => r.json());
                        image = res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    } catch (e) {
                        image = `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`; 
                    }
                } else {
                    const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    }).then(r => r.json());
                    title = res.title || res.name;
                    image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
                }
            } catch (err) {
                title = "Unknown Item";
                image = 'https://placehold.co/500x750/1b2228/9ab?text=Error';
            }
            return { ...item, title, image };
        });

        const fullItems = await Promise.all(mediaPromises);
        
        // Remove loading spinner and render cards
        grid.innerHTML = '';

        fullItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.onclick = () => window.location.href = `details.html?id=${item.media_id}&type=${item.media_type}`;
            card.innerHTML = `
                <div class="poster-wrapper">
                    <img src="${item.image}" 
                         alt="${item.title}" 
                         loading="lazy"
                         onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
                </div>
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

window.filterWatchlist = (type) => {
    currentWatchlistFilter = type;
    currentWatchlistPage = 1; // Reset to page 1 whenever a filter changes

    const filterNav = document.querySelector('.filter-nav');
    const buttons = filterNav.querySelectorAll('.filter-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        
        if (type === 'all' && btnText === 'all') btn.classList.add('active');
        else if (type === 'movie' && btnText === 'movies') btn.classList.add('active');
        else if (type === 'tv' && btnText === 'tv') btn.classList.add('active');
        else if (type === 'book' && btnText === 'books') btn.classList.add('active');
        else if (type === 'album' && btnText === 'music') btn.classList.add('active');
        else if (type === 'youtube' && btnText === 'youtube') btn.classList.add('active');
    });

    renderWatchlistPage(); // Triggers the paginated render
};

window.changeWatchlistPage = (direction) => {
    currentWatchlistPage += direction;
    renderWatchlistPage();
    // Smooth scroll back to the top
    document.querySelector('h1').scrollIntoView({ behavior: 'smooth' });
};

async function renderWatchlistPage() {
    // 1. Filter the master list
    const filtered = currentWatchlistFilter === 'all' 
        ? allWatchlistItems 
        : allWatchlistItems.filter(i => i.media_type === currentWatchlistFilter);
        
    // 2. Calculate Pagination
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / WATCHLIST_PAGE_SIZE) || 1;
    
    if (currentWatchlistPage < 1) currentWatchlistPage = 1;
    if (currentWatchlistPage > totalPages) currentWatchlistPage = totalPages;

    const startIndex = (currentWatchlistPage - 1) * WATCHLIST_PAGE_SIZE;
    const endIndex = startIndex + WATCHLIST_PAGE_SIZE;
    
    // 3. Slice out just the 50 items we need for this page
    const itemsToRender = filtered.slice(startIndex, endIndex);

    // 4. Update the subtitle with the TRUE TOTAL (Not just the 50 on the page)
    const subtitle = document.getElementById('watchlist-subtitle');
    subtitle.textContent = `${totalItems} ${currentWatchlistFilter === 'all' ? 'items' : currentWatchlistFilter + 's'} saved.`;

    // 5. Pass the small chunk to your existing render engine
    await renderWatchlist(itemsToRender, tmdbToken, currentWatchlistFilter);

    // 6. Update the UI Pagination Buttons
    const paginationContainer = document.getElementById('watchlist-pagination');
    if (!paginationContainer) return;

    if (totalItems > WATCHLIST_PAGE_SIZE) {
        paginationContainer.innerHTML = `
            <button class="secondary-btn" onclick="changeWatchlistPage(-1)" ${currentWatchlistPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Previous</button>
            <span class="meta" style="margin: 0 15px; font-weight: bold;">Page ${currentWatchlistPage} of ${totalPages}</span>
            <button class="secondary-btn" onclick="changeWatchlistPage(1)" ${currentWatchlistPage === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Next</button>
        `;
    } else {
        paginationContainer.innerHTML = ''; // Hide if 50 items or fewer
    }
}

initWatchlist();