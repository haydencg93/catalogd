let supabaseClient = null;
let allUserLogs = [];

async function initProfile() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();

        // 1. Initialize with strict persistence settings
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });

        // 2. IMPORTANT: Wait for Supabase to recover the session from storage
        // Without this, the next line often returns null even if you are logged in
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

        if (sessionError || !session) {
            console.warn("No session found, redirecting...");
            window.location.href = 'index.html';
            return;
        }

        const user = session.user;

        // 4. Fetch Profile Data (Bio, Website, Favorites)
        // We do this separately because these are in your custom 'public.profiles' table
        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('bio, website_url, favorites')
            .eq('id', user.id)
            .single();

        if (profileError) {
            console.warn("Profile table fetch error (check if SQL was run):", profileError);
        }

        // 5. Render Profile Metadata (Bio & Website)
        if (profile) {
            document.getElementById('display-bio').textContent = profile.bio || "No bio yet.";
            
            const webElement = document.getElementById('display-website');
            if (profile.website_url) {
                webElement.href = profile.website_url;
                try {
                    // Try to show just the domain name (e.g., letterboxd.com)
                    webElement.textContent = new URL(profile.website_url).hostname;
                } catch (e) {
                    webElement.textContent = "Website";
                }
            } else {
                webElement.style.display = 'none';
            }

            // Store favorites globally for the filter buttons
            window.userFavorites = profile.favorites || { movie: [], tv: [], book: [], all: [] }; 
            filterFavs('all'); // Initial render of favorites
        }

        // 6. Render User Identity (Avatar, Banner, Names)
        const meta = user.user_metadata || {};
        
        // Use Profile table as primary source, then Metadata, then Email
        const displayName = profile?.display_name || meta.display_name || user.email.split('@')[0];
        const username = profile?.username || meta.username || 'user';
        const avatarUrl = profile?.avatar_url || meta.avatar_url;
        const bannerUrl = profile?.banner_url || meta.banner_url;
        
        // Update Text Elements
        document.getElementById('user-display-name').textContent = displayName;
        document.getElementById('user-username').textContent = `@${username.toLowerCase()}`;
        document.getElementById('member-since').textContent = new Date(user.created_at).toLocaleDateString();

        // Handle Banner with proper fallback
        const bannerContainer = document.getElementById('profile-banner');
        if (bannerUrl && bannerUrl.trim() !== "") {
            bannerContainer.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('${bannerUrl}')`;
        } else {
            bannerContainer.style.background = "#1b2228"; // Default dark gray
        }

        // Handle Avatar with proper fallback
        const avatarContainer = document.getElementById('user-avatar');
        if (avatarUrl && avatarUrl.trim() !== "") {
            avatarContainer.innerHTML = `<img src="${avatarUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
            avatarContainer.style.background = "transparent";
        } else {
            avatarContainer.innerHTML = ''; // Clear "?" placeholder
            avatarContainer.textContent = displayName[0].toUpperCase();
            avatarContainer.style.background = "var(--accent)";
        }

        // 7. Fetch Activity Stats & Logs
        const { data: logs } = await supabaseClient
            .from('media_logs')
            .select('*')
            .eq('user_id', user.id);

        if (logs) {
            allUserLogs = logs; 
            document.getElementById('stat-count').textContent = logs.length;
            filterRecent('all'); 
        }

        const { data: activeStatuses } = await supabaseClient
            .from('media_status')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'active');

        if (activeStatuses && activeStatuses.length > 0) {
            document.getElementById('active-tracking-section').style.display = 'block';
            renderActiveItems(activeStatuses);
        }

        // Fetch Watchlist Count
        const { count: watchlistCount } = await supabaseClient
            .from('user_watchlist')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        document.getElementById('watchlist-count').textContent = watchlistCount || 0;

    } catch (err) {
        console.error("Critical Profile Init Error:", err);
    }
}

function setupSettingsUI() {
    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const closeSettings = document.getElementById('close-settings');

    if (!openSettingsBtn || !settingsModal) return; 

    openSettingsBtn.onclick = () => {
        settingsModal.style.display = 'flex';
    };

    closeSettings.onclick = () => {
        settingsModal.style.display = 'none';
    };

    window.onclick = (event) => {
        if (event.target == settingsModal) {
            settingsModal.style.display = 'none';
        }
    };
}

