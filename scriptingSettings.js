let supabaseClient = null;
let tmdbToken = null;
let lastfmKey = null;

let currentFavs = { movie: [], tv: [], book: [], album: [], youtube: [], all: [] };
let currentServices = { streaming: [], buying: [], listening: [], languages: [] };

// --- GLOBAL EXPORT CACHE ---
const exportTitleCache = new Map();

const favSearchInput = document.getElementById('fav-search-input');
const favSearchResults = document.getElementById('fav-search-results');

async function initSettings() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
    tmdbToken = config.tmdb_token;
    lastfmKey = config.lastfm_key;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { window.location.href = 'index.html'; return; }

    // Fetch existing Bio/Website/Favs to prefill
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (profile) {
        // Helper function to safely set values only if the element exists
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };

        // Safely prefill text fields
        setVal('edit-bio', profile.bio || '');
        setVal('edit-website', profile.website_url || '');
        setVal('edit-instagram', profile.instagram || '');
        setVal('edit-snapchat', profile.snapchat || '');
        setVal('edit-tiktok', profile.tiktok || '');
        setVal('edit-youtube', profile.youtube || '');
        setVal('edit-github', profile.github || '');
        setVal('lastfm-username-input', profile.lastfm_username || '');

        // Populate the link
        const currentPath = window.location.pathname;
        const basePath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
        const customLink = `${window.location.origin}${basePath}profile.html?user=${profile.username}`;
        setVal('display-custom-link', customLink);

        // Wire up the inline copy button safely
        const settingsShareBtn = document.getElementById('settings-share-btn');
        if (settingsShareBtn) {
            settingsShareBtn.onmouseover = () => settingsShareBtn.style.opacity = '1';
            settingsShareBtn.onmouseout = () => settingsShareBtn.style.opacity = '0.7';
            settingsShareBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(customLink);
                    showSuccess();
                } catch (err) {
                    const tempInput = document.createElement('input');
                    tempInput.value = customLink;
                    document.body.appendChild(tempInput);
                    tempInput.select();
                    document.execCommand('copy');
                    document.body.removeChild(tempInput);
                    showSuccess();
                }
                function showSuccess() {
                    settingsShareBtn.innerHTML = '✅';
                    settingsShareBtn.style.transform = 'scale(1.1)';
                    setTimeout(() => {
                        settingsShareBtn.innerHTML = '🔗';
                        settingsShareBtn.style.transform = 'scale(1)';
                    }, 2000);
                }
            };
        }

        // Safely set checkboxes
        setCheck('toggle-active-status', profile.show_active_status !== false); 
        setCheck('toggle-paused-status', profile.show_paused_dropped_status !== false);
        setCheck('toggle-fandoms-status', profile.show_fandoms === true);
        setCheck('toggle-characters-status', profile.show_characters === true);

        // Ensure album is in the fallback object
        currentFavs = profile.favorites || { movie: [], tv: [], book: [], youtube: [], album: [], all: [] };
        renderFavManager();
        
        currentServices = profile.services || { streaming: [], buying: [], listening: [], languages: [] };
        if (!currentServices.languages) currentServices.languages = [];

        await fetchAndRenderProviders();
        await fetchAndRenderLanguages();
        renderActiveServicePills();
    }

    // Prefill current data
    const meta = user.user_metadata || {};
    document.getElementById('edit-name').value = meta.display_name || '';
    document.getElementById('edit-username').value = meta.username || '';
    document.getElementById('edit-avatar').value = meta.avatar_url || '';
    document.getElementById('edit-banner').value = meta.banner_url || '';
    document.getElementById('save-services-btn').onclick = saveAllProfileData;

    // --- Change Password ---
    document.getElementById('change-password-btn').onclick = async () => {
        const pass = document.getElementById('new-password').value;
        const confirmPass = document.getElementById('confirm-new-password').value;

        if (pass !== confirmPass) return alert("Passwords do not match!");
        if (pass.length < 6) return alert("Password too short!");

        const { error } = await supabaseClient.auth.updateUser({ password: pass });

        if (error) alert(error.message);
        else {
            alert("Password changed!");
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-new-password').value = '';
        }
    };

    // --- Export Functionality ---
    const rangeSelect = document.getElementById('export-range-select');
    const dateInputs = document.getElementById('date-range-inputs');

rangeSelect.onchange = async () => {
        const isRange = rangeSelect.value === 'range';
        dateInputs.style.display = isRange ? 'flex' : 'none';
        
        if (isRange) {
            // 1. Get Today's Date
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            // 2. Calculate One Week Ago
            const lastWeek = new Date();
            lastWeek.setDate(today.getDate() - 7);
            const lastWeekStr = lastWeek.toISOString().split('T')[0];

            // 3. Set the defaults in the UI
            document.getElementById('export-start-date').value = lastWeekStr;
            document.getElementById('export-end-date').value = todayStr;

            console.log(`📅 Default range set: ${lastWeekStr} to ${todayStr}`);
        }
    };

    document.getElementById('start-export-btn').onclick = async () => {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return alert("Please sign in to export data.");
        
        const rangeType = document.getElementById('export-range-select').value;
        const startDate = document.getElementById('export-start-date').value;
        const endDate = document.getElementById('export-end-date').value;
        const typeFilter = document.getElementById('export-type-select').value;
        
        startFullAccountExport(user, rangeType, startDate, endDate, typeFilter);
    };

    // --- Import Functionality ---
    const importBtn = document.getElementById('start-import-btn');
    const fileInput = document.getElementById('import-csv-input');
    
    importBtn.onclick = () => {
        const file = fileInput.files[0];
        if (!file) return alert("Please select a CSV file first.");
        
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => startImport(results.data, user.id)
        });
    };

    // --- Delete Account ---
    document.getElementById('final-delete-btn').onclick = async () => {
        const password = document.getElementById('delete-confirm-password').value;
        if (!password) return alert("Enter password to confirm deletion.");

        if (confirm("This will permanently delete your data. Continue?")) {
            // Re-auth check
            const { error: authErr } = await supabaseClient.auth.signInWithPassword({
                email: user.email,
                password: password
            });

            if (authErr) return alert("Incorrect password.");

            const { error: delErr } = await supabaseClient.rpc('delete_user_account');
            if (delErr) alert(delErr.message);
            else {
                await supabaseClient.auth.signOut();
                window.location.href = 'index.html';
            }
        }

        const hash = window.location.hash;
        if (hash && hash.includes('type=recovery')) {
            alert("Password recovery mode active. Please enter your new password in the Security section.");
            document.getElementById('new-password').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('new-password').focus();
        }
    }

        // Helper function to safely assign clicks only if the element exists
    const safeClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

    // Safely attach the functions
    safeClick('save-profile-btn', saveAllProfileData);
    safeClick('save-favs-btn', saveAllProfileData);
    safeClick('save-privacy-btn', saveAllProfileData);
    safeClick('save-services-btn', saveAllProfileData);

    setupFavoritesSearch();
    setupHeader();
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

// Function to handle the Favorites search
favSearchInput.oninput = async () => {
    const query = favSearchInput.value;
    if (query.length < 3) {
        favSearchResults.innerHTML = '';
        return;
    }

    // Search TMDB (Movies/TV)
    const options = { headers: { Authorization: `Bearer ${tmdbToken}` } };
    const res = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`, options);
    const data = await res.json();

    favSearchResults.innerHTML = '';
    favSearchResults.style.display = 'block';

    data.results.slice(0, 5).forEach(item => {
        if (item.media_type === 'person') return;
        
        const div = document.createElement('div');
        div.className = 'search-item-dropdown';
        div.style.padding = '10px';
        div.style.cursor = 'pointer';
        div.style.borderBottom = '1px solid #2c3440';
        div.innerHTML = `<strong>${item.title || item.name}</strong> (${item.media_type})`;
        
        div.onclick = () => {
            addFavorite({
                id: item.id,
                title: item.title || item.name,
                type: item.media_type,
                image: `https://image.tmdb.org/t/p/w500${item.poster_path}`
            });
            favSearchResults.innerHTML = '';
            favSearchInput.value = '';
        };
        favSearchResults.appendChild(div);
    });
};

