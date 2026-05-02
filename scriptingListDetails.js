const params = new URLSearchParams(window.location.search);
const listId = params.get('id');
let supabaseClient = null;
let tmdbToken = "";
let isRanked = false;
let isManaging = false;
let currentItems = [];
let sortableInstance = null;
let isOwner = false;
let lastfmKey = "";

async function initListDetails() {
    // 1. Initialize Supabase and Config
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    tmdbToken = config.tmdb_token;
    lastfmKey = config.lastfm_key;

    if (!listId) {
        window.location.href = 'index.html';
        return;
    }

    // 2. Fetch Current User
    const { data: { user } } = await supabaseClient.auth.getUser();
    const currentUserId = user?.id;

    // 3. Fetch List Details
    const { data: fetchedList, error: listError } = await supabaseClient
        .from('media_lists')
        .select('*')
        .eq('id', listId)
        .single();

    if (listError || !fetchedList) {
        alert("List not found or private.");
        window.location.href = 'index.html';
        return;
    }

    const list = fetchedList; 
    isRanked = list.is_ranked;

    // 4. Determine Permissions (Owner vs Collaborator vs Visitor)
    const isActualOwner = currentUserId === list.user_id;
    isOwner = isActualOwner; 

    if (!isActualOwner && currentUserId) {
        const { data: collab } = await supabaseClient
            .from('list_collaborators')
            .select('id')
            .eq('list_id', listId)
            .eq('user_id', currentUserId)
            .maybeSingle();
        
        if (collab) {
            isOwner = true; 
        }
    }

    // 5. UI Permissions & Ranked Toggle Setup
    // 5. UI Permissions & Edit Setup
    const manageBtn = document.getElementById('manage-order-btn');
    const editListBtn = document.getElementById('edit-list-btn');
    const collabBtn = document.getElementById('open-collab-modal-btn');
    
    // Modal Elements
    const editModal = document.getElementById('edit-list-modal');
    const closeEditModal = document.getElementById('close-edit-list-modal');

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
        // EDITOR MODE (Owner OR Collaborator)
        manageBtn.style.display = isRanked ? 'inline-block' : 'none';

        // --- Split Owner vs Collaborator Logic ---
        if (isActualOwner) {
            // OWNER ONLY: Can edit the list details and invite collaborators
            editListBtn.style.display = 'inline-block';
            setupCollabModal();
            collabBtn.style.display = 'inline-block';

            // --- Edit Modal Logic ---
            editListBtn.onclick = () => {
                // Populate the modal with current data
                document.getElementById('edit-list-name').value = list.name;
                document.getElementById('edit-list-desc').value = list.description || "";
                document.getElementById('edit-visibility-select').value = String(list.is_public);
                document.getElementById('edit-ranked-toggle').checked = isRanked;
                editModal.style.display = 'block';
            };

            closeEditModal.onclick = () => editModal.style.display = 'none';
            window.addEventListener('click', (e) => {
                if (e.target === editModal) editModal.style.display = 'none';
            });

            document.getElementById('save-list-edits-btn').onclick = async () => {
                const newName = document.getElementById('edit-list-name').value.trim();
                const newDesc = document.getElementById('edit-list-desc').value.trim();
                const isNowPublic = document.getElementById('edit-visibility-select').value === 'true';
                const isNowRanked = document.getElementById('edit-ranked-toggle').checked;

                if (!newName) return alert("List name cannot be empty.");

                const btn = document.getElementById('save-list-edits-btn');
                btn.textContent = "Saving...";
                btn.disabled = true;

                try {
                    // 1. Update Core List Settings
                    const { error: listUpdateErr } = await supabaseClient
                        .from('media_lists')
                        .update({ 
                            name: newName,
                            description: newDesc,
                            is_public: isNowPublic,
                            is_ranked: isNowRanked 
                        })
                        .eq('id', listId);
                    
                    if (listUpdateErr) throw listUpdateErr;

                    // 2. If Ranked was just turned ON, assign initial ranks to existing items
                    if (isNowRanked && !isRanked && currentItems.length > 0) {
                        const updates = currentItems.map((item, index) => {
                            return supabaseClient
                                .from('list_items')
                                .update({ rank: index + 1 })
                                .eq('id', item.id);
                        });
                        await Promise.all(updates); 
                    }

                    // 3. Update Local Variables & UI smoothly
                    list.name = newName;
                    list.description = newDesc;
                    list.is_public = isNowPublic;
                    isRanked = isNowRanked;

                    document.getElementById('list-name').textContent = list.name;
                    document.getElementById('list-desc').textContent = list.description || "Collection";
                    manageBtn.style.display = isRanked ? 'inline-block' : 'none';

                    editModal.style.display = 'none';
                    await fetchListItems(); // Re-render the cards (adds/removes numbers)
                    
                } catch (err) {
                    alert("Error updating list: " + err.message);
                } finally {
                    btn.textContent = "Save Changes";
                    btn.disabled = false;
                }
            };
            
        } else {
            // COLLABORATOR ONLY: Change Collab button to "Leave List"
            collabBtn.textContent = "Leave List";
            collabBtn.className = "danger-btn"; // Make it red
            collabBtn.style.display = 'inline-block';
            
            collabBtn.onclick = async () => {
                if(confirm("Are you sure you want to remove yourself from this list?")) {
                    const { error } = await supabaseClient
                        .from('list_collaborators')
                        .delete()
                        .eq('list_id', listId)
                        .eq('user_id', currentUserId);
                        
                    if(!error) window.location.href = 'lists.html'; 
                    else alert("Error leaving list: " + error.message);
                }
            };
        }
    }

    const contextId = params.get('context'); 
    const backToListsBtn = document.getElementById('back-to-lists-btn');

    if (backToListsBtn) {
        backToListsBtn.onclick = () => {
            if (contextId) {
                // Go back to the specific user's lists we came from
                window.location.href = `lists.html?id=${contextId}`;
            } else {
                // Fallback: Go to the list owner's page
                window.location.href = `lists.html?id=${list.user_id}`;
            }
        };
    }

    // 6. Final UI Rendering
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
            <div class="poster-wrapper">
                <img src="${details.poster}" alt="${details.title}" onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
            </div>
            <div class="media-info">
                <div class="title" style="font-weight:bold; font-size: 0.9rem; margin-bottom: 5px;">${details.title}</div>
                <div class="meta">
                    <span class="badge badge-${item.media_type}">${item.media_type}</span>
                </div>
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

        const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        const ytMatch = query.match(ytRegex);

        if (ytMatch && ytMatch[1]) {
            const ytId = ytMatch[1];
            try {
                const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytId}`).then(r => r.json());
                
                if (!res.error) {
                    resultsDiv.innerHTML = '';
                    resultsDiv.style.display = 'block';
                    
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.innerHTML = `
                        <img src="${res.thumbnail_url}" onerror="this.src='placeholder.png'">
                        <div>
                            <strong>${res.title}</strong>
                            <div class="meta">YOUTUBE</div>
                        </div>
                    `;
                    div.onclick = () => addItem(ytId, 'youtube');
                    resultsDiv.appendChild(div);
                    return; // Stop here so we don't fetch TMDB/OpenLibrary
                }
            } catch (err) {
                console.error("YouTube fetch error:", err);
            }
        }

        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        const bookRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3`).then(r => r.json());
        
        let albumRes = { results: { albummatches: { album: [] } } };
        try {
            albumRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(query)}&api_key=${lastfmKey}&format=json`).then(r => r.json());
        } catch (e) { console.error("Last.fm search failed", e); }

        renderSearchResults(tmdbRes.results, bookRes.docs, albumRes);
    });
}

function renderSearchResults(tmdb, books, albums) {
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

    albums?.results?.albummatches?.album?.slice(0, 3).forEach(a => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        let img = a.image && a.image[2]['#text'] ? a.image[2]['#text'] : 'https://placehold.co/92x138/1b2228/eb3486?text=Music';
        div.innerHTML = `
            <img src="${img}" onerror="this.src='https://placehold.co/92x138/1b2228/eb3486?text=Music'">
            <div>
                <strong>${a.name}</strong>
                <div class="meta">ALBUM • ${a.artist}</div>
            </div>
        `;
        const compositeId = encodeURIComponent(`${a.artist}|||${a.name}`);
        div.onclick = () => addItem(compositeId, 'album');
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
        if (type === 'youtube') {
            const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`).then(r => r.json());
            return {
                title: res.title || 'YouTube Video',
                poster: res.thumbnail_url || 'https://placehold.co/500x750/1b2228/ff0000?text=YouTube'
            };
        } else if (type === 'book') {            
            const res = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json());
            return {
                title: res.title,
                poster: res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Cover'
            };
        } else if (type === 'album') { // NEW: Add Album Fetching
            const decodedId = decodeURIComponent(id);
            const [artist, albumName] = decodedId.split('|||');
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${lastfmKey}&format=json`).then(r => r.json());
            return {
                title: res.album?.name || albumName,
                poster: res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`
            };
        } else {
            const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());
            return {
                title: res.title || res.name,
                poster: res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Image'
            };
        }
    } catch (e) {
        return { title: 'Unknown', poster: 'https://placehold.co/500x750/1b2228/9ab?text=Error' };
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