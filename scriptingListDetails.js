const params = new URLSearchParams(window.location.search);
const listId = params.get('id');
let supabaseClient = null;
let tmdbToken = "";
let isRanked = false;
let isTiered = false;
let tierColors = {};
let isManaging = false;
let currentItems = [];
let sortableInstance = null;
let sortableInstances = [];
let isOwner = false;
let lastfmKey = "";
let customImgsMap = new Map();

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
    isTiered = list.is_tiered || false;
    tierColors = list.tier_colors || {"S": "#ff7f7f", "A": "#ffbf7f", "B": "#ffff7f", "C": "#7fff7f", "D": "#7fbfff", "F": "#ff7fff"};

    // 4. Determine Permissions (Owner vs Collaborator vs Visitor)
    const isActualOwner = currentUserId === list.user_id;
    let isCollaborator = false;

    if (!isActualOwner && currentUserId) {
        const { data: collab } = await supabaseClient
            .from('list_collaborators')
            .select('id')
            .eq('list_id', listId)
            .eq('user_id', currentUserId)
            .maybeSingle();
        
        if (collab) isCollaborator = true;
    }

    isOwner = isActualOwner || isCollaborator;

    // --- Fetch the correct Custom Images based on ownership ---
    const targetImgUserId = isOwner ? currentUserId : list.user_id;
    if (targetImgUserId) {
        const { data: customImgs } = await supabaseClient
            .from('custom_imgs')
            .select('*')
            .eq('user_id', targetImgUserId);
            
        if (customImgs) {
            customImgs.forEach(img => {
                customImgsMap.set(`${img.media_type}_${img.media_id}`, img);
            });
        }
    }

    // 5. UI Permissions & Edit Setup
    const manageBtn = document.getElementById('manage-order-btn');
    const editListBtn = document.getElementById('edit-list-btn');
    const collabBtn = document.getElementById('open-collab-modal-btn');
    
    // Modal Elements
    const editModal = document.getElementById('edit-list-modal');
    const closeEditModal = document.getElementById('close-edit-list-modal');

    if (!isOwner) {
        // Visitor mode: Hide editing UI
        const addSection = document.getElementById('add-to-list-section');
        if (addSection) addSection.style.display = 'none';
        document.querySelector('.list-controls').style.display = 'none';
        if (list.is_public === false) {
            alert("This list is private.");
            window.location.href = 'index.html';
            return;
        }

        // --- NEW: Fetch profile and inject context button ---
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('display_name')
            .eq('id', list.user_id)
            .single();

        const navActions = document.querySelector('.nav-actions');
        if (navActions && !document.getElementById('context-profile-btn')) {
            const contextBtn = document.createElement('button');
            contextBtn.id = 'context-profile-btn';
            contextBtn.className = 'secondary-btn';
            contextBtn.style.marginRight = '10px';
            contextBtn.textContent = profile ? `← ${profile.display_name}'s Lists` : '← Back to Lists';
            contextBtn.onclick = () => window.location.href = `lists.html?id=${list.user_id}`;
            navActions.prepend(contextBtn);
        }
    } else {
        manageBtn.style.display = isRanked ? 'inline-block' : 'none';

        // --- SHARED LOGIC: Both Owners and Collaborators can Edit the List Details ---
        editListBtn.style.display = 'inline-block';

        editListBtn.onclick = () => {
            // Populate the modal with current data
            document.getElementById('edit-list-name').value = list.name;
            document.getElementById('edit-list-desc').value = list.description || "";
            document.getElementById('edit-visibility-select').value = String(list.is_public);
            document.getElementById('edit-ranked-toggle').checked = isRanked;
            
            const tierSection = document.getElementById('edit-tier-colors-section');
            const tierColorsContainer = document.getElementById('tier-colors-container');
            if (isTiered) {
                tierSection.style.display = 'block';
                tierColorsContainer.innerHTML = Object.keys(tierColors).map(tier => `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <label style="color: white; width: 25px; font-weight: bold;">${tier}</label>
                        <input type="color" id="color-${tier}" value="${tierColors[tier]}" style="background: none; border: none; cursor: pointer; height: 30px; width: 50px; padding: 0;">
                    </div>
                `).join('');
            } else {
                tierSection.style.display = 'none';
            }

            editModal.style.display = 'flex';
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

            let updatedColors = tierColors;
            if (isTiered) {
                Object.keys(tierColors).forEach(tier => {
                    const colorInput = document.getElementById(`color-${tier}`);
                    if (colorInput) updatedColors[tier] = colorInput.value;
                });
            }

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
                        is_ranked: isNowRanked,
                        tier_colors: updatedColors
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
                tierColors = updatedColors;

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

        // --- Split Owner vs Collaborator Logic for the Modal/Invites ---
        if (isActualOwner) {
            // OWNER ONLY: Can invite collaborators and delete list
            setupCollabModal();
            collabBtn.style.display = 'inline-block';
            
            const deleteBtn = document.getElementById('delete-list-btn');
            if (deleteBtn) {
                deleteBtn.style.display = 'block';
                deleteBtn.onclick = async () => {
                    if (confirm("Are you sure you want to permanently delete this list? This cannot be undone.")) {
                        deleteBtn.textContent = "Deleting...";
                        deleteBtn.disabled = true;
                        
                        // Delete items and collabs first to avoid foreign key constraint errors
                        await supabaseClient.from('list_items').delete().eq('list_id', listId);
                        await supabaseClient.from('list_collaborators').delete().eq('list_id', listId);
                        const { error } = await supabaseClient.from('media_lists').delete().eq('id', listId);
                        
                        if (error) {
                            alert("Error deleting list: " + error.message);
                            deleteBtn.textContent = "Delete List";
                            deleteBtn.disabled = false;
                        } else {
                            window.location.href = `lists.html?id=${currentUserId}`;
                        }
                    }
                };
            }
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
    if (isOwner) {
        setupSearch();
        setupCustomCardModal();
    }
    setupHeader()
}

async function setupHeader() {
    const loginBtn = document.getElementById('login-btn');
    const profileMenu = document.getElementById('profile-menu');

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        if (loginBtn) loginBtn.style.display = 'none'; 
        if (profileMenu) profileMenu.style.display = 'inline-block';
        
        const avatar = document.getElementById('nav-avatar');
        if (avatar && user.user_metadata && user.user_metadata.avatar_url) {
            avatar.src = user.user_metadata.avatar_url;
        }
    } else {
        if (loginBtn) {
            loginBtn.style.display = 'inline-block';
            loginBtn.textContent = "Sign In";
            loginBtn.onclick = () => window.location.href = 'index.html'; 
        }
        if (profileMenu) profileMenu.style.display = 'none';
    }
}

function toggleProfileDropdown(event) {
    if (event) event.stopPropagation();
    const content = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (!content || !trigger) return;
    
    const isVisible = content.style.display === 'block';
    content.style.display = isVisible ? 'none' : 'block';
    trigger.classList.toggle('active', !isVisible);
}

window.onclick = (event) => {
    const dropdown = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
};

async function signOut() {
    await supabaseClient.auth.signOut();
    location.reload();
}

async function fetchListItems() {
    const container = document.getElementById('list-content');
    
    let query = supabaseClient
        .from('list_items')
        .select('*')
        .eq('list_id', listId);
    
    if (isTiered) {
        query = query.order('rank', { ascending: true }); // We'll group locally by tier
    } else if (isRanked) {
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

    if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];

    if (currentItems.length === 0) {
        container.innerHTML = "<p class='meta'>No items in this list yet.</p>";
        return;
    }

    container.innerHTML = '<p class="meta">Loading items...</p>';
    
    if (isTiered) {
        await renderTieredList(container);
    } else {
        await renderStandardList(container);
    }
}

async function createListCard(item, index, listType) {
    const details = item.is_custom 
        ? { title: item.custom_name, poster: item.custom_image_url || 'https://placehold.co/500x750/1b2228/9ab?text=Custom' }
        : await fetchMediaDetails(item);

    const customArt = customImgsMap.get(`${item.media_type}_${String(item.media_id)}`);
    if (customArt && customArt.custom_poster) {
        details.poster = customArt.custom_poster;
    }

    let badgeHtml = `<span class="badge badge-${item.media_type}">${item.media_type}</span>`;
    let metaHtml = '';

    if (['character', 'author', 'artist', 'actor', 'crew', 'person', 'other', 'fandom', 'collection'].includes(item.media_type)) {
        badgeHtml = ''; 
        
        if (item.media_type === 'character' && item.source_media_title) {
            metaHtml = `<div class="meta" style="font-size: 0.8rem; color: #9ab; margin-top: -2px;">Character from ${item.source_media_title}</div>`;
        }
    }

    const card = document.createElement('div');
    
    // Apply proper classes based on list type
    if (listType === 'standard') {
        card.className = `media-card ${isManaging ? 'managing' : ''} ${isRanked ? 'ranked-card' : ''}`;
    } else {
        card.className = `media-card ${isManaging ? 'managing' : ''}`;
    }
    
    card.setAttribute('data-type', item.media_type);
    card.setAttribute('data-id', item.id);

    const rankBadge = (listType === 'standard' && isRanked) ? `<div class="rank-badge">${index + 1}</div>` : '';
    const removeBtn = isOwner ? `<button class="remove-btn" onclick="removeItem('${item.id}', event)">✕</button>` : '';
    
    card.innerHTML = `
        ${rankBadge}
        ${removeBtn}
        <div class="poster-wrapper">
            <img src="${details.poster}" alt="${details.title}" onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
            ${badgeHtml}
        </div>
        <div class="media-info">
            <div class="title" style="font-weight:bold; font-size: 0.9rem; margin-bottom: 5px;">${details.title}</div>
            ${metaHtml}
        </div>
    `;
    
    card.onclick = () => {
        if (!isManaging && !item.is_custom) {
            if (['character', 'author', 'artist'].includes(item.media_type)) {
                const param = item.media_type === 'character' ? 'characterWiki' : (item.media_type === 'author' ? 'authorId' : 'artist');
                window.location.href = `cast.html?${param}=${encodeURIComponent(item.media_id)}`;
            } else if (item.media_type === 'person' || item.media_type === 'actor' || item.media_type === 'crew') {
                window.location.href = `cast.html?personId=${item.media_id}`;
            } else {
                window.location.href = `details.html?id=${item.media_id}&type=${item.media_type}`;
            }
        }
    };

    return card;
}

async function renderStandardList(container) {
    container.innerHTML = '';
    container.classList.add('list-items-grid');
    container.classList.remove('tiered-list-container');
    
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < currentItems.length; i++) {
        const card = await createListCard(currentItems[i], i, 'standard');
        fragment.appendChild(card);
    }   

    container.appendChild(fragment);

    if (isManaging && isRanked) {
        sortableInstance = new Sortable(container, { 
            animation: 150,
            disabled: !isManaging || !isRanked,
            onEnd: (evt) => { updateRankBadges(); }
        });
    }
}

