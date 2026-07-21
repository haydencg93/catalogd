const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');
let supabaseClient = null;
let globalData = null;
let tvmazeEpisodesMap = {};
let fullCastData = [];
let fullCrewData = [];
let directorData = null;

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
            const decodedId = decodeURIComponent(id);
            const [artistName, albumName] = decodedId.split('|||');
            
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
            
            if (res.error) {
                alert("Error loading album data.");
                window.location.href = 'index.html';
                return;
            }

            const albumData = res.album;
            
            // 1. Determine the image first
            let img = 'https://via.placeholder.com/500x750?text=No+Cover';
            if (albumData.image && albumData.image.length > 3 && albumData.image[3]['#text']) {
                img = albumData.image[3]['#text'];
            }

            // 2. Process the summary text BEFORE creating the data object
            let rawSummary = albumData.wiki?.summary || "No description available.";
            const cleanSummary = rawSummary.split('<a href')[0].trim();

            // 3. Extract tags
            const tags = albumData.tags?.tag?.map(t => t.name).join(', ') || 'Music';

            // 3. Calculate total duration
            let totalDuration = 0;
            if (albumData.tracks && albumData.tracks.track) {
                const trackList = Array.isArray(albumData.tracks.track) ? albumData.tracks.track : [albumData.tracks.track];
                totalDuration = trackList.reduce((acc, curr) => acc + (parseInt(curr.duration) || 0), 0);
            }
            const durationStr = totalDuration > 0 ? `${Math.floor(totalDuration / 60)}m • ` : '';

            // 5. Now initialize the data object
            data = {
                title: albumData.name,
                overview: cleanSummary,
                poster_path: img,
                meta: `${albumData.artist} • ${durationStr}${tags}`,
                tracks: albumData.tracks?.track || [],
                artistName: albumData.artist
            };
        }
        // --- 2. BOOK FETCH ---
        else if (type === 'book') {
            // Safely fetch and catch any 404 errors from OpenLibrary
            const res = await fetch(`https://openlibrary.org${id}.json`).then(r => r.json()).catch(() => ({}));
            
            if (res.error || !res.title) {
                alert("Book not found. It may have been removed or merged by OpenLibrary.");
                window.location.href = 'index.html';
                return;
            }

            let editionsRes = {};
            try {
                const edFetch = await fetch(`https://openlibrary.org${id}/editions.json`);
                if (edFetch.ok) {
                    editionsRes = await edFetch.json();
                }
            } catch (e) {
                console.warn("Editions data missing for this book.");
            }

            let firstAuthorName = '';
            if (res.authors && res.authors.length > 0) {
                try {
                    const authorKey = res.authors[0].author.key;
                    const authorFetch = await fetch(`https://openlibrary.org${authorKey}.json`);
                    if (authorFetch.ok) {
                        const authorJson = await authorFetch.json();
                        firstAuthorName = authorJson.name;
                    }
                } catch (e) {
                    console.warn("Author data missing for this book.");
                }
            }

            // NEW: Actually packaging the fetched data into the global `data` object
            let pageCount = 0;
            if (editionsRes.entries && editionsRes.entries.length > 0) {
                const edWithPages = editionsRes.entries.find(e => e.number_of_pages);
                if (edWithPages) pageCount = edWithPages.number_of_pages;
            }

            let coverImg = 'https://via.placeholder.com/500x750/1b2228/9ab?text=No+Cover';
            if (res.covers && res.covers.length > 0) {
                coverImg = `https://covers.openlibrary.org/b/id/${res.covers[0]}-L.jpg`;
            }

            data = {
                title: res.title,
                overview: typeof res.description === 'string' ? res.description : (res.description?.value || 'No overview available.'),
                poster_path: coverImg,
                backdrop: null, 
                meta: `${res.first_publish_date || 'Unknown Year'} • Book • ${pageCount ? pageCount + ' Pages' : 'Pages Unknown'}`,
                pages: pageCount,
                authors: res.authors || [],
                authorName: firstAuthorName
            };
        }
        // --- 3. MOVIE & TV FETCH ---
        else {
            const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, tmdbOptions).then(r => r.json());
            
            // ISO Language name mapper
            let mainLanguageName = res.original_language ? res.original_language.toUpperCase() : 'Unknown';
            try {
                const langRes = await fetch(`https://api.themoviedb.org/3/configuration/languages`, tmdbOptions).then(r => r.json());
                const matchedLang = langRes.find(l => l.iso_639_1 === res.original_language);
                if (matchedLang) mainLanguageName = matchedLang.english_name;
            } catch(e) { console.warn("Language config error", e); }

            // Fetch Translations dynamically
            let translationArray = [];
            try {
                const transRes = await fetch(`https://api.themoviedb.org/3/${type}/${id}/translations`, tmdbOptions).then(r => r.json());
                if (transRes.translations) {
                    // Extract just the english names and sort them alphabetically
                    translationArray = transRes.translations.map(t => t.english_name).sort();
                }
            } catch(e) { console.warn("Translations config error", e); }

            // Calculate runtime/duration
            let runtimeStr = '';
            if (type === 'movie' && res.runtime) {
                runtimeStr = `${res.runtime}m • `;
            } else if (type === 'tv') {
                if (res.episode_run_time && res.episode_run_time.length > 0) {
                    // TMDB returns an array of runtimes for TV shows, calculate the average
                    const sum = res.episode_run_time.reduce((a, b) => a + b, 0);
                    const avg = Math.round(sum / res.episode_run_time.length);
                    runtimeStr = `${avg}m • `; 
                } else if (res.last_episode_to_air && res.last_episode_to_air.runtime) {
                    // Fallback since TMDB sometimes omits the main array
                    runtimeStr = `${res.last_episode_to_air.runtime}m • `;
                }
            }

            data = {
                title: res.title || res.name,
                overview: res.overview,
                poster_path: `https://image.tmdb.org/t/p/w500${res.poster_path}`,
                backdrop: res.backdrop_path ? `https://image.tmdb.org/t/p/original${res.backdrop_path}` : null,
                meta: `${(res.release_date || res.first_air_date || '').split('-')[0]} • ${runtimeStr}${res.genres?.map(g => g.name).join(', ')} • ${mainLanguageName}`,
                translations: translationArray
            };
        }

        globalData = data;

        if (!globalData.backdrop && globalData.poster_path) {
            globalData.backdrop = globalData.poster_path;
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user) {
            const { data: customArt } = await supabaseClient.from('custom_imgs').select('*').eq('user_id', session.user.id).eq('media_id', String(id)).eq('media_type', type).maybeSingle();
            if (customArt) {
                if (customArt.custom_poster) globalData.poster_path = customArt.custom_poster;
                if (customArt.custom_background) globalData.backdrop = customArt.custom_background;
            }
        }

        document.getElementById('media-title').textContent = data.title;
        document.getElementById('media-overview').textContent = data.overview;
        document.getElementById('media-meta').textContent = data.meta;
        
        // INJECT TRANSLATIONS SECTION ---
        if (data.translations && data.translations.length > 0) {
            const pillStyle = `background: rgba(255,255,255,0.05); border: 1px solid #2c3440; color: #ccd6e0; padding: 4px 10px; border-radius: 8px; font-size: 0.8rem; cursor: default; transition: all 0.2s ease; display: inline-block;`;
            const hoverEvents = `onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='#fff'; this.style.borderColor='var(--accent)';" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='#ccd6e0'; this.style.borderColor='#2c3440';"`;

            const transHtml = `
            <div id="translations-section" class="history-section" style="margin-top: 20px;">
                <h4>Translations</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${data.translations.map(lang => `<span style="${pillStyle}" ${hoverEvents}>${lang}</span>`).join('')}
                </div>
            </div>`;
            
            // Insert cleanly right below the Fandom button wrapper
            const fandomContainer = document.getElementById('fandom-btn').parentElement;
            if (fandomContainer) {
                fandomContainer.insertAdjacentHTML('afterend', transHtml);
            }
        }
        
        if (globalData.backdrop) {
            document.getElementById('backdrop-overlay').style.backgroundImage = `url(${globalData.backdrop})`;
        }

        // --- YOUTUBE POSTER, PROVIDERS, & CAST RENDERING ---
        if (type === 'youtube') {
            // Replace static poster with a responsive 16:9 playable iframe
            document.getElementById('poster-area').innerHTML = `
                <div style="position: relative; width: 100%; padding-bottom: 56.25%; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
                    <iframe 
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;" 
                        src="https://www.youtube.com/embed/${id}" 
                        title="${data.title}" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                        allowfullscreen>
                    </iframe>
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
        // --- ALBUM POSTER & TRACKLIST RENDERING ---
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
            const finalPoster = globalData.poster_path || 'https://placehold.co/500x750/1b2228/9ab?text=No+Cover';
            document.getElementById('poster-area').innerHTML = `<img src="${finalPoster}" alt="poster" data-type="${type}">`;
        }

        document.getElementById('go-to-log').onclick = () => {
            window.location.href = `log.html?id=${encodeURIComponent(id)}&type=${type}`;
        };

        // --- FANDOM BUTTON LOGIC ---
        const fandomBtn = document.getElementById('fandom-btn');
        if (fandomBtn) {
            // Hide the button for books, albums, and youtube videos
            if (type === 'book' || type === 'youtube' || type === 'album') {
                fandomBtn.style.display = 'none';
            } else {
                // Show it and set the click handler for Movies and TV Shows
                fandomBtn.style.display = 'block';
                fandomBtn.onclick = () => {
                    window.location.href = `fandom.html?id=${encodeURIComponent(id)}&type=${type}`;
                };
            }
        }

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
            fillerInfo.textContent = ""; // Clear default text

            try {
                // 1. Check if we have the file locally
                const fillerFile = await fetch(`animeFillerListApi/data/${slug}.json`);
                let hasFiller = false;
                let fillerData = null;
                
                if (fillerFile.ok) {
                    fillerData = await fillerFile.json();
                    if (!fillerData.error) hasFiller = true;
                }

                // 2. Check DB for pending requests
                const { data: existingRequest } = await supabaseClient
                    .from('filler_list_mgnt')
                    .select('filler_exists, notes')
                    .eq('name', slug)
                    .maybeSingle();

                // 3. Build UI
                // 3. Build UI
                let html = '';
                
                // View Button (if exists)
                if (hasFiller) {
                    html += `
                        <button id="view-filler-btn" class="primary-btn" style="background: #ff9800; width: 100%; margin-bottom: 10px; padding: 10px 20px;">
                            View Filler Episodes
                        </button>
                    `;
                } else {
                    html += `<p class="meta" style="margin-top: 0; margin-bottom: 15px;">Filler list data not found.</p>`;
                }

                // Check if there is an active pending request (a record exists, but no notes yet)
                const isPending = existingRequest && !existingRequest.notes;

                if (isPending) {
                    html += `<div class="meta" style="font-size: 0.85rem; color: #ff9800;">${hasFiller ? 'Update' : 'List'} request pending... check back soon!</div>`;
                } else {
                    // Show previous scraper notes if they exist (e.g., "Successfully scraped")
                    if (existingRequest && existingRequest.notes) {
                        html += `<div class="meta" style="font-size: 0.85rem; margin-bottom: 10px;">Status: ${existingRequest.notes}</div>`;
                    }
                    
                    // Always render the request button if it's not actively pending!
                    const btnText = hasFiller ? "Request a Filler List Update" : "Request Filler List";
                    html += `
                        <button id="request-filler-btn" class="secondary-btn" style="width: 100%; border-color: #ff9800; color: #ff9800;">
                            ${btnText}
                        </button>
                    `;
                }

                fillerAction.innerHTML = html;

                // Attach listeners dynamically
                if (hasFiller) {
                    document.getElementById('view-filler-btn').onclick = () => openFillerModal(fillerData);
                }
                
                // Only attach the request listener if the button was actually rendered
                if (!isPending) {
                    document.getElementById('request-filler-btn').onclick = () => requestFiller(slug, hasFiller);
                }

            } catch (e) {
                console.error("Filler fetch error:", e);
                fillerInfo.textContent = "Error loading filler data.";
            }
        }

        fetchMediaHistory();
        fetchFollowingLogs();
        setupWatchlist(id, type);
        setupListManager(id, type);
        setupStatusManager(id, type);
        setupCustomArt(id, type);
        setupFavoritesManager(id, type)

        if (['movie', 'tv', 'book'].includes(type)) {
            loadSimilar('all');
        }

        checkAndQueueMedia(id, type, config);
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

    // Dynamically set the active label based on all media types
    let activeLabelText = 'Currently Watching'; // Default for movies/tv/youtube
    if (mediaType === 'book') activeLabelText = 'Currently Reading';
    else if (mediaType === 'album') activeLabelText = 'Currently Listening';

    // Map labels for the UI
    const labels = {
        active: activeLabelText,
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
    const activeLabelElement = modal.querySelector('[data-status="active"] .status-label-text');
    if (activeLabelElement) activeLabelElement.textContent = labels.active;

    // 2. Open/Close Modal
    statusBtn.onclick = () => modal.style.display = 'flex'
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
                        media_title: globalData.title,
                        status: selectedStatus,
                        image_url: globalData.poster_path,
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
    if (mediaType === 'book' || mediaType === 'youtube' || mediaType === 'album') return;
    const castList = document.getElementById('cast-list');
    
    // Switch to aggregate_credits for TV shows to get total episode counts
    const endpoint = mediaType === 'tv' ? 'aggregate_credits' : 'credits';
    const url = `https://api.themoviedb.org/3/${mediaType}/${mediaId}/${endpoint}?language=en-US`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` }
        });

        const text = await response.text();
        if (text.startsWith('\x1F\x8B')) throw new Error("TMDB returned raw corrupted GZIP data.");
        
        const res = JSON.parse(text);
        if (!res || !res.crew || !res.cast) return;

        // Normalize TV vs Movie data structures so the rest of the app doesn't have to guess
        if (mediaType === 'tv') {
            fullCastData = res.cast.map(p => ({
                ...p,
                displayRole: p.roles && p.roles.length > 0 ? p.roles[0].character : 'Cast',
                epCountStr: p.total_episode_count ? `${p.total_episode_count} Ep${p.total_episode_count > 1 ? 's' : ''}` : ''
            }));

            fullCrewData = res.crew.map(p => ({
                ...p,
                job: p.jobs && p.jobs.length > 0 ? p.jobs[0].job : 'Crew',
                displayRole: p.jobs && p.jobs.length > 0 ? p.jobs[0].job : 'Crew',
                epCountStr: p.total_episode_count ? `${p.total_episode_count} Ep${p.total_episode_count > 1 ? 's' : ''}` : ''
            }));
        } else {
            fullCastData = res.cast.map(p => ({
                ...p,
                displayRole: p.character || 'Cast',
                epCountStr: ''
            }));

            fullCrewData = res.crew.map(p => ({
                ...p,
                job: p.job,
                displayRole: p.job || 'Crew',
                epCountStr: ''
            }));
        }

        // Store the global data
        directorData = fullCrewData.find(person => 
            person.job === 'Director' || (person.job === 'Executive Producer' && mediaType === 'tv')
        );

        renderMainPageCast();

    } catch (err) { 
        console.error("Credits error:", err); 
        castList.innerHTML = `<p class="meta">Cast information is currently unavailable.</p>`;
    }
}