async function fetchAndRenderProviders() {
    try {
        const [movieProvRes, tvProvRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/watch/providers/movie?language=en-US&watch_region=US`, { headers: { Authorization: `Bearer ${tmdbToken}` } }).then(r => r.json()),
            fetch(`https://api.themoviedb.org/3/watch/providers/tv?language=en-US&watch_region=US`, { headers: { Authorization: `Bearer ${tmdbToken}` } }).then(r => r.json())
        ]);

        const providerMap = new Map();
        [...(movieProvRes.results || []), ...(tvProvRes.results || [])].forEach(p => {
            if (!providerMap.has(p.provider_id)) providerMap.set(p.provider_id, p);
        });
        
        // TMDB Provider IDs for major Rent/Buy platforms in the US
        // This ensures they are routed to the bottom container
        const buyingIds = new Set([
            2,   // Apple TV (iTunes)
            3,   // Google Play Movies
            7,   // Fandango at Home (Vudu)
            10,  // Amazon Video (Rent/Buy - distinct from Prime)
            68,  // Microsoft Store
            192, // YouTube
            358, // DirecTV
            48   // Spectrum On Demand
        ]);

        const streamingProviders = [];
        const buyingProviders = [];

        // Sort all by US display priority
        const sortedProviders = Array.from(providerMap.values())
            .sort((a, b) => a.display_priorities.US - b.display_priorities.US);

        // Route the providers into their specific buckets
        sortedProviders.forEach(p => {
            if (buyingIds.has(p.provider_id)) {
                buyingProviders.push(p);
            } else {
                streamingProviders.push(p);
            }
        });

        // Grab the top options for each category
        const topStreaming = streamingProviders.slice(0, 30);
        const topBuying = buyingProviders.slice(0, 10); 

        const generatePillHTML = (p, category) => {
            const isActive = currentServices[category].includes(String(p.provider_id)) ? 'active' : '';
            return `
                <div class="pill ${isActive}" data-id="${p.provider_id}" onclick="toggleServicePill(this, '${category}')">
                    <img src="https://image.tmdb.org/t/p/w45${p.logo_path}" class="pill-logo">
                    ${p.provider_name}
                </div>
            `;
        };

        // Render to the UI
        document.getElementById('settings-streaming-container').innerHTML = topStreaming.map(p => generatePillHTML(p, 'streaming')).join('');
        document.getElementById('settings-buying-container').innerHTML = topBuying.map(p => generatePillHTML(p, 'buying')).join('');

    } catch (e) {
        document.getElementById('settings-streaming-container').innerHTML = '<p class="meta">Failed to load streaming providers.</p>';
        document.getElementById('settings-buying-container').innerHTML = '<p class="meta">Failed to load buying providers.</p>';
    }
}

async function fetchAndRenderLanguages() {
    try {
        const langRes = await fetch(`https://api.themoviedb.org/3/configuration/languages`, { 
            headers: { Authorization: `Bearer ${tmdbToken}` } 
        }).then(r => r.json());

        // Sort alphabetically by English name
        const sortedLangs = langRes.sort((a, b) => a.english_name.localeCompare(b.english_name));

        document.getElementById('settings-languages-container').innerHTML = sortedLangs.map(lang => {
            const isActive = currentServices.languages && currentServices.languages.includes(lang.english_name) ? 'active' : '';
            return `
                <div class="pill ${isActive}" data-id="${lang.english_name}" onclick="toggleServicePill(this, 'languages')">
                    ${lang.english_name}
                </div>
            `;
        }).join('');
    } catch (e) {
        document.getElementById('settings-languages-container').innerHTML = '<p class="meta">Failed to load languages.</p>';
    }
}

function renderActiveServicePills() {
    // This handles visually updating the hardcoded Music pills on page load
    const musicPills = document.querySelectorAll('#settings-listening-container .pill');
    musicPills.forEach(pill => {
        const id = pill.getAttribute('data-id');
        if (currentServices.listening.includes(id)) {
            pill.classList.add('active');
        }
    });
}

window.moveFavorite = (type, index, direction) => {
    const list = currentFavs[type];
    // Prevent moving out of bounds
    if (index + direction < 0 || index + direction >= list.length) return;
    
    // Swap the items
    const temp = list[index];
    list[index] = list[index + direction];
    list[index + direction] = temp;
    
    // Sync changes and re-render
    updateTopAll();
    renderFavManager();
};

window.toggleServicePill = function(element, category) {
    const id = String(element.getAttribute('data-id'));
    
    if (currentServices[category].includes(id)) {
        currentServices[category] = currentServices[category].filter(val => val !== id);
        element.classList.remove('active');
    } else {
        currentServices[category].push(id);
        element.classList.add('active');
    }
};

// Update Profile
async function saveAllProfileData() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Session lost. Please log in again.");

    // 1. Get values from the UI
    const nameValue = document.getElementById('edit-name').value;
    const usernameValue = document.getElementById('edit-username').value;
    const avatarValue = document.getElementById('edit-avatar').value;
    const bannerValue = document.getElementById('edit-banner').value;
    const bioValue = document.getElementById('edit-bio').value;
    const websiteValue = document.getElementById('edit-website').value;
    
    const instagramVal = document.getElementById('edit-instagram').value.trim();
    const snapchatVal = document.getElementById('edit-snapchat').value.trim();
    const tiktokVal = document.getElementById('edit-tiktok').value.trim();
    let youtubeVal = document.getElementById('edit-youtube').value.trim();
    const githubVal = document.getElementById('edit-github').value.trim();

    if (youtubeVal && !youtubeVal.startsWith('@')) youtubeVal = '@' + youtubeVal;

    const showActive = document.getElementById('toggle-active-status')?.checked ?? true;
    const showPaused = document.getElementById('toggle-paused-status')?.checked ?? true;
    const showFandoms = document.getElementById('toggle-fandoms-status')?.checked ?? false;
    const showCharacters = document.getElementById('toggle-characters-status')?.checked ?? false;

    // 2. Update Auth Metadata (Keep this for session consistency)
    const { error: authError } = await supabaseClient.auth.updateUser({
        data: { 
            display_name: nameValue, 
            username: usernameValue,
            avatar_url: avatarValue,
            banner_url: bannerValue
        }
    });

    // 3. Update Profiles Table
    const { error: profileError } = await supabaseClient
        .from('profiles')
        .update({
            display_name: nameValue,  
            username: usernameValue,  
            avatar_url: avatarValue,  
            banner_url: bannerValue,  
            bio: bioValue,
            website_url: websiteValue,
            instagram: instagramVal,
            snapchat: snapchatVal,
            tiktok: tiktokVal,
            youtube: youtubeVal,
            github: githubVal,
            favorites: currentFavs,
            services: currentServices,
            show_active_status: showActive,
            show_paused_dropped_status: showPaused,
            show_fandoms: showFandoms,
            show_characters: showCharacters
        })
        .eq('id', user.id);

    if (authError || profileError) {
        alert("Error: " + (authError?.message || profileError?.message));
    } else {
        alert("Changes saved successfully!");
        window.location.reload();
    }
}

function addFavorite(item) {
    if (!currentFavs[item.type]) {
        currentFavs[item.type] = [];
    }

    if (currentFavs[item.type].length >= 5) {
        return alert("You can only have 5 favorites per category!");
    }
    
    currentFavs[item.type].push(item);
    updateTopAll(); // Syncs the #1s to the 'all' list
    renderFavManager(); // Refresh the UI
}

