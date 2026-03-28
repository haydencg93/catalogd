let supabaseClient = null;
let allUserLogs = [];
let isOwner = false;
let profileUserId = null;

async function initProfile() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();

        // 1. Initialize Supabase
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });

        // 2. Identify User
        const params = new URLSearchParams(window.location.search);
        const urlUserId = params.get('id');
        const { data: { session } } = await supabaseClient.auth.getSession();
        const loggedInUserId = session?.user?.id;

        profileUserId = urlUserId || loggedInUserId;
        isOwner = (profileUserId === loggedInUserId);

        if (!profileUserId) {
            window.location.href = 'index.html';
            return;
        }

        // 3. Fetch Profile Data
        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', profileUserId)
            .single();

        // --- DEBUG SECTION: COPY THIS ---
        console.log("1. Targeting User ID:", profileUserId);
        console.log("2. Am I the owner?", isOwner);
        if (profileError) console.error("3. Supabase Error:", profileError);
        if (profile) {
            console.log("4. Full Profile Object:", profile);
            console.log("5. Avatar URL found:", profile.avatar_url);
            console.log("6. Banner URL found:", profile.banner_url);
        } else {
            console.warn("4. No profile found in database for this ID.");
        }
        // --------------------------------

        if (profileError) throw profileError;

        if (profile) {
            // --- FIX: CONSOLIDATED RENDERING ---
            const avatarContainer = document.getElementById('user-avatar');
            const bannerContainer = document.getElementById('profile-banner');

            // Render Banner
            if (profile.banner_url && profile.banner_url.trim() !== "") {
                bannerContainer.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url('${profile.banner_url}')`;
            } else {
                bannerContainer.style.background = "#2c3440";
            }

            // Render Avatar
            if (profile.avatar_url && profile.avatar_url.trim() !== "") {
                avatarContainer.innerHTML = `<img src="${profile.avatar_url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
                avatarContainer.style.background = "transparent";
            } else {
                const name = profile.display_name || profile.username || "U";
                avatarContainer.textContent = name[0].toUpperCase();
                avatarContainer.style.background = "var(--accent)";
            }

            // Text Info
            document.getElementById('user-display-name').textContent = profile.display_name || "User";
            document.getElementById('user-username').textContent = `@${(profile.username || 'user').toLowerCase()}`;
            document.getElementById('member-since').textContent = new Date(profile.created_at).toLocaleDateString();
            document.getElementById('display-bio').textContent = profile.bio || "No bio yet.";
            
            // Website
            const webElement = document.getElementById('display-website');
            if (profile.website_url) {
                webElement.href = profile.website_url;
                try {
                    webElement.textContent = new URL(profile.website_url).hostname;
                } catch {
                    webElement.textContent = "Website";
                }
                webElement.style.display = 'inline-block';
            } else {
                webElement.style.display = 'none';
            }

            // Favorites
            window.userFavorites = profile.favorites || { movie: [], tv: [], book: [], all: [] }; 
            filterFavs('all');
        }

        // 4. UI Setup
        setupSocialUI(loggedInUserId, profileUserId);

        // 5. Fetch Activity & Stats
        const { data: logs } = await supabaseClient.from('media_logs').select('*').eq('user_id', profileUserId);
        if (logs) {
            allUserLogs = logs; 
            document.getElementById('stat-count').textContent = logs.length;
            filterRecent('all'); 
        }

        // 6. Active Tracking
        const { data: activeStatuses } = await supabaseClient.from('media_status').select('*').eq('user_id', profileUserId).eq('status', 'active');
        if (activeStatuses?.length > 0) {
            document.getElementById('active-tracking-section').style.display = 'block';
            renderActiveItems(activeStatuses);
        }

        // 7. Watchlist/Follower Counts
        const { count: watchlistCount } = await supabaseClient.from('user_watchlist').select('*', { count: 'exact', head: true }).eq('user_id', profileUserId);
        const { count: followingCount } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profileUserId);
        const { count: followersCount } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profileUserId);

        document.getElementById('following-count').textContent = followingCount || 0;
        document.getElementById('followers-count').textContent = followersCount || 0;
        document.getElementById('watchlist-count').textContent = watchlistCount || 0;
        
        setupSocialModalListeners();

    } catch (err) {
        console.error("Critical Profile Init Error:", err);
    }
}

