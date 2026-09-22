// Import necessary modules and functions
import { loadConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';
import { normalizeOpenLibraryId } from './core/media.js';
import { processFetchedLists, filterListsByCategory } from './logic/lists-logic.js';

// Load configuration and initialize Supabase client
let PROXY_URL = '';
let supabaseClient = null;

// Global vars
let allFetchedLists = [];
let currentListTab = 'owned';
let isManagingLists = false;
let listsSortableInstance = null;
let listOwnerId = null;
let isViewerOwner = false;
const customImgsMap = new Map();

// ----------------------------------------
// Initialization
// ----------------------------------------
async function initLists() {
    const config = await loadConfig();
    PROXY_URL = config.proxy_url;
    supabaseClient = await getSupabaseClient();
    await customElements.whenDefined('app-header');
    await document.querySelector('app-header').initializeAuth(supabaseClient);

    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('id');
    const { data: { session } } = await supabaseClient.auth.getSession();
    const currentUserId = session?.user?.id;

    listOwnerId = urlId || currentUserId;
    isViewerOwner = (listOwnerId === currentUserId);

    if (!listOwnerId) {
        window.location.href = 'index.html';
        return;
    }

    if (!isViewerOwner) {
        // 1. Update the page heading to show it's another user's collection
        const pageTitle = document.querySelector('h1');
        if (pageTitle) pageTitle.textContent = "Shared Lists";

        // 2. Hide the creation panel since visitors can't make lists for other users
        const createSection = document.querySelector('.create-list-section');
        if (createSection) createSection.style.display = 'none';

        // 3. Hide any reordering/management controls
        const manageBtn = document.getElementById('manage-lists-btn');
        if (manageBtn) manageBtn.style.display = 'none';
    } else {
        // Standard owner adjustments
        const pageTitle = document.querySelector('h1');
        if (pageTitle) pageTitle.textContent = "My Lists";
        
        const createSection = document.querySelector('.create-list-section');
        if (createSection) createSection.style.display = 'block';
    }

    const backToProfileBtn = document.getElementById('back-to-profile-btn');
    if (backToProfileBtn) {
        backToProfileBtn.removeAttribute('onclick'); 
        backToProfileBtn.onclick = () => window.location.href = `profile.html?id=${listOwnerId}`;
    }

    const createSection = document.querySelector('.create-list-section');
    const pageTitle = document.querySelector('h1');
    const manageListsBtn = document.getElementById('manage-lists-btn');
    const saveListsBtn = document.getElementById('save-lists-order-btn');

    if (isViewerOwner) {
        pageTitle.textContent = "My Lists";
        if (createSection) createSection.style.display = 'block';
        manageListsBtn.style.display = 'inline-block';
        document.getElementById('create-list-btn').onclick = () => createList(currentUserId);
    } else {
        if (createSection) createSection.style.display = 'none';
        manageListsBtn.style.display = 'none';
        
        const { data: profile } = await supabaseClient.from('profiles').select('display_name').eq('id', listOwnerId).single();
        pageTitle.textContent = profile ? `${profile.display_name}'s Lists` : "Lists";

        const navActions = document.querySelector('.nav-actions');
        if (navActions && !document.getElementById('context-profile-btn')) {
            const contextBtn = document.createElement('button');
            contextBtn.id = 'context-profile-btn';
            contextBtn.className = 'secondary-btn';
            contextBtn.style.marginRight = '10px';
            contextBtn.textContent = profile ? `← ${profile.display_name}'s Profile` : '← Back to Profile';
            contextBtn.onclick = () => window.location.href = `profile.html?id=${listOwnerId}`;
            navActions.prepend(contextBtn);
        }
    }

    const { data: customImgs } = await supabaseClient.from('custom_imgs').select('*').eq('user_id', listOwnerId);
    if (customImgs) {
        customImgs.forEach(img => customImgsMap.set(`${img.media_type}_${img.media_id}`, img));
    }

    // Reorder Button Logic
    manageListsBtn.onclick = () => {
        isManagingLists = true;
        manageListsBtn.style.display = 'none';
        saveListsBtn.style.display = 'inline-block';
        renderFilteredLists();
    };

    saveListsBtn.onclick = async () => {
        saveListsBtn.textContent = 'Saving...';
        saveListsBtn.disabled = true;
        try {
            await saveListsOrder();
            isManagingLists = false;
            saveListsBtn.style.display = 'none';
            manageListsBtn.style.display = 'inline-block';
            renderFilteredLists();
        } catch (err) {
            alert('Error saving order: ' + err.message);
        } finally {
            saveListsBtn.textContent = 'Save Order';
            saveListsBtn.disabled = false;
        }
    };

    fetchUserLists(listOwnerId, currentUserId);
}

// ----------------------------------------
// Data Fetching
// ----------------------------------------
async function fetchUserLists(userId, currentUserId) {
    const container = document.getElementById('lists-container');
    
    try {
        const { data: ownedLists, error: ownedError } = await supabaseClient
            .from('media_lists')
            .select('*, list_items(media_id, media_type, added_at, tier_rank, custom_image_url, media_title)')
            .eq('user_id', listOwnerId);

        const { data: collabRecords, error: collabError } = await supabaseClient
            .from('list_collaborators')
            .select('list_id, media_lists(*, list_items(media_id, media_type, added_at, tier_rank, custom_image_url, media_title))')
            .eq('user_id', userId);

        if (ownedError || collabError) throw (ownedError || collabError);

        let visitorCollabs = new Set();
        if (!isViewerOwner && currentUserId) {
            const { data: vc } = await supabaseClient
                .from('list_collaborators')
                .select('list_id')
                .eq('user_id', currentUserId);
            if (vc) visitorCollabs = new Set(vc.map(c => c.list_id));
        }

        // Delegate to pure logic function
        allFetchedLists = processFetchedLists(ownedLists, collabRecords, listOwnerId, currentUserId, visitorCollabs, isViewerOwner);

        filterLists(currentListTab); 

    } catch (err) {
        console.error("Critical Fetch Error:", err);
        container.innerHTML = "<p class='meta' style='color:red;'>Error loading lists. Permission denied.</p>";
    }
}

// ----------------------------------------
// State Management & Filtering
// ----------------------------------------
// Window level filter function to handle tab clicks
window.filterLists = (category) => {
    currentListTab = category;

    // Update Tab UI
    document.querySelectorAll('#lists-filter-nav .filter-btn').forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        if ((category === 'owned' && btnText === 'owned') ||
            (category === 'shared' && btnText === 'shared with me') ||
            (category === 'tier' && btnText === 'tier lists')) {
            btn.classList.add('active');
        }
    });

    renderFilteredLists();
};

