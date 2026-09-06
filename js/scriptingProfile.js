import { loadConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';
import { normalizeOpenLibraryId } from './core/media.js';
import { socialLogoSvgs as exactSocialLogoSvgs } from './components/socialIcons.js';

let supabaseClient = null;

let allUserLogs = [];
let allLibraryItems = [];
let allTrackedPeople = [];
let currentLibraryPage = 1;
const LIBRARY_PAGE_SIZE = 50;
let currentLibraryFilter = 'all';
let isOwner = false;
let profileUserId = null;
let customImgsMap = new Map();
let revisitCandidates = { movie: [], tv: [], book: [], album: [] };
let allFandoms = [];
let isManagingPeople = false;
let isManagingFandoms = false;
let peopleSortableInstance = null;
let fandomsSortableInstance = null;
let currentPeopleCategory = 'character';
let currentFandomsCategory = 'movie';

function appendSocialLink(container, name, username, href) {
    if (!username) return;
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'social-icon-btn';
    link.title = name;
    link.setAttribute('aria-label', name);
    link.innerHTML = exactSocialLogoSvgs[name];
    const icon = link.querySelector('svg');
    if (icon) {
        icon.classList.add('social-icon-svg');
    }
    container.appendChild(link);
}

async function initProfile() {
    try {
        const config = await loadConfig();

        // 1. Initialize Supabase
        supabaseClient = await getSupabaseClient({
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
        await customElements.whenDefined('app-header');
        await document.querySelector('app-header').initializeAuth(supabaseClient);

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

        const profileListsBtn = document.getElementById('profile-lists-btn'); // Or whatever the element ID is in profile.html
        if (profileListsBtn) {
            if (!isOwner) {
                // Point directly to the target user's lists page
                profileListsBtn.href = `lists.html?id=${profileUserId}`;
            } else {
                // Point to your own lists page
                profileListsBtn.href = `lists.html`;
            }
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

        const charactersGrid = document.getElementById('characters-grid');
        const fandomsGrid = document.getElementById('fandoms-grid');
        
        // 1. Check Privacy Flags
        const canViewCharacters = isOwner || (profile.show_characters === true);
        const canViewFandoms = isOwner || (profile.show_fandoms === true);

        // 2. Load People
        const peopleGrid = document.getElementById('people-grid');
        const canViewPeople = isOwner || (profile.show_characters === true);

        // Show ranking instructions + reorder button if owner
        const rankInstructions = document.getElementById('people-rank-instructions');
        if (rankInstructions && isOwner) rankInstructions.style.display = 'block';
        const managePeopleBtn = document.getElementById('manage-people-order-btn');
        if (managePeopleBtn && isOwner) managePeopleBtn.style.display = 'inline-block';

        if (canViewPeople) {
            const { data: people, error: peopleError } = await supabaseClient
                .from('user_characters')
                .select('*')
                .eq('user_id', profileUserId)
                .order('rank', { ascending: true }) // NEW: Order by rank
                .order('created_at', { ascending: false });
                
            if (peopleError) console.error("People Fetch Error:", peopleError);

            if (people && people.length > 0) {
                allTrackedPeople = people;
                filterPeople('character'); // NEW: Default to character instead of all
            } else {
                if (peopleGrid) peopleGrid.innerHTML = `<p class="meta">No people tracked yet.</p>`;
            }
        } else {
            if (peopleGrid) peopleGrid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align: center;">People tracking is private.</p>`;
        }

        // 3. Load Fandoms
        const fandomsRankInstructions = document.getElementById('fandoms-rank-instructions');
        if (fandomsRankInstructions && isOwner) fandomsRankInstructions.style.display = 'block';
        const manageFandomsBtn = document.getElementById('manage-fandoms-order-btn');
        if (manageFandomsBtn && isOwner) manageFandomsBtn.style.display = 'inline-block';

        if (canViewFandoms) {
            const { data: fandoms, error: fandomsError } = await supabaseClient
                .from('user_fandoms')
                .select('*')
                .eq('user_id', profileUserId)
                .order('rank', { ascending: true })
                .order('created_at', { ascending: false });
                
            if (fandomsError) console.error("Fandoms Fetch Error:", fandomsError);

            if (fandoms && fandoms.length > 0) {
                allFandoms = fandoms;
                filterFandoms('collection');
            } else {
                if (fandomsGrid) fandomsGrid.innerHTML = `<p class="meta">No fandoms followed yet.</p>`;
            }
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

        // Setup Profile Stat Card Routing
        const urlSuffix = isOwner ? '' : `?id=${profileUserId}`;

        const diaryCard = document.getElementById('profile-diary-card');
        if (diaryCard) diaryCard.onclick = () => window.location.href = `diary.html${urlSuffix}`;

        const listsCard = document.getElementById('profile-lists-card');
        if (listsCard) listsCard.onclick = () => window.location.href = `lists.html${urlSuffix}`;

        const watchlistCard = document.getElementById('profile-watchlist-card');
        if (watchlistCard) watchlistCard.onclick = () => window.location.href = `watchlist.html${urlSuffix}`;

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
                    data-fallback="https://ui-avatars.com/api/?name=${encodeURIComponent(profile.username || '')}&background=1b2228&color=9ab">`;
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
            shareBtn.innerHTML = 'ðŸ”—';
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
                    shareBtn.innerHTML = 'âœ…';
                    shareBtn.style.transform = 'scale(1.1)';
                    setTimeout(() => {
                        shareBtn.innerHTML = 'ðŸ”—';
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

            const socialsContainer = document.getElementById('social-icons-container');
            socialsContainer.innerHTML = ''; // Clear it out
            const socials = profile.socials || {};
            appendSocialLink(socialsContainer, 'Instagram', socials.instagram, `https://instagram.com/${socials.instagram}`);
            appendSocialLink(socialsContainer, 'Snapchat', socials.snapchat, `https://snapchat.com/add/${socials.snapchat}`);
            appendSocialLink(socialsContainer, 'TikTok', socials.tiktok, `https://tiktok.com/@${socials.tiktok.replace('@', '')}`);
            appendSocialLink(socialsContainer, 'YouTube', socials.youtube, `https://youtube.com/${socials.youtube}`);
            appendSocialLink(socialsContainer, 'GitHub', socials.github, `https://github.com/${socials.github}`);

            appendSocialLink(socialsContainer, 'Reddit', socials.reddit, `https://reddit.com/user/${encodeURIComponent(socials.reddit)}`);
            appendSocialLink(socialsContainer, 'Goodreads', socials.goodreads, `https://goodreads.com/${encodeURIComponent(socials.goodreads)}`);
            appendSocialLink(socialsContainer, 'Facebook', socials.facebook, `https://facebook.com/${encodeURIComponent(socials.facebook)}`);
            appendSocialLink(socialsContainer, 'X', socials.x, `https://x.com/${encodeURIComponent(socials.x.replace('@', ''))}`);
            appendSocialLink(socialsContainer, 'Pinterest', socials.pinterest, `https://pinterest.com/${encodeURIComponent(socials.pinterest)}`);
            appendSocialLink(socialsContainer, 'Letterboxd', socials.letterboxd, `https://letterboxd.com/${encodeURIComponent(socials.letterboxd)}`);
            appendSocialLink(socialsContainer, 'Discord', socials.discord, `https://discord.com/users/${encodeURIComponent(socials.discord)}`);
            appendSocialLink(socialsContainer, 'Apple Music', socials.apple_music, `https://music.apple.com/profile/${encodeURIComponent(socials.apple_music)}`);
            appendSocialLink(socialsContainer, 'Spotify', socials.spotify, `https://open.spotify.com/user/${encodeURIComponent(socials.spotify)}`);
            if (socials.show_lastfm && socials.lastfm_username) {
                appendSocialLink(socialsContainer, 'Last.fm', socials.lastfm_username, `https://last.fm/user/${encodeURIComponent(socials.lastfm_username)}`);
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

            // Only calculate and show revisits if the logged-in user owns the profile
            if (isOwner) {
                calculateRevisits();

                document.getElementById('tags-tab-btn').style.display = 'block';
                renderProfileTags();
            } else {
                // Hide the Re-Watch section from other users
                const revisitSection = document.getElementById('revisit-section');
                if (revisitSection) {
                    revisitSection.style.display = 'none';
                }
            }

            const statsNavBtn = document.getElementById('stats-nav-btn');
            if (statsNavBtn) {
                if (isOwner) {
                    statsNavBtn.style.display = 'block';
                    statsNavBtn.onclick = () => {
                        window.location.href = 'stats.html';
                    };
                    
                    // This is the critical part that makes 4 buttons fit in one row
                    const statsBar = document.querySelector('.stats-bar');
                    if (statsBar) {
                        statsBar.style.gridTemplateColumns = 'repeat(4, 1fr)';
                    }
                } else {
                    statsNavBtn.style.display = 'none';
                }
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
                        media_title: s.media_title,
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
                        if (!existing.media_title && l.media_title) existing.media_title = l.media_title;
                    } else {
                        // New item from logs
                        libraryMap.set(key, {
                            media_id: l.media_id,
                            media_type: l.media_type,
                            media_title: l.media_title,
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

        const followingCountEl = document.getElementById('following-count');
        const followersCountEl = document.getElementById('followers-count');
        const watchlistCountEl = document.getElementById('watchlist-count');
        if (followingCountEl) followingCountEl.textContent = followingCount || 0;
        if (followersCountEl) followersCountEl.textContent = followersCount || 0;
        if (watchlistCountEl) watchlistCountEl.textContent = watchlistCount || 0;
        
        const listsCountEl = document.getElementById('lists-count');
        if (listsCountEl) listsCountEl.textContent = listsCount || 0;
        
        setupSocialModalListeners();
    } catch (err) {
        console.error("Critical Profile Init Error:", err);
    }
}

window.onclick = (event) => {    
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

function calculateRevisits() {
    const now = new Date();
    // Millisecond thresholds
    const thresholds = {
        movie: 365 * 24 * 60 * 60 * 1000,     // 1 Year
        tv: 365 * 24 * 60 * 60 * 1000,        // 1 Year
        book: 2 * 365 * 24 * 60 * 60 * 1000,  // 2 Years
        album: 180 * 24 * 60 * 60 * 1000      // 6 Months (1/2 Year)
    };

    const latestLogs = {};

    // 1. Deduplicate: Find the absolute latest watched_on date for each media
    allUserLogs.forEach(log => {
        const key = `${log.media_type}_${log.media_id}`;
        const logDate = new Date(log.watched_on || log.created_at);
        
        if (!latestLogs[key] || logDate > latestLogs[key].date) {
            latestLogs[key] = { ...log, date: logDate };
        }
    });

    // 2. Filter: Compare the latest date against thresholds AND check rating
    Object.values(latestLogs).forEach(log => {
        // Excludes YouTube and any unmapped types
        if (!thresholds[log.media_type]) return; 
        
        // Skip the item if it has no rating or the rating is less than 4
        if (!log.rating || log.rating < 4) return;

        const timeDiff = now - log.date;
        if (timeDiff > thresholds[log.media_type]) {
            revisitCandidates[log.media_type].push(log);
        }
    });

    // 3. Sort: Furthest away date to the nearest one (Ascending Order)
    ['movie', 'tv', 'book', 'album'].forEach(type => {
        revisitCandidates[type].sort((a, b) => a.date - b.date);
    });
    
    // Initial Render
    filterRevisit('movie'); 
}

window.filterRevisit = async (type) => {
    // 1. Update Header Text Based on Type
    const heading = document.getElementById('revisit-heading');
    let action = "Re-Watch";
    let verb = "Watched";
    if (type === 'book') { action = "Re-Read"; verb = "Read"; }
    if (type === 'album') { action = "Re-Listen to"; verb = "Listened to"; }
    heading.innerHTML = `Your Next<br><span style="color: var(--accent); font-size: 1.15rem;">${action}</span>`;

    // 2. Toggle Active Button Class
    const buttons = document.querySelectorAll('#revisit-section .filter-btn');
    buttons.forEach(btn => {
        const matchText = type === 'album' ? 'music' : type === 'tv' ? 'tv' : type;
        btn.classList.toggle('active', btn.textContent.toLowerCase().includes(matchText));
    });

    const container = document.getElementById('revisit-covers');
    container.innerHTML = '<p class="meta" style="font-size: 0.75rem; margin: 0;">Loading...</p>';

    const items = revisitCandidates[type] || [];
    if (items.length === 0) {
        container.innerHTML = `<p class="meta" style="font-size: 0.75rem; margin: 0;">Nothing to ${action.toLowerCase()} yet!</p>`;
        return;
    }

    const config = await loadConfig();
    
    // 3. Fetch Image Data
    const itemsWithImages = await Promise.all(items.map(async (item) => {
        let image = item.image_url;
        try {
            if (!image) {
                 if (item.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(item.media_id)}.json`).then(r=>r.json()).catch(()=>({}));
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                 } else if (item.media_type === 'album') {
                    const [artist, albumName] = decodeURIComponent(item.media_id).split('|||');
                    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r=>r.json()).catch(()=>({}));
                    image = res.album?.image?.[3]['#text'] || '';
                 } else {
                    const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}?language=en-US`, {
                        headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` }
                    }).then(r=>r.json()).catch(()=>({}));
                    image = res.poster_path ? `https://image.tmdb.org/t/p/w200${res.poster_path}` : '';
                 }
            }
        } catch(e) {}
        
        const customArt = customImgsMap.get(`${item.media_type}_${item.media_id}`);
        if (customArt && customArt.custom_poster) image = customArt.custom_poster;
        
        return { ...item, image: image || `https://placehold.co/100x150/1b2228/9ab?text=No+Img` };
    }));

    // 4. Render Covers
    container.innerHTML = '';
    itemsWithImages.forEach(item => {
        const dateStr = item.date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        
        const card = document.createElement('div');
        // Very tight formatting to keep the vertical height constrained to <= 1.25x the standard boxes
        card.style.cssText = "flex: 0 0 45px; display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: transform 0.2s;";
        card.onclick = () => window.location.href = `details.html?id=${encodeURIComponent(item.media_id)}&type=${item.media_type}`;
        card.onmouseover = () => card.style.transform = 'translateY(-2px)';
        card.onmouseout = () => card.style.transform = 'none';

        card.innerHTML = `
            <img src="${item.image}" style="width: 45px; height: 68px; object-fit: cover; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); margin-bottom: 3px;">
            <div style="font-size: 0.5rem; color: #9ab; text-align: center; line-height: 1.1; width: 55px; word-wrap: break-word;">
                Last ${verb} on<br><span style="color: #fff; font-weight: bold;">${dateStr}</span>
            </div>
        `;
        container.appendChild(card);
    });
};

async function renderStatusItems(items, gridId) {
    const grid = document.getElementById(gridId);
    const config = await loadConfig();
    
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
                const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(item.media_id)}.json`).then(r => r.json()).catch(() => ({}));
                title = item.media_title || res.title || 'Unknown Book';
                image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
            } else if (item.media_type === 'youtube') {
                const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${item.media_id}`)}&format=json`).then(r => r.json());
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
                title = item.media_title || res.title || res.name || 'Unknown Title';
                image = res.poster_path ? `https://image.tmdb.org/t/p/w500${res.poster_path}` : '';
            }
        } catch (e) {
            title = item.media_title || "Unknown Item";
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
            <div class="media-card" data-type="${item.media_type}" data-route="details.html?id=${encodeURIComponent(item.media_id)}&type=${encodeURIComponent(item.media_type)}">
                <div class="poster-wrapper">
                    <img src="${item.image || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image'}" 
                         alt="${item.title}"
                         data-fallback="https://placehold.co/500x750/1b2228/9ab?text=No+Image">
                    
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

window.filterPeople = (type) => {
    currentPeopleCategory = type;
    const peopleSection = document.getElementById('tab-people');
    if (!peopleSection) return;
    
    const buttons = peopleSection.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        // Handle exact matching since "crew" doesn't have an "s"
        if (btnText === type + 's' || (type === 'crew' && btnText === 'crew')) {
            btn.classList.add('active');
        }
    });

    const grid = document.getElementById('people-grid');
    if (!grid) return;

    // Destroy any previous Sortable instance before re-rendering
    if (peopleSortableInstance) {
        peopleSortableInstance.destroy();
        peopleSortableInstance = null;
    }

    // Filter by specific category (No 'all' option anymore)
    const filtered = allTrackedPeople.filter(p => p.person_category === type);
    
    // Sort array locally to ensure rank is respected
    filtered.sort((a, b) => (a.rank || 0) - (b.rank || 0));

    if (filtered.length === 0) {
        const typeLabel = type === 'crew' ? 'crew members' : type + 's';
        grid.innerHTML = `<p class="meta">No ${typeLabel} tracked yet.</p>`;
        return;
    }

    grid.innerHTML = '';
    
    filtered.forEach((p, index) => {
        let route = `cast.html?personId=${p.character_id}`;
        if (p.person_category === 'character') {
            route = `cast.html?characterWiki=${encodeURIComponent(p.character_id)}&mediaId=${p.media_id || ''}&mediaType=${p.media_type || ''}`;
        } else if (p.person_category === 'author') {
            route = `cast.html?authorId=${p.character_id}`;
        } else if (p.person_category === 'artist') {
            route = `cast.html?artist=${p.character_id}`;
        }

        const label = p.person_category ? (p.person_category.charAt(0).toUpperCase() + p.person_category.slice(1)) : 'Person';
        
        // Handle the description text under the title
        let subText = label;
        if (p.person_category === 'character' && p.media_title) {
            subText = `Character from ${p.media_title}`;
        }

        let finalImg = p.image_url || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
        const customArt = customImgsMap.get(`${p.person_category}_${String(p.character_id)}`);
        if (customArt && customArt.custom_poster) {
            finalImg = customArt.custom_poster;
        }

        const card = document.createElement('div');
        card.className = `media-card ${isManagingPeople ? 'managing' : ''}`;
        card.setAttribute('data-dbid', p.id);

        const rankBadge = `<div class="rank-badge" style="position:absolute; top:8px; left:8px; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 4px; font-weight: bold; z-index: 10;">#${index + 1}</div>`;

        card.innerHTML = `
            <div class="poster-wrapper">
                ${rankBadge}
                <img src="${finalImg}" 
                     alt="${p.character_name}" 
                     data-fallback="https://placehold.co/500x750/1b2228/9ab?text=No+Image">
                <span class="badge badge-movie" style="background: #456; color: #fff;">${label}</span>
            </div>
            <div class="media-info">
                <div class="title" style="font-weight: bold; margin-bottom: 5px;">${p.character_name}</div>
                <!-- Inject the subText here -->
                <div class="meta" style="font-size: 0.8rem; color: #9ab;">${subText}</div>
            </div>
        `;

        if (isManagingPeople) {
            // While reordering, clicks don't navigate - only dragging is active
            card.style.cursor = 'grab';
        } else {
            card.onclick = () => window.location.href = route;
        }

        grid.appendChild(card);
    });

    // Enable drag-to-reorder ONLY while in manage mode (and only for the owner)
    if (isOwner && isManagingPeople) {
        peopleSortableInstance = new Sortable(grid, {
            animation: 150,
            onEnd: () => {
                document.querySelectorAll('#people-grid .rank-badge').forEach((badge, i) => {
                    badge.textContent = `#${i + 1}`;
                });
            }
        });
    }
};

// Background Database Saver
async function savePeopleRank() {
    const grid = document.getElementById('people-grid');
    const cards = grid.querySelectorAll('.media-card');

    const updates = [];
    cards.forEach((card, index) => {
        const dbId = card.getAttribute('data-dbid');
        const rank = index + 1;

        // Visually update the # UI instantly
        const badge = card.querySelector('.rank-badge');
        if (badge) badge.textContent = `#${rank}`;

        // Update the global array so filtering doesn't scramble it back
        const person = allTrackedPeople.find(p => p.id === dbId);
        if (person) person.rank = rank;

        updates.push({ id: dbId, rank: rank });
    });

    // Persist each row's new rank to the DB
    for (const u of updates) {
        const { error } = await supabaseClient.from('user_characters')
            .update({ rank: u.rank })
            .eq('id', u.id);
        if (error) {
            console.error('Error saving person rank:', error);
            throw new Error(error.message || 'Failed to save one or more rows. Check that you are allowed to update this data.');
        }
    }
}

window.filterFandoms = (type) => {
    currentFandomsCategory = type;
    const fandomsSection = document.getElementById('tab-fandoms');
    if (!fandomsSection) return;

    const buttons = fandomsSection.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        
        // Match the button based on the passed type
        if ((type === 'movie' && btnText === 'movies') ||
            (type === 'tv' && btnText === 'tv') ||
            (type === 'collection' && btnText === 'collections') ||
            (type === 'book' && btnText === 'books') ||
            (type === 'album' && btnText === 'music') ||
            (type === 'youtube' && btnText === 'youtube')) {
            btn.classList.add('active');
        }
    });

    const grid = document.getElementById('fandoms-grid');
    if (!grid) return;

    // Destroy any previous Sortable instance before re-rendering
    if (fandomsSortableInstance) {
        fandomsSortableInstance.destroy();
        fandomsSortableInstance = null;
    }

    // FILTER LOGIC: Specifically isolate the media_type
    const filtered = allFandoms.filter(f => f.media_type === type);
    filtered.sort((a, b) => (a.rank || 0) - (b.rank || 0));

    if (filtered.length === 0) {
        const typeLabel = type === 'collection' ? 'collections' : (type === 'album' ? 'music' : type);
        grid.innerHTML = `<p class="meta">No ${typeLabel} followed yet.</p>`;
        return;
    }

    grid.innerHTML = '';

        filtered.forEach((f, index) => {
            // 1. Start with the default image from the user_fandoms table
            let finalImg = f.image_url || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
            
            // 2. Check the Map for a custom override
            // This uses the key "collection_list_xxx" which matches the insert in scriptingFandom.js
            const customArtKey = `${f.media_type}_${String(f.media_id)}`;
            const customArt = customImgsMap.get(customArtKey);
            
            if (customArt && customArt.custom_poster) {
                finalImg = customArt.custom_poster;
            }

            const card = document.createElement('div');
            card.className = `media-card ${isManagingFandoms ? 'managing' : ''}`;
            card.setAttribute('data-dbid', f.id);

            const rankBadge = `<div class="rank-badge" style="position:absolute; top:8px; left:8px; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 4px; font-weight: bold; z-index: 10;">#${index + 1}</div>`;

            // Adjust badge style for collections specifically if desired
            const badgeClass = f.media_type === 'collection' ? 'badge-collection' : `badge-${f.media_type}`;
            const label = f.media_type === 'collection' ? 'Collection' : 'Fandom';

            card.innerHTML = `
                <div class="poster-wrapper">
                    ${rankBadge}
                    <img src="${finalImg}" 
                        alt="${f.title}" 
                        data-fallback="https://placehold.co/500x750/1b2228/9ab?text=No+Image">
                    <span class="badge badge-movie" style="background: #456; color: #fff;">${label}</span>
                </div>
                <div class="media-info">
                    <div class="title" style="font-weight: bold; margin-bottom: 5px;">${f.title}</div>
                    <div class="meta" style="font-size: 0.8rem; color: #9ab;">${f.media_type === 'collection' ? 'Official Collection' : 'Fandom'}</div>
                </div>
            `;

            if (isManagingFandoms) {
                card.style.cursor = 'grab';
            } else {
                card.onclick = () => window.location.href = `fandom.html?id=${f.media_id}&type=${f.media_type}`;
            }

            grid.appendChild(card);
        });

    if (isOwner && isManagingFandoms) {
        fandomsSortableInstance = new Sortable(grid, {
            animation: 150,
            onEnd: () => {
                document.querySelectorAll('#fandoms-grid .rank-badge').forEach((badge, i) => {
                    badge.textContent = `#${i + 1}`;
                });
            }
        });
    }
};

async function saveFandomsRank() {
    const grid = document.getElementById('fandoms-grid');
    const cards = grid.querySelectorAll('.media-card');

    const updates = [];
    cards.forEach((card, index) => {
        const dbId = card.getAttribute('data-dbid');
        const rank = index + 1;

        const badge = card.querySelector('.rank-badge');
        if (badge) badge.textContent = `#${rank}`;

        const fandom = allFandoms.find(f => f.id === dbId);
        if (fandom) fandom.rank = rank;

        updates.push({ id: dbId, rank: rank });
    });

    for (const u of updates) {
        const { error } = await supabaseClient.from('user_fandoms')
            .update({ rank: u.rank })
            .eq('id', u.id);
        if (error) {
            console.error('Error saving fandom rank:', error);
            throw new Error(error.message || 'Failed to save one or more rows. Check that you are allowed to update this data.');
        }
    }
}

// --- Reorder button wiring (People) ---
const managePeopleOrderBtn = document.getElementById('manage-people-order-btn');
const savePeopleOrderBtn = document.getElementById('save-people-order-btn');

if (managePeopleOrderBtn) {
    managePeopleOrderBtn.onclick = () => {
        isManagingPeople = true;
        managePeopleOrderBtn.style.display = 'none';
        savePeopleOrderBtn.style.display = 'inline-block';
        filterPeople(currentPeopleCategory);
    };
}

if (savePeopleOrderBtn) {
    savePeopleOrderBtn.onclick = async () => {
        savePeopleOrderBtn.textContent = 'Saving...';
        savePeopleOrderBtn.disabled = true;
        try {
            await savePeopleRank();
        } catch (err) {
            alert('Error saving order: ' + err.message);
        } finally {
            isManagingPeople = false;
            if (peopleSortableInstance) {
                peopleSortableInstance.destroy();
                peopleSortableInstance = null;
            }
            savePeopleOrderBtn.style.display = 'none';
            managePeopleOrderBtn.style.display = 'inline-block';
            savePeopleOrderBtn.textContent = 'Save Order';
            savePeopleOrderBtn.disabled = false;
            filterPeople(currentPeopleCategory);
        }
    };
}

// --- Reorder button wiring (Fandoms) ---
const manageFandomsOrderBtn = document.getElementById('manage-fandoms-order-btn');
const saveFandomsOrderBtn = document.getElementById('save-fandoms-order-btn');

if (manageFandomsOrderBtn) {
    manageFandomsOrderBtn.onclick = () => {
        isManagingFandoms = true;
        manageFandomsOrderBtn.style.display = 'none';
        saveFandomsOrderBtn.style.display = 'inline-block';
        filterFandoms(currentFandomsCategory);
    };
}

if (saveFandomsOrderBtn) {
    saveFandomsOrderBtn.onclick = async () => {
        saveFandomsOrderBtn.textContent = 'Saving...';
        saveFandomsOrderBtn.disabled = true;
        try {
            await saveFandomsRank();
        } catch (err) {
            alert('Error saving order: ' + err.message);
        } finally {
            isManagingFandoms = false;
            if (fandomsSortableInstance) {
                fandomsSortableInstance.destroy();
                fandomsSortableInstance = null;
            }
            saveFandomsOrderBtn.style.display = 'none';
            manageFandomsOrderBtn.style.display = 'inline-block';
            saveFandomsOrderBtn.textContent = 'Save Order';
            saveFandomsOrderBtn.disabled = false;
            filterFandoms(currentFandomsCategory);
        }
    };
}

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
        <div class="profile-tag-pill clickable" data-tag="${tag}">
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

    const config = await loadConfig();

    try {
        const fullLogs = await Promise.all(sortedLogs.map(async (log) => {
            let title, image;
            try {
                if (log.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(log.media_id)}.json`).then(r => r.json()).catch(() => ({}));
                    title = log.media_title || res.title || 'Unknown Book';
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                } else if (log.media_type === 'youtube') {
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${log.media_id}`)}&format=json`).then(r => r.json());
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
            const stars = 'â˜…'.repeat(Math.floor(log.rating || 0)) + ((log.rating % 1 !== 0) ? 'Â½' : '');
            
            const safeDate = getSafeDate(log);
            const dateStr = safeDate.toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            
            const reviewIcon = log.notes ? `<span title="Reviewed" style="margin-right:8px;">ðŸ“</span>` : '';
            const likeIcon = log.is_liked ? `<span title="Liked" style="color:#ff4d4d; margin-right:8px;">â¤ï¸</span>` : '';
            
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
    const config = await loadConfig();

    try {
        const mediaPromises = sortedLogs.map(async (log) => {
            let title, image;
            try {
                if (log.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(log.media_id)}.json`).then(r => r.json()).catch(() => ({}));
                    title = log.media_title || res.title || 'Unknown Book';
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                } else if (log.media_type === 'youtube') {
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${log.media_id}`)}&format=json`).then(r => r.json());
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

            const stars = 'â˜…'.repeat(Math.floor(log.rating || 0)) + ((log.rating % 1 !== 0) ? 'Â½' : '');
            let rewatchText = 'Rewatch';
            if (log.media_type === 'book') rewatchText = 'Reread';
            else if (log.media_type === 'album') rewatchText = 'Relisten';

            const reviewBadge = log.notes ? `<div class="card-icon-badge" title="Reviewed">ðŸ“</div>` : '';
            const likeBadge = log.is_liked ? `<div class="card-icon-badge icon-heart" title="Liked">â¤ï¸</div>` : '';
            const rewatchBadge = log.is_rewatch ? `<div class="card-icon-badge" title="${rewatchText}" style="font-size: 0.8rem;">ðŸ”</div>` : '';

            card.innerHTML = `
                <div class="poster-wrapper">
                    <div class="badge-container">
                        ${likeBadge}
                        ${reviewBadge}
                        ${rewatchBadge}
                    </div>
                    <img src="${log.image || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image'}" 
                         alt="${log.title}"
                         data-fallback="https://placehold.co/500x750/1b2228/9ab?text=No+Image">
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
                data-fallback="https://placehold.co/500x750/1b2228/9ab?text=No+Image">
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

    const config = await loadConfig();

    try {
        const mediaPromises = items.map(async (item) => {
            let title, image;
            try {
                if (item.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${normalizeOpenLibraryId(item.media_id)}.json`).then(r => r.json()).catch(() => ({}));
                    title = item.media_title || res.title || 'Unknown Book';
                    image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
                } else if (item.media_type === 'youtube') {
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${item.media_id}`)}&format=json`).then(r => r.json());
                    title = item.media_title || res.title || 'YouTube Video';
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
                    title = item.media_title || res.title || res.name || 'Unknown Title';
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
                const starString = 'â˜…'.repeat(Math.floor(item.rating)) + ((item.rating % 1 !== 0) ? 'Â½' : '');
                starsHtml = `<span class="text-glow">${starString}</span>`;
            }
            
            const likeBadge = item.is_liked ? `<div class="card-icon-badge icon-heart">â¤ï¸</div>` : '';

            card.innerHTML = `
                <div class="poster-wrapper">
                    <div class="badge-container">
                        ${likeBadge}
                    </div>
                    <img src="${item.image || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image'}" 
                         alt="${item.title}"
                         data-fallback="https://placehold.co/500x750/1b2228/9ab?text=No+Image">
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
            <button class="secondary-btn" data-library-page="-1" ${currentLibraryPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Previous</button>
            <span class="meta" style="margin: 0 15px; font-weight: bold;">Page ${currentLibraryPage} of ${totalPages}</span>
            <button class="secondary-btn" data-library-page="1" ${currentLibraryPage === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Next</button>
        `;
        paginationContainer.querySelectorAll('[data-library-page]').forEach((button) => {
            button.addEventListener('click', () => window.changeLibraryPage(Number(button.dataset.libraryPage)));
        });
    } else {
        paginationContainer.innerHTML = ''; // Hide if 50 items or fewer
    }
}