function updateTopAll() {
    const topMovie = currentFavs.movie?.[0];
    const topTv = currentFavs.tv?.[0];
    const topBook = currentFavs.book?.[0];
    const topAlbum = currentFavs.album?.[0];
    const topYoutube = currentFavs.youtube?.[0];
    
    currentFavs.all = [topMovie, topTv, topBook, topAlbum, topYoutube].filter(Boolean);
}

async function getExportTitle(id, type) {
    if (!id) return "Unknown Title";
    const cacheKey = `${type}_${id}`;
    if (exportTitleCache.has(cacheKey)) return exportTitleCache.get(cacheKey);

    let title = "Unknown Title";
    try {
        const options = { headers: { Authorization: `Bearer ${tmdbToken}` } };
        
        if (type === 'movie') {
            const res = await fetch(`https://api.themoviedb.org/3/movie/${id}`, options).then(r=>r.json());
            title = res.title || title;
        } else if (type === 'tv') {
            const res = await fetch(`https://api.themoviedb.org/3/tv/${id}`, options).then(r=>r.json());
            title = res.name || title;
        } else if (type === 'book') {
            const formattedId = id.startsWith('/') ? id : `/works/${id}`;
            const res = await fetch(`https://openlibrary.org${formattedId}.json`).then(r=>r.json());
            title = res.title || title;
        } else if (type === 'album') {
            const parts = decodeURIComponent(id).split('|||');
            title = parts[1] || parts[0] || title;
        } else if (type === 'youtube') {
            const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`).then(r=>r.json());
            title = res.title || title;
        }
    } catch(e) {
        console.warn(`Could not resolve title for ${type} ${id}`);
    }
    
    exportTitleCache.set(cacheKey, title);
    // 50ms buffer to respect API rate limits during bulk exports
    await new Promise(r => setTimeout(r, 50)); 
    return title;
}

// --- ORCHESTRATOR ---
async function startFullAccountExport(user, rangeType, startDate, endDate, typeFilter) {
    const statusDiv = document.getElementById('export-status');
    const progressBar = document.getElementById('export-progress-bar');
    const progressText = document.getElementById('export-text');
    const logList = document.getElementById('export-log-list');
    const logContainer = document.getElementById('export-log-container');

    statusDiv.style.display = 'block';
    logContainer.style.display = 'block';
    logList.innerHTML = '';
    
    const zip = new JSZip();
    
    progressText.textContent = "Fetching custom images & maps...";
    const { data: customs } = await supabaseClient.from('custom_imgs').select('*').eq('user_id', user.id);
    const customImgMap = new Map();
    (customs || []).forEach(c => customImgMap.set(`${c.media_type}_${c.media_id}`, { poster: c.custom_poster, bg: c.custom_background }));

    const rangeFilters = { type: rangeType, start: startDate, end: endDate };

    // --- Build a real step-by-step progress tracker ---
    // Each media type contributes 4 discrete units of work inside
    // generateMediaData (Diary, Watchlist, Statuses) + generateListFiles (Lists).
    const selectedTypes = typeFilter === 'all'
        ? ['movie', 'tv', 'book', 'album', 'youtube']
        : [typeFilter];
    const STEPS_PER_TYPE = 4;
    const totalSteps =
        1 +                                  // fetching custom images/maps (already done above, counted for smoothness)
        1 +                                  // account settings
        1 +                                  // list details
        (selectedTypes.length * STEPS_PER_TYPE) +
        1 +                                  // zipping
        1;                                   // finalizing download

    let completedSteps = 1; // the custom image/map fetch above already happened
    const progress = {
        step(label) {
            completedSteps++;
            const pct = Math.min(100, Math.round((completedSteps / totalSteps) * 100));
            progressText.textContent = label;
            progressBar.style.width = `${pct}%`;
        },
        set(pct, label) {
            progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
            if (label) progressText.textContent = label;
        }
    };
    // Reflect the already-completed image/map fetch on the bar immediately.
    progressBar.style.width = `${Math.round((completedSteps / totalSteps) * 100)}%`;

    try {
        // 1. Account Settings & Details
        await exportAccountSettings(zip, user, customImgMap);
        progress.step("Exported Account Settings...");

        await exportListDetails(zip, user);
        progress.step("Exported List Details...");

        // 2. Media Specific Exports based on filters
        if (typeFilter === 'all' || typeFilter === 'movie') {
            await exportMovies(zip, user, rangeFilters, customImgMap, progress);
        }
        if (typeFilter === 'all' || typeFilter === 'tv') {
            await exportTV(zip, user, rangeFilters, customImgMap, progress);
        }
        if (typeFilter === 'all' || typeFilter === 'book') {
            await exportBooks(zip, user, rangeFilters, customImgMap, progress);
        }
        if (typeFilter === 'all' || typeFilter === 'album') {
            await exportMusic(zip, user, rangeFilters, customImgMap, progress);
        }
        if (typeFilter === 'all' || typeFilter === 'youtube') {
            await exportYouTube(zip, user, rangeFilters, customImgMap, progress);
        }

        const content = await zip.generateAsync({ type: "blob" }, (metadata) => {
            // JSZip reports its own internal 0-100% while compressing; blend that
            // into the remaining slice of the bar reserved for "Zipping files...".
            const zipStartPct = Math.round((completedSteps / totalSteps) * 100);
            const zipEndPct = Math.round(((completedSteps + 1) / totalSteps) * 100);
            const blended = zipStartPct + ((zipEndPct - zipStartPct) * (metadata.percent / 100));
            progress.set(blended, `Zipping files... ${Math.round(metadata.percent)}%`);
        });
        const url = URL.createObjectURL(content);

        completedSteps++; // zipping step is now fully complete
        progress.step("Finalizing download...");

        const now = new Date();
        const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${now.getFullYear()}`;
        const filename = `Catalogd_${user.user_metadata?.username || 'user'}_${dateStr}.zip`;

        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();

        progress.set(100, "Export Complete!");

    } catch (e) {
        console.error(e);
        alert("Export failed: " + e.message);
    }
}

// --- SPECIFIC EXPORT FUNCTIONS ---

async function exportAccountSettings(zip, user, customImgMap) {
    const folder = zip.folder("Account").folder("Settings");
    
    const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
    if (!profile) return;

    // Header Info
    const headerInfo = [
        ["Field", "Value"],
        ["Display Name", profile.display_name || ""],
        ["Username", profile.username || ""],
        ["Bio", profile.bio || ""],
        ["Website", profile.website_url || ""]
    ];
    folder.file("HeaderInfo.csv", convertToCSV(headerInfo));

    // Favorites
    const favsData = [["Type", "Title", "ID", "Rank", "Custom Poster", "Custom Background"]];
    if (profile.favorites) {
        for (const [type, list] of Object.entries(profile.favorites)) {
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                const custom = customImgMap.get(`${type}_${item.id}`) || { poster: "", bg: "" };
                favsData.push([type, item.title, item.id, i + 1, custom.poster, custom.bg]);
                exportTitleCache.set(`${type}_${item.id}`, item.title); // Feed the cache
            }
        }
    }
    folder.file("Favorites.csv", convertToCSV(favsData));
    addExportLog("Account Settings", "Exported profile & favorites", "success");
}

async function exportListDetails(zip, user) {
    const folder = zip.folder("Account").folder("Lists");
    const { data: lists } = await supabaseClient.from('media_lists').select('*').eq('user_id', user.id);
    
    const listCsv = [["List ID", "Name", "Description", "Is Public", "Is Ranked", "Created At"]];
    (lists || []).forEach(l => {
        listCsv.push([l.id, l.name, l.description || "", l.is_public, l.is_ranked, l.created_at]);
    });
    
    folder.file("List Details.csv", convertToCSV(listCsv));
    addExportLog("List Details", `Exported metadata for ${lists?.length || 0} lists`, "success");
}