// ----------------------------------------
// UI Rendering
// ----------------------------------------
async function renderFilteredLists() {
    const container = document.getElementById('lists-container');
    
    if (listsSortableInstance) {
        listsSortableInstance.destroy();
        listsSortableInstance = null;
    }

    // Delegate to pure logic function
    const filtered = filterListsByCategory(allFetchedLists, currentListTab, listOwnerId);

    if (filtered.length === 0) {
        container.innerHTML = "<p class='meta'>No lists found in this category.</p>";
        return;
    }

    container.innerHTML = '';

    for (const list of filtered) {
        const isShared = list.user_id !== listOwnerId;
        const firstItems = (list.list_items || [])
            .sort((a, b) => new Date(a.added_at) - new Date(b.added_at))
            .slice(0, 3);

        const listCard = document.createElement('div');
        listCard.className = `list-card ${isManagingLists ? 'managing' : ''}`;
        listCard.setAttribute('data-list-id', list.id);
        
        if (isManagingLists) {
            listCard.style.cursor = 'grab';
        } else {
            listCard.onclick = () => window.location.href = `list-details.html?id=${list.id}&context=${listOwnerId}`;
        }

        let postersHtml = '<div class="list-poster-preview">';
        for (const item of firstItems) {
            let posterUrl = 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
            try {
                if (item.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(item.media_id)}.json`).then(r => r.json());
                    if (res.covers) posterUrl = `https://covers.openlibrary.org/b/id/${res.covers[0]}-S.jpg`;
                } else if (item.media_type === 'youtube') {
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${item.media_id}`)}&format=json`).then(r => r.json());
                    if (res.thumbnail_url) posterUrl = res.thumbnail_url;
                } else if (item.media_type === 'album') {
                    const decodedId = decodeURIComponent(item.media_id);
                    const [artist, albumName] = decodedId.split('|||');
                    const res = await fetch(`${PROXY_URL}/api/lastfm?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}`).then(r => r.json());
                    if (res.album?.image?.[3]['#text']) posterUrl = res.album.image[3]['#text'];
                } else if (item.media_type === 'movie' || item.media_type === 'tv') {
                    const res = await fetch(`${PROXY_URL}/api/tmdb/${item.media_type}/${item.media_id}`).then(r => r.json());
                    if (res.poster_path) posterUrl = `https://image.tmdb.org/t/p/w185${res.poster_path}`;
                } else if (['character', 'author', 'artist'].includes(item.media_type) || (item.media_type === 'person' && !/^\d+$/.test(item.media_id))) {
                    posterUrl = item.custom_image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.media_title || item.media_id)}&background=1b2228&color=9ab`;
                }
            } catch (e) { console.warn("Poster fetch failed", e); }

            const customArt = customImgsMap.get(`${item.media_type}_${String(item.media_id)}`);
            if (customArt && customArt.custom_poster) {
                posterUrl = customArt.custom_poster;
            }
            
            postersHtml += `<img src="${posterUrl}" class="preview-poster" data-type="${item.media_type}" onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">`;
        }
        postersHtml += '</div>';

        const sharedBadge = isShared ? `<span class="collab-badge">Shared</span>` : '';
        const privateBadge = !list.is_public ? `<span class="collab-badge" style="border-color:#ff4d4d; color:#ff4d4d; background:none;">Private</span>` : '';
        const tierBadge = list.is_tiered ? `<span class="collab-badge" style="border-color:var(--text-accent); color:var(--text-accent); background:none;">Tiered</span>` : '';

        listCard.innerHTML = `
            ${postersHtml}
            <div class="list-card-content">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 5px;">
                    <h3 style="margin:5px 0; font-size:1.1rem; line-height: 1.2;">${list.name}</h3>
                    <div style="display:flex; flex-direction: column; align-items: flex-end; gap:4px;">
                        ${privateBadge}${sharedBadge}${tierBadge}
                    </div>
                </div>
                <p class="meta" style="margin:0;">${list.list_items?.length || 0} items</p>
            </div>
        `;
        container.appendChild(listCard);
    }

    if (isViewerOwner && isManagingLists) {
        listsSortableInstance = new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost'
        });
    }
}

