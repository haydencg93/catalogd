let TMDB_TOKEN = '';
let supabaseClient = null;
let configData = null;
let userStreamingProviderIds = [];
let currentUser = null;

// UI Elements
const mediaTypeSelect = document.getElementById('media-type-select');
const sourceSelect = document.getElementById('source-select');
const listSelectGroup = document.getElementById('list-select-group');
const specificListSelect = document.getElementById('specific-list-select');
const servicesCheck = document.getElementById('services-filter-check');
const rollBtn = document.getElementById('roll-btn');
const loader = document.getElementById('loader');
const errorMsg = document.getElementById('error-message');
const resultContainer = document.getElementById('result-container');

// Result Elements
const winPoster = document.getElementById('winner-poster');
const winTitle = document.getElementById('winner-title');
const winYear = document.getElementById('winner-year');
const winGenres = document.getElementById('winner-genres');
const winProviders = document.getElementById('winner-providers');
const rerollBtn = document.getElementById('reroll-btn');
const watchBtn = document.getElementById('watch-btn');

let currentWinnerMediaId = null;

async function initPicker() {
    try {
        const response = await fetch('config.json');
        configData = await response.json();
        TMDB_TOKEN = configData.tmdb_token;
        supabaseClient = supabase.createClient(configData.supabase_url, configData.supabase_key);

        await setupHeaderAndUser();

        // Listeners
        sourceSelect.addEventListener('change', handleSourceChange);
        mediaTypeSelect.addEventListener('change', handleSourceChange);
        rollBtn.addEventListener('click', () => pickRandom());
        rerollBtn.addEventListener('click', () => pickRandom());
        watchBtn.addEventListener('click', markAsWatching);

    } catch (err) {
        console.error("Initialization Error:", err);
    }
}

async function setupHeaderAndUser() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const loginBtn = document.getElementById('login-btn');
    const profileMenu = document.getElementById('profile-menu');
    
    if (user) {
        currentUser = user;
        loginBtn.style.display = 'none'; 
        profileMenu.style.display = 'inline-block';
        if (user.user_metadata?.avatar_url) {
            document.getElementById('nav-avatar').src = user.user_metadata.avatar_url;
        }

        // Fetch streaming services
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('services')
            .eq('id', user.id)
            .single();

        if (profile && profile.services && profile.services.streaming) {
            userStreamingProviderIds = profile.services.streaming.map(String);
        }
    } else {
        loginBtn.style.display = 'inline-block';
        profileMenu.style.display = 'none';
        loginBtn.onclick = () => window.location.href = 'index.html'; 
    }
}

// Logic to show/hide the specific lists dropdown
async function handleSourceChange() {
    if (sourceSelect.value === 'list') {
        if (!currentUser) {
            alert("You must be signed in to pick from your lists.");
            sourceSelect.value = 'taste';
            return;
        }
        
        listSelectGroup.style.display = 'block';
        const type = mediaTypeSelect.value;
        specificListSelect.innerHTML = '<option>Loading lists...</option>';

        // Fetch all lists the user owns or collaborates on
        const { data: owned } = await supabaseClient.from('media_lists').select('id, name').eq('user_id', currentUser.id);
        const { data: collabs } = await supabaseClient.from('list_collaborators').select('list_id, media_lists(id, name)').eq('user_id', currentUser.id);
        
        const listMap = new Map();
        (owned || []).forEach(l => listMap.set(l.id, l));
        (collabs || []).forEach(c => { if(c.media_lists) listMap.set(c.media_lists.id, c.media_lists); });
        
        const allLists = Array.from(listMap.values());

        if (allLists.length === 0) {
            specificListSelect.innerHTML = '<option value="">No lists found.</option>';
            return;
        }

        // Only show lists that actually contain the selected media type
        const listIds = allLists.map(l => l.id);
        const { data: validItems } = await supabaseClient.from('list_items')
            .select('list_id')
            .in('list_id', listIds)
            .eq('media_type', type);

        const validListIds = new Set((validItems || []).map(i => i.list_id));
        const filteredLists = allLists.filter(l => validListIds.has(l.id));

        if (filteredLists.length === 0) {
            specificListSelect.innerHTML = `<option value="">No lists contain ${type}s.</option>`;
        } else {
            specificListSelect.innerHTML = filteredLists.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
        }
    } else {
        listSelectGroup.style.display = 'none';
    }
}

