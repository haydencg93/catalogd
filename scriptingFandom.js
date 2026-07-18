const params = new URLSearchParams(window.location.search);
let mediaId = params.get('id');
let mediaType = params.get('type');
let supabaseClient = null;
let currentUser = null;

// Unblockable Inline SVG Placeholders
const FALLBACK_POSTER = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='750'><rect width='500' height='750' fill='%2314181c'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%239ab'>No Image</text></svg>`;
const FALLBACK_AVATAR = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450'><rect width='300' height='450' fill='%2314181c'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='18' fill='%239ab'>No Image</text></svg>`;

// We only map standard entertainment media now
const propertyMap = {
    'movie': 'P4947',   
    'tv': 'P4983',      
    'album': 'P3192'    
};

// Add a global array for the full character list
let allFandomCharacters = [];

async function initFandomPage() {
    const config = await fetch('config.json').then(r => r.json());
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    await setupHeader();

    const urlListId = params.get('listId');
    const isCollection = (mediaType === 'collection' || !!urlListId);

    if (isCollection) {
        const rawId = urlListId || mediaId; 
        const numericListId = rawId.replace('list_', '');
        mediaId = `list_${numericListId}`;
        mediaType = 'collection';

        try {
            await fetchListFandom(numericListId, config);
        } catch (e) {
            showError("Failed to load collection details.");
        }
        
        // RUN THESE LAST: Art overrides and follow button
        await setupFandomCustomArt();
        await applyCustomFandomArt(); // Apply custom image AFTER TVDB finishes
        
        const fandomTitle = document.getElementById('fandom-title').textContent;
        const fandomImage = document.getElementById('fandom-image').src;
        const dbImage = fandomImage.startsWith('data:image') ? '' : fandomImage;
        await setupFandomFollowBtn(fandomTitle, dbImage);
        return; 
    }

    if (!mediaId || !mediaType || !propertyMap[mediaType]) {
        showError("Fandom exploration is currently only available for Movies, TV Shows, and Albums.");
        return;
    }

    const propertyId = propertyMap[mediaType];
    
    try {
        if (mediaType === 'movie' || mediaType === 'tv') {
            try {
                const tmdbRes = await fetch(`https://api.themoviedb.org/3/${mediaType}/${mediaId}?language=en-US`, {
                    headers: { Authorization: `Bearer ${config.tmdb_token}` }
                }).then(r => r.json());
                if (tmdbRes.poster_path) {
                    document.getElementById('fandom-image').src = `https://image.tmdb.org/t/p/w500${tmdbRes.poster_path}`;
                }
            } catch (e) { console.warn("TMDB image fetch failed."); }
        }

        const wikiTitle = await getWikipediaTitle(propertyId, mediaId);
        if (wikiTitle) {
            await fetchWikipediaLore(wikiTitle);
        } else {
            showError("No Wikipedia lore found for this item in Wikidata.");
        }
        
        await fetchStructuredCharacters(mediaId, mediaType);
        await fetchTVDBLists(mediaId, mediaType, config);
        
        // RUN THESE LAST: Art overrides and follow button
        await setupFandomCustomArt();
        await applyCustomFandomArt(); // Apply custom image AFTER TMDB/Wiki finishes

        const fandomTitle = document.getElementById('fandom-title').textContent;
        const fandomImage = document.getElementById('fandom-image').src;
        const dbImage = fandomImage.startsWith('data:image') ? '' : fandomImage;
        await setupFandomFollowBtn(fandomTitle, dbImage);

    } catch (error) {
        console.error("Fandom Fetch Error:", error);
        showError("Failed to load Wikipedia lore.");
    }
}

// Ask TMDB to find a record by an external id (imdb_id or tvdb_id).
async function tmdbFindByExternalId(externalId, source, mediaKind, tmdbToken) {
    if (!externalId || !tmdbToken) return null;
    try {
        const res = await fetch(`https://api.themoviedb.org/3/find/${externalId}?external_source=${source}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        if (mediaKind === 'movie' && res.movie_results && res.movie_results.length > 0) {
            return res.movie_results[0].id;
        }
        if (mediaKind === 'tv' && res.tv_results && res.tv_results.length > 0) {
            return res.tv_results[0].id;
        }
    } catch (e) {
        console.warn(`TMDB find failed for ${source}=${externalId}`, e);
    }
    return null;
}

// Resolve a TVDB movie/series entity to its matching TMDB id, so collection cards
// can deep-link into this app's own (TMDB-id-keyed) details pages.
//
// IMPORTANT: TMDB's /find endpoint only supports external_source=tvdb_id for TV/season/episode
// lookups - it does NOT support tvdb_id for movies at all (movies on TMDB only cross-reference
// imdb_id, wikidata_id, facebook_id, instagram_id, twitter_id). That's why movie items were
// never linking: every /find?external_source=tvdb_id call for a movie silently returns an
// empty movie_results array, with no error to catch. So for movies we go two hops instead:
// pull the IMDB id off TVDB's own 'remoteIds' (only present on the /extended movie record),
// then ask TMDB to find it via imdb_id, which movies DO support.
async function resolveTmdbId(entData, tvdbAuthHeaders, tmdbToken) {
    if (!tmdbToken || !entData.id) return null;

    if (entData.__type === 'series') {
        return await tmdbFindByExternalId(entData.id, 'tvdb_id', 'tv', tmdbToken);
    }

    // Movie path: make sure we have remoteIds (present if this item came from a /movies/{id}/extended
    // fetch already; fetch it now as a fallback for items that were embedded directly on the list).
    let remoteIds = entData.remoteIds;
    if (!remoteIds) {
        try {
            const res = await fetch(`https://api4.thetvdb.com/v4/movies/${entData.id}/extended`, {
                headers: tvdbAuthHeaders
            }).then(r => r.json());
            remoteIds = res && res.data && res.data.remoteIds;
        } catch (e) {
            console.warn(`Failed to fetch remoteIds for movie ${entData.id}`, e);
        }
    }

    const imdbEntry = Array.isArray(remoteIds)
        ? remoteIds.find(r => typeof r.id === 'string' && /^tt\d+$/.test(r.id))
        : null;

    if (!imdbEntry) return null;
    return await tmdbFindByExternalId(imdbEntry.id, 'imdb_id', 'movie', tmdbToken);
}

