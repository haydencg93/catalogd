const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');
let supabaseClient = null;
let globalData = null;

async function initDetails() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

        const tmdbOptions = { 
            headers: { Authorization: `Bearer ${config.tmdb_token}` } 
        };

        let data;
        
        // --- 1. YOUTUBE FETCH ---
        if (type === 'youtube') {
            const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`).then(r => r.json());
            
            if (res.error) {
                alert("Error loading video data.");
                window.location.href = 'index.html';
                return;
            }

            data = {
                title: res.title,
                overview: `A video by ${res.author_name}.\n\n(Note: Durations and descriptions are not provided by this API. Please input your watch time manually when logging!)`,
                poster_path: res.thumbnail_url,
                meta: 'YouTube Video',
                author_name: res.author_name
            };
        } 
        else if (type === 'album') {
            // We split the composite ID we created on the index page back into Artist and Album
            const decodedId = decodeURIComponent(id);
            const [artistName, albumName] = decodedId.split('|||');
            
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
            
            if (res.error) {
                alert("Error loading album data.");
                window.location.href = 'index.html';
                return;
            }

            const albumData = res.album;
            let img = 'https://via.placeholder.com/500x750?text=No+Cover';
            if (albumData.image && albumData.image.length > 3 && albumData.image[3]['#text']) {
                img = albumData.image[3]['#text'];
            }

            // Extract tags for the meta string
            const tags = albumData.tags?.tag?.map(t => t.name).join(', ') || 'Music';
            
            // Last.fm's summary includes messy HTML links, so we split it to only grab the clean text
            let rawSummary = albumData.wiki?.summary || "No description available.";
            const cleanSummary = rawSummary.split('<a href')[0].trim();

            data = {
                title: albumData.name,
                overview: cleanSummary,
                poster_path: img,
                meta: `${albumData.artist} • ${tags}`,
                tracks: albumData.tracks?.track || [],
                artistName: albumData.artist // <--- ADD THIS LINE
            };
        }
        // --- 2. BOOK FETCH ---
        else if (type === 'book') {
            const res = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json());
            const editionsRes = await fetch(`https://openlibrary.org${id}/editions.json`).then(r => r.json());
            const authorData = res.authors || [];

            let firstAuthorName = '';
            if (res.authors && res.authors.length > 0) {
                const authorKey = res.authors[0].author.key;
                const authorDataFetch = await fetch(`https://openlibrary.org${authorKey}.json`).then(r => r.json());
                firstAuthorName = authorDataFetch.name;
            }

            let foundIsbn = null;
            if (editionsRes.entries) {
                for (const edition of editionsRes.entries) {
                    const isbn13 = edition.isbn_13?.[0];
                    const isbn10 = edition.isbn_10?.[0];
                    if (isbn13 || isbn10) {
                        foundIsbn = isbn13 || isbn10;
                        break; 
                    }
                }
            }

            data = {
                title: res.title,
                overview: res.description?.value || res.description || "No description.",
                poster_path: res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-L.jpg` : null,
                meta: `Published: ${res.first_publish_date || 'Unknown'}`,
                authors: res.authors || [],
                authorName: firstAuthorName
            };
            
            let pageCount = null;
            if (editionsRes.entries) {
                for (const edition of editionsRes.entries) {
                    pageCount = pageCount || edition.number_of_pages;
                    if (pageCount) break; 
                }
            }
            data.pages = pageCount;
        } 
        // --- 3. MOVIE & TV FETCH ---
        else {
            const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, tmdbOptions).then(r => r.json());
            data = {
                title: res.title || res.name,
                overview: res.overview,
                poster_path: `https://image.tmdb.org/t/p/w500${res.poster_path}`,
                backdrop: res.backdrop_path ? `https://image.tmdb.org/t/p/original${res.backdrop_path}` : null,
                meta: `${(res.release_date || res.first_air_date || '').split('-')[0]} • ${res.genres?.map(g => g.name).join(', ')}`
            };
        }

        globalData = data;

        document.getElementById('media-title').textContent = data.title;
        document.getElementById('media-overview').textContent = data.overview;
        document.getElementById('media-meta').textContent = data.meta;
        
        // --- YOUTUBE POSTER, PROVIDERS, & CAST RENDERING ---
        if (type === 'youtube') {
            // 1. Render the iframe
            document.getElementById('poster-area').innerHTML = `
                <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
                    <iframe src="https://www.youtube.com/embed/${id}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" frameborder="0" allowfullscreen></iframe>
                </div>
            `;
            
            // 2. Set YouTube as the Watch Provider
            const providerSection = document.getElementById('watch-providers');
            if (providerSection) {
                providerSection.style.display = 'block';
                providerSection.querySelector('h4').textContent = "Watch on YouTube";
                document.getElementById('providers-list').innerHTML = `
                    <div class="provider-group">
                        <div class="provider-icons">
                            <a href="https://www.youtube.com/watch?v=${id}" target="_blank" style="text-decoration: none; display: inline-block;">
                                <img src="https://www.youtube.com/s/desktop/40cd5ddc/img/favicon_144x144.png" class="provider-logo" style="width: 60px; object-fit: contain; background: transparent; border: none; transition: transform 0.2s;" title="Open in YouTube">
                            </a>
                        </div>
                    </div>
                `;
            }

            // 3. Set the Channel Name as the Cast Member
            const castSection = document.getElementById('cast-section');
            if (castSection) {
                castSection.style.display = 'block';
                castSection.querySelector('h3').textContent = "Channel";
                const channelAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.author_name || 'Y T')}&background=1b2228&color=ff0000&size=185`;
                
                document.getElementById('cast-list').innerHTML = `
                    <div class="cast-card">
                        <img src="${channelAvatar}" alt="${data.author_name || 'Channel'}">
                        <div class="cast-info">
                            <span class="cast-name">${data.author_name || 'Unknown Channel'}</span>
                            <span class="cast-role">Creator</span>
                        </div>
                    </div>
                `;
            }
        } 
        // --- NEW: ALBUM POSTER & TRACKLIST RENDERING ---
        else if (type === 'album') {
            // Render the standard poster
            document.getElementById('poster-area').innerHTML = `<img src="${data.poster_path}" alt="poster">`;
            
            // Hide watch providers
            const providerSection = document.getElementById('watch-providers');
            if (providerSection) providerSection.style.display = 'none';

            // 1. Move Tracklist to the Tracker Section!
            const trackerSection = document.getElementById('tv-tracker');
            const episodeList = document.getElementById('episode-list');
            
            if (trackerSection && data.tracks.length > 0) {
                trackerSection.style.display = 'block';
                trackerSection.querySelector('h3').textContent = "Tracklist";
                
                // Hide TV specific progress bars and controls
                const progressContainer = document.getElementById('progress-container');
                const controls = document.querySelector('.tracker-controls');
                if (progressContainer) progressContainer.style.display = 'none';
                if (controls) controls.style.display = 'none';

                const trackHtml = data.tracks.map((track, index) => {
                    let durationStr = "--:--";
                    if (track.duration && parseInt(track.duration) > 0) {
                        const mins = Math.floor(track.duration / 60);
                        const secs = (track.duration % 60).toString().padStart(2, '0');
                        durationStr = `${mins}:${secs}`;
                    }
                    return `
                    <div style="display: flex; justify-content: space-between; padding: 12px 15px; border-bottom: 1px solid #2c3440; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <span style="color: #9ab; font-size: 0.9rem; width: 20px; text-align: right;">${index + 1}</span>
                            <span style="font-weight: bold;">${track.name}</span>
                        </div>
                        <span style="color: #9ab; font-size: 0.85rem;">${durationStr}</span>
                    </div>`;
                }).join('');
                
                // Drop the tracklist into the episode grid but force it to span full width
                episodeList.style.display = 'block'; 
                episodeList.innerHTML = `
                    <div style="background: #14181c; border-radius: 12px; border: 1px solid #2c3440; overflow: hidden; margin-top: 10px; grid-column: 1 / -1;">
                        ${trackHtml}
                    </div>
                `;
            }

            // 2. Setup Cast Section for the Artist!
            const castSection = document.getElementById('cast-section');
            const castList = document.getElementById('cast-list');
            
            if (castSection && data.artistName) {
                castSection.style.display = 'block';
                castSection.querySelector('h3').textContent = "Artist";
                
                // Generate a profile picture for the artist
                const artistAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.artistName)}&background=1b2228&color=9ab&size=512`;
                
                castList.innerHTML = `
                    <div class="cast-card" onclick="window.location.href='cast.html?artist=${encodeURIComponent(data.artistName)}'" style="cursor: pointer;">
                        <img src="${artistAvatar}" alt="${data.artistName}">
                        <div class="cast-info">
                            <span class="cast-name">${data.artistName}</span>
                            <span class="cast-role">Musician</span>
                        </div>
                    </div>
                `;
            }
        }
        else {
            // Standard poster logic for movies/tv/books
            document.getElementById('poster-area').innerHTML = `<img src="${data.poster_path}" alt="poster">`;
            if (data.backdrop) document.getElementById('backdrop-overlay').style.backgroundImage = `url(${data.backdrop})`;
        }

        document.getElementById('go-to-log').onclick = () => {
            window.location.href = `log.html?id=${id}&type=${type}`;
        };

        setupHeader();

        if (type === 'tv') setupTVTracker(config, id);
        
        if (type === 'book') {
            const firstAuthor = data.authors && data.authors.length > 0 ? data.authors[0].name : '';
            displayBookLinks(data.title, data.authorName); 
            setupBookTracker(data.pages);
            fetchBookAuthors(data.authors);
        } else if (type !== 'youtube' && type !== 'album') {
            // This ensures TMDB provider/credit fetches skip YouTube videos AND Albums!
            fetchWatchProviders(config);
            fetchCredits(config, id, type);
        }

        let isAnime = false;
        if (type === 'tv' || type === 'movie') {
            const keywordUrl = `https://api.themoviedb.org/3/${type}/${id}/keywords`;
            const kwRes = await fetch(keywordUrl, tmdbOptions).then(r => r.json());
            const keywords = type === 'tv' ? kwRes.results : kwRes.keywords;
            isAnime = keywords.some(k => k.name.toLowerCase() === 'anime');
        }

        // If it is an Anime, handle the Filler Logic
        if (isAnime) {
            const slug = slugify(data.title);
            const fillerContainer = document.getElementById('filler-status-container');
            const fillerInfo = document.getElementById('filler-info');
            const fillerAction = document.getElementById('filler-action-area');
            
            fillerContainer.style.display = 'block';

            try {
                const fillerFile = await fetch(`animeFillerListApi/data/${slug}.json`);
                
                if (fillerFile.ok) {
                    const fillerData = await fillerFile.json();
                    
                    if (fillerData.error) {
                        fillerInfo.textContent = "Filler status unavailable for this title.";
                        fillerAction.innerHTML = ""; 
                    } else {
                        fillerInfo.textContent = ""; 
                        fillerAction.innerHTML = `
                            <button id="view-filler-btn" class="primary-btn" style="background: #ff9800; width: auto; padding: 10px 20px;">
                                View Filler Episodes
                            </button>`;
                        document.getElementById('view-filler-btn').onclick = () => openFillerModal(fillerData);
                    }
                } else {
                    fillerInfo.textContent = "Filler list data not found.";
                    checkIfAlreadyRequested(slug, data.title, fillerAction);
                }
            } catch (e) {
                console.error("Filler fetch error:", e);
                fillerInfo.textContent = "Error loading filler data.";
            }
        }

        fetchMediaHistory();
        setupWatchlist(id, type);
        setupListManager(id, type);
        setupStatusManager(id, type);
    } catch (err) { 
        console.error(err); 
    }
}