// --- SPECIFIC EXPORT FUNCTIONS ---
async function exportMovies(zip, user, filters, customImgMap, progress) {
    console.log("[Export] Starting Movies Export...");
    try {
        const folder = zip.folder("Movies");
        
        await generateMediaData(folder, user, ['movie'], filters, customImgMap, progress, true);
        await generateListFiles(folder, user, ['movie'], customImgMap, progress);
        console.log("[Export] Movies Export Complete.");
    } catch (e) {
        console.error("[Export Error] Failed in exportMovies:", e);
        addExportLog("Movies", `Fatal error: ${e.message}`, "error");
    }
}

async function exportTV(zip, user, filters, customImgMap, progress) {
    console.log("[Export] Starting TV Export...");
    try {
        const folder = zip.folder("TV Shows");
        
        await generateMediaData(folder, user, ['tv'], filters, customImgMap, progress, true);
        await generateListFiles(folder, user, ['tv'], customImgMap, progress);
        console.log("[Export] TV Export Complete.");
    } catch (e) {
        console.error("[Export Error] Failed in exportTV:", e);
        addExportLog("TV Shows", `Fatal error: ${e.message}`, "error");
    }
}

async function exportBooks(zip, user, filters, customImgMap, progress) {
    try {
        const folder = zip.folder("Books");
        await generateMediaData(folder, user, ['book'], filters, customImgMap, progress, false);
        await generateListFiles(folder, user, ['book'], customImgMap, progress);
    } catch (e) { console.error("Books Error:", e); }
}

async function exportMusic(zip, user, filters, customImgMap, progress) {
    try {
        const folder = zip.folder("Music");
        await generateMediaData(folder, user, ['album'], filters, customImgMap, progress, false);
        await generateListFiles(folder, user, ['album'], customImgMap, progress);
    } catch (e) { console.error("Music Error:", e); }
}

async function exportYouTube(zip, user, filters, customImgMap, progress) {
    try {
        const folder = zip.folder("YouTube");
        await generateMediaData(folder, user, ['youtube'], filters, customImgMap, progress, false);
        await generateListFiles(folder, user, ['youtube'], customImgMap, progress);
    } catch (e) { console.error("YouTube Error:", e); }
}

// --- UTILITY DATA GENERATORS ---

async function generateMediaData(folder, user, typesArray, filters, customImgMap, progress, isLetterboxd) {
    const typeLabel = typesArray.join('/');
    console.log(`[Export] Generating Data for: ${typeLabel}`);
    
    try {
        // 1. DIARY
        console.log(`[Export] Fetching Diary for ${typeLabel}`);
        progress.step(`Exporting ${typeLabel} Diary...`);
        const diaryHeaders = isLetterboxd 
            ? ["tmdbID", "Title", "Year", "Rating", "WatchedDate", "Rewatch", "Tags", "Review", "Custom Poster", "Custom Background"]
            : ["ID", "Title", "Rating", "Date", "Rewatch", "Tags", "Notes", "Custom Poster", "Custom Background"];
        
        const diaryCsv = [diaryHeaders];
        let diaryQuery = supabaseClient.from('media_logs').select('*').eq('user_id', user.id).in('media_type', typesArray);
        
        if (filters.type === 'range') {
            if (filters.start) diaryQuery = diaryQuery.gte('created_at', `${filters.start}T00:00:00.000Z`);
            if (filters.end) diaryQuery = diaryQuery.lte('created_at', `${filters.end}T23:59:59.999Z`);
        }
        
        const { data: diaryLogs, error: diaryError } = await diaryQuery;
        if (diaryError) throw new Error(`Diary Query Error: ${diaryError.message}`);

        for (const log of (diaryLogs || [])) {
            console.log(`[Export] Processing Diary Log ID: ${log.id}`);
            const title = log.media_title || "Unknown Title";
            const custom = customImgMap.get(`${log.media_type}_${log.media_id}`) || { poster: "", bg: "" };
            // Every exported Diary log gets an additional "catalogd" tag appended,
            // regardless of media type (movie/tv/book/album/youtube).
            const tags = [...(log.tags || []), "catalogd"].join(', ');
            
            // Safe date fallback
            let date = log.watched_on;
            if (!date && log.created_at) date = log.created_at.split('T')[0];
            if (!date) date = ""; 
            
            if (isLetterboxd) {
                diaryCsv.push([log.media_id, title, "", log.rating || "", date, log.is_rewatch ? 'Yes' : '', tags, log.notes || "", custom.poster, custom.bg]);
            } else {
                diaryCsv.push([log.media_id, title, log.rating || "", date, log.is_rewatch ? 'Yes' : 'No', tags, log.notes || "", custom.poster, custom.bg]);
            }
        }
        folder.file("Diary.csv", convertToCSV(diaryCsv));

        // 2. WATCHLIST
        console.log(`[Export] Fetching Watchlist for ${typeLabel}`);
        progress.step(`Exporting ${typeLabel} Watchlist...`);
        const wlHeaders = isLetterboxd 
            ? ["tmdbID", "Title", "Date", "Custom Poster", "Custom Background"] 
            : ["ID", "Title", "Date Added", "Custom Poster", "Custom Background"];
        
        const wlCsv = [wlHeaders];
        const { data: wlLogs, error: wlError } = await supabaseClient.from('user_watchlist').select('*').eq('user_id', user.id).in('media_type', typesArray);
        if (wlError) throw new Error(`Watchlist Query Error: ${wlError.message}`);
        
        for (const log of (wlLogs || [])) {
            const title = log.media_title || "Unknown Title";
            const custom = customImgMap.get(`${log.media_type}_${log.media_id}`) || { poster: "", bg: "" };
            const date = log.created_at ? log.created_at.split('T')[0] : "";
            wlCsv.push([log.media_id, title, date, custom.poster, custom.bg]);
        }
        folder.file("Watchlist.csv", convertToCSV(wlCsv));

        // 3. STATUSES
        console.log(`[Export] Fetching Statuses for ${typeLabel}`);
        progress.step(`Exporting ${typeLabel} Statuses...`);
        const statHeaders = isLetterboxd 
            ? ["tmdbID", "Title", "Status", "Date", "Custom Poster", "Custom Background"] 
            : ["ID", "Title", "Status", "Last Updated", "Custom Poster", "Custom Background"];
            
        const statCsv = [statHeaders];
        const { data: statLogs, error: statError } = await supabaseClient.from('media_status').select('*').eq('user_id', user.id).in('media_type', typesArray);
        if (statError) throw new Error(`Status Query Error: ${statError.message}`);
        
        for (const log of (statLogs || [])) {
            const title = log.media_title || "Unknown Title";
            const custom = customImgMap.get(`${log.media_type}_${log.media_id}`) || { poster: "", bg: "" };
            const date = log.updated_at ? log.updated_at.split('T')[0] : "";
            statCsv.push([log.media_id, title, log.status, date, custom.poster, custom.bg]);
        }
        folder.file("Statuses.csv", convertToCSV(statCsv));

        addExportLog(typeLabel, `Core data exported`, "success");
    } catch (error) {
        console.error(`[Export Error] generateMediaData failure for ${typeLabel}:`, error);
        throw error; // Bubble up to specific export function
    }
}