// Fetch & Render Official TVDB Lists
async function fetchListFandom(listId, config) {
    // Hide standard media sections
    document.getElementById('fandom-cast-section').style.display = 'none';
    document.getElementById('fandom-plot-section').style.display = 'none';
    document.getElementById('fandom-meta').textContent = "Official Collection";
    
    // Login to TVDB v4
    const loginRes = await fetch('https://api4.thetvdb.com/v4/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: config.tvdb_key, pin: config.tvdb_pin || "" })
    }).then(r => r.json());
    
    if (!loginRes.data || !loginRes.data.token) throw new Error("TVDB auth failed");
    const tvdbToken = loginRes.data.token;
    const tvdbAuthHeaders = { Authorization: `Bearer ${tvdbToken}` };
    
    // Fetch Extended List Details
    const listRes = await fetch(`https://api4.thetvdb.com/v4/lists/${listId}/extended`, {
        headers: tvdbAuthHeaders
    }).then(r => r.json());
    
    if (!listRes.data) throw new Error("List not found");
    const list = listRes.data;
    
    // Bind Details to UI
    document.getElementById('fandom-title').textContent = list.name || "Unknown Collection";
    document.getElementById('fandom-overview').innerHTML = list.overview || "No description provided for this collection.";
    
    // TVDB v4's ListExtendedRecord only exposes 'image' (no 'poster' field exists on lists).
    // CRITICAL: TVDB also exposes 'imageIsFallback'. When true, TVDB is NOT giving us the list's
    // own curated artwork - it silently substitutes the FIRST ENTITY'S OWN POSTER instead. That's
    // exactly why the banner was showing the "Star Wars (1977)" poster instead of the Skywalker
    // Saga collection art: TVDB's API was reporting the fallback, not lying to us about the field name.
    let listImage = list.image || list.poster || list.image_url;
    const tvdbImageIsFallback = list.imageIsFallback === true;
    if (tvdbImageIsFallback) {
        console.warn(`TVDB list ${listId}: 'image' is a fallback to an entity poster, not curated list art.`, listImage);
    }
    if (listImage && !tvdbImageIsFallback) {
        document.getElementById('fandom-image').src = listImage;
    }
    
    // Some payloads embed full movie/series objects directly under .movies/.series - use them if present.
    let collectionItems = [];
    if (list.movies && Array.isArray(list.movies)) {
        collectionItems.push(...list.movies.map(m => ({ ...m, __type: 'movie' })));
    }
    if (list.series && Array.isArray(list.series)) {
        collectionItems.push(...list.series.map(s => ({ ...s, __type: 'series' })));
    }
    
    // The documented TVDB v4 shape only puts BARE STUBS ({movieId, seriesId, order}) in .entities -
    // no name, no image. That's why titles/images were failing to load before: entData.name/entData.poster
    // simply don't exist on those stubs. We have to resolve each stub against the movie/series endpoints.
    // We use the /extended endpoints (not the base ones) specifically so we ALSO get 'remoteIds' back
    // in the same call - that's what the TMDB movie-linking step above needs.
    if (collectionItems.length === 0 && list.entities && Array.isArray(list.entities)) {
        const toResolve = [];
        list.entities.forEach(ent => {
            // Defensive: some accounts/proxies do embed the full object - use it directly if it's there.
            const embedded = ent.movie || ent.series;
            if (embedded && (embedded.name || embedded.title)) {
                collectionItems.push({ ...embedded, __type: ent.movie ? 'movie' : 'series' });
                return;
            }
            if (ent.movieId) {
                toResolve.push({ id: ent.movieId, type: 'movie' });
            } else if (ent.seriesId) {
                toResolve.push({ id: ent.seriesId, type: 'series' });
            }
        });
        
        if (toResolve.length > 0) {
            const resolved = await Promise.all(toResolve.map(async (stub) => {
                try {
                    const endpoint = stub.type === 'movie'
                        ? `https://api4.thetvdb.com/v4/movies/${stub.id}/extended`
                        : `https://api4.thetvdb.com/v4/series/${stub.id}/extended`;
                    const res = await fetch(endpoint, { headers: tvdbAuthHeaders }).then(r => r.json());
                    if (res && res.data) {
                        return { ...res.data, __type: stub.type };
                    }
                } catch (e) {
                    console.warn(`Failed to resolve list ${stub.type} ${stub.id}`, e);
                }
                return null;
            }));
            collectionItems.push(...resolved.filter(Boolean));
        }
    }

    // Sort items logically by Year to keep order consistent (String cast protects against raw integers)
    collectionItems.sort((a, b) => {
        const yearA = parseInt(String(a.year || a.firstAired || a.releaseDate || '9999').split('-')[0]) || 9999;
        const yearB = parseInt(String(b.year || b.firstAired || b.releaseDate || '9999').split('-')[0]) || 9999;
        if (yearA !== yearB) return yearA - yearB;
        return (a.id || 0) - (b.id || 0);
    });

    // Cross-reference every item's TVDB id against TMDB so each card can link to its
    // own details page using the TMDB id (the app's details/fandom pages are keyed off TMDB ids,
    // not TVDB ids - see propertyMap/mediaId usage above).
    if (collectionItems.length > 0) {
        await Promise.all(collectionItems.map(async (entData) => {
            entData.__linkType = entData.__type === 'series' ? 'tv' : 'movie';
            entData.__tmdbId = await resolveTmdbId(entData, tvdbAuthHeaders, config.tmdb_token);
        }));
    }

    // If TVDB only gave us a fallback poster (or nothing at all), source a real banner from TMDB's
    // "Collection" artwork instead - a dedicated, curated saga/franchise poster that's completely
    // independent of TVDB's fallback bug - using the TMDB id of the first movie we just resolved.
    if ((tvdbImageIsFallback || !listImage) && config.tmdb_token) {
        const firstMovie = collectionItems.find(i => i.__linkType === 'movie' && i.__tmdbId);
        if (firstMovie) {
            try {
                const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${firstMovie.__tmdbId}?language=en-US`, {
                    headers: { Authorization: `Bearer ${config.tmdb_token}` }
                }).then(r => r.json());
                const collectionPoster = movieRes.belongs_to_collection && movieRes.belongs_to_collection.poster_path;
                if (collectionPoster) {
                    listImage = `https://image.tmdb.org/t/p/w780${collectionPoster}`;
                }
            } catch (e) {
                console.warn('TMDB collection poster lookup failed', e);
            }
        }
        // Still nothing better than TVDB's fallback? Use it anyway rather than showing a blank placeholder.
        document.getElementById('fandom-image').src = listImage || document.getElementById('fandom-image').src;
    }

    // Render the items
    if (collectionItems.length > 0) {
        const entitiesHtml = `
            <div class="rating-section" style="margin-top: 20px;">
                <h3>Items in this Collection</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px; margin-top: 15px;">
                    ${collectionItems.map(entData => {
                        const title = entData.name || entData.title || 'Unknown Title';
                        const rawImg = entData.image || entData.poster || entData.image_url;
                        const img = rawImg ? rawImg : 'https://placehold.co/300x450/1b2228/9ab?text=No+Image';
                        const isClickable = !!entData.__tmdbId;
                        const cardStyle = "text-align: center; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 12px; border: 1px solid #2c3440; display: block; text-decoration: none;" + (isClickable ? " cursor: pointer;" : " cursor: default;");
                        const href = isClickable ? `details.html?id=${entData.__tmdbId}&type=${entData.__linkType}` : '#';
                        const tag = isClickable ? 'a' : 'div';
                        const hrefAttr = isClickable ? `href="${href}"` : '';
                        
                        return `
                            <${tag} class="cast-card" ${hrefAttr} style="${cardStyle}">
                                <img src="${img}" style="width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" loading="lazy">
                                <span style="font-weight: bold; color: #fff; font-size: 0.9rem; display: block; overflow-wrap: break-word;">${title}</span>
                            </${tag}>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        document.querySelector('.info-pane').insertAdjacentHTML('beforeend', entitiesHtml);
    }
    
    const dbImage = listImage || '';
    await setupFandomFollowBtn(list.name || "Collection", dbImage);
}