async function setupStatusManager(mediaId, mediaType) {
    const statusBtn = document.getElementById('status-btn');
    const modal = document.getElementById('status-modal');
    const closeBtn = document.getElementById('close-status-modal');
    const options = document.querySelectorAll('.status-option');
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
        statusBtn.style.display = 'none';
        return;
    }

    // Map labels for the UI
    const labels = {
        active: mediaType === 'book' ? 'Currently Reading' : 'Currently Watching',
        paused: 'Paused',
        dropped: 'Dropped',
        none: 'Mark as...'
    };

    // 1. Initial State Fetch
    const { data: statusData } = await supabaseClient
        .from('media_status')
        .select('status')
        .eq('user_id', user.id)
        .eq('media_id', String(mediaId))
        .maybeSingle();

    if (statusData?.status && labels[statusData.status]) {
        statusBtn.textContent = labels[statusData.status];
        if (statusData.status !== 'completed' && statusData.status !== 'none') {
            statusBtn.classList.add('active');
        }
    }

    // Update Modal labels dynamically for books vs movies
    const activeLabelText = modal.querySelector('[data-status="active"] .status-label-text');
    if (activeLabelText) activeLabelText.textContent = labels.active;

    // 2. Open/Close Modal
    statusBtn.onclick = () => modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    
    // Close on backdrop click
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    // 3. Status Selection Logic
    options.forEach(opt => {
        opt.onclick = async (e) => {
            // Stop propagation to ensure we don't trigger the modal backdrop click
            e.stopPropagation();
            
            const selectedStatus = opt.getAttribute('data-status');
            
            if (selectedStatus === 'none') {
                // Delete the status record
                const { error } = await supabaseClient
                    .from('media_status')
                    .delete()
                    .eq('user_id', user.id)
                    .eq('media_id', String(mediaId));
                
                if (!error) {
                    statusBtn.textContent = labels.none;
                    statusBtn.classList.remove('active');
                }
            } else {
                // Upsert the new status
                const { error } = await supabaseClient
                    .from('media_status')
                    .upsert({
                        user_id: user.id,
                        media_id: String(mediaId),
                        media_type: mediaType,
                        status: selectedStatus,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'user_id,media_id,media_type' });

                if (!error) {
                    statusBtn.textContent = labels[selectedStatus];
                    statusBtn.classList.add('active');
                    
                    // Cleanup watchlist if they start the item
                    if (selectedStatus === 'active') {
                        await supabaseClient.from('user_watchlist').delete()
                            .eq('user_id', user.id)
                            .eq('media_id', String(mediaId));
                            
                        const watchlistBtn = document.getElementById('watchlist-btn');
                        if (watchlistBtn) {
                            watchlistBtn.classList.remove('active');
                            watchlistBtn.textContent = 'Add to Watchlist';
                        }
                    }
                } else {
                    console.error("Error updating status:", error);
                }
            }
            modal.style.display = 'none';
        };
    });
}