// Fisher-Yates Shuffle
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function pickRandom() {
    if (!currentUser && sourceSelect.value !== 'taste') {
        alert("Please sign in to use personalized decider options.");
        return;
    }

    errorMsg.style.display = 'none';
    resultContainer.style.display = 'none';
    loader.style.display = 'block';

    const type = mediaTypeSelect.value;
    const source = sourceSelect.value;
    const requireServices = servicesCheck.checked;
    
    // Reset watch button state
    watchBtn.textContent = "Mark as Currently Watching";
    watchBtn.classList.remove('active');

    try {
        let poolIds = [];

        if (source === 'taste') {
            poolIds = await getTastePool(type);
        } else if (source === 'watchlist') {
            const { data } = await supabaseClient.from('user_watchlist').select('media_id').eq('user_id', currentUser.id).eq('media_type', type);
            poolIds = (data || []).map(d => d.media_id);
        } else if (source === 'list') {
            const listId = specificListSelect.value;
            if (!listId) throw new Error("Please select a valid list.");
            const { data } = await supabaseClient.from('list_items').select('media_id').eq('list_id', listId).eq('media_type', type);
            poolIds = (data || []).map(d => d.media_id);
        } else if (source === 'rewatch') {
            poolIds = await getRewatchPool(type);
        }

        if (poolIds.length === 0) {
            throw new Error(`We couldn't find enough ${type}s in that category to pick from.`);
        }

        // Shuffle the pool to ensure true randomness
        poolIds = shuffleArray([...new Set(poolIds)]);

        let winner = null;
        let winnerProviders = [];

        // Sequentially check items until we find one that meets the provider constraints
        for (let id of poolIds) {
            const details = await fetch(`https://api.themoviedb.org/3/${type}/${id}?append_to_response=watch/providers`, {
                headers: { Authorization: `Bearer ${TMDB_TOKEN}` }
            }).then(r => r.json()).catch(() => null);

            if (!details || !details.id) continue;

            const providersData = details['watch/providers']?.results?.US || {};
            const flatrate = (providersData.flatrate || []);
            const free = (providersData.free || []);
            const ads = (providersData.ads || []);
            
            let isAvailable = false;
            let availableProvidersList = [];

            if (!requireServices) {
                isAvailable = true;
                // Just grab top 5 streams/free
                availableProvidersList = [...flatrate, ...free, ...ads];
            } else {
                const flatrateIds = flatrate.map(p => String(p.provider_id));
                const freeIds = free.map(p => String(p.provider_id));
                const adsIds = ads.map(p => String(p.provider_id));

                const isOnUserServices = [...flatrateIds, ...freeIds, ...adsIds].some(pid => userStreamingProviderIds.includes(pid));
                const isFreeAnywhere = freeIds.length > 0;
                const isFreeWithAdsAnywhere = adsIds.length > 0;

                if (isOnUserServices || isFreeAnywhere || isFreeWithAdsAnywhere) {
                    isAvailable = true;
                    // Filter the arrays to only include what they have or what is free
                    availableProvidersList = [
                        ...flatrate.filter(p => userStreamingProviderIds.includes(String(p.provider_id))),
                        ...free,
                        ...ads
                    ];
                }
            }

            if (isAvailable) {
                winner = details;
                // Deduplicate providers by ID
                const pMap = new Map();
                availableProvidersList.forEach(p => pMap.set(p.provider_id, p));
                winnerProviders = Array.from(pMap.values()).slice(0, 5); // Only show top 5
                break; // WE FOUND A WINNER! Stop checking.
            }
        }

        if (!winner) {
            throw new Error("The list doesn't contain any that are available on free services or your preferred streaming services.");
        }

        renderWinner(winner, type, winnerProviders);

    } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
    } finally {
        loader.style.display = 'none';
    }
}