async function generateListFiles(parentFolder, user, typesArray, customImgMap, progress) {
    try {
        console.log(`[Export] Processing Lists for ${typesArray}`);
        progress.step(`Processing Custom Lists for ${typesArray.join('/')}...`);
        
        const { data: lists, error: listError } = await supabaseClient.from('media_lists').select('*').eq('user_id', user.id);
        if (listError) throw new Error(`List Query Error: ${listError.message}`);
        if (!lists || lists.length === 0) return;

        const listFolder = parentFolder.folder("Lists");

        for (const list of lists) {
            const { data: items, error: itemError } = await supabaseClient
                .from('list_items')
                .select('*')
                .eq('list_id', list.id)
                .in('media_type', typesArray)
                .order('rank', { ascending: true });
            
            if (itemError) throw new Error(`List Item Query Error for List ${list.id}: ${itemError.message}`);

            if (items && items.length > 0) {
                const listCsv = [["Position", "tmdbID", "Title", "Custom Poster", "Custom Background"]];
                
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const title = await getExportTitle(item.media_id, item.media_type);
                    const custom = customImgMap.get(`${item.media_type}_${item.media_id}`) || { poster: "", bg: "" };
                    const position = list.is_ranked ? (item.rank || i + 1) : "";
                    
                    listCsv.push([position, item.media_id, title, custom.poster, custom.bg]);
                }
                
                const safeFileName = list.name.replace(/[/\\?%*:|"<>]/g, '-');
                listFolder.file(`${safeFileName}.csv`, convertToCSV(listCsv));
                addExportLog("List", `Created ${safeFileName}.csv`, "success");
            }
        }
    } catch (error) {
        console.error(`[Export Error] generateListFiles failure:`, error);
        throw error;
    }
}

// Helper to convert array to CSV string
function convertToCSV(rows) {
    return rows.map(row => 
        row.map(cell => {
            // Safely handle null, undefined, or empty values
            const stringCell = (cell === null || cell === undefined) ? "" : String(cell);
            return `"${stringCell.replace(/"/g, '""')}"`;
        }).join(",")
    ).join("\n");
}

function addExportLog(title, message, type) {
    const logList = document.getElementById('export-log-list');
    const li = document.createElement('li');
    li.style.cssText = "margin-bottom: 5px; padding-bottom: 5px; border-bottom: 1px solid #2c3440;";
    
    let color = type === 'success' ? '#3f35eb' : '#ff4d4d';
    let icon = type === 'success' ? '🎬' : '❌';

    li.innerHTML = `<span style="color: ${color}">${icon} ${title}</span>: <span style="opacity: 0.7">${message}</span>`;
    logList.prepend(li);
}

async function startImport(data, userId) {
    const statusDiv = document.getElementById('import-status');
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-text');
    const logList = document.getElementById('import-log-list');
    const shouldOverwrite = document.getElementById('overwrite-toggle').checked;
    
    statusDiv.style.display = 'block';
    document.getElementById('import-log-container').style.display = 'block';
    logList.innerHTML = '';
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    let overwriteCount = 0;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const title = row.Name || "Unknown Title";
        const progress = Math.round(((i + 1) / data.length) * 100);
        
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `Processing ${i + 1}/${data.length}: ${title}`;

        try {
            const mediaInfo = await resolveMedia(title, row.Year);
            if (!mediaInfo) {
                addImportLog(title, "Could not find on TMDB", "error");
                failCount++;
                continue;
            }

            const watchedDate = row['Watched Date'] || row.Date;
            const rowRating = parseFloat(row.Rating) || 0;

            // 1. Look for an existing match
            const { data: existing } = await supabaseClient
                .from('media_logs')
                .select('id')
                .eq('user_id', userId)
                .eq('media_id', String(mediaInfo.id))
                .eq('watched_on', watchedDate)
                .maybeSingle();

            const payload = {
                user_id: userId,
                media_id: String(mediaInfo.id),
                media_type: mediaInfo.type,
                media_title: title,
                rating: rowRating,
                watched_on: watchedDate,
                runtime: mediaInfo.runtime, // ADD THIS LINE
                is_rewatch: row.Rewatch === 'Yes',
                created_at: new Date().toISOString()
            };

            if (existing) {
                if (shouldOverwrite) {
                    // 2. Overwrite mode: Include the existing ID to trigger an update
                    payload.id = existing.id; 
                    const { error } = await supabaseClient.from('media_logs').upsert(payload);
                    if (error) throw error;
                    
                    addImportLog(title, "Updated/Overwritten", "success");
                    overwriteCount++;
                } else {
                    // 3. Skip mode
                    addImportLog(title, "Already in Catalogd (Skipped)", "warning");
                    skipCount++;
                    continue;
                }
            } else {
                // 4. New entry
                const { error } = await supabaseClient.from('media_logs').insert(payload);
                if (error) throw error;
                successCount++;
            }

        } catch (err) {
            console.error(err);
            addImportLog(title, "Database error", "error");
            failCount++;
        }

        await new Promise(r => setTimeout(r, 200)); 
    }

    progressText.textContent = `Import Complete!`;
    alert(`Finished!\nNew: ${successCount}\nOverwritten: ${overwriteCount}\nSkipped: ${skipCount}\nFailed: ${failCount}`);
}

document.getElementById('start-lastfm-sync-btn').onclick = async () => {
    const username = document.getElementById('lastfm-username-input').value.trim();
    const syncType = document.getElementById('lastfm-sync-type').value;
    const limit = document.getElementById('lastfm-sync-limit').value;
    
    if (!username) return alert("Please enter a Last.fm username.");

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Session lost. Please log in again.");

    await supabaseClient.from('profiles').update({ lastfm_username: username }).eq('id', user.id);

    const statusDiv = document.getElementById('import-status');
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-text');
    const logList = document.getElementById('import-log-list');
    
    statusDiv.style.display = 'block';
    document.getElementById('import-log-container').style.display = 'block';
    logList.innerHTML = '';
    progressBar.style.width = '10%';
    progressText.textContent = `Fetching data from Last.fm for @${username}...`;

    try {
        let url = '';
        if (syncType === 'top') {
            url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(username)}&api_key=${lastfmKey}&format=json&limit=${limit}`;
        } else {
            url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${lastfmKey}&format=json&limit=${limit}`;
        }

        const res = await fetch(url).then(r => r.json());
        if (res.error) throw new Error(res.message);

        let itemsToProcess = [];

        // 1. Parse based on type
        if (syncType === 'top' && res.topalbums && res.topalbums.album) {
            itemsToProcess = res.topalbums.album.map(a => ({
                artist: a.artist.name,
                name: a.name, // Album Name
                image: a.image?.[3]?.['#text'] || '',
                isTrack: false
            }));
        } else if (syncType === 'recent' && res.recenttracks && res.recenttracks.track) {
            // Map directly to individual tracks!
            const rawTracks = res.recenttracks.track.slice(0, parseInt(limit));
            
            rawTracks.forEach(t => {
                const albumName = t.album['#text'];
                const artistName = t.artist['#text'];
                const trackName = t.name;
                
                // Catalogd requires an album to group the track under. 
                // If Last.fm doesn't have an album for the scrobble, we must skip it.
                if (albumName) {
                    itemsToProcess.push({
                        isTrack: true,
                        trackName: trackName,
                        artist: artistName,
                        name: albumName, 
                        image: t.image?.[3]?.['#text'] || ''
                    });
                }
            });
        }

        if (itemsToProcess.length === 0) {
            progressText.textContent = "No valid data found.";
            return progressBar.style.width = '100%';
        }

        progressText.textContent = "Data fetched! Opening review modal...";
        progressBar.style.width = '100%';

        const listContainer = document.getElementById('bulk-log-list');
        listContainer.innerHTML = ''; 

        // 2. Generate the UI Modal
        itemsToProcess.forEach((item, index) => {
            const rawId = `${item.artist}|||${item.name}`;
            const displayName = item.isTrack ? item.trackName : item.name;
            const displaySub = item.isTrack ? `${item.artist} (from ${item.name})` : item.artist;
            
            listContainer.innerHTML += `
                <div class="bulk-log-item" data-id="${rawId}" data-image="${item.image}" data-istrack="${item.isTrack}" data-trackname="${encodeURIComponent(item.trackName || '')}" data-artist="${encodeURIComponent(item.artist)}" data-album="${encodeURIComponent(item.name)}" style="display: flex; align-items: center; gap: 15px; padding: 15px; border-bottom: 1px solid #2c3440;">
                    
                    <input type="checkbox" class="bulk-import-checkbox" checked style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--accent);">
                    
                    <img src="${item.image || 'https://via.placeholder.com/50'}" style="width: 50px; height: 50px; border-radius: 4px; object-fit: cover;">
                    <div style="flex-grow: 1;">
                        <div style="font-weight: bold;">${displayName}</div>
                        <div style="font-size: 0.8rem; color: #9ab;">${displaySub}</div>
                    </div>
                    
                    <div class="mini-star-rater" data-index="${index}" style="display: flex; cursor: pointer; color: #2c3440;">
                        <span class="bulk-star" data-val="1">★</span>
                        <span class="bulk-star" data-val="2">★</span>
                        <span class="bulk-star" data-val="3">★</span>
                        <span class="bulk-star" data-val="4">★</span>
                        <span class="bulk-star" data-val="5">★</span>
                    </div>
                    
                    <button class="bulk-like-btn action-btn-icon" data-index="${index}" style="padding: 5px 10px;">
                        <span class="heart-icon">❤</span>
                    </button>
                </div>
            `;
        });

        setTimeout(() => {
            statusDiv.style.display = 'none';
            document.getElementById('import-log-container').style.display = 'none';
        }, 1000);

        document.getElementById('bulk-log-modal').style.display = 'flex';
        setupBulkInteractions(itemsToProcess);

    } catch (err) {
        console.error(err);
        progressText.textContent = "Error during sync.";
        alert("Failed to sync Last.fm: " + err.message);
    }
};