async function fetchCredits(config, mediaId, mediaType) {
    if (mediaType === 'book' || mediaType === 'youtube') return;
    const castList = document.getElementById('cast-list');
    const url = `https://api.themoviedb.org/3/${mediaType}/${mediaId}/credits`;

    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.tmdb_token}` }
        }).then(r => r.json());

        const director = res.crew.find(person => 
            person.job === 'Director' || 
            (person.job === 'Executive Producer' && mediaType === 'tv')
        );
        
        const topCast = res.cast.slice(0, 11);
        let finalDisplayList = [];
        
        if (director) {
            finalDisplayList.push({
                id: director.id,
                name: director.name,
                character: director.job,
                profile_path: director.profile_path,
                isDirector: true
            });
        }
        
        topCast.forEach(actor => finalDisplayList.push(actor));

        castList.innerHTML = finalDisplayList.map(person => `
            <div class="cast-card ${person.isDirector ? 'director-highlight' : ''}" 
                 onclick="window.location.href='cast.html?personId=${person.id}'">
                <img src="${person.profile_path ? 'https://image.tmdb.org/t/p/w185' + person.profile_path : 'https://via.placeholder.com/185x278?text=No+Photo'}" alt="${person.name}">
                <div class="cast-info">
                    <span class="cast-name">${person.name}</span>
                    <span class="cast-role">${person.character || 'Cast'} ${person.isDirector ? '🎬' : ''}</span>
                </div>
            </div>
        `).join('');
    } catch (err) { console.error("Credits error:", err); }
}

async function fetchBookAuthors(authorsList) {
    const castSection = document.getElementById('cast-section');
    const castList = document.getElementById('cast-list');
    castSection.querySelector('h3').textContent = "Authors & Writers";

    if (!authorsList || authorsList.length === 0) {
        castList.innerHTML = "<p class='meta'>Author information not available.</p>";
        return;
    }

    try {
        const authorCards = await Promise.all(authorsList.map(async (auth) => {
            const authorKey = auth.author.key;
            const details = await fetch(`https://openlibrary.org${authorKey}.json`).then(r => r.json());
            const authorId = authorKey.split('/').pop();
            const photoUrl = details.photos 
                ? `https://covers.openlibrary.org/a/id/${details.photos[0]}-M.jpg` 
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(details.name)}&background=1b2228&color=9ab&size=512`;

            return `
                <div class="cast-card" onclick="window.location.href='cast.html?authorId=${authorId}'">
                    <img src="${photoUrl}" alt="${details.name}">
                    <div class="cast-info">
                        <span class="cast-name">${details.name}</span>
                        <span class="cast-role">Author</span>
                    </div>
                </div>
            `;
        }));
        castList.innerHTML = authorCards.join('');
    } catch (err) { console.error("Error fetching authors:", err); }
}

function setupBookTracker(totalPages) {
    const trackerSection = document.getElementById('tv-tracker');
    const list = document.getElementById('episode-list');
    trackerSection.style.display = 'block';
    trackerSection.querySelector('h3').textContent = "Reading Progress";
    
    const controls = document.querySelector('.tracker-controls');
    if (controls) controls.style.display = 'none';
    list.style.display = 'block'; 
    
    if (!totalPages) {
        list.innerHTML = `<p class="meta">Page count not available.</p>`;
        return;
    }

    list.innerHTML = `
        <div class="book-progress-container">
            <div class="quick-update-row">
                <input type="number" id="quick-page-input" placeholder="Current Page #" min="1" max="${totalPages}">
                <button onclick="updatePageProgress(${totalPages})" class="primary-btn">Update Progress</button>
            </div>
        </div>
    `;
    fetchBookProgress(totalPages); 
}

async function updatePageProgress(totalPages) {
    const input = document.getElementById('quick-page-input');
    const newPage = parseInt(input.value);

    if (newPage >= totalPages) {
        alert("To mark a book as finished, please use the 'Log or Review' button to rate and review.");
        input.value = '';
        return;
    }

    if (!newPage || newPage < 1) return alert(`Enter a page between 1 and ${totalPages - 1}`);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in.");

    const { data: activeLog } = await supabaseClient.from('media_logs').select('id')
        .eq('user_id', user.id).eq('media_id', id).eq('is_finished', false).maybeSingle();

    const logData = {
        user_id: user.id, media_id: id, media_type: 'book',
        current_page: newPage, total_pages: totalPages,
        is_finished: false, watched_on: new Date().toISOString().split('T')[0]
    };
    if (activeLog) logData.id = activeLog.id;

    const { error } = await supabaseClient.from('media_logs').upsert(logData);
    if (!error) {
        input.value = '';
        fetchBookProgress(totalPages);
        fetchMediaHistory();
    }
}

async function fetchBookProgress(totalPages) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user || !totalPages) return;

    const { data: logs } = await supabaseClient.from('media_logs')
        .select('current_page').eq('user_id', user.id).eq('media_id', id)
        .eq('is_finished', false).order('created_at', { ascending: false }).limit(1);

    const currentPage = logs?.[0]?.current_page || 0;
    updateUnifiedProgress(currentPage, totalPages, "pages read");
}

function displayBookLinks(title, authorName) {
    const providerSection = document.getElementById('watch-providers');
    const list = document.getElementById('providers-list');
    providerSection.querySelector('h4').textContent = "Get this Book";

    // If authorName is missing, just search by title
    const searchTerms = authorName ? `${title} ${authorName}` : title;
    const query = encodeURIComponent(searchTerms);

    const logos = {
        worldcat: "https://search.worldcat.org/favicons/android-chrome-192x192.png",
        bwb: "https://www.betterworldbooks.com/images/logos/favicon.ico",
        amazon: "https://www.amazon.com/favicon.ico",
        thriftbooks: "https://static.thriftbooks.com/images/favicon.ico",
        chirp: "https://www.chirpbooks.com/favicon.ico"
    };

    list.innerHTML = `
        <div class="provider-group">
            <span class="provider-type-label">Check nearby libraries</span>
            <div class="book-link-list">
                <a href="https://search.worldcat.org/search?q=${query}" target="_blank" class="book-external-link">
                    <img src="${logos.worldcat}"> <span>WorldCat</span>
                </a>
            </div>
        </div>
        <div class="provider-group">
            <span class="provider-type-label">Buy Used or New</span>
            <div class="book-link-list">
                <a href="https://www.thriftbooks.com/browse/?b.search=${query}" target="_blank" class="book-external-link">
                    <img src="${logos.thriftbooks}"> <span>ThriftBooks</span>
                </a>
                <a href="https://www.betterworldbooks.com/search/results?q=${query}" target="_blank" class="book-external-link">
                    <img src="${logos.bwb}"> <span>Better World Books</span>
                </a>
                <a href="https://www.amazon.com/s?k=${query}" target="_blank" class="book-external-link">
                    <img src="${logos.amazon}"> <span>Amazon</span>
                </a>
            </div>
        </div>
        <div class="provider-group">
            <span class="provider-type-label">Audiobooks</span>
            <div class="book-link-list">
                <a href="https://www.chirpbooks.com/search?q=${query}" target="_blank" class="book-external-link">
                    <img src="${logos.chirp}"> <span>Chirp</span>
                </a>
            </div>
        </div>
    `;
}

async function setupHeader() {
    const searchInput = document.getElementById('search-input');
    const searchFilter = document.getElementById('search-filter');
    const loginBtn = document.getElementById('login-btn');
    const profileBtn = document.getElementById('profile-btn');

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim() !== "") {
            const filterVal = searchFilter ? searchFilter.value : 'all';
            // Send both the search text AND the filter choice to index.html
            window.location.href = `index.html?search=${encodeURIComponent(searchInput.value)}&filter=${filterVal}`;
        }
    });

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        loginBtn.textContent = "Sign Out";
        loginBtn.onclick = async () => { await supabaseClient.auth.signOut(); location.reload(); };
        if (profileBtn) profileBtn.style.display = 'inline-block';
    } else {
        loginBtn.textContent = "Sign In";
        loginBtn.onclick = () => window.location.href = 'index.html'; 
        if (profileBtn) profileBtn.style.display = 'none';
    }
}

async function setupTVTracker(config, seriesId) {
    const trackerSection = document.getElementById('tv-tracker');
    trackerSection.style.display = 'block';
    const seasonSelector = document.getElementById('season-selector');
    const markBtn = document.getElementById('mark-season-btn');
    const clearBtn = document.getElementById('clear-season-btn');
    
    const res = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}`, {
        headers: { Authorization: `Bearer ${config.tmdb_token}` }
    }).then(r => r.json());

    seasonSelector.innerHTML = res.seasons.map(s => `<option value="${s.season_number}">${s.name}</option>`).join('');
    seasonSelector.onchange = () => loadEpisodes(config, seriesId, seasonSelector.value);
    loadEpisodes(config, seriesId, res.seasons[0].season_number);

    markBtn.onclick = () => markSeasonAsWatched();
    clearBtn.onclick = () => clearSeasonProgress();
}