// --- HEADER & AUTH LOGIC ---
async function setupHeader() {
    const loginBtn = document.getElementById('login-btn');
    const profileMenu = document.getElementById('profile-menu');

    const { data: { user } } = await supabaseClient.auth.getUser();
    currentUser = user; // Save to global variable

    if (user) {
        loginBtn.style.display = 'none';
        profileMenu.style.display = 'inline-block';
        
        const avatar = document.getElementById('nav-avatar');
        if (avatar && user.user_metadata && user.user_metadata.avatar_url) {
            avatar.src = user.user_metadata.avatar_url;
        }
    } else {
        loginBtn.style.display = 'inline-block';
        profileMenu.style.display = 'none';
        loginBtn.textContent = "Sign In";
        loginBtn.onclick = () => window.location.href = 'index.html'; 
    }
}

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
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
}

async function signOut() {
    await supabaseClient.auth.signOut();
    location.reload();
}

async function getWikipediaTitle(propertyId, externalId) {
    const sparqlQuery = `
        SELECT ?article WHERE {
            ?item wdt:${propertyId} "${externalId}".
            ?article schema:about ?item ;
                     schema:isPartOf <https://en.wikipedia.org/> .
        } LIMIT 1
    `;

    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;

    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await response.json();

    if (data.results.bindings.length > 0) {
        return data.results.bindings[0].article.value.split('/').pop();
    }
    return null;
}