document.getElementById('save-bulk-logs-btn').onclick = async () => {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const items = document.querySelectorAll('.bulk-log-item');
    const today = new Date().toISOString().split('T')[0];
    const btn = document.getElementById('save-bulk-logs-btn');

    btn.textContent = "Saving... (This may take a moment)";
    btn.disabled = true;
    
    let successCount = 0;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // NEW: Check if this item is selected. If not, skip it!
        const checkbox = item.querySelector('.bulk-import-checkbox');
        if (!checkbox || !checkbox.checked) continue;

        const compositeId = item.dataset.id; 
        const image = item.dataset.image;
        const isTrack = item.dataset.istrack === "true";
        
        const trackName = decodeURIComponent(item.dataset.trackname);
        const artist = decodeURIComponent(item.dataset.artist);
        const album = decodeURIComponent(item.dataset.album);
        
        const rating = window.bulkRatings[i];
        const isLiked = window.bulkLikes[i];

        let payload = {
            user_id: user.id,
            media_id: compositeId,
            media_type: 'album',
            media_title: isTrack ? trackName : album,
            rating: rating,
            is_liked: isLiked,
            image_url: image,
            watched_on: today,
            created_at: new Date().toISOString()
        };

        if (isTrack) {
            try {
                const albumRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${lastfmKey}&format=json`).then(r => r.json());
                
                if (albumRes.album && albumRes.album.tracks && albumRes.album.tracks.track) {
                    const trackList = Array.isArray(albumRes.album.tracks.track) ? albumRes.album.tracks.track : [albumRes.album.tracks.track];
                    const safeTrackName = trackName.toLowerCase().trim();
                    
                    let foundIndex = trackList.findIndex(tr => tr.name.toLowerCase().trim() === safeTrackName);
                    
                    if (foundIndex === -1) {
                        foundIndex = trackList.findIndex(tr => 
                            tr.name.toLowerCase().includes(safeTrackName) || 
                            safeTrackName.includes(tr.name.toLowerCase())
                        );
                    }
                    
                    if (foundIndex !== -1) {
                        payload.episode_number = foundIndex + 1; 
                    } else {
                        console.warn(`Could not map track number for: ${trackName}`);
                    }
                }
            } catch (e) {
                console.error("Could not fetch track index for", trackName);
            }
        }

        const { error } = await supabaseClient.from('media_logs').insert(payload); 
        if (!error) successCount++;
    }

    alert(`Saved ${successCount} logs to your diary!`);
    document.getElementById('bulk-log-modal').style.display = 'none';
    btn.textContent = "Save All to Diary";
    btn.disabled = false;
};

function setupBulkInteractions(albumsArray) {
    window.bulkRatings = new Array(albumsArray.length).fill(0);
    window.bulkLikes = new Array(albumsArray.length).fill(false);

    // 1. Setup Stars (With Half-Star Visuals)
    document.querySelectorAll('.mini-star-rater').forEach(rater => {
        const index = rater.dataset.index;
        const stars = rater.querySelectorAll('.bulk-star');
        
        stars.forEach(star => {
            star.onclick = (e) => {
                const rect = star.getBoundingClientRect();
                const isLeftHalf = (e.clientX - rect.left) < (rect.width / 2);
                const val = parseInt(star.dataset.val);
                
                const rating = isLeftHalf ? val - 0.5 : val;
                window.bulkRatings[index] = rating;

                // Visually update the stars
                stars.forEach(s => {
                    const sVal = parseInt(s.dataset.val);
                    
                    // Reset all styles first
                    s.style.color = '#2c3440';
                    s.style.background = 'none';
                    s.style.webkitBackgroundClip = 'initial';
                    s.style.webkitTextFillColor = 'initial';

                    if (sVal <= rating) {
                        // Full Star
                        s.style.color = 'var(--accent)';
                    } else if (sVal - 0.5 === rating) {
                        // Half Star (using CSS gradient text clipping)
                        s.style.background = 'linear-gradient(90deg, var(--accent) 50%, #2c3440 50%)';
                        s.style.webkitBackgroundClip = 'text';
                        s.style.webkitTextFillColor = 'transparent';
                    }
                });
            };
        });
    });

    // 2. Setup Likes
    document.querySelectorAll('.bulk-like-btn').forEach(btn => {
        const index = btn.dataset.index;
        btn.onclick = () => {
            window.bulkLikes[index] = !window.bulkLikes[index];
            btn.classList.toggle('active', window.bulkLikes[index]);
            btn.style.color = window.bulkLikes[index] ? '#ff4d4d' : '';
        };
    });

    // 3. Setup Toggle All Button
    const toggleBtn = document.getElementById('bulk-toggle-all-btn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            const checkboxes = document.querySelectorAll('.bulk-import-checkbox');
            const isDeselecting = toggleBtn.textContent === "Deselect All";
            
            checkboxes.forEach(cb => cb.checked = !isDeselecting);
            toggleBtn.textContent = isDeselecting ? "Select All" : "Deselect All";
        };
    }
}

document.getElementById('cancel-bulk-log').onclick = () => {
    document.getElementById('bulk-log-modal').style.display = 'none';
};

// Updated Helper for green "Success" logs
function addImportLog(title, message, type) {
    const logList = document.getElementById('import-log-list');
    const li = document.createElement('li');
    li.style.cssText = "margin-bottom: 5px; padding-bottom: 5px; border-bottom: 1px solid #2c3440;";
    
    let color = '#ffb347'; // Default Orange
    let icon = '⏭️';

    if (type === 'error') {
        color = '#ff4d4d'; // Red
        icon = '❌';
    } else if (type === 'success') {
        color = '#4CAF50'; // Green
        icon = '✅';
    }

    li.innerHTML = `<span style="color: ${color}">${icon} ${title}</span>: <span style="opacity: 0.7">${message}</span>`;
    logList.prepend(li);
}

// Add this to your scriptingSettings.js
window.handleAdvancedImport = async (type) => {
    const fileInput = document.getElementById(`import-${type}-input`);
    const file = fileInput.files[0];
    if (!file) return alert(`Please select the ${type} CSV file.`);

    const { data: { user } } = await supabaseClient.auth.getUser();

    Papa.parse(file, {
        header: false, // Set to false first to handle the Letterboxd metadata rows
        skipEmptyLines: true,
        complete: (results) => {
            if (type === 'list') {
                processListData(results.data, user.id);
            } else {
                // For other types, convert back to header-based format or adjust processAdvancedData
                const headers = results.data[0];
                const rows = results.data.slice(1).map(row => {
                    let obj = {};
                    headers.forEach((h, i) => obj[h] = row[i]);
                    return obj;
                });
                processAdvancedData(type, rows, user.id);
            }
        }
    });
};

async function processAdvancedData(importType, data, userId) {
    const statusDiv = document.getElementById('import-status');
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-text');
    const logList = document.getElementById('import-log-list');

    statusDiv.style.display = 'block';
    document.getElementById('import-log-container').style.display = 'block';
    logList.innerHTML = '';

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const title = row.Name || "Unknown";
        const progress = Math.round(((i + 1) / data.length) * 100);
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `Syncing ${importType}: ${title}`;

        try {
            const mediaInfo = await resolveMedia(title, row.Year);
            if (!mediaInfo) {
                addImportLog(title, "Not found on TMDB", "error");
                failCount++;
                continue;
            }

            if (importType === 'watchlist') {
                // WATCHLIST: Insert into user_watchlist table
                const { error } = await supabaseClient.from('user_watchlist').upsert({
                    user_id: userId,
                    media_id: String(mediaInfo.id),
                    media_type: mediaInfo.type,
                    media_title: title
                }, { onConflict: 'user_id, media_id, media_type' }); // Prevents duplicates if constraint exists

                if (error) throw error;
                addImportLog(title, "Added to Watchlist", "success");
            } 
            else {
                // REVIEWS or LIKES: Update existing logs in media_logs
                const { data: existingLogs } = await supabaseClient
                    .from('media_logs')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('media_id', String(mediaInfo.id));

                if (!existingLogs || existingLogs.length === 0) {
                    addImportLog(title, "No existing diary log found to update", "warning");
                    failCount++;
                } else {
                    for (const log of existingLogs) {
                        let updateData = {};
                        if (importType === 'reviews') updateData.notes = row.Review;
                        if (importType === 'likes') updateData.is_liked = true;

                        await supabaseClient.from('media_logs').update(updateData).eq('id', log.id);
                    }
                    addImportLog(title, `Updated ${importType}`, "success");
                }
            }
            successCount++;
        } catch (err) {
            console.error(err);
            failCount++;
        }
        await new Promise(r => setTimeout(r, 150));
    }

    progressText.textContent = `${importType} sync complete!`;
    alert(`Import Finished!\nSuccess: ${successCount}\nFailed/Skipped: ${failCount}`);
}

async function processListData(rawData, userId) {
    const statusDiv = document.getElementById('import-status');
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-text');
    const logList = document.getElementById('import-log-list');

    statusDiv.style.display = 'block';
    document.getElementById('import-log-container').style.display = 'block';
    logList.innerHTML = '';

    // 1. Extract List Metadata (Letterboxd format)
    // Row 0 is often "Letterboxd list export v7"
    // Row 1 is "Date, Name, Tags, URL, Description"
    // Row 2 is the actual values for the list itself
    const listName = rawData[2][1] || "Imported List";
    const listDescription = rawData[2][4] || "";

    // 2. Find where the actual movie data starts (usually after "Position, Name, Year...")
    const headerRowIndex = rawData.findIndex(row => row.includes("Position") && row.includes("Name"));
    if (headerRowIndex === -1) return alert("Could not find movie data in CSV.");

    const movieRows = rawData.slice(headerRowIndex + 1);

    try {
        progressText.textContent = `Creating list: ${listName}...`;
        
        // 3. Create the List in media_lists
        const { data: newList, error: listError } = await supabaseClient
            .from('media_lists')
            .insert({
                user_id: userId,
                name: listName,
                description: listDescription,
                is_public: true
            })
            .select()
            .single();

        if (listError) throw listError;

        let successCount = 0;

        // 4. Process each movie
        for (let i = 0; i < movieRows.length; i++) {
            const row = movieRows[i];
            const title = row[1]; // Index 1 is 'Name'
            const year = row[2];  // Index 2 is 'Year'

            const progress = Math.round(((i + 1) / movieRows.length) * 100);
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `Adding to ${listName}: ${title}`;

            const mediaInfo = await resolveMedia(title, year);
            if (mediaInfo) {
                const { error: itemError } = await supabaseClient
                    .from('list_items')
                    .insert({
                        list_id: newList.id,
                        media_id: String(mediaInfo.id),
                        media_type: mediaInfo.type,
                        media_title: title
                    });

                if (!itemError) {
                    addImportLog(title, "Added to list", "success");
                    successCount++;
                } else {
                    addImportLog(title, "Error adding to list", "error");
                }
            } else {
                addImportLog(title, "Not found on TMDB", "error");
            }
            // Small delay to respect TMDB rate limits
            await new Promise(r => setTimeout(r, 150));
        }

        progressText.textContent = "List import complete!";
        alert(`Imported "${listName}" with ${successCount} items.`);

    } catch (err) {
        console.error(err);
        alert("Failed to create list: " + err.message);
    }
}

async function resolveMedia(title, year) {
    if (!title) return null;
    
    const query = encodeURIComponent(title);
    const movieUrl = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${year || ''}`;
    
    try {
        const res = await fetch(movieUrl, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        if (res.results && res.results.length > 0) {
            const movieId = res.results[0].id;
            // Fetch full details to get the runtime
            const detailUrl = `https://api.themoviedb.org/3/movie/${movieId}?api_key=`; // Bearer token in headers works better
            const details = await fetch(`https://api.themoviedb.org/3/movie/${movieId}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            return { 
                id: movieId, 
                type: 'movie', 
                runtime: details.runtime || 0 // Movies use .runtime
            };
        }
        
        // Fallback for TV
        const tvUrl = `https://api.themoviedb.org/3/search/tv?query=${query}&first_air_date_year=${year || ''}`;
        const tvRes = await fetch(tvUrl, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        if (tvRes.results && tvRes.results.length > 0) {
            const tvId = tvRes.results[0].id;
            const details = await fetch(`https://api.themoviedb.org/3/tv/${tvId}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());

            return { 
                id: tvId, 
                type: 'tv', 
                // TV shows use episode_run_time (an array)
                runtime: details.episode_run_time ? details.episode_run_time[0] : 0 
            };
        }
    } catch (e) {
        console.error("TMDB Resolve Error:", e);
        return null;
    }
    return null;
}

// --- Favorites Search Logic ---
function setupFavoritesSearch() {
    const favSearchInput = document.getElementById('fav-search-input');
    const favSearchResults = document.getElementById('fav-search-results');

    // Debounce variable to prevent rapid-fire API calls
    let timeout = null;

    favSearchInput.oninput = () => {
        clearTimeout(timeout);
        const query = favSearchInput.value.trim();
        
        if (query.length < 3) {
            favSearchResults.innerHTML = '';
            favSearchResults.style.display = 'none';
            return;
        }

        // --- NEW YOUTUBE URL DETECTION ---
        const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        const ytMatch = query.match(ytRegex);

        if (ytMatch && ytMatch[1]) {
            const ytId = ytMatch[1];
            fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytId}`).then(r => r.json()).then(res => {
                if (!res.error) {
                    favSearchResults.innerHTML = '';
                    favSearchResults.style.display = 'block';
                    
                    const div = document.createElement('div');
                    div.className = 'search-item-dropdown';
                    div.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 10px; cursor: pointer; border-bottom: 1px solid #2c3440;`;
                    div.innerHTML = `
                        <img src="${res.thumbnail_url}" style="width: 40px; height: 60px; object-fit: cover; border-radius: 4px;">
                        <div style="flex: 1;">
                            <strong style="font-size: 1rem;">${res.title}</strong>
                            <div style="font-size: 0.75rem; color: #9ab;">YOUTUBE</div>
                        </div>
                    `;
                    div.onclick = () => {
                        addFavorite({ id: ytId, title: res.title, type: 'youtube', image: res.thumbnail_url });
                        favSearchResults.innerHTML = ''; favSearchInput.value = '';
                    };
                    favSearchResults.appendChild(div);
                }
            });
            return; // Stop here so it doesn't try to search TMDB for a URL
        }

        timeout = setTimeout(async () => {
            const options = { headers: { Authorization: `Bearer ${tmdbToken}` } };

            try {
                // Fetch everything in parallel
                const [movieRes, tvRes, bookRes, albumRes] = await Promise.all([
                    fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`, options).then(r => r.json()),
                    fetch(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}`, options).then(r => r.json()),
                    fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`).then(r => r.json()),
                    fetch(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(query)}&api_key=${lastfmKey}&format=json`).then(r => r.json()).catch(() => null)
                ]);

                // Clear UI once before rendering new results
                favSearchResults.innerHTML = '';
                favSearchResults.style.display = 'block';

                const seenIds = new Set();

                const createSearchRow = (title, year, type, imageUrl, subtitle, clickAction) => {
                    const div = document.createElement('div');
                    div.className = 'search-item-dropdown';
                    div.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 10px; cursor: pointer; border-bottom: 1px solid #2c3440;`;
                    div.innerHTML = `
                        <img src="${imageUrl}" style="width: 40px; height: 60px; object-fit: cover; border-radius: 4px; background: #1a1d23;" alt="cover">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: baseline; gap: 6px;">
                                <strong style="font-size: 1rem;">${title}${year}</strong>
                                <span style="opacity:0.5; font-size: 0.7rem; text-transform: uppercase;">— ${type}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #9ab; margin-top: 2px;">${subtitle}</div>
                        </div>
                    `;
                    div.onclick = clickAction;
                    return div;
                };

                // --- MOVIES ---
                for (const item of movieRes.results.slice(0, 5)) {
                    if (seenIds.has(item.id)) continue;
                    seenIds.add(item.id);

                    const year = item.release_date ? ` (${item.release_date.split('-')[0]})` : "";
                    const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Image';
                    
                    // Note: We'll skip director fetch here for speed unless specifically needed
                    // Use item.overview or "Movie" as subtitle to prevent lag in search dropdown
                    favSearchResults.appendChild(createSearchRow(item.title, year, 'movie', img, "Movie", () => {
                        addFavorite({ id: item.id, title: `${item.title}${year}`, type: 'movie', image: img.replace('w92', 'w500') });
                        favSearchResults.innerHTML = ''; favSearchInput.value = '';
                    }));
                }

                // --- TV ---
                for (const item of tvRes.results.slice(0, 5)) {
                    if (seenIds.has(item.id)) continue;
                    seenIds.add(item.id);

                    const year = item.first_air_date ? ` (${item.first_air_date.split('-')[0]})` : "";
                    const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Image';
                    
                    favSearchResults.appendChild(createSearchRow(item.name, year, 'tv', img, "TV Show", () => {
                        addFavorite({ id: item.id, title: `${item.name}${year}`, type: 'tv', image: img.replace('w92', 'w500') });
                        favSearchResults.innerHTML = ''; favSearchInput.value = '';
                    }));
                }

                // --- BOOKS ---
                bookRes.docs.forEach(book => {
                    if (seenIds.has(book.key)) return;
                    seenIds.add(book.key);

                    const year = book.first_publish_year ? ` (${book.first_publish_year})` : "";
                    const img = book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : 'https://via.placeholder.com/92x138?text=No+Cover';
                    const author = book.author_name ? book.author_name[0] : "Unknown Author";

                    favSearchResults.appendChild(createSearchRow(book.title, year, 'book', img, author, () => {
                        addFavorite({ id: book.key, title: `${book.title}${year}`, type: 'book', image: img });
                        favSearchResults.innerHTML = ''; favSearchInput.value = '';
                    }));
                });

                // --- ALBUMS ---
                if (albumRes?.results?.albummatches?.album) {
                    for (const a of albumRes.results.albummatches.album.slice(0, 5)) {
                        const compositeId = encodeURIComponent(`${a.artist}|||${a.name}`);
                        if (seenIds.has(compositeId)) continue;
                        seenIds.add(compositeId);

                        const img = a.image && a.image[2]['#text'] ? a.image[2]['#text'] : `https://placehold.co/92x138/1b2228/eb3486?text=Music`;
                        
                        favSearchResults.appendChild(createSearchRow(a.name, "", 'album', img, a.artist, () => {
                            addFavorite({ id: compositeId, title: a.name, type: 'album', image: img.replace('92x138', '500x500') });
                            favSearchResults.innerHTML = ''; favSearchInput.value = '';
                        }));
                    }
                }

            } catch (error) {                console.error("Search error:", error);
            }
        }, 300); // 300ms delay protects against "double typing" bugs
    };
}

// --- Render the Favorites Manager in Settings ---
function renderFavManager() {
    const container = document.getElementById('favorites-manager');
    container.innerHTML = ''; // Clear existing

    // Reordered: 'album' before 'youtube'
    const categories = ['movie', 'tv', 'book', 'album', 'youtube']; 
    
    categories.forEach(cat => {
        const section = document.createElement('div');
        section.className = 'fav-category-admin';
        section.style.marginBottom = '20px';
        
        let label = "";
        if (cat === 'youtube') label = "YouTube Videos";
        else if (cat === 'tv') label = "TV Shows";
        else if (cat === 'album') label = "Music Albums"; 
        else label = cat.charAt(0).toUpperCase() + cat.slice(1) + 's';
        
        section.innerHTML = `<h4 style="color: #9ab; margin-bottom: 10px;">Top 5 ${label}</h4>`;
        
        const list = currentFavs[cat] || [];
        
        const itemContainer = document.createElement('div');
        itemContainer.style.display = 'flex';
        itemContainer.style.gap = '10px';
        itemContainer.style.flexWrap = 'wrap';

        list.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            // Added data-id and a grab handle for SortableJS
            itemDiv.style.cssText = "background: #14181c; padding: 5px 10px; border-radius: 6px; display: flex; align-items: center; gap: 8px; border: 1px solid #2c3440;";
            itemDiv.innerHTML = `
                <span class="drag-handle" style="cursor: grab; color: #678; margin-right: 5px;" title="Drag to reorder">☰</span>
                <span class="fav-rank" style="color: var(--accent); font-weight: bold;">#${index + 1}</span>
                <span style="font-size: 0.9rem;">${item.title}</span>
                <span onclick="removeFavorite('${cat}', ${index})" style="cursor: pointer; color: #ff4d4d; font-weight: bold; margin-left: auto;">×</span>
            `;
            itemContainer.appendChild(itemDiv);
        });

        if (list.length === 0) {
            itemContainer.innerHTML = `<p style="font-size: 0.8rem; opacity: 0.5;">No ${cat}s added yet.</p>`;
        }

        section.appendChild(itemContainer);
        container.appendChild(section);

        // Initialize SortableJS on the container if there are items to sort
        if (list.length > 0) {
            new Sortable(itemContainer, {
                animation: 150,
                handle: '.drag-handle', // Only allow dragging from the hamburger icon
                onEnd: (evt) => {
                    // Update the underlying data array to match the new DOM order
                    const movedItem = currentFavs[cat].splice(evt.oldIndex, 1)[0];
                    currentFavs[cat].splice(evt.newIndex, 0, movedItem);
                    
                    // Visually update the #1, #2, #3 text without needing a full re-render
                    itemContainer.querySelectorAll('.fav-rank').forEach((el, i) => {
                        el.textContent = `#${i + 1}`;
                    });
                    
                    updateTopAll();
                }
            });
        }
    });
}

// --- Helper to Remove Favorites ---
window.removeFavorite = (type, index) => {
    currentFavs[type].splice(index, 1);
    updateTopAll();
    renderFavManager();
};

initSettings();