// Add a global variable to track log visibility
let allLogsData = [];
async function fetchMediaHistory() {
    const historyList = document.getElementById('history-list');
    const showMoreBtn = document.getElementById('show-more-logs');
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) { 
        if (historyList) historyList.innerHTML = "<p class='meta'>Sign in to see history.</p>"; 
        return; 
    }

    const { data: logs } = await supabaseClient.from('media_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('media_id', id)
        .order('created_at', { ascending: false });

    if (!logs || logs.length === 0) { 
        if (historyList) historyList.innerHTML = "<p class='meta'>No logs yet.</p>"; 
        if (showMoreBtn) showMoreBtn.style.display = 'none';
        return; 
    }

    allLogsData = logs; 

    // 1. Initial render of top 3
    renderLogs(allLogsData.slice(0, 3));

    // 2. Setup the "Show More" button logic
    if (showMoreBtn) {
        if (allLogsData.length > 3) {
            showMoreBtn.style.display = 'block';
            showMoreBtn.textContent = `Show More (+${allLogsData.length - 3})`;
            
            // This is the click handler that was likely missing or resetting
            showMoreBtn.onclick = (e) => {
                e.preventDefault();
                renderLogs(allLogsData); // Render the full list
                showMoreBtn.style.display = 'none'; // Hide the button once expanded
            };
        } else {
            showMoreBtn.style.display = 'none';
        }
    }
}

