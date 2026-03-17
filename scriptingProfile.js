let supabaseClient = null;
let allUserLogs = [];

async function initProfile() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    const meta = user.user_metadata || {};
    const displayName = meta.display_name || user.email.split('@')[0];
    const username = meta.username || 'user';
    
    // 1. Handle Banner
    const bannerContainer = document.getElementById('profile-banner');
    if (meta.banner_url && meta.banner_url.trim() !== "") {
        // We wrap the URL in the same linear-gradient used in the CSS
        bannerContainer.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('${meta.banner_url}')`;
    }

    // 2. Handle Avatar
    const avatarContainer = document.getElementById('user-avatar');
    if (meta.avatar_url) {
        avatarContainer.innerHTML = `<img src="${meta.avatar_url}" style="width:100%; height:100%; object-fit:cover;">`;
        avatarContainer.style.background = "transparent";
    } else {
        avatarContainer.textContent = displayName[0].toUpperCase();
    }

    // 3. Handle Text Info
    document.getElementById('user-display-name').textContent = displayName;
    document.getElementById('user-username').textContent = `@${username.toLowerCase()}`;
    document.getElementById('member-since').textContent = new Date(user.created_at).toLocaleDateString();

    // 4. Fetch Stats
    const { data: logs } = await supabaseClient.from('media_logs').select('*').eq('user_id', user.id);
    if (logs) {
        allUserLogs = logs; 
        document.getElementById('stat-count').textContent = logs.length;
        filterRecent('all'); 
    }

    const { count: watchlistCount } = await supabaseClient
        .from('user_watchlist')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

    document.getElementById('watchlist-count').textContent = watchlistCount || 0;
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

initProfile();