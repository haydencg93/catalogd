let supabaseClient = null;
let allUserLogs = []; // Global variable to hold all logs for filtering

async function initProfile() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    // Extract metadata from the user object
    const meta = user.user_metadata || {};
    const displayName = meta.display_name || user.email.split('@')[0];
    const username = meta.username || 'user';

    // Update the UI
    document.getElementById('user-display-name').textContent = displayName;
    document.getElementById('user-username').textContent = `@${username.toLowerCase()}`;
    document.getElementById('user-avatar').textContent = displayName[0].toUpperCase();
    document.getElementById('member-since').textContent = new Date(user.created_at).toLocaleDateString();

    // Fetch User Stats from media_logs
    const { data: logs } = await supabaseClient
        .from('media_logs')
        .select('*')
        .eq('user_id', user.id);

    if (logs) {
        allUserLogs = logs; 
        document.getElementById('stat-count').textContent = logs.length; // Keep total logs
        
        // Ensure it defaults to 'all' on every load
        filterRecent('all'); 
    }

    const { count: watchlistCount } = await supabaseClient
        .from('user_watchlist')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

    document.getElementById('watchlist-count').textContent = watchlistCount || 0;

    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const closeSettings = document.getElementById('close-settings');
    const finalDeleteBtn = document.getElementById('final-delete-btn');
    const deletePasswordInput = document.getElementById('delete-confirm-password');

    // This function handles the button clicks
    function setupSettingsUI() {
        if (!openSettingsBtn) return; // Safety check

        openSettingsBtn.onclick = () => {
            settingsModal.style.display = 'flex';
        };

        closeSettings.onclick = () => {
            settingsModal.style.display = 'none';
            deletePasswordInput.value = ''; // Clear password on close
        };

        // Close modal if clicking outside the card
        window.onclick = (event) => {
            if (event.target == settingsModal) {
                settingsModal.style.display = 'none';
            }
        };
    }

    // Make sure to call this inside your initProfile() after the user is verified
    setupSettingsUI();
}

function calculateStats(logs) {
    document.getElementById('stat-count').textContent = logs.length;
}

window.filterRecent = (type) => {
    // 1. Update button UI
    const buttons = document.querySelectorAll('.filter-nav .filter-btn');
    
    buttons.forEach(btn => {
        // Remove active from everyone first
        btn.classList.remove('active');
        
        // Check if the button's text (lowercase) matches the type clicked
        // e.g., if type is 'movie', match button with text 'Movies'
        const btnText = btn.textContent.toLowerCase();
        
        if (type === 'all' && btnText === 'all') {
            btn.classList.add('active');
        } else if (type === 'movie' && btnText === 'movies') {
            btn.classList.add('active');
        } else if (type === 'tv' && btnText === 'tv') {
            btn.classList.add('active');
        } else if (type === 'book' && btnText === 'books') {
            btn.classList.add('active');
        }
    });

    // 2. Filter the global logs array
    const filtered = type === 'all' 
        ? allUserLogs 
        : allUserLogs.filter(l => l.media_type === type);
    
    renderRecent(filtered);
};

// Just a simple list for now, you could fetch posters from TMDB later if you want it fancy
async function renderRecent(logs) {
    const grid = document.getElementById('recent-grid');
    grid.innerHTML = '<p class="meta">Loading activity...</p>';

    if (!logs || logs.length === 0) {
        grid.innerHTML = "<p class='meta'>No activity found.</p>";
        return;
    }

    // Sort by creation date and take the top 10
    const sortedLogs = logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    
    const config = await fetch('config.json').then(r => r.json());

    try {
        // 1. Create the array of promises
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
                console.error("Row fetch error", innerError);
                return { ...log, title: "Unknown", image: "" };
            }
        });

        // 2. CRITICAL FIX: Wait for all promises to resolve into actual data
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
        console.error("Error rendering activity:", err);
        grid.innerHTML = "<p class='meta'>Error loading activity.</p>";
    }
}

initProfile();