function renderLogs(logsToRender) {
    const historyList = document.getElementById('history-list');
    
    historyList.innerHTML = logsToRender.map(log => {
        let label = type.charAt(0).toUpperCase() + type.slice(1);
        if (type === 'tv') {
            label = log.episode_number ? `S${log.season_number} E${log.episode_number}` : 
                   (log.season_number ? `Season ${log.season_number}` : `Series`);
        } else if (type === 'album') {
            if (log.episode_number && globalData && globalData.tracks && globalData.tracks[log.episode_number - 1]) {
                label = globalData.tracks[log.episode_number - 1].name; // Grabs the exact song name!
            } else {
                label = 'Entire Album';
            }
        }

        // --- BADGE LOGIC ---
        let rewatchText = 'Rewatch';
        if (type === 'book') rewatchText = 'Reread';
        else if (type === 'album') rewatchText = 'Relisten';
        
        const heartBadge = log.is_liked ? `<span title="Liked" style="display: flex; align-items: center;">❤️</span>` : '';
        const rewatchBadge = log.is_rewatch ? 
            `<span title="${rewatchText}" style="font-size: 0.85rem; display: flex; align-items: center;">🔁</span>` 
            : '';
            
        // Create a dedicated row for the badges that only shows up if the user liked or rewatched it
        const badgeRow = (log.is_liked || log.is_rewatch) ? 
            `<div style="display: flex; gap: 10px; margin-top: 6px; margin-bottom: 2px;">
                ${heartBadge}
                ${rewatchBadge}
            </div>` : '';
        // --- END BADGE LOGIC ---
        
        const stars = '★'.repeat(Math.floor(log.rating)) + (log.rating % 1 !== 0 ? '½' : '');
        const logDateTime = new Date(log.created_at).toLocaleString([], { 
            year: 'numeric', month: 'numeric', day: 'numeric', 
            hour: '2-digit', minute: '2-digit' 
        });

        const reviewPreview = log.notes ? `<div class="history-notes">"${log.notes}"</div>` : '';

        return `
            <div class="history-item" id="log-${log.id}">
                <div class="history-header">
                    <span class="history-label" style="margin: 0; padding-right: 15px;">${label}</span>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <span class="history-stars">${stars}</span>
                        <span onclick="window.location.href='log.html?id=${id}&type=${type}&logId=${log.id}'" 
                              style="cursor:pointer; font-size: 0.8rem;" title="Edit Log">✏️</span>
                        <span onclick="deleteLog('${log.id}')" 
                              style="cursor:pointer; color:#ff4d4d; font-size: 0.8rem;" title="Delete Log">🗑️</span>
                    </div>
                </div>
                ${badgeRow}
                <div class="history-date">${logDateTime}</div>
                ${reviewPreview}
            </div>
        `;
    }).join('');
}

