let supabaseClient = null;
let listOwnerId = null;
let isViewerOwner = false;
let lastfmKey = null;
let tmdbToken = null; // Storing this globally so it doesn't fetch repeatedly
let customImgsMap = new Map();

async function initLists() {
    const response = await fetch('config.json');
    const config = await response.json();
    lastfmKey = config.lastfm_key;
    tmdbToken = config.tmdb_token;
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
        backToProfileBtn.removeAttribute('onclick'); 
        backToProfileBtn.onclick = () => {
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
        if (createSection) createSection.style.display = 'none';
        
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('display_name')
            .eq('id', listOwnerId)
            .single();
        
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

    const { data: customImgs } = await supabaseClient
        .from('custom_imgs')
        .select('*')
        .eq('user_id', listOwnerId);
        
    if (customImgs) {
        customImgs.forEach(img => {
            customImgsMap.set(`${img.media_type}_${img.media_id}`, img);
        });
    }

    fetchUserLists(listOwnerId, currentUserId);
    setupHeader();
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

async function fetchUserLists(userId, currentUserId) {
    const container = document.getElementById('lists-container');
    
    try {
        const { data: ownedLists, error: ownedError } = await supabaseClient
            .from('media_lists')
            .select('*, list_items(media_id, media_type, added_at)')
            .eq('user_id', userId);

        const { data: collabRecords, error: collabError } = await supabaseClient
            .from('list_collaborators')
            .select('list_id, media_lists(*, list_items(media_id, media_type, added_at))')
            .eq('user_id', userId);

        if (ownedError || collabError) throw (ownedError || collabError);

        // FIX: Protected against null crashes
        const collaborativeLists = (collabRecords || []).map(record => record.media_lists).filter(Boolean);
        const allListsMap = new Map();

        [...(ownedLists || []), ...collaborativeLists].forEach(list => {
            allListsMap.set(list.id, list);
        });

        const finalLists = Array.from(allListsMap.values()).sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        );

        if (finalLists.length === 0) {
            container.innerHTML = "<p class='meta'>No lists found.</p>";
            return;
        }

        container.innerHTML = '';

        for (const list of finalLists) {
            const isShared = list.user_id !== userId;
            const firstItems = (list.list_items || [])
                .sort((a, b) => new Date(a.added_at) - new Date(b.added_at))
                .slice(0, 3);

            const listCard = document.createElement('div');
            listCard.className = 'list-card';
            listCard.onclick = () => window.location.href = `listDetails.html?id=${list.id}&context=${userId}`;

            let postersHtml = '<div class="list-poster-preview">';
            for (const item of firstItems) {
                let posterUrl = 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
                try {
                    if (item.media_type === 'book') {
                        const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json());
                        if (res.covers) posterUrl = `https://covers.openlibrary.org/b/id/${res.covers[0]}-S.jpg`;
                    } else if (item.media_type === 'youtube') {
                        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${item.media_id}`).then(r => r.json());
                        if (res.thumbnail_url) posterUrl = res.thumbnail_url;
                    } else if (item.media_type === 'album') {
                        const decodedId = decodeURIComponent(item.media_id);
                        const [artist, albumName] = decodedId.split('|||');
                        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${lastfmKey}&format=json`).then(r => r.json());
                        if (res.album?.image?.[3]['#text']) posterUrl = res.album.image[3]['#text'];
                    } else {
                        const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}`, {
                            headers: { Authorization: `Bearer ${tmdbToken}` }
                        }).then(r => r.json());
                        if (res.poster_path) posterUrl = `https://image.tmdb.org/t/p/w185${res.poster_path}`;
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

            listCard.innerHTML = `
                ${postersHtml}
                <div class="list-card-content">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:10px 0 5px 0;">${list.name}</h3>
                        <div style="display:flex; gap:5px;">${privateBadge}${sharedBadge}</div>
                    </div>
                    <p class="meta" style="margin:0;">${list.list_items?.length || 0} items</p>
                </div>
            `;
            container.appendChild(listCard);
        }
    } catch (err) {
        console.error("Critical Fetch Error:", err);
        container.innerHTML = "<p class='meta' style='color:red;'>Error loading lists. Permission denied.</p>";
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
        fetchUserLists(userId, userId); // Fixed missing parameter
    }
}

initLists();