async function setupFavoritesManager(mediaId, mediaType) {
    const btn = document.getElementById('favorite-heart-btn');
    const modal = document.getElementById('favorites-modal');
    const closeBtn = document.getElementById('close-fav-modal');
    const container = document.getElementById('fav-slots-container');

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        btn.style.display = 'none';
        return;
    }

    let userFavorites = { movie: [], tv: [], book: [], album: [], youtube: [], all: [] };

    // Fetch current favorites
    const { data: profile } = await supabaseClient.from('profiles').select('favorites').eq('id', user.id).single();
    if (profile && profile.favorites) {
        userFavorites = profile.favorites;
    }

    // Check if it's already a favorite to style the heart solid
    const currentCategoryList = userFavorites[mediaType] || [];
    const isAlreadyFav = currentCategoryList.some(fav => String(fav.id) === String(mediaId));
    if (isAlreadyFav) {
        btn.textContent = '♥';
        btn.style.color = '#ff4d4d'; // Red heart
    }

    btn.onclick = () => {
        modal.style.display = 'flex';
        renderFavSlots();
    };

    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    const renderFavSlots = () => {
        const list = userFavorites[mediaType] || [];
        container.innerHTML = '';
        
        // Loop through the 5 possible slots
        for (let i = 0; i < 5; i++) {
            const currentItem = list[i];
            const slotDiv = document.createElement('div');
            slotDiv.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid #2c3440; border-radius: 8px; cursor: pointer; transition: background 0.2s;";
            
            slotDiv.onmouseover = () => slotDiv.style.background = 'rgba(255,255,255,0.1)';
            slotDiv.onmouseout = () => slotDiv.style.background = 'rgba(255,255,255,0.05)';

            if (currentItem) {
                // If the slot is occupied by THIS media, show "Remove" state
                if (String(currentItem.id) === String(mediaId)) {
                    slotDiv.style.borderColor = '#ff4d4d';
                    slotDiv.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: bold; color: #ff4d4d;">#${i + 1}</span>
                            <span style="color: #fff; font-weight: 500;">${currentItem.title}</span>
                        </div>
                        <span style="color: #ff4d4d; font-size: 0.8rem; font-weight: bold;">REMOVE</span>
                    `;
                    slotDiv.onclick = () => updateFavorite(i, null);
                } else {
                    // Show existing media and "Replace" state
                    slotDiv.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: bold; color: #9ab;">#${i + 1}</span>
                            <span style="color: #ccd6e0; font-size: 0.95rem;">${currentItem.title}</span>
                        </div>
                        <span style="color: var(--accent); font-size: 0.8rem; font-weight: bold;">REPLACE</span>
                    `;
                    slotDiv.onclick = () => updateFavorite(i, mediaId);
                }
            } else {
                // Empty slot
                slotDiv.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-weight: bold; color: #9ab;">#${i + 1}</span>
                        <span style="color: #678; font-style: italic; font-size: 0.95rem;">Empty Slot</span>
                    </div>
                    <span style="color: #00e054; font-size: 0.8rem; font-weight: bold;">ADD HERE</span>
                `;
                slotDiv.onclick = () => updateFavorite(i, mediaId);
            }
            container.appendChild(slotDiv);
        }
    };

    const updateFavorite = async (index, newMediaId) => {
        if (!userFavorites[mediaType]) userFavorites[mediaType] = [];
        
        if (newMediaId === null) {
            // Remove
            userFavorites[mediaType].splice(index, 1);
            btn.textContent = '♡';
            btn.style.color = '#2c3440';
        } else {
            // Replace / Add
            // Make sure to remove it from elsewhere in the list to prevent duplicates
            userFavorites[mediaType] = userFavorites[mediaType].filter(item => String(item.id) !== String(newMediaId));
            
            const newFavObject = {
                id: mediaId,
                title: globalData.title,
                type: mediaType,
                image: globalData.poster_path
            };

            // Insert at specific index, or push if array is shorter
            if (index >= userFavorites[mediaType].length) {
                userFavorites[mediaType].push(newFavObject);
            } else {
                userFavorites[mediaType][index] = newFavObject;
            }

            btn.textContent = '♥';
            btn.style.color = '#ff4d4d';
        }

        // Sync to "all" list (top 1 of each)
        const topMovie = userFavorites.movie?.[0];
        const topTv = userFavorites.tv?.[0];
        const topBook = userFavorites.book?.[0];
        const topAlbum = userFavorites.album?.[0];
        const topYoutube = userFavorites.youtube?.[0];
        userFavorites.all = [topMovie, topTv, topBook, topAlbum, topYoutube].filter(Boolean);

        // Save to DB
        await supabaseClient.from('profiles').update({ favorites: userFavorites }).eq('id', user.id);
        
        renderFavSlots(); // Re-render visually to confirm change
    };
}

function renderMainPageCast() {
    const castList = document.getElementById('cast-list');
    const castSection = document.getElementById('cast-section');
    let finalDisplayList = [];

    // 1. Add Director First
    if (directorData) {
        finalDisplayList.push({
            ...directorData,
            isDirector: true
        });
    }

    // 2. Render Top 11
    const castToShow = fullCastData.slice(0, 11);
    castToShow.forEach(actor => finalDisplayList.push(actor));

    castList.innerHTML = finalDisplayList.map(person => `
        <div class="cast-card ${person.isDirector ? 'director-highlight' : ''}" 
             onclick="window.location.href='cast.html?personId=${person.id}'">
            <img src="${person.profile_path ? 'https://image.tmdb.org/t/p/w185' + person.profile_path : 'https://via.placeholder.com/185x278?text=No+Photo'}" alt="${person.name}">
            <div class="cast-info">
                <span class="cast-name">${person.name}</span>
                <span class="cast-role">${person.displayRole} ${person.isDirector ? '🎬' : ''}</span>
                ${person.epCountStr ? `<span style="display:block; font-size: 0.75rem; color: var(--accent); margin-top: 2px;">${person.epCountStr}</span>` : ''}
            </div>
        </div>
    `).join('');

    // 3. Add Modal Trigger Button
    let viewAllBtn = document.getElementById('view-all-cast-btn');
    if (!viewAllBtn && (fullCastData.length > 11 || fullCrewData.length > 1)) {
        viewAllBtn = document.createElement('button');
        viewAllBtn.id = 'view-all-cast-btn';
        viewAllBtn.textContent = 'View Full Cast & Crew';
        viewAllBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.05); border: 1px solid #2c3440;
            color: #9ab; padding: 12px; border-radius: 8px; cursor: pointer;
            transition: all 0.2s ease; width: 100%; margin-top: 20px; font-weight: bold; font-size: 0.9rem;
        `;
        
        viewAllBtn.onmouseover = () => {
            viewAllBtn.style.color = '#fff'; viewAllBtn.style.background = 'rgba(255, 255, 255, 0.1)'; viewAllBtn.style.borderColor = 'var(--accent)';
        };
        viewAllBtn.onmouseout = () => {
            viewAllBtn.style.color = '#9ab'; viewAllBtn.style.background = 'rgba(255, 255, 255, 0.05)'; viewAllBtn.style.borderColor = '#2c3440';
        };

        viewAllBtn.onclick = () => openCastModal();
        castSection.appendChild(viewAllBtn);
    }
}

function openCastModal() {
    const modal = document.getElementById('cast-modal');
    const closeBtn = document.getElementById('close-cast-modal');
    const searchInput = document.getElementById('cast-search-input');
    const grid = document.getElementById('full-cast-grid');
    
    // Combine Cast and Crew into one mega-list
    const combinedList = [...fullCastData, ...fullCrewData];

    // Function to render the grid based on search text
    const renderGrid = (filterText = '') => {
        const lowerFilter = filterText.toLowerCase();
        
        const filtered = combinedList.filter(person => 
            person.name.toLowerCase().includes(lowerFilter) || 
            person.displayRole.toLowerCase().includes(lowerFilter)
        );

        if (filtered.length === 0) {
            grid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align: center;">No cast or crew found matching "${filterText}".</p>`;
            return;
        }

        grid.innerHTML = filtered.map(person => `
            <div class="cast-card ${person.job === 'Director' ? 'director-highlight' : ''}" 
                 onclick="window.location.href='cast.html?personId=${person.id}'">
                <img src="${person.profile_path ? 'https://image.tmdb.org/t/p/w185' + person.profile_path : 'https://via.placeholder.com/185x278?text=No+Photo'}" 
                     alt="${person.name}" loading="lazy">
                <div class="cast-info">
                    <span class="cast-name">${person.name}</span>
                    <span class="cast-role">${person.displayRole} ${person.job === 'Director' ? '🎬' : ''}</span>
                    ${person.epCountStr ? `<span style="display:block; font-size: 0.75rem; color: var(--accent); margin-top: 2px;">${person.epCountStr}</span>` : ''}
                </div>
            </div>
        `).join('');
    };

    // Initialize Modal
    searchInput.value = '';
    renderGrid();

    // Attach Search Listener
    searchInput.oninput = (e) => renderGrid(e.target.value);

    // Open & Close Logic
    modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
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
        media_title: globalData.title,
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

    // If authorName is missing, just search by title for shopping links
    const searchTerms = authorName ? `${title} ${authorName}` : title;
    const query = encodeURIComponent(searchTerms);

    const logos = {
        worldcat: "https://search.worldcat.org/favicons/android-chrome-192x192.png",
        bwb: "https://www.betterworldbooks.com/images/logos/favicon.ico",
        amazon: "https://www.amazon.com/favicon.ico",
        thriftbooks: "https://static.thriftbooks.com/images/favicon.ico",
        chirp: "https://www.chirpbooks.com/favicon.ico"
    };

    // Build Dynamic Trailer Query for Books
    let yearPart = globalData.meta.split(' • ')[0].trim();
    if (yearPart === 'Unknown Year' || !/^\d{4}$/.test(yearPart)) yearPart = '';
    const trailerQuery = encodeURIComponent(`${title} ${yearPart ? yearPart + ' ' : ''}book trailer`);

    list.innerHTML = `
        <div class="provider-group">
            <span class="provider-type-label">Check nearby libraries</span>
            <div class="provider-icons">
                <a href="https://search.worldcat.org/search?q=${query}" target="_blank" style="text-decoration: none; display: inline-block;">
                    <img src="${logos.worldcat}" class="provider-logo" title="WorldCat" style="background: white; object-fit: contain;">
                </a>
            </div>
        </div>
        <div class="provider-group">
            <span class="provider-type-label">Buy Used or New</span>
            <div class="provider-icons">
                <a href="https://www.thriftbooks.com/browse/?b.search=${query}" target="_blank" style="text-decoration: none; display: inline-block;">
                    <img src="${logos.thriftbooks}" class="provider-logo" title="ThriftBooks" style="background: white; object-fit: contain;">
                </a>
                <a href="https://www.betterworldbooks.com/search/results?q=${query}" target="_blank" style="text-decoration: none; display: inline-block;">
                    <img src="${logos.bwb}" class="provider-logo" title="Better World Books" style="background: white; object-fit: contain;">
                </a>
                <a href="https://www.amazon.com/s?k=${query}" target="_blank" style="text-decoration: none; display: inline-block;">
                    <img src="${logos.amazon}" class="provider-logo" title="Amazon" style="background: white; object-fit: contain;">
                </a>
            </div>
        </div>
        <div class="provider-group">
            <span class="provider-type-label">Audiobooks</span>
            <div class="provider-icons">
                <a href="https://www.chirpbooks.com/search?q=${query}" target="_blank" style="text-decoration: none; display: inline-block;">
                    <img src="${logos.chirp}" class="provider-logo" title="Chirp" style="background: white; object-fit: contain;">
                </a>
            </div>
        </div>
        <div class="provider-group">
            <span class="provider-type-label">Trailer</span>
            <div class="provider-icons">
                <a href="https://www.youtube.com/results?search_query=${trailerQuery}" target="_blank" style="text-decoration: none; display: inline-block;">
                    <img src="https://www.youtube.com/s/desktop/40cd5ddc/img/favicon_144x144.png" class="provider-logo" title="YouTube Trailer" style="background: transparent; border: none; object-fit: contain;">
                </a>
            </div>
        </div>
    `;
}

async function setupHeader() {
    const searchInput = document.getElementById('search-input');
    const searchFilter = document.getElementById('search-filter');
    const loginBtn = document.getElementById('login-btn');
    const profileMenu = document.getElementById('profile-menu');

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim() !== "") {
            const filterVal = searchFilter ? searchFilter.value : 'all';
            window.location.href = `index.html?search=${encodeURIComponent(searchInput.value)}&filter=${filterVal}`;
        }
    });

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        // User is logged in: Hide Sign In, Show Profile Menu
        loginBtn.style.display = 'none'; 
        profileMenu.style.display = 'inline-block';
        
        const avatar = document.getElementById('nav-avatar');
        if (user.user_metadata && user.user_metadata.avatar_url) {
            avatar.src = user.user_metadata.avatar_url;
        }
    } else {
        // Not logged in: Show Sign In, Hide Profile Menu
        loginBtn.style.display = 'inline-block';
        profileMenu.style.display = 'none';
        loginBtn.textContent = "Sign In";
        loginBtn.onclick = () => window.location.href = 'index.html'; 
    }
}

