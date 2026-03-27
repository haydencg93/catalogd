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

    fetchUserLists(listOwnerId);
}

async function fetchUserLists(userId) {
    const container = document.getElementById('lists-container');
    
    // Fetch lists AND the 3 most recent items for each list
    const { data: lists, error } = await supabaseClient
        .from('media_lists')
        .select(`
            *, 
            list_items(media_id, media_type, added_at)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) return console.error(error);

    if (lists.length === 0) {
        container.innerHTML = "<p class='meta'>You haven't created any lists yet.</p>";
        return;
    }

    container.innerHTML = '';

    for (const list of lists) {
        // Sort items by date and take the top 3
        const firstItems = list.list_items
            .sort((a, b) => new Date(a.added_at) - new Date(b.added_at))
            .slice(0, 3);

        const listCard = document.createElement('div');
        listCard.className = 'list-card';
        listCard.onclick = () => window.location.href = `listDetails.html?id=${list.id}`;

        // Create a container for the mini-posters
        let postersHtml = '<div class="list-poster-preview">';
        
        // Fetch poster URLs for the preview
        const config = await fetch('config.json').then(r => r.json());
        
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
            } catch (e) { console.error("Preview error", e); }
            
            postersHtml += `<img src="${posterUrl}" class="preview-poster">`;
        }
        
        postersHtml += '</div>';

        listCard.innerHTML = `
            ${postersHtml}
            <div class="list-card-content">
                <h3 style="margin:10px 0 5px 0;">${list.name}</h3>
                <p class="meta" style="margin:0;">${list.list_items.length} items</p>
            </div>
        `;
        container.appendChild(listCard);
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