// Replicates the "For You" API logic, but asks for more pages to build a pool of ~50
async function getTastePool(type) {
    if (!currentUser) {
        // Fallback for non-logged in users: just grab trending
        const res = await fetch(`https://api.themoviedb.org/3/trending/${type}/week`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json());
        return (res.results || []).map(i => String(i.id));
    }

    const { data: highlyRated } = await supabaseClient.from('media_logs')
        .select('media_id, rating') 
        .eq('user_id', currentUser.id)
        .eq('media_type', type)
        .gte('rating', 4)
        .order('rating', { ascending: false })
        .limit(20);

    if (!highlyRated || highlyRated.length === 0) {
        // Fallback: Trending
        const res = await fetch(`https://api.themoviedb.org/3/trending/${type}/week`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json());
        return (res.results || []).map(i => String(i.id));
    }

    let genreCounts = {};
    const analyzedItems = await Promise.all(highlyRated.map(item => 
        fetch(`https://api.themoviedb.org/3/${type}/${item.media_id}`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json()).catch(() => null) 
    ));

    analyzedItems.forEach((res, index) => {
        if (!res) return;
        let weight = highlyRated[index].rating === 5 ? 2 : 1; 
        (res.genres || []).forEach(g => { genreCounts[g.id] = (genreCounts[g.id] || 0) + weight; });
    });

    const topGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]).slice(0, 3);
    
    // Fetch 3 pages of discover results based on top genres to build a big pool
    let pool = [];
    const genreStr = topGenres.join('|');
    for(let i = 1; i <= 3; i++) {
        const discoverUrl = `https://api.themoviedb.org/3/discover/${type}?language=en-US&sort_by=popularity.desc&watch_region=US&with_genres=${genreStr}&page=${i}`;
        const pageData = await fetch(discoverUrl, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } }).then(r => r.json()).catch(() => ({}));
        if(pageData.results) pool.push(...pageData.results.map(item => String(item.id)));
    }
    return pool;
}

// Replicates the Re-watch logic from Profile page (>1 year ago, rating >= 4)
async function getRewatchPool(type) {
    const { data: logs } = await supabaseClient.from('media_logs')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('media_type', type)
        .gte('rating', 4);

    if (!logs || logs.length === 0) return [];

    const now = new Date();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    
    const latestLogs = {};
    logs.forEach(log => {
        const logDate = new Date(log.watched_on || log.created_at);
        if (!latestLogs[log.media_id] || logDate > latestLogs[log.media_id].date) {
            latestLogs[log.media_id] = { ...log, date: logDate };
        }
    });

    const validIds = [];
    Object.values(latestLogs).forEach(log => {
        if (now - log.date > oneYearMs) validIds.push(String(log.media_id));
    });

    return validIds;
}

function renderWinner(item, type, providers) {
    currentWinnerMediaId = String(item.id);
    
    winTitle.textContent = item.title || item.name;
    winYear.textContent = (item.release_date || item.first_air_date || '').split('-')[0];
    winPoster.src = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://via.placeholder.com/500x750/1b2228/9ab?text=No+Cover';
    
    // Top 3 Genres
    const genres = (item.genres || []).slice(0, 3).map(g => `<span class="genre-pill">${g.name}</span>`).join('');
    winGenres.innerHTML = genres;

    if (providers.length > 0) {
        winProviders.innerHTML = providers.map(p => `
            <img src="https://image.tmdb.org/t/p/original${p.logo_path}" title="${p.provider_name}" class="provider-logo">
        `).join('');
        winProviders.parentElement.style.display = 'block';
    } else {
        winProviders.parentElement.style.display = 'none';
    }

    resultContainer.style.display = 'flex';
}

async function markAsWatching() {
    if (!currentUser || !currentWinnerMediaId) return;
    
    const type = mediaTypeSelect.value;

    const { error } = await supabaseClient
        .from('media_status')
        .upsert({
            user_id: currentUser.id,
            media_id: currentWinnerMediaId,
            media_type: type,
            media_title: winTitle.textContent,
            status: 'active',
            image_url: winPoster.src,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,media_id,media_type' });

    if (!error) {
        watchBtn.textContent = "Added!";
        watchBtn.classList.add('active'); // Triggers the green details.html styling
        
        // Cleanup watchlist
        await supabaseClient.from('user_watchlist').delete()
            .eq('user_id', currentUser.id)
            .eq('media_id', currentWinnerMediaId);
    } else {
        alert("Error saving status.");
    }
}

// Nav Dropdown Logic
window.toggleProfileDropdown = function(event) {
    if (event) event.stopPropagation();
    const content = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    const isVisible = content.style.display === 'block';
    content.style.display = isVisible ? 'none' : 'block';
    trigger.classList.toggle('active', !isVisible);
}
window.onclick = function(event) {
    const dropdown = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
}
window.signOut = async function() {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
}

initPicker();