async function renderTieredList(container) {
    container.innerHTML = '';
    container.classList.remove('list-items-grid');
    container.classList.add('tiered-list-container');

    const tiers = ['S', 'A', 'B', 'C', 'D', 'F', 'NS'];
    
    for (const tier of tiers) {
        const tierItems = currentItems.filter(item => item.tier_rank === tier).sort((a, b) => (a.rank || 0) - (b.rank || 0));
        const tierColor = tierColors[tier] || '#444'; 
        const tierLabel = tier === 'NS' ? 'N/A' : tier;

        const tierRow = document.createElement('div');
        tierRow.className = 'tier-row';
        
        tierRow.innerHTML = `
            <div class="tier-label" style="background-color: ${tierColor}; color: ${tier === 'NS' ? '#fff' : '#000'};">${tierLabel}</div>
            <div class="tier-content" data-tier="${tier}" id="tier-content-${tier}"></div>
        `;
        container.appendChild(tierRow);

        const contentDiv = tierRow.querySelector('.tier-content');
        
        for (let i = 0; i < tierItems.length; i++) {
            const card = await createListCard(tierItems[i], i, 'tiered');
            contentDiv.appendChild(card);
        }

        if (isManaging) {
            const sortable = new Sortable(contentDiv, {
                group: 'shared-tiers',
                animation: 150,
                disabled: !isManaging,
                ghostClass: 'sortable-ghost'
            });
            sortableInstances.push(sortable);
        }
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
        if (isTiered) {
            const tiers = ['S', 'A', 'B', 'C', 'D', 'F', 'NS'];
            for (const tier of tiers) {
                const contentDiv = document.getElementById(`tier-content-${tier}`);
                if (!contentDiv) continue;
                const cards = contentDiv.querySelectorAll('.media-card');
                
                for (let i = 0; i < cards.length; i++) {
                    const dbId = cards[i].getAttribute('data-id');
                    const newRank = i + 1;
                    if (!dbId) continue;

                    const { error } = await supabaseClient
                        .from('list_items')
                        .update({ rank: newRank, tier_rank: tier })
                        .eq('id', dbId);
                    
                    if (error) throw new Error(`Database error on rank ${newRank}.`);
                }
            }
        } else {
            const container = document.getElementById('list-content');
            const cards = container.querySelectorAll('.media-card');
            
            for (let i = 0; i < cards.length; i++) {
                const dbId = cards[i].getAttribute('data-id');
                const newRank = i + 1;

                if (!dbId) continue;

                const { error } = await supabaseClient
                    .from('list_items')
                    .update({ rank: newRank })
                    .eq('id', dbId);
                
                if (error) throw new Error(`Permission denied or database error on rank ${newRank}.`);
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
                    div.onclick = () => addItem(ytId, 'youtube', res.title);
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

    tmdb?.filter(item => isTiered || item.media_type !== 'person').slice(0, 5).forEach(item => {
        const div = document.createElement('div');
        const imgPath = item.poster_path || item.profile_path;
        div.className = 'search-result-item';
        div.innerHTML = `
            <img src="https://image.tmdb.org/t/p/w92${imgPath}" onerror="this.src='placeholder.png'">
            <div>
                <strong>${item.title || item.name}</strong>
                <div class="meta">${item.media_type.toUpperCase()}</div>
            </div>
        `;
        div.onclick = () => addItem(item.id, item.media_type, item.title || item.name);
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
        div.onclick = () => addItem(book.key, 'book', book.title);
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
        div.onclick = () => addItem(compositeId, 'album', a.name);
        resultsDiv.appendChild(div);
    });
}

async function addItem(mediaId, mediaType, mediaTitle) {
    const newRank = isRanked || isTiered ? currentItems.length + 1 : null;
    const newTierRank = isTiered ? 'NS' : 'NS';
    
    const { error } = await supabaseClient
        .from('list_items')
        .insert({ 
            list_id: listId, 
            media_id: String(mediaId), 
            media_type: mediaType,
            media_title: mediaTitle,
            rank: newRank,
            tier_rank: newTierRank
        });

    if (error) {
        alert(error.code === '23505' ? "Item already in list!" : "Error adding item: " + error.message);
    } else {
        document.getElementById('search-results').style.display = 'none';
        document.getElementById('list-search-input').value = '';
        fetchListItems();
    }
}

async function fetchMediaDetails(item) {
    const id = item.media_id;
    const type = item.media_type;
    try {
        if (['character', 'author', 'artist', 'actor', 'crew', 'other'].includes(type) || (type === 'person' && !/^\d+$/.test(id))) {
            return {
                title: item.media_title || item.custom_name || id,
                poster: item.custom_image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.media_title || id)}&background=1b2228&color=9ab&size=300`
            };
        } else if (type === 'youtube') {
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
        } else if (type === 'album') {
            const decodedId = decodeURIComponent(id);
            const [artist, albumName] = decodedId.split('|||');
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${lastfmKey}&format=json`).then(r => r.json());
            return {
                title: res.album?.name || albumName,
                poster: res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`
            };
        } else if (type === 'person') {
            const res = await fetch(`https://api.themoviedb.org/3/person/${id}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());
            return {
                title: res.name,
                poster: res.profile_path ? `https://image.tmdb.org/t/p/w500${res.profile_path}` : 'https://placehold.co/500x750/1b2228/9ab?text=No+Photo'
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

function setupCustomCardModal() {
    const openBtn = document.getElementById('open-custom-card-modal');
    const modal = document.getElementById('custom-card-modal');
    const closeBtn = document.getElementById('close-custom-card-modal');
    const submitBtn = document.getElementById('submit-custom-card');

    openBtn.onclick = () => modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    submitBtn.onclick = async () => {
        const name = document.getElementById('custom-card-name').value.trim();
        const img = document.getElementById('custom-card-img').value.trim() || null;
        const type = document.getElementById('custom-card-type').value;

        if (!name) return alert("Name is required for custom cards.");

        submitBtn.disabled = true;
        submitBtn.textContent = "Adding...";

        const newRank = isRanked || isTiered ? currentItems.length + 1 : null;
        const newTierRank = isTiered ? 'NS' : 'NS';

        const { error } = await supabaseClient
            .from('list_items')
            .insert({ 
                list_id: listId, 
                media_id: 'custom_' + Date.now(), 
                media_type: type,
                media_title: name,
                rank: newRank,
                tier_rank: newTierRank,
                is_custom: true,
                custom_name: name,
                custom_image_url: img
            });

        if (error) alert("Error adding custom card: " + error.message);
        else {
            document.getElementById('custom-card-name').value = '';
            document.getElementById('custom-card-img').value = '';
            modal.style.display = 'none';
            fetchListItems();
        }
        
        submitBtn.disabled = false;
        submitBtn.textContent = "Add Card";
    };
}

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

    openBtn.onclick = () => { modal.style.display = 'flex'; refreshCollabList(); };
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