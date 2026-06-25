let supabaseClient = null;
let allUserLogs = [];
let allLibraryItems = [];
let currentLibraryPage = 1;
const LIBRARY_PAGE_SIZE = 50;
let currentLibraryFilter = 'all';
let isOwner = false;
let profileUserId = null;
let customImgsMap = new Map();

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

        // 2. Identify User from URL
        const params = new URLSearchParams(window.location.search);
        let urlUserId = params.get('userId') || params.get('id'); 
        const urlUsername = params.get('user'); 
        
        // 3. Fallback Lookup: If we don't have an ID, but we do have a username from a shared link
        if (!urlUserId && urlUsername) {
            const { data: userLookup, error: lookupError } = await supabaseClient
                .from('profiles')
                .select('id')
                .ilike('username', urlUsername) // Case-insensitive match
                .maybeSingle();

            if (userLookup) {
                urlUserId = userLookup.id; // Swap the username for the database ID
            } else {
                alert("User not found!");
                window.location.href = 'index.html';
                return;
            }
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        const loggedInUserId = session?.user?.id;

        profileUserId = urlUserId || loggedInUserId;
        isOwner = (profileUserId === loggedInUserId);

        if (!profileUserId) {
            window.location.href = 'index.html';
            return;
        }

        const { data: customImgs } = await supabaseClient
            .from('custom_imgs')
            .select('*')
            .eq('user_id', profileUserId);
            
        if (customImgs) {
            customImgs.forEach(img => {
                customImgsMap.set(`${img.media_type}_${img.media_id}`, img);
            });
        }

        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', profileUserId)
            .single();

        // Fetch all statuses for the user whose profile we are viewing
        // 1. Define the containers
        const activeSection = document.getElementById('active-tracking-section');
        const activeGrid = document.getElementById('active-grid');
        const holdGrid = document.getElementById('on-hold-grid');

        // 2. Clear initial states
        if (activeGrid) activeGrid.innerHTML = '';
        if (holdGrid) holdGrid.innerHTML = '';

        // 3. Privacy Checks
        const canViewActive = isOwner || (profile.show_active_status !== false);
        const canViewOnHold = isOwner || (profile.show_paused_dropped_status !== false);

        // 4. Fetch all statuses
        const { data: allStatuses, error: statusError } = await supabaseClient
            .from('media_status')
            .select('*')
            .eq('user_id', profileUserId);

        if (statusError) console.error("Status Fetch Error:", statusError);

        // 5. Render Active/Hold if allowed
        if (canViewActive || canViewOnHold) {
            if (allStatuses && allStatuses.length > 0) {
                const activeItems = allStatuses.filter(s => s.status === 'active');
                const pausedDroppedItems = allStatuses.filter(s => s.status === 'paused' || s.status === 'dropped');

                // Handle Active Items
                if (canViewActive) {
                    if (activeItems.length > 0) {
                        activeSection.style.display = 'block';
                        renderStatusItems(activeItems, 'active-grid'); 
                    } else {
                        activeSection.style.display = 'none';
                    }
                } else {
                    activeSection.style.display = 'none';
                }

                // Handle Paused/Dropped Items
                if (canViewOnHold) {
                    if (pausedDroppedItems.length > 0) {
                        renderStatusItems(pausedDroppedItems, 'on-hold-grid');
                    } else {
                        holdGrid.innerHTML = `<p class="meta">No paused or dropped items to show.</p>`;
                    }
                } else {
                    holdGrid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align: center;">This section is private.</p>`;
                }
            } else {
                // No statuses exist at all
                activeSection.style.display = 'none';
                if (canViewOnHold) holdGrid.innerHTML = `<p class="meta">No paused or dropped items to show.</p>`;
            }
        } else {
            // Completely private
            activeSection.style.display = 'none';
            holdGrid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align: center;">Status tracking is private.</p>`;
        }

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

        const diaryNavBtn = document.querySelector('button[onclick*="diary.html"]');
        const listsNavBtn = document.querySelector('button[onclick*="lists.html"]');

        if (diaryNavBtn) {
            diaryNavBtn.onclick = () => {
                // If we're looking at someone else, append their ID to the link
                const urlSuffix = isOwner ? '' : `?id=${profileUserId}`;
                window.location.href = `diary.html${urlSuffix}`;
            };
        }

        if (listsNavBtn) {
            listsNavBtn.onclick = () => {
                const urlSuffix = isOwner ? '' : `?id=${profileUserId}`;
                window.location.href = `lists.html${urlSuffix}`;
            };
        }

        if (profileError) throw profileError;

        if (profile) {
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
                avatarContainer.innerHTML = `<img src="${profile.avatar_url}" 
                    style="width:100%; height:100%; object-fit:cover; border-radius:50%;"
                    onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${profile.username}&background=1b2228&color=9ab';">`;
                avatarContainer.style.background = "transparent";
            } else {
                const name = profile.display_name || profile.username || "U";
                avatarContainer.textContent = name[0].toUpperCase();
                avatarContainer.style.background = "var(--accent)";
            }

            // Text Info
            document.getElementById('user-display-name').textContent = profile.display_name || "User";
            
            const usernameEl = document.getElementById('user-username');
            usernameEl.textContent = `@${(profile.username || 'user').toLowerCase()}`;
            
            // Set up flexbox so the icon sits perfectly inline with the username
            usernameEl.style.display = 'flex';
            usernameEl.style.alignItems = 'center';
            usernameEl.style.gap = '8px';

            document.getElementById('member-since').textContent = new Date(profile.created_at).toLocaleDateString();
            document.getElementById('display-bio').textContent = profile.bio || "No bio yet.";

            const shareBtn = document.createElement('button');
            shareBtn.innerHTML = '🔗';
            // Style it to look like a subtle inline icon
            shareBtn.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 1.1rem; padding: 0; margin: 0; opacity: 0.7; transition: opacity 0.2s, transform 0.2s;';
            shareBtn.title = 'Copy Custom Profile Link';
            
            shareBtn.onmouseover = () => shareBtn.style.opacity = '1';
            shareBtn.onmouseout = () => shareBtn.style.opacity = '0.7';

            shareBtn.onclick = async () => {
                const cleanUrl = `${window.location.origin}${window.location.pathname}?user=${profile.username}`;
                
                // Bulletproof copy mechanism
                try {
                    await navigator.clipboard.writeText(cleanUrl);
                    showSuccess();
                } catch (err) {
                    // Fallback for strict browsers
                    const tempInput = document.createElement('input');
                    tempInput.value = cleanUrl;
                    document.body.appendChild(tempInput);
                    tempInput.select();
                    document.execCommand('copy');
                    document.body.removeChild(tempInput);
                    showSuccess();
                }

                function showSuccess() {
                    shareBtn.innerHTML = '✅';
                    shareBtn.style.transform = 'scale(1.1)';
                    setTimeout(() => {
                        shareBtn.innerHTML = '🔗';
                        shareBtn.style.transform = 'scale(1)';
                    }, 2000);
                }
            };
            
            // Append the icon directly inside the username container
            usernameEl.appendChild(shareBtn);
            
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

            if (isOwner) {
                document.getElementById('tags-tab-btn').style.display = 'block';
                renderProfileTags();
            }
        }

        let libraryMap = new Map();
        let droppedKeys = new Set();

        // Pass 1: Process Statuses
        if (allStatuses) {
            allStatuses.forEach(s => {
                const key = `${s.media_type}_${s.media_id}`;
                if (s.status === 'dropped') {
                    droppedKeys.add(key); // Mark as dropped
                } else {
                    libraryMap.set(key, {
                        media_id: s.media_id,
                        media_type: s.media_type,
                        image_url: s.image_url,
                        first_added: s.created_at || s.updated_at
                    });
                }
            });
        }

        // Pass 2: Process Logs (Merge & Deduplicate)
        if (allUserLogs) {
            allUserLogs.forEach(l => {
                const key = `${l.media_type}_${l.media_id}`;
                // Determine the most relevant date for this log
                const logDate = new Date(l.watched_on || l.created_at);

                // Only add if it hasn't been dropped
                if (!droppedKeys.has(key)) {
                    if (libraryMap.has(key)) {
                        const existing = libraryMap.get(key);
                        
                        // Keep track of the earliest date added for sorting purposes
                        if (new Date(l.created_at) < new Date(existing.first_added)) {
                            existing.first_added = l.created_at;
                        }
                        
                        // Keep track of the LATEST rating and like status for the display
                        if (!existing.latest_log_date || logDate > existing.latest_log_date) {
                            existing.latest_log_date = logDate;
                            existing.rating = l.rating;
                            existing.is_liked = l.is_liked;
                        }

                        // Prioritize image_url from log if missing
                        if (!existing.image_url && l.image_url) existing.image_url = l.image_url;
                    } else {
                        // New item from logs
                        libraryMap.set(key, {
                            media_id: l.media_id,
                            media_type: l.media_type,
                            image_url: l.image_url,
                            first_added: l.created_at,
                            latest_log_date: logDate,
                            rating: l.rating,
                            is_liked: l.is_liked
                        });
                    }
                }
            });
        }

        // Sort descending (Newest first) by the earliest date they interacted with it
        allLibraryItems = Array.from(libraryMap.values()).sort((a, b) => new Date(b.first_added) - new Date(a.first_added));
        filterLibrary('all'); // Initial render

        // 7. Watchlist/Follower/Lists Counts
        const { count: watchlistCount } = await supabaseClient.from('user_watchlist').select('*', { count: 'exact', head: true }).eq('user_id', profileUserId);
        const { count: listsCount } = await supabaseClient.from('media_lists').select('*', { count: 'exact', head: true }).eq('user_id', profileUserId);
        const { count: followingCount } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profileUserId);
        const { count: followersCount } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profileUserId);

        document.getElementById('following-count').textContent = followingCount || 0;
        document.getElementById('followers-count').textContent = followersCount || 0;
        document.getElementById('watchlist-count').textContent = watchlistCount || 0;
        
        const listsCountEl = document.getElementById('lists-count');
        if (listsCountEl) listsCountEl.textContent = listsCount || 0;
        
        setupSocialModalListeners();
        setupHeader()
    } catch (err) {
        console.error("Critical Profile Init Error:", err);
    }
}