// --- NEW PROFILE DROPDOWN LOGIC ---

function toggleProfileDropdown(event) {
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
    
    // Safety check in case the elements haven't loaded
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
}

async function signOut() {
    await supabaseClient.auth.signOut();
    location.reload();
}

async function setupTVTracker(config, seriesId) {
    const trackerSection = document.getElementById('tv-tracker');
    trackerSection.style.display = 'block';
    const seasonSelector = document.getElementById('season-selector');
    const markBtn = document.getElementById('mark-season-btn');
    const clearBtn = document.getElementById('clear-season-btn');
    
    // Inject dynamic season description container if it doesn't exist yet
    let seasonDescEl = document.getElementById('season-description');
    if (!seasonDescEl) {
        seasonDescEl = document.createElement('p');
        seasonDescEl.id = 'season-description';
        seasonDescEl.className = 'meta';
        seasonDescEl.style.cssText = 'margin: 10px 0 20px 0; font-style: italic; font-size: 0.95rem; line-height: 1.5; color: #ccd6e0;';
        seasonSelector.parentNode.insertAdjacentElement('afterend', seasonDescEl);
    }
    
    try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}?language=en-US`, {
            headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` }
        });
        const res = await response.json();

        // 1. Fetch TVMaze data matching via external IMDB or TMDB ID mappings
        let tvmazeId = null;
        try {
            const extRes = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}/external_ids`, {
                headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` }
            }).then(r => r.json());

            let lookupUrl = '';
            if (extRes.imdb_id) lookupUrl = `https://api.tvmaze.com/lookup/shows?imdb=${extRes.imdb_id}`;
            else lookupUrl = `https://api.tvmaze.com/lookup/shows?thetvdb=${extRes.thetvdb_id}`;

            const tvmazeShow = await fetch(lookupUrl).then(r => r.json());
            if (tvmazeShow && tvmazeShow.id) tvmazeId = tvmazeShow.id;
        } catch(e) { console.warn("TVMaze show link unavailable, falling back.", e); }

        seasonSelector.innerHTML = res.seasons.map(s => `<option value="${s.season_number}">${s.name}</option>`).join('');
        
        // Define clean event handler wrapper
        const onSeasonChange = () => {
            const currentSeason = seasonSelector.value;
            loadEpisodes(config, seriesId, currentSeason, tvmazeId);
            updateSeasonDescription(tvmazeId, currentSeason);
        };
        
        seasonSelector.onchange = onSeasonChange;
        
        const defaultSeason = res.seasons.find(s => s.season_number === 1) || res.seasons[0];
        if (defaultSeason) {
            seasonSelector.value = defaultSeason.season_number;
            onSeasonChange();
        }

        markBtn.onclick = () => markSeasonAsWatched();
        clearBtn.onclick = () => clearSeasonProgress();
    } catch (err) {
        trackerSection.innerHTML = `<h3>Episode Tracker</h3><p class="meta">Error connecting to tracker pipeline.</p>`;
    }
}

