const params = new URLSearchParams(window.location.search);
const listId = params.get('id');
let supabaseClient = null;
let tmdbToken = "";
let isRanked = false;
let isManaging = false;
let currentItems = [];
let sortableInstance = null;
let isOwner = false;

async function initListDetails() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    tmdbToken = config.tmdb_token;

    const { data: { session } } = await supabaseClient.auth.getSession();
    const currentUserId = session?.user?.id;

    // 1. Fetch List Info and Check Ownership
    const { data: list } = await supabaseClient
        .from('media_lists')
        .select('*')
        .eq('id', listId)
        .single();

    if (!list) {
        console.error("List not found");
        window.location.href = 'index.html';
        return;
    }

    // This block handles both UI permissions and the dynamic back button
    if (list) {
        isOwner = (list.user_id === currentUserId);
        isRanked = list.is_ranked;

        // DYNAMIC BACK BUTTON: Ensures visitors go back to the owner's lists hub
        const backBtn = document.getElementById('back-to-lists-btn');
        if (backBtn) {
            backBtn.onclick = () => {
                window.location.href = `lists.html?id=${list.user_id}`;
            };
        }

        // 2. Hide Management UI if not the owner
        if (!isOwner) {
            document.querySelector('.search-container').style.display = 'none';
            document.querySelector('.list-controls').style.display = 'none';
            document.getElementById('manage-order-btn').style.display = 'none';
            document.getElementById('visibility-select').style.display = 'none';
            
            // IMPORTANT: Privacy check
            if (list.is_public === false) {
                alert("This list is private.");
                window.location.href = 'index.html';
                return;
            }
        } else {
            // Setup Visibility Toggle for owner
            const visSelect = document.getElementById('visibility-select');
            if (visSelect) {
                visSelect.value = String(list.is_public);
                visSelect.onchange = async () => {
                    const { error } = await supabaseClient
                        .from('media_lists')
                        .update({ is_public: visSelect.value === 'true' })
                        .eq('id', listId);
                    if (!error) alert("Visibility updated!");
                };
            }
        }

        // 3. Render contents
        document.getElementById('list-name').textContent = list.name;
        document.getElementById('list-desc').textContent = list.description || "Collection";
        
        await fetchListItems();
        if (isOwner) setupSearch();
    }
}

async function fetchListInfo() {
    const { data: list } = await supabaseClient
        .from('media_lists')
        .select('*')
        .eq('id', listId)
        .single();

    if (list) {
        document.getElementById('list-name').textContent = list.name;
        isRanked = list.is_ranked;
        
        const toggle = document.getElementById('ranked-toggle');
        if (toggle) {
            toggle.checked = isRanked;
            document.getElementById('manage-order-btn').style.display = isRanked ? 'inline-block' : 'none';
            
            toggle.onchange = async () => {
                const isNowRanked = toggle.checked;
                const confirmed = confirm(isNowRanked ? "Enable ranking?" : "Disable ranking?");
                if (confirmed) {
                    await supabaseClient.from('media_lists').update({ is_ranked: isNowRanked }).eq('id', listId);
                    
                    // Assign initial ranks if turning ON to maintain current order
                    if (isNowRanked) {
                        for (let i = 0; i < currentItems.length; i++) {
                            await supabaseClient.from('list_items')
                                .update({ rank: i + 1 })
                                .eq('id', currentItems[i].id);
                        }
                    }
                    location.reload(); 
                }
            };
        }
    }
}

