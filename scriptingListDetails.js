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

    // 1. Fetch List Info AND Collaborators
    const { data: list } = await supabaseClient
        .from('media_lists')
        .select('*, list_collaborators(user_id)')
        .eq('id', listId)
        .single();

    if (!list) {
        console.error("List not found");
        window.location.href = 'index.html';
        return;
    }

    const isActualOwner = (list.user_id === currentUserId);
    const isCollaborator = list.list_collaborators?.some(c => c.user_id === currentUserId);
    
    // isOwner represents anyone with EDIT permissions
    isOwner = isActualOwner || isCollaborator; 
    isRanked = list.is_ranked;

    // 2. Dynamic Back Button
    const backBtn = document.getElementById('back-to-lists-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            window.location.href = `lists.html?id=${list.user_id}`;
        };
    }

    // 3. UI Permissions & Ranked Toggle Setup
    const rankedToggle = document.getElementById('ranked-toggle');
    const manageBtn = document.getElementById('manage-order-btn');

    if (!isOwner) {
        // Visitor mode: Hide editing UI
        document.querySelector('.search-container').style.display = 'none';
        document.querySelector('.list-controls').style.display = 'none';
        if (list.is_public === false) {
            alert("This list is private.");
            window.location.href = 'index.html';
            return;
        }
    } else {
        // Editor mode (Owner or Collaborator)
        if (rankedToggle) {
            rankedToggle.checked = isRanked;
            manageBtn.style.display = isRanked ? 'inline-block' : 'none';
            
            rankedToggle.onchange = async () => {
                const isNowRanked = rankedToggle.checked;
                const { error } = await supabaseClient
                    .from('media_lists')
                    .update({ is_ranked: isNowRanked })
                    .eq('id', listId);
                
                if (!error) {
                    // Initialize ranks for existing items to match current order if turning ON
                    if (isNowRanked) {
                        for (let i = 0; i < currentItems.length; i++) {
                            await supabaseClient.from('list_items')
                                .update({ rank: i + 1 })
                                .eq('id', currentItems[i].id);
                        }
                    }
                    location.reload();
                } else {
                    alert("Error updating rank setting: " + error.message);
                }
            };
        }

        // Privacy Toggle - Only for the Actual Owner
        const visSelect = document.getElementById('visibility-select');
        if (visSelect) {
            if (isActualOwner) {
                visSelect.value = String(list.is_public);
                visSelect.onchange = async () => {
                    await supabaseClient
                        .from('media_lists')
                        .update({ is_public: visSelect.value === 'true' })
                        .eq('id', listId);
                    alert("Visibility updated!");
                };
            } else {
                visSelect.style.display = 'none';
            }
        }

        // Collaborator management - Only for the Actual Owner
        if (isActualOwner) {
            setupCollabModal();
            document.getElementById('open-collab-modal-btn').style.display = 'inline-block';
        }
    }

    document.getElementById('list-name').textContent = list.name;
    document.getElementById('list-desc').textContent = list.description || "Collection";
    
    await fetchListItems();
    if (isOwner) setupSearch();
}

async function fetchListItems() {
    const container = document.getElementById('list-content');
    
    let query = supabaseClient
        .from('list_items')
        .select('*')
        .eq('list_id', listId);
    
    if (isRanked) {
        query = query.order('rank', { ascending: true });
    } else {
        query = query.order('added_at', { ascending: false });
    }

    const { data: items, error } = await query;
    if (error) return console.error("Error fetching items:", error);

    currentItems = items || [];
    renderList();
}

async function renderList() {
    const container = document.getElementById('list-content');
    container.innerHTML = '';

    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    if (currentItems.length === 0) {
        container.innerHTML = "<p class='meta'>No items in this list yet.</p>";
        return;
    }

    container.innerHTML = '<p class="meta">Loading items...</p>';
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < currentItems.length; i++) {
        const item = currentItems[i];
        const details = await fetchMediaDetails(item.media_id, item.media_type);

        const card = document.createElement('div');
        card.className = `media-card ${isManaging ? 'managing' : ''} ${isRanked ? 'ranked-card' : ''}`;
        card.setAttribute('data-id', item.id);

        const rankBadge = isRanked ? `<div class="rank-badge">${i + 1}</div>` : '';
        const removeBtn = isOwner ? `<button class="remove-btn" onclick="removeItem('${item.id}', event)">✕</button>` : '';
        
        card.innerHTML = `
            ${rankBadge}
            ${removeBtn}
            <img src="${details.poster}" alt="${details.title}" onerror="this.src='placeholder.png'">
            <div class="media-info">
                <div class="title">${details.title}</div>
            </div>
        `;
        
        card.onclick = () => {
            if (!isManaging) {
                window.location.href = `details.html?id=${item.media_id}&type=${item.media_type}`;
            }
        };

        fragment.appendChild(card);
    }

    container.innerHTML = '';
    container.appendChild(fragment);

    // Initialize drag-and-drop if managing order
    if (isManaging && isRanked) {
        sortableInstance = new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: () => {
                const newOrderIds = Array.from(container.querySelectorAll('.media-card'))
                                        .map(card => card.getAttribute('data-id'));

                // Reorder the local array based on the new DOM order
                currentItems = newOrderIds.map(id => currentItems.find(item => item.id === id));
                updateRankBadges();
            }
        });
    }
}