async function loadEpisodes(config, seriesId, seasonNum) {
    const list = document.getElementById('episode-list');
    list.innerHTML = 'Loading...';
    try {
        const res = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNum}`, {
            headers: { Authorization: `Bearer ${config.tmdb_token}` }
        }).then(r => r.json());

        const { data: { user } } = await supabaseClient.auth.getUser();
        let watchedSet = new Set();
        if (user) {
            const { data: watched } = await supabaseClient.from('episode_logs')
                .select('episode_number').eq('series_id', String(seriesId)).eq('season_number', seasonNum).eq('user_id', user.id);
            if (watched) watchedSet = new Set(watched.map(w => w.episode_number));
        }

        list.innerHTML = res.episodes.map(ep => `
            <div class="episode-item">
                <input type="checkbox" id="ep-${ep.episode_number}" ${watchedSet.has(ep.episode_number) ? 'checked' : ''} 
                    onclick="toggleEpisode('${seriesId}', ${seasonNum}, ${ep.episode_number})">
                <label for="ep-${ep.episode_number}">E${ep.episode_number}: ${ep.name}</label>
            </div>
        `).join('');
        updateUnifiedProgress(watchedSet.size, res.episodes.length, "episodes watched");
    } catch (err) { list.innerHTML = "Error loading episodes."; }
}

async function toggleEpisode(seriesId, seasonNum, epNum) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const isChecked = document.getElementById(`ep-${epNum}`).checked;
    if (isChecked) {
        await supabaseClient.from('episode_logs').insert({ user_id: user.id, series_id: String(seriesId), season_number: seasonNum, episode_number: epNum });
    } else {
        await supabaseClient.from('episode_logs').delete().eq('user_id', user.id).eq('series_id', String(seriesId)).eq('season_number', seasonNum).eq('episode_number', epNum);
    }
    refreshProgressBar(seriesId, seasonNum);
}

async function markSeasonAsWatched() {
    const seasonNum = parseInt(document.getElementById('season-selector').value);
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in.");
    const config = await fetch('config.json').then(r => r.json());
    const res = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNum}`, { headers: { Authorization: `Bearer ${config.tmdb_token}` } }).then(r => r.json());
    const logs = res.episodes.map(ep => ({ user_id: user.id, series_id: String(id), season_number: seasonNum, episode_number: ep.episode_number }));
    await supabaseClient.from('episode_logs').upsert(logs);
    loadEpisodes(config, id, seasonNum);
}