function setupSearch() {
    const input = document.getElementById('list-search-input');
    const resultsDiv = document.getElementById('search-results');

    input.addEventListener('input', async () => {
        const query = input.value.trim();
        if (query.length < 3) {
            resultsDiv.style.display = 'none';
            return;
        }

        // Search Movies/TV via TMDB
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        // Search Books via OpenLibrary
        const bookRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3`).then(r => r.json());

        renderSearchResults(tmdbRes.results, bookRes.docs);
    });
}

function renderSearchResults(tmdb, books) {
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'block';

    // Process TMDB
    tmdb.filter(item => item.media_type !== 'person').slice(0, 5).forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
            <img src="https://image.tmdb.org/t/p/w92${item.poster_path}" onerror="this.src='placeholder.png'">
            <div>
                <strong>${item.title || item.name}</strong>
                <div class="meta">${item.media_type.toUpperCase()}</div>
            </div>
        `;
        div.onclick = () => addItem(item.id, item.media_type);
        resultsDiv.appendChild(div);
    });

    // Process Books
    books.forEach(book => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
            <img src="https://covers.openlibrary.org/b/id/${book.cover_i}-S.jpg" onerror="this.src='placeholder.png'">
            <div>
                <strong>${book.title}</strong>
                <div class="meta">BOOK</div>
            </div>
        `;
        div.onclick = () => addItem(book.key, 'book');
        resultsDiv.appendChild(div);
    });
}

async function addItem(mediaId, mediaType) {
    const { error } = await supabaseClient
        .from('list_items')
        .insert({ list_id: listId, media_id: String(mediaId), media_type: mediaType });

    if (error) {
        if (error.code === '23505') alert("Item already in list!");
        else alert("Error adding item.");
    } else {
        document.getElementById('search-results').style.display = 'none';
        document.getElementById('list-search-input').value = '';
        fetchListItems();
    }
}

async function fetchListItems() {
    const container = document.getElementById('list-content');
    
    // 1. You MUST check isRanked here to decide the sort
    let query = supabaseClient
        .from('list_items')
        .select('*')
        .eq('list_id', listId);
    
    if (isRanked) {
        // This tells Supabase: "Give me the smallest rank numbers first"
        query = query.order('rank', { ascending: true });
    } else {
        query = query.order('added_at', { ascending: false });
    }

    const { data: items, error } = await query;
    
    if (error) {
        console.error("Fetch Error:", error);
        return;
    }

    currentItems = items || [];
    console.log("Items fetched from DB:", currentItems); // Check the console for the 99!

    if (currentItems.length === 0) {
        container.innerHTML = "<p class='meta'>No items in this list yet.</p>";
        return;
    }

    renderList();
}

async function renderList() {
    const container = document.getElementById('list-content');
    container.innerHTML = '';

    // Destroy previous instance to refresh for the current state
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    for (let i = 0; i < currentItems.length; i++) {
        const item = currentItems[i];
        const details = await fetchMediaDetails(item.media_id, item.media_type);

        const card = document.createElement('div');
        card.className = `media-card ${isManaging ? 'managing' : ''} ${isRanked ? 'ranked-card' : ''}`;
        // CRITICAL: Set a data-id so we can identify the item after moving
        card.setAttribute('data-id', item.id);

        const rankBadge = isRanked ? `<div class="rank-badge">${i + 1}</div>` : '';
        
        card.innerHTML = `
            ${rankBadge}
            <button class="remove-btn" onclick="removeItem('${item.id}')">✕</button>
            <img src="${details.poster}" alt="${details.title}">
            <div class="media-info">
                <div class="title">${details.title}</div>
            </div>
        `;
        
        // Add click listener to go to details page (only if NOT managing)
        card.onclick = () => {
            if (!isManaging) {
                window.location.href = `details.html?id=${item.media_id}&type=${item.media_type}`;
            }
        };

        container.appendChild(card);
    }

    // Initialize SortableJS
    if (isManaging) {
        sortableInstance = new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: () => {
                // 1. Get the new order of data-ids directly from the HTML elements
                const newOrderIds = Array.from(container.querySelectorAll('.media-card'))
                                        .map(card => card.getAttribute('data-id'));

                // 2. Map the IDs back to the full objects from the original array
                const reorderedItems = newOrderIds.map(id => 
                    currentItems.find(item => item.id === id)
                );

                // 3. Update the global array so the 'Save' button sees the new order
                currentItems = reorderedItems;

                // 4. Update the visual numbers (1, 2, 3...)
                if (isRanked) updateRankBadges();
            }
        });
    }
}

// Helper to update numbers visually without a full re-render
function updateRankBadges() {
    document.querySelectorAll('.rank-badge').forEach((badge, index) => {
        badge.textContent = index + 1;
    });
}

// Update the Save Button to push to Supabase
document.getElementById('save-order-btn').onclick = async () => {
    console.log("--- START SAVE PROCESS ---");
    console.log("Current Items in Memory:", currentItems.map(i => i.id)); // DEBUG 1

    const btn = document.getElementById('save-order-btn');
    btn.textContent = "Saving...";
    btn.disabled = true;

    try {
        for (let i = 0; i < currentItems.length; i++) {
            const item = currentItems[i];
            const newRank = i + 1;

            console.log(`Updating ID: ${item.id} to Rank: ${newRank}`); // DEBUG 2

            const { error } = await supabaseClient
                .from('list_items')
                .update({ rank: newRank })
                .eq('id', item.id);
            
            if (error) {
                console.error("SUPABASE ERROR:", error); // DEBUG 3: This will tell us if RLS or a constraint blocked it
                throw error;
            }
        }

        console.log("--- SAVE SUCCESSFUL ---");
        alert("List order saved successfully!");
        isManaging = false;
        document.getElementById('save-order-btn').style.display = 'none';
        document.getElementById('manage-order-btn').style.display = 'inline-block';
        fetchListItems(); 
    } catch (err) {
        console.error("CATCH BLOCK ERROR:", err); // DEBUG 4
        alert("Error saving: " + err.message);
    } finally {
        btn.textContent = "Save Order";
        btn.disabled = false;
    }
};

document.getElementById('manage-order-btn').onclick = () => {
    isManaging = true;
    document.getElementById('manage-order-btn').style.display = 'none';
    document.getElementById('save-order-btn').style.display = 'inline-block';
    renderList();
};

// Helper to fetch details (refactored from your original code)
async function fetchMediaDetails(id, type) {
    if (type === 'book') {
        const res = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json());
        return {
            title: res.title,
            poster: res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'placeholder.png'
        };
    } else {
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());
        return {
            title: res.title || res.name,
            poster: `https://image.tmdb.org/t/p/w500${res.poster_path}`
        };
    }
}

window.removeItem = async (itemId) => {
    if (!confirm("Remove this item?")) return;
    await supabaseClient.from('list_items').delete().eq('id', itemId);
    fetchListItems();
};

initListDetails();