// ----------------------------------------
// CRUD Operations & Integrations
// ----------------------------------------
async function createList(userId) {
    const nameInput = document.getElementById('list-name-input');
    const name = nameInput.value.trim();
    const isTiered = document.getElementById('create-tiered-toggle').checked;

    if (!name) return alert("Please enter a list name.");

    const { error } = await supabaseClient
        .from('media_lists')
        .insert({ 
            user_id: userId, 
            name: name,
            is_tiered: isTiered,
            is_ranked: isTiered // Inherently true for tiered lists
        });

    if (error) {
        alert("Error creating list: " + error.message);
    } else {
        nameInput.value = '';
        document.getElementById('create-tiered-toggle').checked = false;
        // Switch to the correct tab to show the new list
        currentListTab = isTiered ? 'tier' : 'owned';
        fetchUserLists(userId, userId); 
    }
}

async function saveListsOrder() {
    const container = document.getElementById('lists-container');
    const cards = container.querySelectorAll('.list-card');
    
    const updates = [];
    cards.forEach((card, index) => {
        const listId = card.getAttribute('data-list-id');
        const rank = index + 1;
        
        // Update the global state so tab switching doesn't reset it
        const listRef = allFetchedLists.find(l => l.id === listId);
        if (listRef) listRef.sort_rank = rank;

        updates.push({ id: listId, sort_rank: rank });
    });

    for (const u of updates) {
        const { error } = await supabaseClient.from('media_lists').update({ sort_rank: u.sort_rank }).eq('id', u.id);
        if (error) throw new Error(error.message);
    }
}

// ----------------------------------------
// Event Delegation
// ----------------------------------------
document.querySelectorAll('[data-list-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterLists(button.dataset.listFilter));
});

initLists();