async function renderActiveItems(items) {
    const grid = document.getElementById('active-grid');
    const config = await fetch('config.json').then(r => r.json());
    
    const displayPromises = items.map(async (item) => {
        let title, image, progressText = "";
        if (item.media_type === 'book') {
            const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json());
            title = res.title;
            image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'placeholder.png';
            if(item.current_page) progressText = `Pg ${item.current_page}`;
        } else {
            const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}`, {
                headers: { Authorization: `Bearer ${config.tmdb_token}` } 
            }).then(r => r.json());
            title = res.title || res.name;
            image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : 'placeholder.png';
        }
        return { ...item, title, image, progressText };
    });

    const fullItems = await Promise.all(displayPromises);
    grid.innerHTML = fullItems.map(item => `
        <div class="media-card" onclick="window.location.href='details.html?id=${item.media_id}&type=${item.media_type}'">
            <div class="poster-wrapper">
                <img src="${item.image}" alt="${item.title}">
                <div class="active-badge">ACTIVE</div>
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                <div class="meta">
                    <span class="badge badge-${item.media_type}">${item.media_type}</span>
                    <span style="color: var(--accent);">${item.progressText}</span>
                </div>
            </div>
        </div>
    `).join('');
}

window.filterRecent = (type) => {
    const buttons = document.querySelectorAll('.filter-nav .filter-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        
        if (type === 'all' && btnText === 'all') btn.classList.add('active');
        else if (type === 'movie' && btnText === 'movies') btn.classList.add('active');
        else if (type === 'tv' && btnText === 'tv') btn.classList.add('active');
        else if (type === 'book' && btnText === 'books') btn.classList.add('active');
    });

    const filtered = type === 'all' 
        ? allUserLogs 
        : allUserLogs.filter(l => l.media_type === type);
    
    renderRecent(filtered);
};

async function renderRecent(logs) {
    const grid = document.getElementById('recent-grid');
    grid.innerHTML = '<p class="meta">Loading activity...</p>';

    if (!logs || logs.length === 0) {
        grid.innerHTML = "<p class='meta'>No activity found.</p>";
        return;
    }

    const sortedLogs = logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    const config = await fetch('config.json').then(r => r.json());

    try {
        const mediaPromises = sortedLogs.map(async (log) => {
            let title, image;
            try {
                if (log.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${log.media_id}.json`).then(r => r.json());
                    title = res.title;
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                } else {
                    const res = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}`, {
                        headers: { Authorization: `Bearer ${config.tmdb_token}` } 
                    }).then(r => r.json());
                    title = res.title || res.name;
                    image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : '';
                }
                return { ...log, title, image };
            } catch (innerError) {
                return { ...log, title: "Unknown", image: "" };
            }
        });

        const fullLogs = await Promise.all(mediaPromises);
        grid.innerHTML = ''; 

        fullLogs.forEach(log => {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.onclick = () => window.location.href = `details.html?id=${log.media_id}&type=${log.media_type}`;

            const stars = '★'.repeat(log.rating || 0);
            const reviewBadge = log.notes ? `<div class="review-badge">📝</div>` : '';

            card.innerHTML = `
                ${reviewBadge}
                <img src="${log.image || 'placeholder.png'}" alt="${log.title}">
                <div class="media-info">
                    <div class="title" style="font-weight:bold; margin-bottom:5px;">${log.title}</div>
                    <div class="meta">
                        <span class="badge badge-${log.media_type}">${log.media_type}</span>
                        <span style="color: var(--accent); margin-left: 5px;">${stars}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (err) {
        grid.innerHTML = "<p class='meta'>Error loading activity.</p>";
    }
}

function updateTopAll() {
    // Take index [0] from each specific category
    const topMovie = currentFavs.movie[0];
    const topTv = currentFavs.tv[0];
    const topBook = currentFavs.book[0];
    
    // Replace the 'all' array with these three (if they exist)
    currentFavs.all = [topMovie, topTv, topBook].filter(Boolean);
}

window.filterFavs = (type) => {
    // 1. Update Button UI
    const favSection = document.getElementById('favorites-section');
    const buttons = favSection.querySelectorAll('.filter-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        if (type === 'all' && btnText === 'all') btn.classList.add('active');
        else if (type === 'movie' && btnText === 'movies') btn.classList.add('active');
        else if (type === 'tv' && btnText === 'tv') btn.classList.add('active');
        else if (type === 'book' && btnText === 'books') btn.classList.add('active');
    });

    // 2. Clear and Render Grid
    const grid = document.getElementById('favorites-grid');
    grid.innerHTML = '';
    const favorites = window.userFavorites || { movie: [], tv: [], book: [], all: [] };
    const list = favorites[type] || [];

    if (list.length === 0) {
        grid.innerHTML = `<p class="meta">No ${type} favorites added yet.</p>`;
        return;
    }

    list.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.onclick = () => window.location.href = `details.html?id=${item.id}&type=${item.type}`;
        
        card.innerHTML = `
            <div class="poster-wrapper">
                <img src="${item.image}" alt="${item.title}" onerror="this.src='https://via.placeholder.com/500x750?text=No+Image';">
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                <div class="meta">
                    <span class="badge badge-${item.type}">${item.type}</span>
                </div>
            </div>`;
        grid.appendChild(card);
    });
};

initProfile();