document.querySelectorAll('[data-profile-tab]').forEach((button) => {
    button.addEventListener('click', () => window.switchTab(button.dataset.profileTab));
});
document.querySelectorAll('[data-library-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterLibrary(button.dataset.libraryFilter));
});
document.querySelectorAll('[data-people-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterPeople(button.dataset.peopleFilter));
});
document.querySelectorAll('[data-fandom-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterFandoms(button.dataset.fandomFilter));
});
document.querySelectorAll('[data-revisit-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterRevisit(button.dataset.revisitFilter));
});
document.querySelectorAll('[data-favorites-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterFavs(button.dataset.favoritesFilter));
});
document.querySelectorAll('[data-recent-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterRecent(button.dataset.recentFilter));
});
document.querySelector('[data-navigation="settings.html"]')?.addEventListener('click', () => {
    window.location.href = 'settings.html';
});
document.addEventListener('click', (event) => {
    const routeTarget = event.target.closest('[data-route]');
    if (routeTarget) {
        window.location.href = routeTarget.dataset.route;
        return;
    }

    const tagTarget = event.target.closest('[data-tag]');
    if (tagTarget) window.openTagDetails(tagTarget.dataset.tag);
});
document.addEventListener('error', (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.dataset.fallback) {
        image.src = image.dataset.fallback;
        delete image.dataset.fallback;
    }
}, true);

initProfile();