function updateRankBadges() {
    document.querySelectorAll('.rank-badge').forEach((badge, index) => {
        badge.textContent = index + 1;
    });
}

document.getElementById('manage-order-btn').onclick = () => {
    isManaging = true;
    document.getElementById('manage-order-btn').style.display = 'none';
    document.getElementById('save-order-btn').style.display = 'inline-block';
    renderList();
};

document.getElementById('save-order-btn').onclick = async () => {
    const btn = document.getElementById('save-order-btn');
    btn.textContent = "Saving...";
    btn.disabled = true;

    try {
        // Individual updates to handle collaborator RLS specifically
        for (let i = 0; i < currentItems.length; i++) {
            const item = currentItems[i];
            const newRank = i + 1;

            console.log(`Saving: Item ${item.id} -> New Rank ${newRank}`);

            const { error } = await supabaseClient
                .from('list_items')
                .update({ rank: newRank })
                .eq('id', item.id);
            
            if (error) {
                console.error(`Error updating rank for item ${item.id}:`, error);
                throw new Error(`Permission denied or database error on item ${i + 1}.`);
            }
        }

        alert("Order saved successfully!");
        isManaging = false;
        document.getElementById('save-order-btn').style.display = 'none';
        document.getElementById('manage-order-btn').style.display = 'inline-block';
        fetchListItems(); 
    } catch (err) {
        alert("Error saving: " + err.message);
    } finally {
        btn.textContent = "Save Order";
        btn.disabled = false;
    }
};

async function setupSearch() {
    const input = document.getElementById('list-search-input');
    const resultsDiv = document.getElementById('search-results');

    input.addEventListener('input', async () => {
        const query = input.value.trim();
        if (query.length < 3) {
            resultsDiv.style.display = 'none';
            return;
        }

        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        const bookRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3`).then(r => r.json());
        renderSearchResults(tmdbRes.results, bookRes.docs);
    });
}

function renderSearchResults(tmdb, books) {
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'block';

    tmdb?.filter(item => item.media_type !== 'person').slice(0, 5).forEach(item => {
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

    books?.forEach(book => {
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
    const newRank = isRanked ? currentItems.length + 1 : null;
    
    const { error } = await supabaseClient
        .from('list_items')
        .insert({ 
            list_id: listId, 
            media_id: String(mediaId), 
            media_type: mediaType,
            rank: newRank
        });

    if (error) {
        alert(error.code === '23505' ? "Item already in list!" : "Error adding item: " + error.message);
    } else {
        document.getElementById('search-results').style.display = 'none';
        document.getElementById('list-search-input').value = '';
        fetchListItems();
    }
}

async function fetchMediaDetails(id, type) {
    try {
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
                poster: res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : 'placeholder.png'
            };
        }
    } catch (e) {
        return { title: 'Unknown', poster: 'placeholder.png' };
    }
}

window.removeItem = async (itemId, event) => {
    if (event) event.stopPropagation();
    if (!confirm("Remove this item?")) return;
    
    const { error } = await supabaseClient.from('list_items').delete().eq('id', itemId);
    if (error) alert("Error removing item: " + error.message);
    else fetchListItems();
};

async function setupCollabModal() {
    const modal = document.getElementById('collab-modal');
    const openBtn = document.getElementById('open-collab-modal-btn');
    const closeBtn = document.getElementById('close-collab-modal');
    const collabListDiv = document.getElementById('collab-list');

    const refreshCollabList = async () => {
        const { data, error } = await supabaseClient
            .from('list_collaborators')
            .select(`id, user_id, profiles:user_id (username, display_name, avatar_url)`)
            .eq('list_id', listId);
        
        if (error) return;

        collabListDiv.innerHTML = data?.length ? '' : '<p class="meta">No collaborators yet.</p>';
        data?.forEach(collab => {
            const u = collab.profiles;
            if (!u) return;
            const avatar = u.avatar_url || `https://ui-avatars.com/api/?name=${u.username}&background=1b2228&color=9ab`;
            const row = document.createElement('div');
            row.className = 'social-user-row';
            row.style.justifyContent = 'space-between';
            row.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px;">
                    <img src="${avatar}" class="social-avatar" style="width:32px; height:32px;">
                    <div class="social-info">
                        <span class="social-name">${u.display_name || u.username}</span>
                        <span class="social-username">@${u.username}</span>
                    </div>
                </div>
                <span onclick="removeCollaborator('${collab.id}')" style="color:#ff4d4d; cursor:pointer; font-size:1.5rem; padding:0 10px;">&times;</span>
            `;
            collabListDiv.appendChild(row);
        });
    };

    openBtn.onclick = () => { modal.style.display = 'block'; refreshCollabList(); };
    closeBtn.onclick = () => modal.style.display = 'none';
    window.removeCollaborator = async (id) => {
        if (confirm("Remove collaborator?")) {
            await supabaseClient.from('list_collaborators').delete().eq('id', id);
            refreshCollabList();
        }
    };

    document.getElementById('add-collab-btn').onclick = async () => {
        const input = document.getElementById('collab-username');
        const username = input.value.trim();
        const { data: profile } = await supabaseClient.from('profiles').select('id').eq('username', username).single();
        if (!profile) return alert("User not found!");
        const { error } = await supabaseClient.from('list_collaborators').insert({ list_id: listId, user_id: profile.id });
        if (error) alert("Already a collaborator or error occurred.");
        else { input.value = ''; refreshCollabList(); }
    };
}

initListDetails();