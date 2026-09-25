// Import necessary modules and functions
import { loadConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';
import { normalizeOpenLibraryId } from './core/media.js';
import { calculatePagination } from './logic/watchlist-logic.js';

// Load configuration and initialize Supabase client
let supabaseClient = null;
let PROXY_URL = '';

// Global vars
let allWatchlistItems = [];
let watchlistOwnerId = null;
let isViewerOwner = false;
let currentWatchlistPage = 1;
const WATCHLIST_PAGE_SIZE = 50;
let currentWatchlistFilter = 'all';
let customImgsMap = new Map();

// ----------------------------------------
// Initialization
// ----------------------------------------
async function initWatchlist() {
    const config = await loadConfig();
    PROXY_URL = config.proxy_url;
    supabaseClient = await getSupabaseClient();
    await customElements.whenDefined('app-header');
    await document.querySelector('app-header').initializeAuth(supabaseClient);

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

        // Inject the "Back to Profile" Context Button
        const navActions = document.querySelector('.nav-actions');
        if (navActions && !document.getElementById('context-profile-btn')) {
            const contextBtn = document.createElement('button');
            contextBtn.id = 'context-profile-btn';
            contextBtn.className = 'secondary-btn';
            contextBtn.style.marginRight = '10px';
            contextBtn.textContent = profile ? `← ${profile.display_name}'s Profile` : '← Back to Profile';
            contextBtn.onclick = () => window.location.href = `profile.html?id=${watchlistOwnerId}`;
            navActions.prepend(contextBtn);
        }
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

    const { data: customImgs } = await supabaseClient
        .from('custom_imgs')
        .select('*')
        .eq('user_id', watchlistOwnerId);
        
    if (customImgs) {
        customImgs.forEach(img => {
            customImgsMap.set(`${img.media_type}_${img.media_id}`, img);
        });
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

// ----------------------------------------
// Data Fetching & Base Rendering
// ----------------------------------------
async function renderWatchlist(items) {
    const grid = document.getElementById('watchlist-grid');

    try {
        const mediaPromises = items.map(async (item) => {
            let title, image;
            try {
                if (item.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(item.media_id)}.json`).then(r => r.json());
                    title = item.media_title || res.title || 'Unknown Book';
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Cover';
                } else if (item.media_type === 'youtube') {
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${item.media_id}`)}&format=json`).then(r => r.json());
                    title = res.title || 'YouTube Video';
                    image = res.thumbnail_url || 'https://placehold.co/500x750/1b2228/ff0000?text=YouTube';
                } else if (item.media_type === 'album') {
                    const decodedId = decodeURIComponent(item.media_id);
                    const [artist, albumName] = decodedId.split('|||');
                    title = albumName;
                    
                    // Fetch from Last.fm dynamically!
                    try {
                        const res = await fetch(`${PROXY_URL}/api/lastfm?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}`).then(r => r.json());
                        image = res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    } catch (e) {
                        image = `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    }
                } else {
                    const res = await fetch(`${PROXY_URL}/api/tmdb/${item.media_type}/${item.media_id}`).then(r => r.json());
                    title = item.media_title || res.title || res.name || 'Unknown Title';
                    image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
                }
            } catch (err) {
                title = item.media_title || "Unknown Item";
                image = 'https://placehold.co/500x750/1b2228/9ab?text=Error';
            }

            const customArt = customImgsMap.get(`${item.media_type}_${String(item.media_id)}`);
            if (customArt && customArt.custom_poster) {
                image = customArt.custom_poster;
            }

            return { ...item, title, image };
        });

        const fullItems = await Promise.all(mediaPromises);
        
        // Remove loading spinner and render cards
        grid.innerHTML = '';

        fullItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.setAttribute('data-type', item.media_type);
            card.onclick = () => window.location.href = `details.html?id=${item.media_id}&type=${item.media_type}`;
            card.innerHTML = `
                <div class="poster-wrapper">
                    <img src="${item.image}" 
                         alt="${item.title}" 
                         loading="lazy"
                         data-fallback="https://placehold.co/500x750/1b2228/9ab?text=No+Image">
                    <span class="badge badge-${item.media_type}">${item.media_type}</span>
                </div>
                <div class="media-info">
                    <div class="title" style="font-weight:bold;">${item.title}</div>
                </div>
            `;
            grid.appendChild(card);
            const imageElement = card.querySelector('img');
            imageElement?.addEventListener('error', () => {
                imageElement.src = imageElement.dataset.fallback;
                delete imageElement.dataset.fallback;
            }, { once: true });
        });
    } catch (err) {
        console.error("Watchlist render error:", err);
        grid.innerHTML = "<p class='meta'>Error loading items. Please try again.</p>";
    }
}

// ----------------------------------------
// State Management (Filters & Pagination)
// ----------------------------------------
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
    // 1. Delegate math to the pure function
    const { paginatedItems, totalPages, boundedCurrentPage, totalFilteredItems } = calculatePagination(
        allWatchlistItems, 
        currentWatchlistPage, 
        WATCHLIST_PAGE_SIZE, 
        currentWatchlistFilter
    );
    
    // Sync the global variable with the mathematically bounded result
    currentWatchlistPage = boundedCurrentPage;

    // 2. Update the subtitle with the TRUE TOTAL (Not just the 50 on the page)
    const subtitle = document.getElementById('watchlist-subtitle');
    subtitle.textContent = `${totalFilteredItems} ${currentWatchlistFilter === 'all' ? 'items' : currentWatchlistFilter + 's'} saved.`;

    // 3. Pass the small chunk to your existing render engine
    await renderWatchlist(paginatedItems, currentWatchlistFilter);

    // 4. Update the UI Pagination Buttons
    const paginationContainer = document.getElementById('watchlist-pagination');
    if (!paginationContainer) return;

    if (totalFilteredItems > WATCHLIST_PAGE_SIZE) {
        paginationContainer.innerHTML = `
            <button class="secondary-btn" data-watchlist-page="-1" ${currentWatchlistPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Previous</button>
            <span class="meta" style="margin: 0 15px; font-weight: bold;">Page ${currentWatchlistPage} of ${totalPages}</span>
            <button class="secondary-btn" data-watchlist-page="1" ${currentWatchlistPage === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Next</button>
        `;
        paginationContainer.querySelectorAll('[data-watchlist-page]').forEach((button) => {
            button.addEventListener('click', () => window.changeWatchlistPage(Number(button.dataset.watchlistPage)));
        });
    } else {
        paginationContainer.innerHTML = ''; 
    }
}

// ----------------------------------------
// Event Delegation
// ----------------------------------------
document.querySelectorAll('[data-watchlist-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterWatchlist(button.dataset.watchlistFilter));
});

initWatchlist();