async function refreshProgressBar(seriesId, seasonNum) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const total = document.querySelectorAll('.episode-item').length;
    const { data: watched } = await supabaseClient.from('episode_logs').select('episode_number').eq('series_id', String(seriesId)).eq('season_number', parseInt(seasonNum)).eq('user_id', user.id);
    updateUnifiedProgress(watched ? watched.length : 0, total, "episodes watched");
}

function updateUnifiedProgress(current, total, label) {
    const bar = document.getElementById('main-progress-fill');
    const text = document.getElementById('progress-stats-text');
    const percent = total > 0 ? Math.min(Math.round((current / total) * 100), 100) : 0;
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = `${current} / ${total} ${label} (${percent}%)`;
}

async function clearSeasonProgress() {
    const seasonNum = document.getElementById('season-selector').value;
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user || !confirm(`Clear Season ${seasonNum} progress?`)) return;
    await supabaseClient.from('episode_logs').delete().eq('user_id', user.id).eq('series_id', String(id)).eq('season_number', seasonNum);
    refreshProgressBar(id, seasonNum);
    document.querySelectorAll('.episode-item input').forEach(i => i.checked = false);
}

async function fetchWatchProviders(config) {
    if (type === 'book') return; 
    const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}/watch/providers`, { 
        headers: { Authorization: `Bearer ${config.tmdb_token}` } 
    }).then(r => r.json());
    
    const results = res.results?.US || {};
    const stream = results.flatrate || [];
    const buy = results.buy || [];
    const container = document.getElementById('providers-list');
    
    if (!stream.length && !buy.length) {
        container.innerHTML = "<p class='meta'>Not available to stream or buy.</p>";
        return;
    }

    let html = '';

    // Streaming Group
    if (stream.length) {
        html += `
            <div class="provider-group">
                <span class="provider-type-label">Stream</span>
                <div class="provider-icons">
                    ${stream.map(p => `
                        <img src="https://image.tmdb.org/t/p/original${p.logo_path}" 
                             title="${p.provider_name}" class="provider-logo">
                    `).join('')}
                </div>
            </div>`;
    }

    // Buy/Rent Group
    if (buy.length) {
        html += `
            <div class="provider-group">
                <span class="provider-type-label">Buy / Rent</span>
                <div class="provider-icons">
                    ${buy.map(p => `
                        <img src="https://image.tmdb.org/t/p/original${p.logo_path}" 
                             title="${p.provider_name}" class="provider-logo">
                    `).join('')}
                </div>
            </div>`;
    }

    container.innerHTML = html;
}

async function setupWatchlist(mediaId, mediaType) {
    const btn = document.getElementById('watchlist-btn');
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { btn.style.display = 'none'; return; }
    const { data: exists } = await supabaseClient.from('user_watchlist').select('id').eq('user_id', user.id).eq('media_id', String(mediaId)).maybeSingle();
    if (exists) { btn.classList.add('active'); btn.textContent = 'On Watchlist'; }
    btn.onclick = async () => {
        if (btn.classList.contains('active')) {
            await supabaseClient.from('user_watchlist').delete().eq('user_id', user.id).eq('media_id', String(mediaId));
            btn.classList.remove('active'); btn.textContent = 'Add to Watchlist';
        } else {
            await supabaseClient.from('user_watchlist').insert({ user_id: user.id, media_id: String(mediaId), media_type: mediaType });
            btn.classList.add('active'); btn.textContent = 'On Watchlist';
        }
    };
}

async function setupListManager(mediaId, mediaType) {
    const btn = document.getElementById('add-to-list-btn');
    const modal = document.getElementById('list-modal');
    const close = document.getElementById('close-list-modal');
    const container = document.getElementById('user-lists-selection');
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { 
        btn.style.display = 'none'; 
        return; 
    }

    btn.onclick = async () => {
        modal.style.display = 'flex';
        container.innerHTML = '<p class="meta">Loading your lists...</p>';

        // STEP 1: Fetch lists the user owns
        const { data: owned } = await supabaseClient
            .from('media_lists')
            .select('id, name')
            .eq('user_id', user.id);

        // STEP 2: Fetch lists where the user is a collaborator
        const { data: collabEntries } = await supabaseClient
            .from('list_collaborators')
            .select('list_id, media_lists(id, name)')
            .eq('user_id', user.id);

        const collaborative = collabEntries?.map(e => e.media_lists).filter(Boolean) || [];

        // STEP 3: Merge and de-duplicate
        const listMap = new Map();
        [...(owned || []), ...collaborative].forEach(l => listMap.set(l.id, l));
        const finalLists = Array.from(listMap.values());

        if (finalLists.length === 0) {
            container.innerHTML = '<p class="meta">No editable lists found.</p>';
            return;
        }

        // STEP 4: Check which lists already contain this item
        const listIds = finalLists.map(l => l.id);
        const { data: currentItems } = await supabaseClient
            .from('list_items')
            .select('list_id')
            .in('list_id', listIds)
            .eq('media_id', String(mediaId));
            
        // Create a Set of list IDs that already have the item for quick lookup
        const addedListIds = new Set(currentItems?.map(item => item.list_id) || []);

        // STEP 5: Render the buttons dynamically
        container.innerHTML = finalLists.map(l => {
            const isAdded = addedListIds.has(l.id);
            const btnClass = isAdded ? 'danger-btn' : 'primary-btn';
            const btnText = isAdded ? 'Remove' : 'Add';
            
            return `
                <div class="list-select-item">
                    <span>${l.name}</span>
                    <button onclick="toggleListItem('${l.id}', '${mediaId}', '${mediaType}', this)" class="${btnClass}">${btnText}</button>
                </div>
            `;
        }).join('');
    };

    close.onclick = () => modal.style.display = 'none';
    
    // Close on backdrop click
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}

window.deleteLog = async (logId) => {
    if (!confirm("Delete this log?")) return;
    await supabaseClient.from('media_logs').delete().eq('id', logId);
    document.getElementById(`log-${logId}`)?.remove();
};

async function checkIfAlreadyRequested(slug, originalName, actionArea) {
    const { data: existingRequest } = await supabaseClient
        .from('filler_list_mgnt')
        .select('filler_exists, notes')
        .eq('name', slug)
        .maybeSingle();

    if (existingRequest) {
        if (existingRequest.notes) {
            actionArea.innerHTML = `<span class="meta">Status: ${existingRequest.notes}</span>`;
        } else {
            actionArea.innerHTML = `<span class="meta">Request pending... check back soon!</span>`;
        }
    } else {
        // Show the Request Button
        actionArea.innerHTML = `
            <button id="request-filler-btn" class="secondary-btn" style="background: #ff9800; color: #fff;">
                Request Filler List
            </button>`;
        
        document.getElementById('request-filler-btn').onclick = () => requestFiller(slug);
    }
}

async function requestFiller(slug) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in to request filler lists!");

    const { error } = await supabaseClient
        .from('filler_list_mgnt')
        .insert({ name: slug, filler_exists: false });

    if (!error) {
        alert("Request sent! Our scraper will look for this soon.");
        location.reload();
    } else {
        console.error(error);
    }
}

function openFillerModal(data) {
    const modal = document.getElementById('filler-modal');
    const tbody = document.getElementById('filler-table-body');
    const closeBtn = document.getElementById('close-filler-modal');

    document.getElementById('filler-modal-title').textContent = `${data.anime} Filler List`;
    
    // Clear and build table
    tbody.innerHTML = data.episodes.map(ep => {
        // Determine class based on type string
        let typeClass = 'type-canon'; // Default to green
        const typeStr = ep.type.toLowerCase();

        // Check for mixed first!
        if (typeStr.includes('mixed')) {
            typeClass = 'type-mixed';
        } 
        else if (typeStr.includes('filler')) {
            typeClass = 'type-filler';
        }
        else if (typeStr.includes('canon')) {
            typeClass = 'type-canon';
        }

        return `
            <tr>
                <td>${ep.number}</td>
                <td>${ep.title}</td>
                <td class="${typeClass}">${ep.type}</td>
            </tr>
        `;
    }).join('');

    modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.getElementById('filler-modal-title').innerHTML = `
        ${data.anime} Filler List
        <div style="font-size: 0.9rem; color: #9ab; font-weight: normal; margin-top: 5px;">
            Provided Through <a href="https://www.animefillerlist.com" target="_blank" style="color: #ff9800; text-decoration: none;">AnimeFillerList.com</a>
        </div>
    `;
}

window.toggleListItem = async (listId, mediaId, mediaType, btnElement) => {
    // Determine if we are adding or removing based on the button's current text
    const isAdding = btnElement.textContent === 'Add';
    btnElement.textContent = '...'; // Show a loading state

    if (isAdding) {
        // ADD to list
        const { error } = await supabaseClient
            .from('list_items')
            .insert({ 
                list_id: listId, 
                media_id: String(mediaId), 
                media_type: mediaType 
            });
        
        if (!error) {
            btnElement.textContent = 'Remove';
            btnElement.className = 'danger-btn'; // Changes it to the red style
        } else {
            console.error("Error adding to list:", error);
            alert("Failed to add to list.");
            btnElement.textContent = 'Add';
        }
    } else {
        // REMOVE from list
        const { error } = await supabaseClient
            .from('list_items')
            .delete()
            .eq('list_id', listId)
            .eq('media_id', String(mediaId));
        
        if (!error) {
            btnElement.textContent = 'Add';
            btnElement.className = 'primary-btn'; // Changes it back to the green/default style
        } else {
            console.error("Error removing from list:", error);
            alert("Failed to remove from list.");
            btnElement.textContent = 'Remove';
        }
    }
};

initDetails();