async function setupSocialUI(currentUserId, targetUserId) {
    const settingsBtnContainer = document.querySelector('.settings-section');
    
    // Remove any existing follow button to prevent duplicates on re-init
    const existingFollow = document.getElementById('follow-toggle-btn');
    if (existingFollow) existingFollow.remove();

    if (isOwner) {
        // Show settings if viewing own profile
        if (settingsBtnContainer) settingsBtnContainer.style.display = 'block';
    } else {
        // Hide settings and show Follow button if viewing another user
        if (settingsBtnContainer) settingsBtnContainer.style.display = 'none';

        const profileHeader = document.querySelector('.profile-header');
        const followBtn = document.createElement('button');
        followBtn.id = 'follow-toggle-btn';
        followBtn.className = 'primary-btn';
        followBtn.style.marginTop = '15px';
        profileHeader.appendChild(followBtn);

        if (!currentUserId) {
            followBtn.textContent = 'Sign in to Follow';
            followBtn.onclick = () => window.location.href = 'index.html';
            return;
        }

        // Check follow status
        const { data: isFollowing } = await supabaseClient
            .from('follows')
            .select('id')
            .eq('follower_id', currentUserId)
            .eq('following_id', targetUserId)
            .maybeSingle();

        followBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
        followBtn.classList.toggle('secondary-btn', !!isFollowing);

        followBtn.onclick = async () => {
            if (followBtn.textContent === 'Follow') {
                const { error } = await supabaseClient
                    .from('follows')
                    .insert({ follower_id: currentUserId, following_id: targetUserId });
                
                if (!error) {
                    followBtn.textContent = 'Unfollow';
                    followBtn.classList.add('secondary-btn');
                }
            } else {
                const { error } = await supabaseClient
                    .from('follows')
                    .delete()
                    .eq('follower_id', currentUserId)
                    .eq('following_id', targetUserId);
                
                if (!error) {
                    followBtn.textContent = 'Follow';
                    followBtn.classList.remove('secondary-btn');
                }
            }
        };
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
                <div class="poster-wrapper">
                    ${log.notes ? `<div class="review-badge">📝</div>` : ''}
                    <img src="${log.image || 'placeholder.png'}" alt="${log.title}">
                </div>
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

// Add these to your event listener setup or initProfile
function setupSocialModalListeners() {
    const modal = document.getElementById('social-modal');
    const closeBtn = document.getElementById('close-social-modal');

    document.getElementById('followers-stat-btn').onclick = () => openSocialModal('followers');
    document.getElementById('following-stat-btn').onclick = () => openSocialModal('following');

    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target == modal) modal.style.display = 'none';
    };
}

async function openSocialModal(type) {
    const modal = document.getElementById('social-modal');
    const body = document.getElementById('social-modal-body');
    const title = document.getElementById('social-modal-title');
    
    title.textContent = type === 'followers' ? 'Followers' : 'Following';
    body.innerHTML = '<p class="meta">Loading users...</p>';
    modal.style.display = 'block';

    try {
        let query;
        if (type === 'followers') {
            // "profiles:follower_id" tells Supabase to join profiles on the follower_id column
            query = supabaseClient
                .from('follows')
                .select('profiles:follower_id(id, username, display_name, avatar_url)')
                .eq('following_id', profileUserId);
        } else {
            query = supabaseClient
                .from('follows')
                .select('profiles:following_id(id, username, display_name, avatar_url)')
                .eq('follower_id', profileUserId);
        }

        const { data, error } = await query;
        if (error) throw error;

        body.innerHTML = '';
        if (!data || data.length === 0) {
            body.innerHTML = `<p class="meta">No ${type} yet.</p>`;
            return;
        }

        data.forEach(entry => {
            const u = entry.profiles;
            if (!u) return;
            const avatar = u.avatar_url || `https://ui-avatars.com/api/?name=${u.username}&background=1b2228&color=9ab`;
            
            const row = document.createElement('div');
            row.className = 'social-user-row';
            row.onclick = () => window.location.href = `profile.html?id=${u.id}`;
            row.innerHTML = `
                <img src="${avatar}" class="social-avatar">
                <div class="social-info">
                    <span class="social-name">${u.display_name || u.username}</span>
                    <span class="social-username">@${u.username}</span>
                </div>`;
            body.appendChild(row);
        });
    } catch (err) {
        body.innerHTML = `<p class="meta" style="color:red;">Error: ${err.message}</p>`;
    }
}

initProfile();