async function updateSeasonDescription(tvmazeId, seasonNum) {
    const descEl = document.getElementById('season-description');
    if (!descEl) return;
    descEl.textContent = "Loading season context...";
    
    if (!tvmazeId) {
        descEl.textContent = "Description unavailable for this season mapping.";
        return;
    }

    try {
        const seasons = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/seasons`).then(r => r.json());
        const currentSeasonData = seasons.find(s => String(s.number) === String(seasonNum));
        if (currentSeasonData && currentSeasonData.summary) {
            // Clean up html tags injected inside summaries safely via standard text content DOM injections
            const tmp = document.createElement('div');
            tmp.innerHTML = currentSeasonData.summary;
            descEl.textContent = tmp.textContent || tmp.innerText;
        } else {
            descEl.textContent = "No description description provided for this season.";
        }
    } catch(e) {
        descEl.textContent = "Description unavailable.";
    }
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
                label = globalData.tracks[log.episode_number - 1].name;
            } else {
                label = 'Entire Album';
            }
        }

        let rewatchText = 'Rewatch';
        if (type === 'book') rewatchText = 'Reread';
        else if (type === 'album') rewatchText = 'Relisten';
        
        const heartBadge = log.is_liked ? `<span title="Liked" style="display: flex; align-items: center;">❤️</span>` : '';
        const rewatchBadge = log.is_rewatch ? 
            `<span title="${rewatchText}" style="font-size: 0.85rem; display: flex; align-items: center;">🔁</span>` 
            : '';
            
        const badgeRow = (log.is_liked || log.is_rewatch) ? 
            `<div style="display: flex; gap: 10px; margin-top: 6px; margin-bottom: 2px;">
                ${heartBadge}
                ${rewatchBadge}
            </div>` : '';
        
        const stars = '★'.repeat(Math.floor(log.rating)) + (log.rating % 1 !== 0 ? '½' : '');

        const targetDate = log.watched_on ? log.watched_on : log.created_at.split('T')[0];
        const logDate = new Date(targetDate + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        const reviewPreview = log.notes ? `<div class="history-notes">"${log.notes}"</div>` : '';
        
        const tagsHtml = (log.tags && log.tags.length > 0) ? 
            `<div class="log-tags-container">
                ${log.tags.map(tag => `<span class="log-tag-pill">${tag}</span>`).join('')}
            </div>` : '';

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
                <div class="history-date">Watched on ${logDate}</div>
                ${reviewPreview}
                ${tagsHtml}
            </div>
        `;
    }).join('');
}