// --- HEADER & AUTH LOGIC ---
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
    // Merge with any existing modal logic
    const dropdown = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
    
    // Existing Settings Modal Logic
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && event.target == settingsModal) {
        settingsModal.style.display = 'none';
    }
    
    // Existing Tag Details Modal Logic
    const tagModal = document.getElementById('tag-details-modal');
    if (tagModal && event.target == tagModal) {
        tagModal.style.display = 'none';
    }
};

async function signOut() {
    await supabaseClient.auth.signOut();
    location.reload();
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
        profileHeader.after(followBtn);

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

async function renderStatusItems(items, gridId) {
    const grid = document.getElementById(gridId);
    const config = await fetch('config.json').then(r => r.json());
    
    const displayPromises = items.map(async (item) => {
        let title, image, progressText = "";
        try {
            // --- PROGRESS FETCHING LOGIC ---
            if (item.media_type === 'tv') {
                // TV progress is stored in 'episode_logs'
                const { data: tvLog } = await supabaseClient
                    .from('episode_logs')
                    .select('season_number, episode_number')
                    .eq('user_id', profileUserId)
                    .eq('series_id', String(item.media_id))
                    .order('season_number', { ascending: false })
                    .order('episode_number', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                
                if (tvLog) {
                    progressText = `S${tvLog.season_number} E${tvLog.episode_number}`;
                }
            } else if (item.media_type === 'book' || item.media_type === 'album') {
                // Books and Albums are stored in 'media_logs'
                const { data: mediaLog } = await supabaseClient
                    .from('media_logs')
                    .select('current_page, episode_number')
                    .eq('user_id', profileUserId)
                    .eq('media_id', item.media_id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (mediaLog) {
                    if (item.media_type === 'book' && mediaLog.current_page) {
                        progressText = `Pg ${mediaLog.current_page}`;
                    } else if (item.media_type === 'album' && mediaLog.episode_number) {
                        progressText = `Track ${mediaLog.episode_number}`;
                    }
                }
            }

            // --- MEDIA INFO FETCHING ---
            if (item.media_type === 'book') {
                const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json()).catch(() => ({}));
                title = res.title || 'Unknown Book';
                image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
            } else if (item.media_type === 'youtube') {
                const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${item.media_id}`).then(r => r.json());
                title = res.title || 'YouTube Video';
                image = res.thumbnail_url || '';
            } else if (item.media_type === 'album') {
                const decodedId = decodeURIComponent(item.media_id);
                const [artist, albumName] = decodedId.split('|||');
                title = albumName;
                try {
                    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
                    image = res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                } catch (e) {
                    image = `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`; 
                }
            } else {
                const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}?language=en-US`, {
                    headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
                }).then(r => r.json());
                if (res.success === false) throw new Error("TMDB returned an error JSON");
                title = res.title || res.name || 'Unknown Title';
                image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : '';
            }
        } catch (e) {
            title = "Unknown Item";
            image = item.image_url || ''; 
        }

        const customArt = customImgsMap.get(`${item.media_type}_${String(item.media_id)}`);
        if (customArt && customArt.custom_poster) {
            image = customArt.custom_poster;
        }
        
        return { ...item, title, image, progressText };
    });

    const fullItems = await Promise.all(displayPromises);
    
    grid.innerHTML = fullItems.map(item => {
        const statusLabel = item.status.toUpperCase();
        
        // STATUS COLOR MAPPING
        let badgeBg = 'rgba(0, 0, 0, 0.7)'; 
        let badgeText = '#ffffff';
        const s = (statusLabel || '').toLowerCase();
        
        if (s.includes('watching') || s.includes('reading') || s.includes('active')) {
            badgeText = '#00e054'; 
        } else if (s.includes('pause') || s.includes('hold')) {
            badgeText = '#facc15'; 
        } else if (s.includes('drop')) {
            badgeText = '#f87171'; 
        } else if (s.includes('complet')) {
            badgeText = 'var(--text-accent)'; 
        }

        return `
            <div class="media-card" data-type="${item.media_type}" onclick="window.location.href='details.html?id=${item.media_id}&type=${item.media_type}'">
                <div class="poster-wrapper">
                    <img src="${item.image || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image'}" 
                         alt="${item.title}"
                         onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
                    
                    <div class="active-badge" style="--badge-text: ${badgeText}; background: ${badgeBg}; color: ${badgeText};">
                        ${statusLabel}
                    </div>
                    
                    <span class="badge badge-${item.media_type}">${item.media_type}</span>
                </div>
                <div class="media-info">
                    <div class="title" style="font-weight: bold; margin-bottom: 5px;">${item.title}</div>
                    ${item.progressText ? `<div class="meta" style="font-size: 0.8rem; color: #9ab; margin-top: -2px;">${item.progressText}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

window.filterRecent = (type) => {
    const activitySection = document.getElementById('recent-grid').previousElementSibling;
    const buttons = activitySection.querySelectorAll('.filter-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        
        if (type === 'all' && btnText === 'all') btn.classList.add('active');
        else if (type === 'movie' && btnText === 'movies') btn.classList.add('active');
        else if (type === 'tv' && btnText === 'tv') btn.classList.add('active');
        else if (type === 'book' && btnText === 'books') btn.classList.add('active');
        else if (type === 'album' && btnText === 'music') btn.classList.add('active'); // Added
        else if (type === 'youtube' && btnText === 'youtube') btn.classList.add('active');
    });

    const filtered = type === 'all' ? allUserLogs : allUserLogs.filter(l => l.media_type === type);
    renderRecent(filtered);
};

function renderProfileTags() {
    const container = document.getElementById('tags-grid');
    
    if (!allUserLogs || allUserLogs.length === 0) {
        container.innerHTML = '<p class="meta">No tags found. Start logging to build your collection!</p>';
        return;
    }

    const tagCounts = {};
    
    allUserLogs.forEach(log => {
        if (log.tags && Array.isArray(log.tags)) {
            log.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });

    const uniqueTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);

    if (uniqueTags.length === 0) {
        container.innerHTML = '<p class="meta">No tags found. Start logging to build your collection!</p>';
        return;
    }

    container.innerHTML = uniqueTags.map(tag => `
        <div class="profile-tag-pill clickable" onclick="openTagDetails('${tag}')">
            <span class="tag-name">${tag}</span>
            <span class="tag-count">${tagCounts[tag]}</span>
        </div>
    `).join('');
}

window.openTagDetails = async (tag) => {
    const modal = document.getElementById('tag-details-modal');
    const body = document.getElementById('tag-details-modal-body');
    const title = document.getElementById('tag-details-modal-title');
    const closeBtn = document.getElementById('close-tag-modal');

    title.textContent = `Logs tagged with "${tag}"`;
    body.innerHTML = '<p class="meta">Loading logs...</p>';
    modal.style.display = 'flex';

    closeBtn.onclick = () => modal.style.display = 'none';
    
    modal.onclick = (event) => {
        if (event.target === modal) modal.style.display = 'none';
    };

    const getSafeDate = (log) => {
        let dateVal = log.watched_on || log.created_at;
        if (dateVal && dateVal.length === 10) {
            dateVal += "T12:00:00"; 
        }
        return new Date(dateVal);
    };

    const taggedLogs = allUserLogs.filter(log => log.tags && log.tags.includes(tag));
    const sortedLogs = taggedLogs.sort((a, b) => getSafeDate(b) - getSafeDate(a));

    const config = await fetch('config.json').then(r => r.json());

    try {
        const fullLogs = await Promise.all(sortedLogs.map(async (log) => {
            let title, image;
            try {
                if (log.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json()).catch(() => ({}));
                    title = res.title || 'Unknown Book';
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                } else if (log.media_type === 'youtube') {
                    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${log.media_id}`).then(r => r.json());
                    title = res.title || 'YouTube Video';
                    image = res.thumbnail_url || '';
                } else if (log.media_type === 'album') {
                    const decodedId = decodeURIComponent(log.media_id);
                    const [artist, albumName] = decodedId.split('|||');
                    title = albumName;
                    try {
                        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
                        image = res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    } catch (e) {
                        image = `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    }
                } else {
                    const res = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}?language=en-US`, {
                        headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
                    }).then(r => r.json());
                    if (res.success === false) throw new Error("TMDB returned an error JSON");
                    title = res.title || res.name || 'Unknown Title';
                    image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : '';
                }
                
                // --- OVERRIDE WITH CUSTOM POSTER ---
                const customArt = customImgsMap.get(`${log.media_type}_${log.media_id}`);
                if (customArt && customArt.custom_poster) {
                    image = customArt.custom_poster;
                }
                
                return { ...log, title, image };
            } catch (innerError) {
                return { ...log, title: "Unknown", image: "" };
            }
        }));

        body.innerHTML = '';
        fullLogs.forEach(log => {
            const stars = '★'.repeat(Math.floor(log.rating || 0)) + ((log.rating % 1 !== 0) ? '½' : '');
            
            const safeDate = getSafeDate(log);
            const dateStr = safeDate.toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            
            const reviewIcon = log.notes ? `<span title="Reviewed" style="margin-right:8px;">📝</span>` : '';
            const likeIcon = log.is_liked ? `<span title="Liked" style="color:#ff4d4d; margin-right:8px;">❤️</span>` : '';
            
            const row = document.createElement('div');
            row.className = 'tag-log-row';
            row.onclick = () => window.location.href = `details.html?id=${encodeURIComponent(log.media_id)}&type=${log.media_type}`;
            
            row.innerHTML = `
                <img src="${log.image || 'https://placehold.co/50x75/1b2228/9ab?text=No+Img'}" class="tag-log-poster" style="width: 45px; height: 68px; border-radius: 4px; object-fit: cover; flex-shrink: 0;">
                <div class="tag-log-info">
                    <div class="tag-log-title">${log.title}</div>
                    <div class="tag-log-meta">
                        <span class="text-glow" style="margin-right: 10px;">${stars}</span>
                        <span style="color: #9ab; margin-right: 10px;">${dateStr}</span>
                        ${likeIcon}
                        ${reviewIcon}
                    </div>
                    <div style="margin-top: 2px;">
                        <span class="badge badge-${log.media_type}" style="position: static; font-size: 0.65rem; padding: 2px 6px; display: inline-block;">${log.media_type}</span>
                    </div>
                </div>
            `;
            body.appendChild(row);
        });
    } catch (err) {
        body.innerHTML = `<p class="meta" style="color:red;">Error loading details.</p>`;
    }
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
                    const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json()).catch(() => ({}));
                    title = res.title || 'Unknown Book';
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                } else if (log.media_type === 'youtube') {
                    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${log.media_id}`).then(r => r.json());
                    title = res.title || 'YouTube Video';
                    image = res.thumbnail_url || '';
                } else if (log.media_type === 'album') {
                    const decodedId = decodeURIComponent(log.media_id);
                    const [artist, albumName] = decodedId.split('|||');
                    title = albumName;
                    try {
                        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
                        image = res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    } catch (e) {
                        image = `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    }
                } else {
                    const res = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}?language=en-US`, {
                        headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
                    }).then(r => r.json());
                    if (res.success === false) throw new Error("TMDB returned an error JSON");
                    title = res.title || res.name || 'Unknown Title';
                    image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : '';
                }
                
                // --- OVERRIDE WITH CUSTOM POSTER ---
                const customArt = customImgsMap.get(`${log.media_type}_${log.media_id}`);
                if (customArt && customArt.custom_poster) {
                    image = customArt.custom_poster;
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
            card.onclick = () => window.location.href = `details.html?id=${encodeURIComponent(log.media_id)}&type=${log.media_type}`;

            const stars = '★'.repeat(Math.floor(log.rating || 0)) + ((log.rating % 1 !== 0) ? '½' : '');
            let rewatchText = 'Rewatch';
            if (log.media_type === 'book') rewatchText = 'Reread';
            else if (log.media_type === 'album') rewatchText = 'Relisten';

            const reviewBadge = log.notes ? `<div class="card-icon-badge" title="Reviewed">📝</div>` : '';
            const likeBadge = log.is_liked ? `<div class="card-icon-badge icon-heart" title="Liked">❤️</div>` : '';
            const rewatchBadge = log.is_rewatch ? `<div class="card-icon-badge" title="${rewatchText}" style="font-size: 0.8rem;">🔁</div>` : '';

            card.innerHTML = `
                <div class="poster-wrapper">
                    <div class="badge-container">
                        ${likeBadge}
                        ${reviewBadge}
                        ${rewatchBadge}
                    </div>
                    <img src="${log.image || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image'}" 
                         alt="${log.title}"
                         onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
                    <span class="badge badge-${log.media_type}">${log.media_type}</span>
                </div>
                <div class="media-info">
                    <div class="title" style="font-weight:bold; margin-bottom:5px;">${log.title}</div>
                    <div class="meta">
                        <span class="text-glow" style="margin-left: 0;">${stars}</span>
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
    const topMovie = currentFavs.movie?.[0];
    const topTv = currentFavs.tv?.[0];
    const topBook = currentFavs.book?.[0];
    const topYoutube = currentFavs.youtube?.[0];
    currentFavs.all = [topMovie, topTv, topBook, topYoutube].filter(Boolean);
}

window.filterFavs = (type) => {
    const favSection = document.getElementById('favorites-section');
    const buttons = favSection.querySelectorAll('.filter-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        if (type === 'all' && btnText === 'all') btn.classList.add('active');
        else if (type === 'movie' && btnText === 'movies') btn.classList.add('active');
        else if (type === 'tv' && btnText === 'tv') btn.classList.add('active');
        else if (type === 'book' && btnText === 'books') btn.classList.add('active');
        else if (type === 'album' && btnText === 'music') btn.classList.add('active'); 
        else if (type === 'youtube' && btnText === 'youtube') btn.classList.add('active');
    });

    const grid = document.getElementById('favorites-grid');
    grid.innerHTML = '';
    
    const favorites = window.userFavorites || { movie: [], tv: [], book: [], youtube: [], album: [], all: [] };
    const list = favorites[type] || [];

    if (list.length === 0) {
        const displayType = type === 'album' ? 'music' : type;
        grid.innerHTML = `<p class="meta">No ${displayType} favorites added yet.</p>`;
        return;
    }

    list.forEach(item => {
        // --- OVERRIDE WITH CUSTOM POSTER ---
        let finalImage = item.image;
        const customArt = customImgsMap.get(`${item.type}_${item.id}`);
        if (customArt && customArt.custom_poster) {
            finalImage = customArt.custom_poster;
        }

        const card = document.createElement('div');
        card.className = 'media-card';
        card.onclick = () => window.location.href = `details.html?id=${encodeURIComponent(item.id)}&type=${item.type}`;
        
        card.innerHTML = `
            <div class="poster-wrapper">
                <img src="${finalImage}" 
                alt="${item.title}" 
                loading="lazy" 
                onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
                <span class="badge badge-${item.type}">${item.type}</span>
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
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
    modal.style.display = 'flex';

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

window.switchTab = (tabName) => {
    // Update Buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.toLowerCase().includes(tabName.replace('-', ' ')));
    });

    // Update Content Visibility
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');
};

window.filterLibrary = (type) => {
    currentLibraryFilter = type;
    currentLibraryPage = 1; // Reset to page 1 whenever a filter changes

    const librarySection = document.getElementById('tab-library');
    const buttons = librarySection.querySelectorAll('.filter-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        
        if (type === 'all' && btnText === 'all') btn.classList.add('active');
        else if (type === 'movie' && btnText === 'movies') btn.classList.add('active');
        else if (type === 'tv' && btnText === 'tv') btn.classList.add('active');
        else if (type === 'book' && btnText === 'books') btn.classList.add('active');
        else if (type === 'album' && btnText === 'music') btn.classList.add('active');
        else if (type === 'youtube' && btnText === 'youtube') btn.classList.add('active');
    });

    renderLibraryPage(); // Triggers the paginated render
};

async function renderLibrary(items) {
    const grid = document.getElementById('library-grid');
    grid.innerHTML = '<p class="meta">Loading library...</p>';

    if (!items || items.length === 0) {
        grid.innerHTML = "<p class='meta'>Library is empty.</p>";
        return;
    }

    const config = await fetch('config.json').then(r => r.json());

    try {
        const mediaPromises = items.map(async (item) => {
            let title, image;
            try {
                if (item.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json()).catch(() => ({}));
                    title = res.title || 'Unknown Book';
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                } else if (item.media_type === 'youtube') {
                    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${item.media_id}`).then(r => r.json());
                    title = res.title || 'YouTube Video';
                    image = res.thumbnail_url || '';
                } else if (item.media_type === 'album') {
                    const decodedId = decodeURIComponent(item.media_id);
                    const [artist, albumName] = decodedId.split('|||');
                    title = albumName;
                    
                    try {
                        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
                        image = res.album?.image?.[3]['#text'] || `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    } catch (e) {
                        image = `https://placehold.co/500x500/1b2228/eb3486?text=${encodeURIComponent(albumName)}`;
                    }
                } else {
                    const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}?language=en-US`, {
                        headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
                    }).then(r => r.json());
                    if (res.success === false) throw new Error("TMDB returned an error JSON");
                    title = res.title || res.name || 'Unknown Title';
                    image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : '';
                }
                
                // --- OVERRIDE WITH CUSTOM POSTER ---
                const customArt = customImgsMap.get(`${item.media_type}_${item.media_id}`);
                if (customArt && customArt.custom_poster) {
                    image = customArt.custom_poster;
                }
                
                return { ...item, title, image };
            } catch (innerError) {
                return { ...item, title: "Unknown", image: "" };
            }
        });

        const fullItems = await Promise.all(mediaPromises);
        grid.innerHTML = ''; 

        fullItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.onclick = () => window.location.href = `details.html?id=${encodeURIComponent(item.media_id)}&type=${item.media_type}`;

            let starsHtml = '';
            if (item.rating > 0) {
                const starString = '★'.repeat(Math.floor(item.rating)) + ((item.rating % 1 !== 0) ? '½' : '');
                starsHtml = `<span class="text-glow">${starString}</span>`;
            }
            
            const likeBadge = item.is_liked ? `<div class="card-icon-badge icon-heart">❤️</div>` : '';

            card.innerHTML = `
                <div class="poster-wrapper">
                    <div class="badge-container">
                        ${likeBadge}
                    </div>
                    <img src="${item.image || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image'}" 
                         alt="${item.title}"
                         onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
                    <span class="badge badge-${item.media_type}">${item.media_type}</span>
                </div>
                <div class="media-info">
                    <div class="title" style="font-weight:bold; margin-bottom:5px;">${item.title}</div>
                    <div class="meta">
                        ${starsHtml}
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (err) {
        grid.innerHTML = "<p class='meta'>Error loading library.</p>";
    }
}

window.changeLibraryPage = (direction) => {
    currentLibraryPage += direction;
    renderLibraryPage();
    // Smooth scroll back to the top of the library tab when changing pages
    document.getElementById('tab-library').scrollIntoView({ behavior: 'smooth' });
};

async function renderLibraryPage() {
    // 1. Filter the master list
    const filtered = currentLibraryFilter === 'all' 
        ? allLibraryItems 
        : allLibraryItems.filter(l => l.media_type === currentLibraryFilter);
        
    // 2. Calculate Pagination
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / LIBRARY_PAGE_SIZE) || 1;
    
    if (currentLibraryPage < 1) currentLibraryPage = 1;
    if (currentLibraryPage > totalPages) currentLibraryPage = totalPages;

    const startIndex = (currentLibraryPage - 1) * LIBRARY_PAGE_SIZE;
    const endIndex = startIndex + LIBRARY_PAGE_SIZE;
    
    // 3. Slice out just the 50 items we need for this page
    const itemsToRender = filtered.slice(startIndex, endIndex);

    // 4. Pass the small chunk to your existing render engine
    await renderLibrary(itemsToRender);

    // 5. Update the UI Pagination Buttons
    const paginationContainer = document.getElementById('library-pagination');
    if (!paginationContainer) return;

    if (totalItems > LIBRARY_PAGE_SIZE) {
        paginationContainer.innerHTML = `
            <button class="secondary-btn" onclick="changeLibraryPage(-1)" ${currentLibraryPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Previous</button>
            <span class="meta" style="margin: 0 15px; font-weight: bold;">Page ${currentLibraryPage} of ${totalPages}</span>
            <button class="secondary-btn" onclick="changeLibraryPage(1)" ${currentLibraryPage === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Next</button>
        `;
    } else {
        paginationContainer.innerHTML = ''; // Hide if 50 items or fewer
    }
}

initProfile();