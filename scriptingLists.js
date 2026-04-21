let supabaseClient = null;
let listOwnerId = null;
let isViewerOwner = false;

async function initLists() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('id');
    const { data: { session } } = await supabaseClient.auth.getSession();
    const currentUserId = session?.user?.id;

    // Determine who owns the lists we are looking at
    listOwnerId = urlId || currentUserId;
    isViewerOwner = (listOwnerId === currentUserId);

    if (!listOwnerId) {
        window.location.href = 'index.html';
        return;
    }

    // --- DYNAMIC BACK BUTTON LOGIC ---
    const backToProfileBtn = document.getElementById('back-to-profile-btn');
    if (backToProfileBtn) {
        backToProfileBtn.onclick = () => {
            // Redirect back to the profile of the person who owns these lists
            window.location.href = `profile.html?id=${listOwnerId}`;
        };
    }

    // UI Adjustments
    const createSection = document.querySelector('.create-list-section');
    const pageTitle = document.querySelector('h1');

    if (isViewerOwner) {
        pageTitle.textContent = "My Lists";
        if (createSection) createSection.style.display = 'block';
        document.getElementById('create-list-btn').onclick = () => createList(currentUserId);
    } else {
        // Viewing someone else's lists
        if (createSection) createSection.style.display = 'none';
        
        // Fetch the owner's name to make the title look better
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('display_name')
            .eq('id', listOwnerId)
            .single();
        
        pageTitle.textContent = profile ? `${profile.display_name}'s Lists` : "Lists";
    }

    fetchUserLists(listOwnerId, currentUserId);
}

async function fetchUserLists(userId, currentUserId) { // Added currentUserId param
    const container = document.getElementById('lists-container');
    
    try {
        const { data: ownedLists, error: ownedError } = await supabaseClient
            .from('media_lists')
            .select('*, list_items(media_id, media_type, added_at), list_collaborators(user_id)')
            .eq('user_id', userId);

        const { data: collabRecords, error: collabError } = await supabaseClient
            .from('list_collaborators')
            .select('list_id, media_lists(*, list_items(media_id, media_type, added_at))')
            .eq('user_id', userId);

        if (ownedError || collabError) throw (ownedError || collabError);

        const collaborativeLists = collabRecords.map(record => record.media_lists).filter(Boolean);
        
        const allListsMap = new Map();
        [...ownedLists, ...collaborativeLists].forEach(list => {
            // FIX for Bug 2 & 3:
            if (!isViewerOwner) {
                // If viewing someone else's profile, show only public lists.
                // Note: If you are a collaborator on their private list, 
                // it will show up here because you are "userId" (the listOwnerId).
                if (!list.is_public) return; 
            }
            allListsMap.set(list.id, list);
        });

        const finalLists = Array.from(allListsMap.values()).sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        );

        console.log("Final Merged List Count:", finalLists.length);

        // 4. Render
        if (finalLists.length === 0) {
            container.innerHTML = "<p class='meta'>No lists found.</p>";
            return;
        }

        container.innerHTML = '';
        const config = await fetch('config.json').then(r => r.json());

        for (const list of finalLists) {
            const isShared = list.user_id !== userId;
            
            const firstItems = list.list_items
                .sort((a, b) => new Date(a.added_at) - new Date(b.added_at))
                .slice(0, 3);

            const listCard = document.createElement('div');
            listCard.className = 'list-card';
            listCard.onclick = () => window.location.href = `listDetails.html?id=${list.id}`;

            let postersHtml = '<div class="list-poster-preview">';
            for (const item of firstItems) {
                let posterUrl = 'placeholder.png';
                try {
                    if (item.media_type === 'book') {
                        const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json());
                        if (res.covers) posterUrl = `https://covers.openlibrary.org/b/id/${res.covers[0]}-S.jpg`;
                    } else {
                        const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}`, {
                            headers: { Authorization: `Bearer ${config.tmdb_token}` }
                        }).then(r => r.json());
                        if (res.poster_path) posterUrl = `https://image.tmdb.org/t/p/w185${res.poster_path}`;
                    }
                } catch (e) { console.warn("Poster fetch failed", e); }
                postersHtml += `<img src="${posterUrl}" class="preview-poster">`;
            }
            postersHtml += '</div>';

            const sharedBadge = isShared ? `<span class="collab-badge">Shared</span>` : '';

            listCard.innerHTML = `
                ${postersHtml}
                <div class="list-card-content">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:10px 0 5px 0;">${list.name}</h3>
                        ${sharedBadge}
                    </div>
                    <p class="meta" style="margin:0;">${list.list_items.length} items</p>
                </div>
            `;
            container.appendChild(listCard);
        }
        console.log("--- RENDER COMPLETE ---");

    } catch (err) {
        console.error("Critical Fetch Error:", err);
        container.innerHTML = "<p class='meta' style='color:red;'>Error loading lists. Check console for details.</p>";
    }
}

async function createList(userId) {
    const nameInput = document.getElementById('list-name-input');
    const name = nameInput.value.trim();

    if (!name) return alert("Please enter a list name.");

    const { error } = await supabaseClient
        .from('media_lists')
        .insert({ user_id: userId, name: name });

    if (error) {
        alert("Error creating list: " + error.message);
    } else {
        nameInput.value = '';
        fetchUserLists(userId);
    }
}

initLists();