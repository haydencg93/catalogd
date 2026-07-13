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
                filterFandoms('movie');
            } else {
                if (fandomsGrid) fandomsGrid.innerHTML = `<p class="meta">No fandoms followed yet.</p>`;
            }
        } else {
            if (fandomsGrid) fandomsGrid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align: center;">Fandom tracking is private.</p>`;
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

            const socialsContainer = document.getElementById('social-icons-container');
            socialsContainer.innerHTML = ''; // Clear it out
            
            // 1. Instagram
            if (profile.instagram) {
                socialsContainer.innerHTML += `
                    <a href="https://instagram.com/${profile.instagram}" target="_blank" class="social-icon-btn" title="Instagram">
                        <svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.88z"/></svg>
                    </a>`;
            }
            
            // 2. Snapchat
            if (profile.snapchat) {
                socialsContainer.innerHTML += `
                    <a href="https://snapchat.com/add/${profile.snapchat}" target="_blank" class="social-icon-btn" title="Snapchat">
                        <svg viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet"> 
                            <g transform="translate(0,600) scale(0.1,-0.1)">
                                <path fill="currentColor" d="M2805 5128 c-27 -5 -60 -9 -72 -9 -13 -1 -21 -4 -19 -8 2 -3 -12 -7 -32 -8 -57 -3 -196 -50 -294 -100 -14 -7 -33 -13 -40 -13 -8 0 -23 -9 -33 -20 -10 -11 -24 -20 -31 -20 -7 0 -18 -8 -23 -17 -6 -11 -11 -13 -11 -5 0 7 -5 10 -10 7 -6 -4 -8 -11 -5 -16 3 -5 -1 -6 -10 -3 -10 4 -15 2 -13 -7 2 -7 -3 -13 -10 -14 -8 0 -20 -11 -27 -25 -9 -15 -15 -19 -15 -10 0 12 -3 11 -11 -3 -6 -9 -14 -15 -20 -12 -5 4 -6 -2 -2 -11 4 -12 3 -15 -5 -10 -7 4 -12 3 -12 -1 0 -5 -7 -18 -16 -29 -8 -10 -13 -12 -9 -4 4 8 -3 5 -14 -8 -11 -12 -25 -21 -31 -20 -7 2 -14 -6 -16 -17 -1 -11 -14 -29 -27 -41 -27 -23 -107 -138 -107 -153 0 -6 -5 -11 -11 -11 -5 0 -7 -4 -4 -10 3 -5 3 -10 -2 -10 -12 0 -33 -51 -26 -64 3 -6 2 -8 -2 -3 -7 6 -26 -25 -34 -58 -2 -5 -7 -18 -12 -27 -5 -9 -12 -34 -15 -55 -3 -21 -11 -46 -16 -57 -7 -12 -7 -16 0 -12 6 3 5 -6 -3 -21 -34 -70 -42 -423 -16 -721 10 -118 2 -123 -139 -86 -36 9 -67 20 -70 24 -9 12 -72 30 -105 30 -53 0 -130 -28 -163 -60 -18 -17 -32 -27 -32 -24 0 4 -13 -13 -30 -37 -45 -67 -41 -166 9 -207 9 -8 11 -11 5 -8 -6 3 -11 -1 -11 -8 0 -8 8 -11 20 -8 14 3 18 1 13 -6 -4 -7 -2 -12 4 -12 6 0 8 -4 5 -10 -4 -6 1 -7 11 -3 11 4 15 3 10 -5 -6 -9 21 -24 49 -27 6 0 9 -6 7 -13 -1 -7 4 -12 12 -12 8 0 17 -6 19 -12 4 -10 6 -10 6 0 1 10 9 8 27 -7 14 -11 32 -17 40 -14 8 3 14 1 14 -5 0 -6 9 -8 20 -5 12 3 22 -1 26 -11 3 -9 10 -14 14 -11 4 3 21 -2 37 -10 16 -8 40 -16 54 -19 13 -2 23 -9 22 -15 -2 -5 3 -8 11 -5 7 3 20 -2 29 -10 9 -9 21 -16 28 -16 7 0 10 -3 6 -6 -3 -3 2 -15 12 -26 11 -11 18 -31 16 -46 -3 -40 -27 -112 -37 -112 -4 0 -7 -3 -6 -7 2 -9 -51 -115 -61 -123 -3 -3 -15 -22 -26 -42 -11 -21 -22 -38 -25 -38 -3 0 -14 -14 -25 -32 -10 -18 -32 -46 -49 -62 -17 -17 -31 -33 -31 -37 0 -13 -63 -67 -71 -61 -4 4 -4 1 0 -5 4 -8 -5 -20 -26 -33 -18 -11 -32 -23 -31 -27 2 -5 -3 -8 -10 -8 -19 -1 -38 -16 -31 -26 3 -5 -8 -14 -25 -20 -17 -6 -29 -15 -26 -19 3 -5 -10 -14 -29 -21 -19 -7 -32 -17 -29 -23 4 -5 0 -7 -10 -3 -8 3 -21 -1 -27 -9 -7 -8 -19 -14 -26 -14 -8 0 -14 -5 -14 -11 0 -5 -4 -7 -10 -4 -5 3 -10 1 -10 -5 0 -6 -3 -9 -8 -7 -4 3 -25 -4 -47 -14 -22 -11 -45 -17 -52 -15 -7 3 -15 1 -18 -4 -5 -9 -70 -30 -105 -35 -8 -1 -28 -7 -45 -14 -16 -6 -35 -13 -42 -16 -22 -7 -45 -67 -48 -121 -1 -30 2 -51 6 -48 5 3 9 -1 9 -9 0 -8 10 -22 22 -31 20 -15 20 -16 4 -11 -19 6 -19 5 -1 -15 10 -11 24 -20 31 -20 7 0 18 -8 23 -19 6 -10 31 -24 56 -31 32 -9 42 -16 33 -21 -9 -6 -3 -9 18 -9 17 0 34 -3 38 -8 4 -4 12 -8 17 -8 5 -1 11 -3 14 -4 3 -1 8 -3 13 -5 4 -1 20 -7 35 -13 16 -7 46 -15 67 -18 24 -4 37 -11 33 -17 -3 -5 -2 -7 4 -4 6 4 46 0 89 -7 43 -8 82 -12 86 -10 4 3 12 -15 18 -38 6 -24 14 -50 17 -58 3 -8 7 -24 9 -35 6 -37 10 -50 15 -60 3 -5 4 -20 4 -32 -1 -12 1 -21 4 -20 4 1 17 -8 31 -20 14 -14 37 -23 54 -23 18 0 26 -3 19 -8 -6 -4 6 -7 27 -7 21 0 34 2 28 6 -5 4 4 8 21 11 17 2 31 1 31 -3 0 -4 17 -3 38 1 88 20 229 28 322 18 52 -6 105 -11 118 -12 12 0 22 -5 22 -9 0 -5 5 -5 10 -2 6 3 10 2 10 -2 0 -5 12 -14 28 -21 34 -15 65 -34 85 -51 9 -7 22 -9 28 -5 7 4 9 3 6 -3 -4 -6 1 -17 10 -24 13 -11 15 -11 9 -1 -7 11 -4 11 12 1 12 -7 19 -15 17 -17 -2 -3 3 -11 11 -19 8 -8 11 -19 8 -25 -5 -7 -2 -8 5 -4 7 5 10 14 7 22 -8 22 1 17 36 -18 17 -18 28 -26 24 -18 -4 8 -1 7 8 -4 8 -10 20 -15 27 -10 7 4 10 3 5 -4 -6 -10 16 -28 37 -31 4 -1 6 -4 5 -7 -2 -4 7 -11 20 -15 13 -5 21 -13 18 -17 -3 -5 6 -7 19 -4 15 2 25 0 25 -7 0 -6 5 -11 10 -11 6 0 33 -11 61 -25 29 -13 56 -22 62 -18 6 3 7 2 4 -4 -4 -6 6 -10 24 -11 17 0 38 -7 46 -14 22 -18 332 -24 400 -8 26 6 54 12 61 12 6 1 12 5 12 8 0 4 23 10 50 14 28 4 49 10 46 15 -3 4 17 13 45 20 27 7 47 16 44 21 -3 4 14 15 37 24 22 10 70 38 105 64 34 26 67 47 72 47 5 0 23 13 41 28 18 17 38 26 47 23 11 -4 13 -2 9 9 -3 8 -2 14 2 13 16 -3 72 29 65 37 -5 5 -1 4 9 -3 12 -10 18 -10 24 -1 5 8 3 10 -7 5 -8 -4 -5 0 5 8 11 9 28 16 38 16 10 0 18 4 18 8 0 5 6 9 13 9 6 1 44 9 82 18 90 22 95 22 250 2 205 -27 281 -25 344 11 8 4 15 21 17 37 2 15 8 31 14 35 7 4 10 9 9 11 -5 6 21 121 32 142 6 12 5 17 -3 18 -7 0 -2 4 10 10 13 5 28 7 33 3 5 -3 15 -2 22 3 11 7 52 14 90 14 9 0 15 4 12 9 -3 6 0 7 8 4 8 -3 18 -1 22 5 3 6 11 11 16 11 6 0 8 -4 5 -9 -3 -5 23 1 59 14 35 12 68 19 71 16 4 -3 4 0 0 7 -5 8 2 12 22 12 16 0 35 7 42 15 7 8 18 15 24 15 6 0 4 -5 -4 -10 -8 -5 -10 -10 -4 -10 16 0 35 25 27 34 -4 4 0 4 9 1 10 -4 24 2 37 16 12 13 21 19 21 13 0 -5 3 -5 8 1 4 6 16 15 27 21 11 6 29 26 39 44 13 21 15 31 6 25 -10 -6 -10 -3 2 14 26 37 4 156 -30 156 -4 0 -6 3 -5 7 3 9 -87 39 -98 33 -4 -3 -10 -1 -13 4 -3 4 -23 11 -45 15 -22 3 -52 11 -68 18 -15 6 -31 12 -35 13 -5 2 -9 3 -10 5 -2 1 -12 3 -23 5 -11 2 -25 12 -32 21 -7 10 -16 15 -19 11 -4 -4 -13 2 -21 13 -7 10 -20 17 -27 14 -7 -3 -16 2 -19 10 -4 9 -13 16 -21 16 -8 0 -21 6 -28 12 -7 7 -40 35 -73 61 -33 26 -67 54 -77 62 -9 7 -18 11 -20 9 -3 -2 -11 7 -18 21 -7 14 -17 25 -21 25 -13 0 -39 56 -31 65 4 5 1 5 -6 1 -7 -4 -10 -12 -7 -17 4 -5 4 -9 0 -9 -3 0 -10 12 -15 26 -6 14 -14 22 -20 19 -5 -3 -10 2 -10 13 0 10 -9 27 -21 38 -23 21 -54 74 -51 87 1 5 -2 6 -8 2 -5 -3 -10 1 -10 9 0 9 -4 16 -10 16 -5 0 -10 9 -10 19 0 11 -5 23 -12 27 -7 5 -8 3 -3 -6 5 -9 4 -11 -4 -6 -6 4 -9 12 -6 17 4 5 -1 21 -9 36 -46 83 -60 168 -31 196 8 8 11 17 8 21 -4 3 1 6 10 6 9 0 17 3 17 8 0 12 43 35 73 38 15 2 49 14 75 26 26 12 57 22 69 21 12 0 20 4 17 8 -5 8 10 13 29 10 4 0 7 4 7 9 0 6 6 10 13 8 19 -3 117 51 117 66 0 7 8 20 18 27 15 13 16 12 3 -4 -8 -9 -12 -20 -9 -23 3 -2 13 11 22 31 18 36 30 48 19 18 -3 -10 -3 -15 1 -11 4 3 9 12 10 20 2 7 8 26 14 41 27 64 -4 193 -49 204 -10 3 -17 9 -14 13 3 5 -4 11 -15 15 -11 4 -18 11 -15 16 3 5 -2 6 -11 2 -10 -4 -15 -2 -11 4 7 12 -78 33 -134 33 -46 0 -129 -21 -129 -32 0 -4 -10 -8 -23 -8 -13 0 -27 -4 -33 -10 -5 -5 -21 -11 -34 -14 -14 -2 -25 -5 -25 -6 0 -1 -15 -3 -32 -5 -18 -1 -30 1 -27 6 3 5 2 9 -3 9 -4 0 -5 44 -2 97 10 149 9 590 -2 658 -6 33 -11 70 -12 82 -1 11 -5 19 -9 17 -4 -3 -6 4 -6 13 0 10 -2 29 -5 43 -8 40 -69 170 -79 170 -5 0 -7 4 -3 9 3 6 -4 19 -17 30 -12 12 -19 24 -15 27 3 3 -5 18 -18 32 -13 14 -29 38 -36 54 -6 15 -15 25 -20 22 -5 -3 -9 1 -9 8 0 8 -9 20 -19 28 -11 7 -19 16 -18 19 3 6 -60 70 -68 71 -3 0 -6 3 -7 8 -2 11 -32 31 -40 26 -4 -3 -5 1 -2 9 3 10 -5 18 -26 26 -17 6 -29 14 -26 19 2 4 -10 14 -27 21 -18 8 -42 23 -54 34 -13 11 -23 16 -23 11 0 -5 -5 -1 -11 9 -5 9 -16 17 -23 17 -7 0 -26 10 -42 22 -16 13 -25 16 -20 8 4 -9 2 -8 -6 2 -8 9 -26 19 -40 22 -14 2 -34 9 -44 15 -35 20 -95 40 -89 31 3 -6 -1 -7 -9 -4 -9 3 -14 10 -11 14 3 5 -3 9 -12 8 -10 0 -28 3 -40 6 -58 15 -70 18 -93 22 -14 2 -50 8 -80 13 -69 12 -318 11 -385 -1z"></path> 
                            </g> 
                        </svg>
                    </a>`;
            }

            // 3. TikTok
            if (profile.tiktok) {
                socialsContainer.innerHTML += `
                    <a href="https://tiktok.com/@${profile.tiktok.replace('@', '')}" target="_blank" class="social-icon-btn" title="TikTok">
                        <svg viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
                    </a>`;
            }

            // 4. YouTube
            if (profile.youtube) {
                socialsContainer.innerHTML += `
                    <a href="https://youtube.com/${profile.youtube}" target="_blank" class="social-icon-btn" title="YouTube">
                        <svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    </a>`;
            }

            // 5. GitHub
            if (profile.github) {
                socialsContainer.innerHTML += `
                    <a href="https://github.com/${profile.github}" target="_blank" class="social-icon-btn" title="GitHub">
                        <svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                    </a>`;
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

    const config = await fetch('config.json').then(r => r.json());
    
    // 3. Fetch Image Data
    const itemsWithImages = await Promise.all(items.map(async (item) => {
        let image = item.image_url;
        try {
            if (!image) {
                 if (item.media_type === 'book') {
                    const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r=>r.json()).catch(()=>({}));
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

        // --- CUSTOM ART LOGIC ---
        // Ensure character_id is treated as a string for the map lookup
let finalImg = p.image_url || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
const customArt = customImgsMap.get(`${p.person_category}_${String(p.character_id)}`);
if (customArt && customArt.custom_poster) {
    finalImg = customArt.custom_poster;
}

const card = document.createElement('div');
card.className = `media-card ${isManagingPeople ? 'managing' : ''}`;
card.setAttribute('data-dbid', p.id);

// Show rank badge for EVERYONE, not just the owner
const rankBadge = `<div class="rank-badge" style="position:absolute; top:8px; left:8px; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 4px; font-weight: bold; z-index: 10;">#${index + 1}</div>`;

        card.innerHTML = `
            <div class="poster-wrapper">
                ${rankBadge}
                <img src="${finalImg}" 
                     alt="${p.character_name}" 
                     onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
                <span class="badge badge-movie" style="background: #456; color: #fff;">${label}</span>
            </div>
            <div class="media-info">
                <div class="title" style="font-weight: bold; margin-bottom: 5px;">${p.character_name}</div>
                <div class="meta" style="font-size: 0.8rem; color: #9ab;">${label}</div>
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
        if ((type === 'movie' && btnText === 'movies') ||
            (type === 'tv' && btnText === 'tv') ||
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

    const filtered = allFandoms.filter(f => f.media_type === type);
    filtered.sort((a, b) => (a.rank || 0) - (b.rank || 0));

    if (filtered.length === 0) {
        const typeLabel = type === 'album' ? 'music' : type;
        grid.innerHTML = `<p class="meta">No ${typeLabel} fandoms followed yet.</p>`;
        return;
    }

    grid.innerHTML = '';

    filtered.forEach((f, index) => {
        // Add Custom Image Logic for Fandoms
        let finalImg = f.image_url || 'https://placehold.co/500x750/1b2228/9ab?text=No+Image';
        const customArt = customImgsMap.get(`${f.media_type}_${String(f.media_id)}`);
        if (customArt && customArt.custom_poster) {
            finalImg = customArt.custom_poster;
        }

        const card = document.createElement('div');
        card.className = `media-card ${isManagingFandoms ? 'managing' : ''}`;
        card.setAttribute('data-dbid', f.id);

        // Show rank badge for EVERYONE
        const rankBadge = `<div class="rank-badge" style="position:absolute; top:8px; left:8px; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 4px; font-weight: bold; z-index: 10;">#${index + 1}</div>`;

        card.innerHTML = `
            <div class="poster-wrapper">
                ${rankBadge}
                <img src="${finalImg}" 
                    alt="${f.title}" 
                    onerror="this.onerror=null; this.src='https://placehold.co/500x750/1b2228/9ab?text=No+Image';">
                <span class="badge badge-${f.media_type}">${f.media_type}</span>
            </div>
            <div class="media-info">
                <div class="title" style="font-weight: bold; margin-bottom: 5px;">${f.title}</div>
                <div class="meta" style="font-size: 0.8rem; color: #9ab;">Fandom</div>
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