async function loadEpisodes(config, seriesId, seasonNum, tvmazeId) {
    const list = document.getElementById('episode-list');
    list.innerHTML = 'Loading episodes...';
    tvmazeEpisodesMap = {}; // Reset local cache frame
    
    try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNum}?language=en-US`, {
            headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` }
        });
        const res = await response.json();

        // Populate TVMaze episode data cache framework asynchronously
        if (tvmazeId) {
            try {
                const tvmazeEps = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/episodes?special=1`).then(r => r.json());
                tvmazeEps.forEach(ep => {
                    if (String(ep.season) === String(seasonNum)) {
                        tvmazeEpisodesMap[String(ep.number)] = ep;
                    }
                });
            } catch(e) { console.warn("Failed caching TVMaze episode metadata structures.", e); }
        }

        const { data: { user } } = await supabaseClient.auth.getUser();
        let watchedSet = new Set();
        if (user) {
            const { data: watched } = await supabaseClient.from('episode_logs')
                .select('episode_number').eq('series_id', String(seriesId)).eq('season_number', seasonNum).eq('user_id', user.id);
            if (watched) watchedSet = new Set(watched.map(w => w.episode_number));
        }

        list.innerHTML = res.episodes.map(ep => `
            <div class="episode-item" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px;">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                    <input type="checkbox" id="ep-${ep.episode_number}" ${watchedSet.has(ep.episode_number) ? 'checked' : ''} 
                        onclick="event.stopPropagation(); toggleEpisode('${seriesId}', ${seasonNum}, ${ep.episode_number})">
                    <label style="cursor: pointer; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" 
                           onclick="openEpisodeModal('${ep.episode_number}', '${(ep.name || 'Untitled').replace(/'/g, "\\'")}', '${seasonNum}')">
                        E${ep.episode_number}: <span style="text-decoration: underline; color: var(--accent);">${ep.name || 'Untitled'}</span>
                    </label>
                </div>
            </div>
        `).join('');
        updateUnifiedProgress(watchedSet.size, res.episodes.length, "episodes watched");
    } catch (err) { 
        console.error("Episode load error:", err);
        list.innerHTML = "<p class='meta'>Error loading episodes.</p>"; 
    }
}

async function openEpisodeModal(epNum, fallbackTitle, seasonNum) {
    const modal = document.getElementById('episode-modal');
    const closeBtn = document.getElementById('close-episode-modal');
    
    const imgEl = document.getElementById('modal-episode-img');
    const titleEl = document.getElementById('modal-episode-title');
    const metaEl = document.getElementById('modal-episode-meta');
    const overviewEl = document.getElementById('modal-episode-overview');
    const castContainer = document.getElementById('modal-episode-cast');

    titleEl.textContent = fallbackTitle;
    metaEl.textContent = `Episode ${epNum}`;
    overviewEl.textContent = "No overview description available.";
    castContainer.innerHTML = '';
    imgEl.src = 'https://via.placeholder.com/320x180/1b2228/9ab?text=No+Image';

    const localData = tvmazeEpisodesMap[String(epNum)];
    if (localData) {
        if (localData.name) titleEl.textContent = localData.name;
        if (localData.image && localData.image.medium) imgEl.src = localData.image.medium;
        if (localData.airdate) metaEl.textContent = `Episode ${epNum} • Aired ${localData.airdate}`;
        
        if (localData.summary) {
            const div = document.createElement('div');
            div.innerHTML = localData.summary;
            overviewEl.textContent = div.textContent || div.innerText;
        }

        // Deep-fetch Guest Cast structure directly from TMDB natively to ensure flawless Actor Cast routing
        try {
            const config = await fetch('config.json').then(r => r.json());
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNum}/episode/${epNum}/credits?language=en-US`, {
                headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` }
            }).then(r => r.json());
            
            if (tmdbRes && tmdbRes.guest_stars && tmdbRes.guest_stars.length > 0) {
                castContainer.innerHTML = tmdbRes.guest_stars.map(g => {
                    const img = g.profile_path ? `https://image.tmdb.org/t/p/w185${g.profile_path}` : 'https://via.placeholder.com/60x60/1b2228/9ab?text=No+Photo';
                    
                    // Route using personId (TMDB ID) instead of characterWiki!
                    return `
                        <div onclick="window.location.href='cast.html?personId=${g.id}'" 
                            style="cursor: pointer; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 6px; font-size: 0.8rem; display: flex; flex-direction: column; align-items: center; text-align: center; transition: background 0.2s, transform 0.2s;"
                            onmouseover="this.style.background='rgba(255,255,255,0.08)'; this.style.transform='scale(1.03)';"
                            onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.transform='scale(1)';">
                            <img src="${img}" style="width: 45px; height: 45px; object-fit: cover; border-radius: 50%; margin-bottom: 6px; border: 1px solid #2c3440;">
                            <span style="font-weight: bold; color: #fff; display: block; overflow: hidden; text-overflow: ellipsis; max-width: 100%; white-space: nowrap;">${g.name}</span>
                            <span style="color: #9ab; font-size: 0.7rem; display: block; overflow: hidden; text-overflow: ellipsis; max-width: 100%; white-space: nowrap; margin-top: 2px;">${g.character || 'Guest'}</span>
                        </div>
                    `;
                }).join('');
            } else {
                castContainer.innerHTML = '<p class="meta" style="font-size: 0.8rem; margin: 0;">No guest cast recorded.</p>';
            }
        } catch(e) { 
            console.error(e);
            castContainer.innerHTML = '<p class="meta" style="font-size: 0.8rem; margin: 0;">Guest cast lookups failed.</p>'; 
        }
    }

    modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
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
    
    try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNum}?language=en-US`, { 
            headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
        });
        
        const text = await response.text();
        const res = JSON.parse(text);
        
        const logs = res.episodes.map(ep => ({ user_id: user.id, series_id: String(id), season_number: seasonNum, episode_number: ep.episode_number }));
        
        // Delete existing logs for this specific season to prevent duplicates/errors
        await supabaseClient.from('episode_logs').delete()
            .eq('user_id', user.id)
            .eq('series_id', String(id))
            .eq('season_number', seasonNum);
            
        // Insert the fresh, complete list
        await supabaseClient.from('episode_logs').insert(logs);
        
        loadEpisodes(config, id, seasonNum);
    } catch (err) {
        alert("Error marking season as watched.");
    }
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
    
    try {
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}/watch/providers`, { 
            headers: { Authorization: `Bearer ${config.tmdb_token}` } 
        }).then(r => r.json());
        
        const results = res.results?.US || {};
        
        // Grab ALL possible monetization arrays from TMDB to ensure maximum library depth
        const flatrate = results.flatrate || [];
        const free = results.free || [];
        const ads = results.ads || [];
        const buy = results.buy || [];
        const rent = results.rent || [];

        // 1. Compile the "FREE TO WATCH" category (AVOD + Completely Free models)
        // We combine 'free' and 'ads' arrays, then de-duplicate by provider_id
        const freeToWatchMap = new Map();
        [...free, ...ads].forEach(p => freeToWatchMap.set(p.provider_id, p));
        const freeToWatchList = Array.from(freeToWatchMap.values());

        // 2. Compile the standard "STREAM" subscriptions (SVOD)
        const streamList = [...flatrate];

        // 3. Compile the "BUY / RENT" marketplaces (TVOD)
        // Combine buy and rent, then de-duplicate by provider_id
        const buyRentMap = new Map();
        [...buy, ...rent].forEach(p => buyRentMap.set(p.provider_id, p));
        const buyRentList = Array.from(buyRentMap.values());

        // 4. Compile the "OTHER" catch-all array
        // Check if TMDB outputs other unexpected transactional styles (like premium add-on channels)
        const handledIds = new Set([
            ...freeToWatchList.map(p => p.provider_id),
            ...streamList.map(p => p.provider_id),
            ...buyRentList.map(p => p.provider_id)
        ]);
        
        const otherList = [];
        for (const key in results) {
            if (Array.isArray(results[key])) {
                results[key].forEach(p => {
                    if (!handledIds.has(p.provider_id)) {
                        otherList.push(p);
                        handledIds.add(p.provider_id); // Prevent self-duplication inside other
                    }
                });
            }
        }

        const container = document.getElementById('providers-list');
        let html = '';

        if (!freeToWatchList.length && !streamList.length && !buyRentList.length && !otherList.length) {
            html += "<p class='meta' style='margin-bottom: 15px; font-size: 0.9rem;'>Not available to stream or buy.</p>";
        } else {
            // Helper generator to build uniform icon markup blocks cleanly
            const generateGroupHtml = (label, providersArray) => {
                if (!providersArray.length) return '';
                return `
                    <div class="provider-group">
                        <span class="provider-type-label">${label}</span>
                        <div class="provider-icons">
                            ${providersArray.map(p => `
                                <img src="https://image.tmdb.org/t/p/original${p.logo_path}" 
                                     title="${p.provider_name}" class="provider-logo" alt="${p.provider_name}">
                            `).join('')}
                        </div>
                    </div>`;
            };

            // Inject structural rows matching your prioritized design order
            html += generateGroupHtml("Free to Watch", freeToWatchList);
            html += generateGroupHtml("Stream", streamList);
            html += generateGroupHtml("Buy / Rent", buyRentList);
            html += generateGroupHtml("Other Services", otherList); // Automatically hidden if empty!
        }

        // Build Dynamic Trailer Link (Appended cleanly underneath layouts)
        let yearPart = globalData.meta.split(' • ')[0].trim();
        if (yearPart === 'Unknown Year' || !/^\d{4}$/.test(yearPart)) yearPart = '';
        
        const typeStr = type === 'tv' ? 'tv show' : 'movie';
        const query = encodeURIComponent(`${globalData.title} ${yearPart ? yearPart + ' ' : ''}${typeStr} trailer`);
        
        html += `
            <div class="provider-group">
                <span class="provider-type-label">Trailer</span>
                <div class="provider-icons">
                    <a href="https://www.youtube.com/results?search_query=${query}" target="_blank">
                        <img src="https://www.youtube.com/s/desktop/40cd5ddc/img/favicon_144x144.png" class="provider-logo" title="Watch Trailer on YouTube" style="background: transparent; border: none; object-fit: contain;">
                    </a>
                </div>
            </div>`;

        container.innerHTML = html;
    } catch (err) {
        console.error("Watch providers panel failed to render:", err);
        document.getElementById('providers-list').innerHTML = "<p class='meta'>Availability data currently updating.</p>";
    }
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
            await supabaseClient.from('user_watchlist').insert({ 
                user_id: user.id, 
                media_id: String(mediaId), 
                media_type: mediaType,
                media_title: globalData.title,
                image_url: globalData.poster_path
            });
            btn.classList.add('active'); btn.textContent = 'On Watchlist';
        }
    };
}