function scrubWikipediaHeaders(htmlString) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    
    // Remove headers and edit links
    tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6, .mw-editsection').forEach(el => el.remove());
    
    // Fix relative Wikipedia links
    tempDiv.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href');
        
        if (href) {
            // Check if the link is a relative Wikipedia path
            if (href.startsWith('/wiki/')) {
                link.setAttribute('href', `https://en.wikipedia.org${href}`);
                link.setAttribute('target', '_blank'); 
                link.setAttribute('rel', 'noopener noreferrer'); 
            } 
            // Wikipedia's REST API sometimes returns paths starting with "./"
            else if (href.startsWith('./')) {
                link.setAttribute('href', `https://en.wikipedia.org/wiki/${href.substring(2)}`);
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }
        }
    });
    
    return tempDiv.innerHTML;
}

async function fetchWikipediaLore(title) {
    try {
        // Fetch Top Level Summary
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirects=1`;
        const summaryRes = await fetch(summaryUrl).then(r => r.json());

        const activeTitle = summaryRes.title || title;

        document.getElementById('fandom-title').textContent = activeTitle;
        document.getElementById('fandom-overview').innerHTML = summaryRes.extract_html || summaryRes.extract;
        
        const meta = document.getElementById('fandom-meta');
        if (summaryRes.description) meta.textContent = summaryRes.description;

        const wikiLink = document.getElementById('wiki-link');
        if (summaryRes.content_urls) {
            wikiLink.href = summaryRes.content_urls.desktop.page;
            wikiLink.style.display = 'inline-block';
        }

        // Fetch Plot Section 
        const sectionsUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(activeTitle)}&prop=sections&format=json&origin=*&redirects=1`;
        const sectionsRes = await fetch(sectionsUrl).then(r => r.json());

        let plotSectionId = null;

        if (sectionsRes.parse && sectionsRes.parse.sections) {
            sectionsRes.parse.sections.forEach(sec => {
                const titleLower = sec.line.toLowerCase().trim();
                if (['plot', 'synopsis', 'premise', 'overview'].includes(titleLower)) {
                    if (!plotSectionId) plotSectionId = sec.index; 
                }
            });
        }

        // Render Plot
        if (plotSectionId) {
            const plotUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(activeTitle)}&section=${plotSectionId}&prop=text&format=json&origin=*&redirects=1`;
            const plotData = await fetch(plotUrl).then(r => r.json());
            
            if (plotData && plotData.parse && plotData.parse.text) {
                document.getElementById('fandom-plot-section').style.display = 'block';
                document.getElementById('fandom-plot-content').innerHTML = scrubWikipediaHeaders(plotData.parse.text['*']);
            }
        }
    } catch (err) {
        console.error("Wikipedia API Error:", err);
        showError("Failed to load detailed Wikipedia lore. See console for details.");
    }
}

async function setupFandomCustomArt() {
    // Only show for logged-in users
    if (!currentUser) return;

    // 1. REPLICATE DETAILS PAGE STRUCTURE: Create the controls wrapper
    const leftCol = document.getElementById('left-col');
    const posterArea = document.getElementById('fandom-poster-area');
    const followBtn = document.getElementById('follow-fandom-btn');

    // Create the wrapper (exactly like #poster-controls-wrapper in details.html)
    const controlsWrapper = document.createElement('div');
    controlsWrapper.id = 'fandom-poster-controls-wrapper';
    
    // Move poster and follow button into the wrapper to maintain the same DOM hierarchy as Details
    posterArea.parentNode.insertBefore(controlsWrapper, posterArea);
    controlsWrapper.appendChild(posterArea);
    
    // 2. CREATE EDIT ART BUTTON (Same styles as details.html)
    const editArtBtn = document.createElement('button');
    editArtBtn.id = 'edit-art-btn';
    editArtBtn.className = 'secondary-btn';
    editArtBtn.textContent = 'Edit Art';
    editArtBtn.style.cssText = 'width: 100%; margin-top: 10px; display: block;';
    
    // 3. WRAP FOLLOW BUTTON (Same as the div wrapper around #fandom-btn in details.html)
    const followBtnWrapper = document.createElement('div');
    followBtnWrapper.style.marginTop = '10px';
    followBtn.style.marginTop = '0px'; // Remove the 15px margin from the HTML to prevent choppiness
    followBtnWrapper.appendChild(followBtn);

    // Assemble the wrapper in the EXACT order of details.html:
    // Poster Area -> Edit Art Button -> Follow Button Wrapper
    controlsWrapper.appendChild(editArtBtn);
    controlsWrapper.appendChild(followBtnWrapper);

    // 4. CREATE THE MODAL (Exact copy of #custom-art-modal from details.html)
    const modalHtml = `
        <div id="fandom-custom-art-modal" class="modal-overlay" style="display:none;">
            <div class="auth-card">
                <button class="close-btn" id="close-fandom-art-modal">×</button>
                <h3>Custom Art</h3>
                <p class="meta" style="margin-bottom: 15px; font-size: 0.85rem;">Paste image URLs to override the default art. Leave blank to use defaults.</p>
                <input type="text" id="fandom-custom-poster-input" placeholder="Custom Poster URL" style="width: 100%; box-sizing: border-box; margin-bottom: 10px;">
                <button id="save-fandom-art-btn" class="primary-btn" style="margin-top: 10px; width: 100%;">Save Art</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('fandom-custom-art-modal');
    const closeBtn = document.getElementById('close-fandom-art-modal');
    const saveBtn = document.getElementById('save-fandom-art-btn');
    const input = document.getElementById('fandom-custom-poster-input');

    // 5. LOGIC (Mirroring setupCustomArt in scriptingDetails.js)
    editArtBtn.onclick = async () => {
        const { data: existingArt } = await supabaseClient
            .from('custom_imgs')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('media_id', String(mediaId))
            .eq('media_type', mediaType)
            .maybeSingle();
        
        input.value = existingArt?.custom_poster || '';
        modal.style.display = 'flex';
    };

    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    saveBtn.onclick = async () => {
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;

        const customPoster = input.value.trim() || null;

        const { error } = await supabaseClient
            .from('custom_imgs')
            .upsert({
                user_id: currentUser.id,
                media_id: String(mediaId),
                media_type: mediaType,
                custom_poster: customPoster
            }, { onConflict: 'user_id,media_id,media_type' });

        if (!error) {
            // Mirroring the Details page reload behavior
            location.reload(); 
        } else {
            alert("Error saving art: " + error.message);
            saveBtn.textContent = "Save Art";
            saveBtn.disabled = false;
        }
    };
}

async function applyCustomFandomArt() {
    if (!currentUser) return;

    try {
        const { data: customArt } = await supabaseClient
            .from('custom_imgs')
            .select('custom_poster')
            .eq('user_id', currentUser.id)
            .eq('media_id', String(mediaId))
            .eq('media_type', mediaType)
            .maybeSingle();

        if (customArt && customArt.custom_poster) {
            document.getElementById('fandom-image').src = customArt.custom_poster;
        }
    } catch (e) {
        console.warn("Error applying custom art:", e);
    }
}

async function fetchTVDBLists(mId, mType, config) {
    if (mType !== 'movie' && mType !== 'tv') return;

    try {
        // 1. Authorize with TVDB v4
        const loginRes = await fetch('https://api4.thetvdb.com/v4/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apikey: config.tvdb_key, pin: config.tvdb_pin || "" })
        }).then(r => r.json());
        
        if (!loginRes.data || !loginRes.data.token) return;
        const tvdbToken = loginRes.data.token;
        const tvdbHeaders = { Authorization: `Bearer ${tvdbToken}` };

        // 2. Get External IDs from TMDB
        const tmdbHeaders = { Authorization: `Bearer ${config.tmdb_token}` };
        const extIds = await fetch(`https://api.themoviedb.org/3/${mType}/${mId}/external_ids`, { headers: tmdbHeaders }).then(r => r.json()).catch(() => ({}));

        let tvdbId = null;

        // ATTEMPT 1: Direct TMDB to TVDB ID Match (If TMDB provides it)
        if (extIds.tvdb_id) {
            tvdbId = extIds.tvdb_id;
        }

        // ATTEMPT 2: Search TVDB using the IMDB ID
        if (!tvdbId && extIds.imdb_id) {
            const imdbSearch = await fetch(`https://api4.thetvdb.com/v4/search/remoteid/${extIds.imdb_id}`, { headers: tvdbHeaders }).then(r => r.json()).catch(()=>({}));
            if (imdbSearch.data && imdbSearch.data.length > 0) {
                // Safely extract from TVDB's nested remote ID structure
                const item = imdbSearch.data[0];
                tvdbId = item.movie?.id || item.series?.id || item.tvdb_id || item.id;
            }
        }

        // ATTEMPT 3: Search TVDB natively using the TMDB ID
        if (!tvdbId) {
            const tmdbSearch = await fetch(`https://api4.thetvdb.com/v4/search/remoteid/${mId}`, { headers: tvdbHeaders }).then(r => r.json()).catch(()=>({}));
            if (tmdbSearch.data && tmdbSearch.data.length > 0) {
                // Find matching media type to avoid crossing Movie/TV wires
                const validMatch = tmdbSearch.data.find(d => (mType === 'movie' && d.movie) || (mType === 'tv' && d.series));
                if (validMatch) {
                    tvdbId = validMatch.movie?.id || validMatch.series?.id || validMatch.tvdb_id || validMatch.id;
                } else {
                    const item = tmdbSearch.data[0];
                    tvdbId = item.movie?.id || item.series?.id || item.tvdb_id || item.id;
                }
            }
        }

        // ATTEMPT 4: Fallback Text Search (Using the Title)
        if (!tvdbId) {
            const titleToSearch = document.getElementById('fandom-title').textContent;
            if (titleToSearch && titleToSearch !== "Loading Wikipedia Lore...") {
                const typeFilter = mType === 'tv' ? 'series' : 'movie';
                const textSearch = await fetch(`https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(titleToSearch)}&type=${typeFilter}`, { headers: tvdbHeaders }).then(r=>r.json()).catch(()=>({}));
                if (textSearch.data && textSearch.data.length > 0) {
                    tvdbId = textSearch.data[0].tvdb_id || textSearch.data[0].id;
                }
            }
        }

        if (!tvdbId) {
            console.log("Could not resolve a TVDB ID for this media.");
            return;
        }

        // 3. Fetch TVDB extended details using the resolved ID
        const endpointType = mType === 'tv' ? 'series' : 'movies';
        const extendedRes = await fetch(`https://api4.thetvdb.com/v4/${endpointType}/${tvdbId}/extended`, { headers: tvdbHeaders }).then(r => r.json());

        if (extendedRes.data && extendedRes.data.lists && extendedRes.data.lists.length > 0) {
            
            // 1. STRICT FILTER: Only allow official lists or lists containing major keywords
            const validLists = extendedRes.data.lists.filter(l => {
                const name = l.name.toLowerCase();
                return l.isOfficial || 
                       name.includes('franchise') || 
                       name.includes('saga') || 
                       name.includes('universe') || 
                       name.includes('collection');
            });

            // 2. DEDUPLICATE: Prevent multiple lists with the exact same name
            const uniqueListsMap = new Map();
            validLists.forEach(l => {
                const nameKey = l.name.toLowerCase().trim();
                const existing = uniqueListsMap.get(nameKey);
                // Overwrite only if the new one is 'Official' and the stored one isn't
                if (!existing || (l.isOfficial && !existing.isOfficial)) {
                    uniqueListsMap.set(nameKey, l);
                }
            });
            const uniqueLists = Array.from(uniqueListsMap.values());

            // 3. SORT: Prioritize Franchises, Sagas, and Universes to float to the very top
            const sortedLists = uniqueLists.sort((a, b) => {
                const getScore = (l) => {
                    let score = 0;
                    if (l.isOfficial) score += 10;
                    const name = l.name.toLowerCase();
                    if (name.includes('franchise')) score += 5;
                    if (name.includes('saga')) score += 5;
                    if (name.includes('universe')) score += 5;
                    if (name.includes('collection')) score += 3;
                    return score;
                };
                return getScore(b) - getScore(a);
            });
            
            // Render Top 5
            const listsToShow = sortedLists.slice(0, 5);

            if (listsToShow.length > 0) {
                const listHtml = `
                    <div id="part-of-section" class="history-section" style="margin-top: 15px; border-color: var(--accent);">
                        <h4 style="color: var(--accent); border-bottom-color: var(--accent);">Part Of</h4>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${listsToShow.map(list => `
                                <button class="secondary-btn" style="width: 100%; text-align: left; padding: 12px; font-size: 0.85rem; border-color: #2c3440; background: rgba(255,255,255,0.02);" 
                                        onclick="window.location.href='fandom.html?listId=${list.id}'"
                                        onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='var(--accent)';"
                                        onmouseout="this.style.background='rgba(255,255,255,0.02)'; this.style.borderColor='#2c3440';">
                                    • ${list.name}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `;
                // Inject the list underneath the follow button
                document.getElementById('follow-fandom-btn').insertAdjacentHTML('afterend', listHtml);
            }
        }
    } catch (err) {
        console.warn("TVDB List Fetch Error:", err);
    }
}

async function fetchStructuredCharacters(externalId, type) {
    if (type !== 'movie' && type !== 'tv') return;

    document.querySelector('#fandom-cast-section h3').textContent = "Characters";
    document.getElementById('fandom-cast-section').style.display = 'block';
    const gridContainer = document.getElementById('fandom-cast-content');
    gridContainer.innerHTML = '<p class="meta">Loading characters...</p>';

    try {
        const config = await fetch('config.json').then(r => r.json());
        const endpoint = type === 'tv' ? 'aggregate_credits' : 'credits';
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${externalId}/${endpoint}?language=en-US`, {
            headers: { Authorization: `Bearer ${config.tmdb_token}` }
        }).then(r => r.json());
        
        if (!res.cast || res.cast.length === 0) {
            gridContainer.innerHTML = `<p class="meta">No structured character data found.</p>`;
            return;
        }

        let followedCharacterIds = new Set();
        if (currentUser) {
            const { data: userChars } = await supabaseClient
                .from('user_characters')
                .select('character_id')
                .eq('user_id', currentUser.id)
                .eq('media_id', String(externalId))
                .eq('media_type', type);
            
            if (userChars) {
                userChars.forEach(c => followedCharacterIds.add(c.character_id));
            }
        }

        const characters = res.cast.map(c => {
            let charName = c.character;
            if (type === 'tv' && c.roles && c.roles.length > 0) { charName = c.roles[0].character; }
            let cleanName = charName ? charName.replace(/\(voice\)/gi, '').trim() : "Unknown";
            cleanName = cleanName.split('/')[0].trim();
            
            return {
                name: cleanName,
                wikiId: cleanName.replace(/\s+/g, '_'), 
                tmdbImage: c.profile_path ? `https://image.tmdb.org/t/p/w300${c.profile_path}` : null
            };
        }).filter(c => c.name !== "Unknown" && c.name.length > 1);

        allFandomCharacters = characters; 
        const displayChars = characters.slice(0, 24);

        // Uses the Cast-Grid to perfectly align with your Details page CSS
        let gridHtml = `<div class="cast-grid" style="margin-top: 20px;">`;
        
        displayChars.forEach((char, index) => {
            const fallbackImg = char.tmdbImage || FALLBACK_AVATAR;
            const safeDbImage = char.tmdbImage || ''; 
            
            const isFollowingChar = followedCharacterIds.has(char.wikiId);
            const btnClass = isFollowingChar ? 'secondary-btn' : 'primary-btn';
            const btnText = isFollowingChar ? 'Unfollow' : 'Follow';
            const escapedName = char.name.replace(/'/g, "\\'"); 

            gridHtml += `
                <div class="cast-card" style="cursor: pointer; text-align: center; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 12px; border: 1px solid #2c3440;" onclick="routeToCharacter('${char.wikiId}')">
                    <img src="${fallbackImg}" style="width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" loading="lazy">
                    <span style="font-weight: bold; color: #fff; font-size: 0.95rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${char.name}</span>
                    <button class="${btnClass}" 
                        style="width: 100%; padding: 6px; font-size: 0.8rem; border-radius: 6px; margin-top: 10px;"
                        onclick="event.stopPropagation(); toggleCharacterFollow(this, '${char.wikiId}', '${escapedName}', '${safeDbImage}')">
                        ${btnText}
                    </button>
                </div>
            `;
        });

        gridHtml += `</div>`;
        gridContainer.innerHTML = gridHtml;

        if (characters.length > 24) {
            const viewAllBtn = document.createElement('button');
            viewAllBtn.id = 'view-all-chars-btn';
            viewAllBtn.textContent = 'View All Characters';
            viewAllBtn.style.cssText = `
                background: rgba(255, 255, 255, 0.05); border: 1px solid #2c3440;
                color: #9ab; padding: 12px; border-radius: 8px; cursor: pointer;
                transition: all 0.2s ease; width: 100%; margin-top: 20px; font-weight: bold; font-size: 0.9rem;
            `;
            viewAllBtn.onmouseover = () => { viewAllBtn.style.color = '#fff'; viewAllBtn.style.background = 'rgba(255, 255, 255, 0.1)'; viewAllBtn.style.borderColor = 'var(--accent)'; };
            viewAllBtn.onmouseout = () => { viewAllBtn.style.color = '#9ab'; viewAllBtn.style.background = 'rgba(255, 255, 255, 0.05)'; viewAllBtn.style.borderColor = '#2c3440'; };
            viewAllBtn.onclick = () => openCharacterModal(followedCharacterIds);
            
            document.getElementById('fandom-cast-section').appendChild(viewAllBtn);
        }

    } catch (err) {
        console.error("Structured Character Error:", err);
        gridContainer.innerHTML = `<p class="meta">Failed to load structured character data.</p>`;
    }
}

function openCharacterModal(followedCharacterIds) {
    const modal = document.getElementById('character-modal');
    const closeBtn = document.getElementById('close-character-modal');
    const searchInput = document.getElementById('character-search-input');
    const grid = document.getElementById('full-character-grid');
    const loadMoreBtn = document.getElementById('load-more-chars-btn');

    let currentPage = 1;
    const pageSize = 24;
    let currentFiltered = [];

    const renderGrid = (append = false) => {
        if (!append) {
            grid.innerHTML = '';
            currentPage = 1;
        }
        
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const slice = currentFiltered.slice(startIndex, endIndex);

        if (currentFiltered.length === 0) {
            grid.innerHTML = `<p class="meta" style="grid-column: 1/-1; text-align: center;">No characters found matching "${searchInput.value}".</p>`;
            loadMoreBtn.style.display = 'none';
            return;
        }

        const html = slice.map((char) => {
            const fallbackImg = char.tmdbImage || FALLBACK_AVATAR;
            const safeDbImage = char.tmdbImage || '';
            const isFollowingChar = followedCharacterIds.has(char.wikiId);
            const btnClass = isFollowingChar ? 'secondary-btn' : 'primary-btn';
            const btnText = isFollowingChar ? 'Unfollow' : 'Follow';
            const escapedName = char.name.replace(/'/g, "\\'");

            return `
                <div class="cast-card" style="cursor: pointer; text-align: center; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 12px; border: 1px solid #2c3440;" onclick="routeToCharacter('${char.wikiId}')">
                    <img src="${fallbackImg}" style="width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" loading="lazy">
                    <span style="font-weight: bold; color: #fff; font-size: 0.95rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${char.name}</span>
                    <button class="${btnClass}" 
                        style="width: 100%; padding: 6px; font-size: 0.8rem; border-radius: 6px; margin-top: 10px;"
                        onclick="event.stopPropagation(); toggleCharacterFollow(this, '${char.wikiId}', '${escapedName}', '${safeDbImage}')">
                        ${btnText}
                    </button>
                </div>
            `;
        }).join('');

        if (append) {
            grid.insertAdjacentHTML('beforeend', html);
        } else {
            grid.innerHTML = html;
        }

        if (endIndex < currentFiltered.length) {
            loadMoreBtn.style.display = 'block';
        } else {
            loadMoreBtn.style.display = 'none';
        }
    };

    const applySearch = () => {
        const filterText = searchInput.value.toLowerCase();
        currentFiltered = allFandomCharacters.filter(char => 
            char.name.toLowerCase().includes(filterText)
        );
        renderGrid(false);
    };

    searchInput.value = '';
    applySearch();
    searchInput.oninput = applySearch;

    loadMoreBtn.onclick = () => {
        currentPage++;
        renderGrid(true);
    };

    modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}

async function fetchCharacterPreviewImage(wikiTitle, imgElementId) {
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}?redirects=1`;
        const res = await fetch(url).then(r => r.json());
        
        const imgEl = document.getElementById(imgElementId);
        if (imgEl && res.thumbnail && res.thumbnail.source) {
            imgEl.src = res.thumbnail.source;
        }
    } catch (e) { }
}

window.routeToCharacter = function(wikiId) {
    if (!wikiId) return;
    const currentMediaTitle = document.getElementById('fandom-title').textContent || '';
    window.location.href = `cast.html?characterWiki=${encodeURIComponent(wikiId)}&mediaId=${mediaId}&mediaType=${mediaType}&mediaTitle=${encodeURIComponent(currentMediaTitle)}`;
};

async function setupFandomFollowBtn(title, imageUrl) {
    const btn = document.getElementById('follow-fandom-btn');
    if (!currentUser) {
        btn.textContent = "Sign in to Follow Fandom";
        btn.onclick = () => window.location.href = 'index.html';
        return;
    }

    // Check if already following
    const { data } = await supabaseClient
        .from('user_fandoms')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('media_id', String(mediaId))
        .eq('media_type', mediaType)
        .maybeSingle();

    let isFollowing = !!data;
    
        const updateBtnUI = (following) => {
        // Determine the label based on whether this is a standard fandom or a collection
        const label = mediaType === 'collection' ? 'Collection' : 'Fandom';
        btn.textContent = following ? `Unfollow ${label}` : `Follow ${label}`;
        
        if (following) {
            btn.classList.remove('primary-btn');
            btn.classList.add('secondary-btn');
        } else {
            btn.classList.remove('secondary-btn');
            btn.classList.add('primary-btn');
        }
    };

    updateBtnUI(isFollowing);

    btn.onclick = async () => {
        btn.disabled = true; // Prevent spam clicks
        
        if (isFollowing) {
            const { error } = await supabaseClient
                .from('user_fandoms')
                .delete()
                .eq('user_id', currentUser.id)
                .eq('media_id', String(mediaId))
                .eq('media_type', mediaType);
            
            if (!error) {
                isFollowing = false;
                updateBtnUI(isFollowing);
            }
        } else {
            const { error } = await supabaseClient
                .from('user_fandoms')
                .insert({
                    user_id: currentUser.id,
                    media_id: String(mediaId),
                    media_type: mediaType,
                    title: title,
                    image_url: imageUrl
                });
            
            if (!error) {
                isFollowing = true;
                updateBtnUI(isFollowing);
            }
        }
        btn.disabled = false;
    };
}

window.toggleCharacterFollow = async function(btn, charId, charName, imageUrl) {
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    const isFollowing = btn.textContent.trim() === 'Unfollow';

    // Disable briefly while updating DB
    btn.disabled = true; 
    btn.style.opacity = '0.5';

    if (isFollowing) {
        const { error } = await supabaseClient
            .from('user_characters')
            .delete()
            .eq('user_id', currentUser.id)
            .eq('character_id', charId)
            .eq('media_id', String(mediaId))
            .eq('media_type', mediaType);
        
        if (!error) {
            btn.textContent = 'Follow';
            btn.classList.remove('secondary-btn');
            btn.classList.add('primary-btn');
        }
    } else {
        const { error } = await supabaseClient
            .from('user_characters')
            .insert({
                user_id: currentUser.id,
                character_id: charId,
                character_name: charName,
                media_id: String(mediaId),
                media_type: mediaType,
                image_url: imageUrl
            });
        
        if (!error) {
            btn.textContent = 'Unfollow';
            btn.classList.remove('primary-btn');
            btn.classList.add('secondary-btn');
        }
    }
    
    btn.disabled = false;
    btn.style.opacity = '1';
};

function showError(message) {
    document.getElementById('fandom-title').textContent = "Lore Unavailable";
    document.getElementById('fandom-overview').textContent = message;
    document.getElementById('fandom-meta').textContent = "---";
}

initFandomPage();