async function setupListManager(mediaId, mediaType) {
    const btn = document.getElementById('add-to-list-btn');
    const modal = document.getElementById('list-modal');
    const close = document.getElementById('close-list-modal');
    const container = document.getElementById('user-lists-selection');
    const filterBtns = modal.querySelectorAll('.filter-btn');
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { 
        btn.style.display = 'none'; 
        return; 
    }

    let allAvailableLists = [];
    let itemsInLists = new Set();
    let currentDetailsListTab = 'owned';

    const renderDetailsListModal = () => {
        let filtered = [];
        if (currentDetailsListTab === 'owned') {
            filtered = allAvailableLists.filter(l => l.user_id === user.id && !l.is_tiered);
        } else if (currentDetailsListTab === 'shared') {
            filtered = allAvailableLists.filter(l => l.user_id !== user.id && !l.is_tiered);
        } else if (currentDetailsListTab === 'tier') {
            filtered = allAvailableLists.filter(l => l.is_tiered);
        }

        if (filtered.length === 0) {
            container.innerHTML = '<p class="meta">No lists found in this category.</p>';
            return;
        }

        container.innerHTML = filtered.map(l => {
            const isAdded = itemsInLists.has(l.id);
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

    filterBtns.forEach(fBtn => {
        fBtn.onclick = () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            fBtn.classList.add('active');
            currentDetailsListTab = fBtn.getAttribute('data-filter');
            if (allAvailableLists.length > 0) renderDetailsListModal();
        };
    });

    btn.onclick = async () => {
        modal.style.display = 'flex';
        container.innerHTML = '<p class="meta">Loading your lists...</p>';

        // STEP 1: Fetch lists the user owns
        const { data: owned } = await supabaseClient
            .from('media_lists')
            .select('id, name, is_tiered, user_id')
            .eq('user_id', user.id);

        // STEP 2: Fetch lists where the user is a collaborator
        const { data: collabEntries } = await supabaseClient
            .from('list_collaborators')
            .select('list_id, media_lists(id, name, is_tiered, user_id)')
            .eq('user_id', user.id);

        const collaborative = collabEntries?.map(e => e.media_lists).filter(Boolean) || [];

        // STEP 3: Merge and de-duplicate
        const listMap = new Map();
        [...(owned || []), ...collaborative].forEach(l => listMap.set(l.id, l));
        allAvailableLists = Array.from(listMap.values());

        if (allAvailableLists.length === 0) {
            container.innerHTML = '<p class="meta">No editable lists found.</p>';
            return;
        }

        // STEP 4: Check which lists already contain this item
        const listIds = allAvailableLists.map(l => l.id);
        const { data: currentItems } = await supabaseClient
            .from('list_items')
            .select('list_id')
            .in('list_id', listIds)
            .eq('media_id', String(mediaId));
            
        itemsInLists = new Set(currentItems?.map(item => item.list_id) || []);

        // STEP 5: Render
        renderDetailsListModal();
    };

    close.onclick = () => modal.style.display = 'none';
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

async function requestFiller(slug, isUpdate) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return alert("Please sign in to request filler lists!");

    // Use UPSERT and clear the notes to put it back into a "pending" state for your scraper
    const { error } = await supabaseClient
        .from('filler_list_mgnt')
        .upsert(
            { name: slug, filler_exists: isUpdate, notes: null }, 
            { onConflict: 'name' }
        );

    if (!error) {
        alert(isUpdate ? "Update request sent! We'll check for new episodes." : "Request sent! Our scraper will look for this soon.");
        location.reload();
    } else {
        console.error(error);
        alert("There was an error sending your request.");
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
                media_type: mediaType,
                media_title: globalData.title
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

async function setupCustomArt(mediaId, mediaType) {
    const editBtn = document.getElementById('edit-art-btn');
    const modal = document.getElementById('custom-art-modal');
    const closeBtn = document.getElementById('close-art-modal');
    const saveBtn = document.getElementById('save-art-btn');
    const posterInput = document.getElementById('custom-poster-input');
    const bgInput = document.getElementById('custom-bg-input');

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return; // Keep the button hidden if not signed in

    // 1. Show the Edit button
    editBtn.style.display = 'block';

    // 2. Fetch existing art to pre-fill the inputs if they exist
    const { data: existingArt } = await supabaseClient
        .from('custom_imgs')
        .select('*')
        .eq('user_id', user.id)
        .eq('media_id', String(mediaId))
        .eq('media_type', mediaType)
        .maybeSingle();

    // 3. Open Modal & Pre-fill
    editBtn.onclick = () => {
        posterInput.value = existingArt?.custom_poster || '';
        bgInput.value = existingArt?.custom_background || '';
        modal.style.display = 'flex';
    };

    // 4. Close Modal Handling
    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    // 5. Save the Art
    saveBtn.onclick = async () => {
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;

        const customPoster = posterInput.value.trim() || null;
        const customBg = bgInput.value.trim() || null;

        const { error } = await supabaseClient
            .from('custom_imgs')
            .upsert({
                user_id: user.id,
                media_id: String(mediaId),
                media_type: mediaType,
                custom_poster: customPoster,
                custom_background: customBg
            }, { onConflict: 'user_id,media_id,media_type' });

        if (!error) {
            // Reload the page to cleanly fetch and apply defaults/customs across all elements
            location.reload(); 
        } else {
            alert("Error saving art: " + error.message);
            saveBtn.textContent = "Save Art";
            saveBtn.disabled = false;
        }
    };
}

// ==========================================
// AI RECOMMENDATIONS ENGINE (If You Liked This...)
// ==========================================

window.loadSimilar = async function(filterType = 'all') {
    const simSection = document.getElementById('similar-section');
    const loader = document.getElementById('similar-loader');
    const grid = document.getElementById('similar-grid');
    
    // Safety check: Only run this for movies, tv, and books
    if (!['movie', 'tv', 'book'].includes(type)) return;
    
    simSection.style.display = 'block';
    
    // Update active filter button
    document.querySelectorAll('#similar-section .filter-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`sim-btn-${filterType}`).classList.add('active');

    loader.style.display = 'block';
    grid.innerHTML = '';
    
    // Convert OpenLibrary string keys into Universal IDs just like our mass seeders did
    const universalId = type === 'book' ? parseInt(String(id).replace(/\D/g, ''), 10) + 100000000 : parseInt(id, 10);
    
    // Tell the Edge Function what we want back
    let desiredOutputs = ['movie', 'tv', 'book'];
    if (filterType !== 'all') {
        desiredOutputs = [filterType];
    }
    
    try {
        const config = await fetch('config.json').then(r => r.json());
        
        const response = await fetch(`${config.supabase_url}/functions/v1/get-recommendations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.supabase_key}` 
            },
            body: JSON.stringify({
                favoriteIds: [universalId], // Pass the current page's ID to the AI
                desiredOutputs: desiredOutputs
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        // Limit to 12 items so the grid looks perfectly balanced (2 rows of 6 on desktop)
        const toShow = data.recommendations.slice(0, 12);
        
        if (toShow.length === 0) {
            grid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align:center;">No similar ${filterType === 'all' ? 'items' : filterType + 's'} found in the database yet.</p>`;
        } else {
            toShow.forEach(rec => {
                const card = document.createElement('div');
                card.className = 'media-card';
                card.setAttribute('data-type', rec.media_type);
                card.onclick = () => window.location.href = `details.html?id=${encodeURIComponent(rec.id)}&type=${rec.media_type}`;
                
                const imgId = `sim-poster-${rec.id}`;
                
                card.innerHTML = `
                    <div class="poster-wrapper">
                        <img id="${imgId}" src="https://via.placeholder.com/500x750/1b2228/9ab?text=Loading..." alt="${rec.title}" loading="lazy">
                        <span class="badge badge-${rec.media_type}">${rec.media_type}</span>
                    </div>
                    <div class="media-info">
                        <div class="title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${rec.title}</div>
                        <div class="meta" style="color: var(--accent); font-weight: bold; margin-top: 4px;">${rec.match_percentage}% Match</div>
                    </div>`;
                    
                grid.appendChild(card);
                
                // Fire off the lazy-loader to grab the poster
                fetchSimPoster(rec, imgId, config);
            });
        }
    } catch (e) {
        console.error("AI Recommendation Fetch Error:", e);
        grid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align:center;">AI Engine is currently unavailable.</p>`;
    } finally {
        loader.style.display = 'none';
    }
};

// Lazy loader specifically for the grid posters
async function fetchSimPoster(rec, imgId, config) {
    const imgEl = document.getElementById(imgId);
    if (!imgEl) return;
    
    try {
        if (rec.media_type === 'movie' || rec.media_type === 'tv') {
            const res = await fetch(`https://api.themoviedb.org/3/${rec.media_type}/${rec.id}`, {
                headers: { Authorization: `Bearer ${config.tmdb_token}` }
            }).then(r => r.json());
            imgEl.src = res.poster_path ? `https://image.tmdb.org/t/p/w342${res.poster_path}` : 'https://via.placeholder.com/500x750/1b2228/9ab?text=No+Poster';
        } else if (rec.media_type === 'book') {
            const rawNum = parseInt(rec.id) - 100000000;
            const res = await fetch(`https://openlibrary.org/works/OL${rawNum}W.json`).then(r => r.json());
            imgEl.src = (res.covers && res.covers.length > 0) ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'https://via.placeholder.com/500x750/1b2228/9ab?text=No+Cover';
        }
    } catch (e) {
        imgEl.src = 'https://via.placeholder.com/500x750/1b2228/ff4d4d?text=Error';
    }
}

// ==========================================
// SILENT JIT (Just-In-Time) QUEUE
// ==========================================
async function checkAndQueueMedia(mediaId, mediaType, config) {
    if (!['movie', 'tv', 'book'].includes(mediaType)) return;

    // Standardize the ID
    const universalId = mediaType === 'book' ? parseInt(String(mediaId).replace(/\D/g, ''), 10) + 100000000 : parseInt(mediaId, 10);

    try {
        // 1. Check if it already exists in the Taste Graph
        const { data: existing } = await supabaseClient
            .from('global_movies')
            .select('tmdb_id')
            .eq('tmdb_id', universalId)
            .maybeSingle();

        if (existing) return; // It's already in the database. Do nothing!

        console.log("[I] Media not found in Taste Graph. Queuing for nightly ML embedding...");

        let tags = [];
        let title = '';
        let year = null;
        let popularity = 0;
        let overview = '';

        // 2. Fetch the rich tag data based on type
        if (mediaType === 'movie' || mediaType === 'tv') {
            const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${mediaId}?append_to_response=keywords`, { 
                headers: { Authorization: `Bearer ${config.tmdb_token}` } 
            }).then(r => r.json());
            
            title = res.title || res.name;
            year = (res.release_date || res.first_air_date || '').split('-')[0];
            popularity = res.popularity;
            overview = res.overview;
            
            const genres = res.genres ? res.genres.map(g => g.name) : [];
            const kwList = mediaType === 'tv' ? (res.keywords?.results || []) : (res.keywords?.keywords || []);
            tags = [...genres, ...kwList.map(k => k.name)];
            
        } else if (mediaType === 'book') {
            const res = await fetch(`https://openlibrary.org${mediaId}.json`).then(r => r.json());
            title = res.title;
            year = res.first_publish_date ? res.first_publish_date : null; 
            overview = typeof res.description === 'string' ? res.description : (res.description?.value || '');
            tags = res.subjects ? res.subjects.map(s => typeof s === 'string' ? s : s.name || '') : [];
        }

        if (tags.length === 0) return; // We can't build math without tags, so we abandon ship.

        // 3. Silently push it to Supabase
        const { error } = await supabaseClient.from('global_movies').upsert({
            tmdb_id: universalId,
            title: title,
            release_year: year ? String(year) : null,
            popularity: popularity || 0,
            overview: typeof overview === 'string' ? overview : 'No overview available.',
            tags: tags.slice(0, 15).join(', '),
            media_type: mediaType,
            is_embedded: false 
        }, { onConflict: 'tmdb_id' });

        // NEW: Actually check for the error before logging success!
        if (error) {
            throw new Error(error.message);
        }

        console.log("[S] Successfully added to the ML queue!");

    } catch (err) {
        console.error("[E] Background Queue Error:", err);
    }
}

async function fetchFollowingLogs() {
    const section = document.getElementById('following-history');
    const listContainer = document.getElementById('following-history-list');
    const { data: { user } } = await supabaseClient.auth.getUser();

    // If not signed in, show a prompt instead of hiding the section
    if (!user) {
        section.style.display = 'block';
        listContainer.innerHTML = '<p class="meta">Sign in to see friend reviews.</p>';
        return; 
    }

    try {
        // 1. Find who the user follows from the 'follows' table
        const { data: follows, error: followError } = await supabaseClient
            .from('follows')
            .select('following_id')
            .eq('follower_id', user.id);

        // If the user doesn't follow anyone, show the empty state
        if (followError || !follows || follows.length === 0) {
            section.style.display = 'block';
            listContainer.innerHTML = '<p class="meta">No reviews from friends yet.</p>';
            return;
        }

        const followingIds = follows.map(f => f.following_id);

        // 2. Fetch logs for THIS media from THOSE users
        const { data: logs, error: logsError } = await supabaseClient
            .from('media_logs')
            .select('*')
            .eq('media_id', String(id))
            .in('user_id', followingIds)
            .order('created_at', { ascending: false })
            .limit(5); // Show top 5 recent friend logs

        // If friends haven't reviewed it, show the empty state
        if (logsError || !logs || logs.length === 0) {
            section.style.display = 'block';
            listContainer.innerHTML = '<p class="meta">No reviews from friends yet.</p>';
            return;
        }

        // 3. Fetch the profile info for these specific users
        const logUserIds = [...new Set(logs.map(log => log.user_id))];
        const { data: profiles, error: profilesError } = await supabaseClient
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', logUserIds);

        // Create a quick lookup dictionary for the profiles
        const profileMap = {};
        if (profiles) {
            profiles.forEach(p => {
                profileMap[p.id] = p;
            });
        }

        // 4. Render the UI
        section.style.display = 'block';
        
        listContainer.innerHTML = logs.map(log => {
            const profile = profileMap[log.user_id] || {};
            const username = profile.username || 'Unknown User';
            const avatar = profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=1b2228&color=9ab`;
            
            const stars = '★'.repeat(Math.floor(log.rating || 0)) + ((log.rating || 0) % 1 !== 0 ? '½' : '');
            
            // Use watched_on if available, otherwise fallback to created_at
            const targetDate = log.watched_on ? log.watched_on : log.created_at.split('T')[0];
            const logDate = new Date(targetDate + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            
            const reviewPreview = log.notes ? `<div class="history-notes">"${log.notes}"</div>` : '';
            const heartBadge = log.is_liked ? `<span title="Liked" style="font-size: 0.85rem; margin-right: 5px;">❤️</span>` : '';
            
            let rewatchText = 'Rewatch';
            if (type === 'book') rewatchText = 'Reread';
            else if (type === 'album') rewatchText = 'Relisten';
            const rewatchBadge = log.is_rewatch ? `<span title="${rewatchText}" style="font-size: 0.85rem;">🔁</span>` : '';

            return `
                <div class="history-item following-log-item" style="cursor: pointer; transition: background 0.2s; padding: 10px; border-radius: 8px; margin: 0 -10px 10px -10px;" onclick="window.location.href='profile.html?userId=${log.user_id}'">
                    <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px;">
                        <img src="${avatar}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; border: 1px solid #2c3440;">
                        <span style="font-weight: bold; font-size: 0.9rem; color: #fff;">${username}</span>
                        <span style="font-size: 0.75rem; color: #678; margin-left: auto;">${logDate}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="history-stars">${stars}</span>
                        <div>
                            ${heartBadge}
                            ${rewatchBadge}
                        </div>
                    </div>
                    ${reviewPreview}
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error("Error fetching friend logs:", err);
        // Fallback for random network errors
        section.style.display = 'block';
        listContainer.innerHTML = '<p class="meta">Unable to load friend reviews.</p>';
    }
}

initDetails();