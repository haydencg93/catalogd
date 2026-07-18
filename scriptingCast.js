const params = new URLSearchParams(window.location.search);
const personId = params.get('personId');
const authorId = params.get('authorId');
const artistName = params.get('artist');
const characterWiki = params.get('characterWiki');
const mediaId = params.get('mediaId');
const mediaType = params.get('mediaType');
const mediaTitle = params.get('mediaTitle');

let supabaseClient = null;
let currentUser = null; // Track the logged-in user

async function initCastPage() {
    try {
        const configResponse = await fetch('config.json');
        const config = await configResponse.json();
        
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        await setupHeader();

        if (characterWiki) {
            await initCharacterPage(characterWiki, mediaId, mediaType);
        } else if (authorId) {
            await initAuthorPage(authorId);
        } else if (personId) {
            await initPersonPage(personId, config.tmdb_token);
        } else if (artistName) {
            await initArtistPage(artistName, config.lastfm_key);
        } else {
            document.getElementById('person-name').textContent = "No person selected.";
        }

    } catch (err) {
        console.error("Error initializing cast page:", err);
    }
}

// --- NEW: CHARACTER PAGE LOGIC ---
async function initCharacterPage(wikiId, mId, mType) {
    let name = wikiId.replace(/_/g, ' ');
    document.getElementById('person-name').textContent = name;
    
    // Characters don't have filmographies or "Known For" sections
    document.getElementById('filmography').style.display = 'none';

    let bioText = "";
    let imageUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1b2228&color=9ab&size=300`;

    // 1. Try to fetch rich data from Wikipedia (Idea 2 Cascade)
    try {
        // Reverse the order so we try the most specific queries FIRST
        const attempts = [
            `${encodeURIComponent(wikiId)}_(${encodeURIComponent(mediaTitle || '')}_character)`,
            `${encodeURIComponent(wikiId)}_(character)`,
            encodeURIComponent(wikiId)
        ];
        
        let wikiRes = null;
        for (let query of attempts) {
            // Safely prevent bad queries from running if parameters are missing
            if (!query || query.startsWith('_')) continue; 
            
            const tempRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${query}?redirects=1`);
            
            if (tempRes.ok) {
                const data = await tempRes.json();
                
                // Disambiguation Check: Discard Wikipedia directory pages
                if (data.type === 'disambiguation' || (data.extract && data.extract.includes("may refer to:"))) {
                    continue;
                }
                
                // Sanity Check: If we fall back to the generic single-word attempt, ensure it's actually about a character
                if (query === encodeURIComponent(wikiId)) {
                    const desc = (data.description || "").toLowerCase();
                    const extract = (data.extract || "").toLowerCase();
                    const media = (mediaTitle || "").toLowerCase();
                    
                    // If it doesn't mention "character", "fictional", or the media title, skip the false positive
                    if (!desc.includes('character') && !desc.includes('fictional') && (!media || !extract.includes(media))) {
                        continue; 
                    }
                }
                
                wikiRes = data;
                break;
            }
        }

        if (wikiRes && wikiRes.title && wikiRes.title.toLowerCase().includes("list of")) {
            // Ignore the Wikipedia summary if it redirected us to a "List of..." page
            bioText = ""; 
        } else if (wikiRes) {
            if (wikiRes.extract) bioText = wikiRes.extract;
            if (wikiRes.thumbnail?.source) imageUrl = wikiRes.thumbnail.source;
            if (wikiRes.title) {
                // Strip out the "(character)" suffix from the display name if it exists
                name = wikiRes.title.replace(/\s\(.*?\)$/, ''); 
                document.getElementById('person-name').textContent = name;
            }
        }
    } catch (e) {
        console.log("Wiki fetch fallback triggered for character");
    }

    // 2. Fallback if Wikipedia failed or was a "List of..." page
    if (!bioText && mediaTitle) {
        const displayType = mType === 'tv' ? 'TV show' : 'movie';
        bioText = `${name} is a character in the ${displayType} ${mediaTitle}.`;
    } else if (!bioText) {
        bioText = "No biography available.";
    }

    document.getElementById('person-biography').textContent = bioText;

    // 3. Setup Universal UI
    await setupPersonImage(wikiId, 'character', imageUrl, name);
    setupFollowBtn(wikiId, name, 'character', imageUrl, mId, mType);
}

// Robust year extraction from various Open Library data shapes
function extractYear(item) {
    if (!item) return null;
    const dateSources = [item.first_publish_date, item.publish_date, item.created?.value, item.last_modified?.value];
    for (let dateStr of dateSources) {
        if (dateStr) {
            const match = String(dateStr).match(/\d{4}/);
            if (match) return match[0];
        }
    }
    return null;
}

async function initAuthorPage(id) {
    const author = await fetch(`https://openlibrary.org/authors/${id}.json`).then(r => r.json());
    document.getElementById('person-name').textContent = author.name;
    
    let bioText = "No biography available.";
    if (author.bio) {
        bioText = typeof author.bio === 'string' ? author.bio : author.bio.value;
    }
    document.getElementById('person-biography').textContent = bioText;
    
    const filmographyHeader = document.querySelector('#filmography h3');
    if (filmographyHeader) filmographyHeader.textContent = "Bibliography";

    // Setup Image & Follow Button
    let defaultImg = author.photos && author.photos.length > 0 
        ? `https://covers.openlibrary.org/a/id/${author.photos[0]}-L.jpg` 
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(author.name)}&background=1b2228&color=9ab&size=300`;
    
    await setupPersonImage(id, 'author', defaultImg, author.name);
    setupFollowBtn(id, author.name, 'author', defaultImg, null, null);

    const worksData = await fetch(`https://openlibrary.org/authors/${id}/works.json?limit=1000`).then(r => r.json());
    let rawWorks = worksData.entries || [];

    const titleMap = new Map();
    const noiseKeywords = ["sparknotes", "literature guide", "summary of", "study guide", "cliffsnote", "workbook"];
    
    rawWorks.forEach(item => {
        const titleLower = item.title.toLowerCase().trim();
        if (noiseKeywords.some(keyword => titleLower.includes(keyword))) return;
        if (!titleMap.has(titleLower) || (!titleMap.get(titleLower).covers && item.covers)) {
            titleMap.set(titleLower, item);
        }
    });

    let works = Array.from(titleMap.values());
    works.sort((a, b) => {
        const yearA = extractYear(a) || '0000';
        const yearB = extractYear(b) || '0000';
        return yearB.localeCompare(yearA);
    });

    const knownFor = works.filter(w => w.covers && w.covers.length > 0).slice(0, 4);
    if (knownFor.length > 0) {
        const knownForHtml = `
            <div class="known-for-section">
                <h3>Best Known Works</h3>
                <div class="known-for-grid">
                    ${knownFor.map(item => `
                        <div class="media-card" onclick="window.location.href='details.html?id=${item.key}&type=book'">
                            <div class="poster-wrapper">
                                <img src="https://covers.openlibrary.org/b/id/${item.covers[0]}-M.jpg" alt="${item.title}" onerror="this.style.display='none'">
                            </div>
                            <div class="media-info">
                                <div class="title" style="font-size: 0.9rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${item.title}
                                </div>
                                <div class="meta" style="font-size: 0.8rem; color: #9ab;">
                                    ${extractYear(item) || 'Unknown'}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.getElementById('person-bio-area').insertAdjacentHTML('beforeend', knownForHtml);
    }

    const list = document.getElementById('film-list');
    list.innerHTML = ''; 

    const bookPlaceholder = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDQwIDYwIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNjAiIGZpbGw9IiMxYjIyMjgiLz48cGF0aCBkPSJNMTAgMTBoMjB2NDBIMTB6IiBmaWxsPSJub25lIiBzdHJva2U9IiM5YWIiIHN0cm9rZS13aWR0aD0iMiIvPjxsaW5lIHgxPSIxNSIgeTE9IjIwIiB4Mj0iMjUiIHkyPSIyMCIgc3Ryb2tlPSIjOWFiIiBzdHJva2Utd2lkdGg9IjIiLz48bGluZSB4MT0iMTUiIHkxPSIzMCIgeDI9IjI1IiB5Mj0iMzAiIHN0cm9rZT0iIzlhYiIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+`;

    works.forEach(item => {
        const yearDisplay = extractYear(item) || '----';
        const poster = item.covers ? `https://covers.openlibrary.org/b/id/${item.covers[0]}-S.jpg` : bookPlaceholder;

        const row = document.createElement('div');
        row.className = 'film-row';
        row.onclick = () => window.location.href = `details.html?id=${item.key}&type=book`;
        
        row.innerHTML = `
            <span class="film-year">${yearDisplay}</span>
            <img src="${poster}" class="mini-poster" alt="book" onerror="this.src='${bookPlaceholder}'">
            <div class="film-info">
                <span class="film-title"><strong>${item.title}</strong></span>
                <span class="film-role">Author</span>
            </div>
        `;
        list.appendChild(row);
    });
}

async function initPersonPage(id, token) {
    const headers = { Authorization: `Bearer ${token}` };
    const person = await fetch(`https://api.themoviedb.org/3/person/${id}`, { headers }).then(r => r.json());
    document.getElementById('person-name').textContent = person.name;
    document.getElementById('person-biography').textContent = person.biography || "No biography available.";
    
    // Setup Image & Follow Button
    let defaultImg = person.profile_path 
        ? `https://image.tmdb.org/t/p/w300${person.profile_path}` 
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(person.name)}&background=1b2228&color=9ab&size=300`;
    
    const category = person.known_for_department === 'Acting' ? 'actor' : 'crew';

    await setupPersonImage(id, category, defaultImg, person.name);
    setupFollowBtn(id, person.name, category, defaultImg, null, null);

    const credits = await fetch(`https://api.themoviedb.org/3/person/${id}/combined_credits`, { headers }).then(r => r.json());
    
    // For Crew members, use the crew array instead of cast for the known-for/filmography
    const creditArray = category === 'actor' ? (credits.cast || []) : (credits.crew || []);
    
    const validCredits = creditArray.filter(item => item.poster_path);
    const uniqueCredits = [];
    const seenIds = new Set();
    
    validCredits.forEach(item => {
        if (!seenIds.has(item.id)) {
            uniqueCredits.push(item);
            seenIds.add(item.id);
        }
    });

    const knownFor = uniqueCredits.sort((a, b) => {
        const typeWeightA = a.media_type === 'movie' ? 2 : 1;
        const typeWeightB = b.media_type === 'movie' ? 2 : 1;
        const scoreA = (a.vote_count || 0) * typeWeightA;
        const scoreB = (b.vote_count || 0) * typeWeightB;
        return scoreB - scoreA;
    }).slice(0, 4);

    if (knownFor.length > 0) {
        const knownForHtml = `
            <div class="known-for-section">
                <h3>Known For</h3>
                <div class="known-for-grid">
                    ${knownFor.map(item => `
                        <div class="media-card" onclick="window.location.href='details.html?id=${item.id}&type=${item.media_type}'">
                            <div class="poster-wrapper">
                                <img src="${item.poster_path ? 'https://image.tmdb.org/t/p/w300' + item.poster_path : 'placeholder.png'}" alt="${item.title || item.name}">
                            </div>
                            <div class="media-info">
                                <div class="title" style="font-size: 0.9rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${item.title || item.name}
                                </div>
                                <div class="meta" style="font-size: 0.8rem; color: #9ab;">
                                    ${(item.release_date || item.first_air_date || '').split('-')[0] || '----'}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.getElementById('person-bio-area').insertAdjacentHTML('beforeend', knownForHtml);
    }

    const sorted = creditArray.sort((a, b) => {
        const dateA = a.release_date || a.first_air_date || '0000';
        const dateB = b.release_date || b.first_air_date || '0000';
        return dateB.localeCompare(dateA);
    });

    const list = document.getElementById('film-list');
    list.innerHTML = sorted.map(item => {
        const year = (item.release_date || item.first_air_date || '----').split('-')[0];
        const poster = item.poster_path 
            ? `https://image.tmdb.org/t/p/w92${item.poster_path}` 
            : 'https://via.placeholder.com/40x60?text=?';
            
        const role = category === 'actor' ? (item.character ? 'as ' + item.character : '') : (item.job || '');

        return `
            <div class="film-row" onclick="window.location.href='details.html?id=${item.id}&type=${item.media_type}'">
                <span class="film-year">${year}</span>
                <img src="${poster}" class="mini-poster" alt="poster">
                <div class="film-info">
                    <span class="film-title"><strong>${item.title || item.name}</strong></span>
                    <span class="film-role">${role}</span>
                </div>
            </div>
        `;
    }).join('');
}

async function initArtistPage(name, apiKey) {
    try {
        const infoRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json`).then(r => r.json());
        const albumsRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.gettopalbums&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json&limit=50`).then(r => r.json());

        const artist = infoRes.artist;
        const albums = albumsRes.topalbums?.album || [];

        document.getElementById('person-name').textContent = artist.name;
        
        let rawSummary = artist.bio?.summary || "No biography available.";
        document.getElementById('person-biography').textContent = rawSummary.split('<a href')[0].trim();

        const filmographyHeader = document.querySelector('#filmography h3');
        if (filmographyHeader) filmographyHeader.textContent = "Discography";

        // Setup Image & Follow Button
        let defaultImg = `https://ui-avatars.com/api/?name=${encodeURIComponent(artist.name)}&background=1b2228&color=9ab&size=512`;
        if (albums.length > 0 && albums[0].image && albums[0].image.length > 3 && albums[0].image[3]['#text']) {
            defaultImg = albums[0].image[3]['#text'];
        }
        
        await setupPersonImage(encodeURIComponent(artist.name), 'artist', defaultImg, artist.name);
        setupFollowBtn(encodeURIComponent(artist.name), artist.name, 'artist', defaultImg, null, null);

        const knownFor = albums.slice(0, 4);
        if (knownFor.length > 0) {
            const knownForHtml = `
                <div class="known-for-section">
                    <h3>Top Albums</h3>
                    <div class="known-for-grid">
                        ${knownFor.map(item => {
                            let img = 'https://via.placeholder.com/500x750?text=No+Cover';
                            if (item.image && item.image.length > 3 && item.image[3]['#text']) img = item.image[3]['#text'];
                            const compositeId = encodeURIComponent(`${artist.name}|||${item.name}`);
                            return `
                            <div class="media-card" onclick="window.location.href='details.html?id=${compositeId}&type=album'">
                                <div class="poster-wrapper">
                                    <img src="${img}" alt="${item.name}">
                                </div>
                                <div class="media-info">
                                    <div class="title" style="font-size: 0.9rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                        ${item.name}
                                    </div>
                                    <div class="meta" style="font-size: 0.8rem; color: #9ab;">
                                        ${item.playcount ? `${parseInt(item.playcount).toLocaleString()} plays` : 'Album'}
                                    </div>
                                </div>
                            </div>`
                        }).join('')}
                    </div>
                </div>
            `;
            document.getElementById('person-bio-area').insertAdjacentHTML('beforeend', knownForHtml);
        }

        const list = document.getElementById('film-list');
        list.innerHTML = '';
        
        const albumPlaceholder = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDQwIDYwIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNjAiIGZpbGw9IiMxYjIyMjgiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjMwIiByPSIxMiIgc3Ryb2tlPSIjOWFiIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjMwIiByPSI0IiBmaWxsPSIjOWFiIi8+PC9zdmc+`;

        albums.forEach(item => {
            let img = albumPlaceholder;
            if (item.image && item.image.length > 1 && item.image[1]['#text']) img = item.image[1]['#text']; 
            
            const compositeId = encodeURIComponent(`${artist.name}|||${item.name}`);
            const plays = item.playcount ? formatPlays(item.playcount) : '---';
            
            const row = document.createElement('div');
            row.className = 'film-row';
            row.onclick = () => window.location.href = `details.html?id=${compositeId}&type=album`;
            
            row.innerHTML = `
                <span class="film-year" style="font-size: 0.85rem; min-width: 75px;">${plays}</span>
                <img src="${img}" class="mini-poster" alt="album" onerror="this.src='${albumPlaceholder}'">
                <div class="film-info">
                    <span class="film-title"><strong>${item.name}</strong></span>
                    <span class="film-role">Album</span>
                </div>
            `;
            list.appendChild(row);
        });

    } catch (err) {
        console.error("Error loading Last.fm Artist:", err);
        document.getElementById('person-name').textContent = "Artist Not Found";
    }
}

// --- UNIVERSAL PERSON UI LOGIC ---
async function setupPersonImage(id, category, defaultUrl, name) {
    let finalUrl = defaultUrl;
    
    // Check if the user has a custom override saved
    if (currentUser) {
        const { data } = await supabaseClient.from('custom_imgs')
            .select('custom_poster')
            .eq('user_id', currentUser.id)
            .eq('media_id', String(id))
            .eq('media_type', category)
            .maybeSingle();
            
        if (data && data.custom_poster) finalUrl = data.custom_poster;
    }

    document.getElementById('person-image-container').innerHTML = `<img src="${finalUrl}" alt="${name}" class="person-img" id="current-person-img">`;
    setupCustomArt(id, category);
}

async function setupFollowBtn(charId, charName, category, imageUrl, mediaId, mediaType) {
    const btn = document.getElementById('follow-person-btn');
    btn.style.display = 'block'; // Make it visible now that we have data
    
    if (!currentUser) {
        btn.textContent = "Sign in to Follow";
        btn.onclick = () => window.location.href = 'index.html';
        return;
    }

    const { data } = await supabaseClient
        .from('user_characters')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('character_id', String(charId))
        .eq('person_category', category)
        .maybeSingle();

    let isFollowing = !!data;
    
    const updateBtnUI = (following) => {
        btn.textContent = following ? 'Unfollow' : 'Follow';
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
        btn.disabled = true;
        if (isFollowing) {
            const { error } = await supabaseClient
                .from('user_characters')
                .delete()
                .eq('user_id', currentUser.id)
                .eq('character_id', String(charId))
                .eq('person_category', category);
            
            if (!error) {
                isFollowing = false;
                updateBtnUI(isFollowing);
            }
        } else {
            const { error } = await supabaseClient
                .from('user_characters')
                .insert({
                    user_id: currentUser.id,
                    character_id: String(charId),
                    character_name: charName,
                    person_category: category,
                    media_id: mediaId ? String(mediaId) : null,
                    media_type: mediaType || null,
                    image_url: imageUrl
                });
            
            if (!error) {
                isFollowing = true;
                updateBtnUI(isFollowing);
            }
        }
        btn.disabled = false;
    };

    setupTierListManager(charId, charName, category, imageUrl);
}

async function setupTierListManager(personId, personName, category, imageUrl) {
    const btn = document.getElementById('add-to-tier-list-btn');
    const modal = document.getElementById('tier-list-modal');
    const close = document.getElementById('close-tier-list-modal');
    const container = document.getElementById('user-tier-lists-selection');
    
    if (!currentUser) { 
        btn.style.display = 'none'; 
        return; 
    }

    btn.style.display = 'block';

    btn.onclick = async () => {
        modal.style.display = 'flex';
        container.innerHTML = '<p class="meta">Loading tiered lists...</p>';

        // Fetch tiered lists the user owns
        const { data: owned } = await supabaseClient
            .from('media_lists')
            .select('id, name')
            .eq('user_id', currentUser.id)
            .eq('is_tiered', true);

        // Fetch tiered lists where the user is a collaborator
        const { data: collabEntries } = await supabaseClient
            .from('list_collaborators')
            .select('list_id, media_lists(id, name, is_tiered)')
            .eq('user_id', currentUser.id);

        const collaborative = collabEntries?.map(e => e.media_lists).filter(l => l && l.is_tiered) || [];

        const listMap = new Map();
        [...(owned || []), ...collaborative].forEach(l => listMap.set(l.id, l));
        const finalLists = Array.from(listMap.values());

        if (finalLists.length === 0) {
            container.innerHTML = '<p class="meta">No tiered lists found. Create one on your Lists page!</p>';
            return;
        }

        const listIds = finalLists.map(l => l.id);
        const { data: currentItems } = await supabaseClient
            .from('list_items')
            .select('list_id')
            .in('list_id', listIds)
            .eq('media_id', String(personId));
            
        const addedListIds = new Set(currentItems?.map(item => item.list_id) || []);

        container.innerHTML = finalLists.map(l => {
            const isAdded = addedListIds.has(l.id);
            const btnClass = isAdded ? 'danger-btn' : 'primary-btn';
            const btnText = isAdded ? 'Remove' : 'Add';
            
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #2c3440;">
                    <span style="font-weight: 600; color: #fff; font-size: 1rem;">${l.name}</span>
                    <button onclick="toggleTierListItem('${l.id}', '${personId}', '${category}', '${personName.replace(/'/g, "\\'")}', '${imageUrl}', this)" class="${btnClass}" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 14px; width: auto; min-width: 60px;">${btnText}</button>
                </div>
            `;
        }).join('');
    };

    close.onclick = () => modal.style.display = 'none';
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

window.toggleTierListItem = async (listId, mediaId, mediaType, title, imageUrl, btnElement) => {
    const isAdding = btnElement.textContent === 'Add';
    btnElement.textContent = '...'; 

    if (isAdding) {
        const { error } = await supabaseClient
            .from('list_items')
            .insert({ 
                list_id: listId, 
                media_id: String(mediaId), 
                media_type: mediaType,
                media_title: title,
                custom_image_url: imageUrl,
                tier_rank: 'NS'
            });
        
        if (!error) {
            btnElement.textContent = 'Remove';
            btnElement.className = 'danger-btn'; 
        } else {
            alert("Failed to add to list.");
            btnElement.textContent = 'Add';
        }
    } else {
        const { error } = await supabaseClient
            .from('list_items')
            .delete()
            .eq('list_id', listId)
            .eq('media_id', String(mediaId));
        
        if (!error) {
            btnElement.textContent = 'Add';
            btnElement.className = 'primary-btn'; 
        } else {
            alert("Failed to remove from list.");
            btnElement.textContent = 'Remove';
        }
    }
};

async function setupCustomArt(personId, category) {
    const editBtn = document.getElementById('edit-art-btn');
    const modal = document.getElementById('custom-art-modal');
    const closeBtn = document.getElementById('close-art-modal');
    const saveBtn = document.getElementById('save-art-btn');
    const posterInput = document.getElementById('custom-poster-input');

    if (!currentUser) return; // Keep hidden if not signed in
    editBtn.style.display = 'block';

    const { data: existingArt } = await supabaseClient
        .from('custom_imgs')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('media_id', String(personId))
        .eq('media_type', category)
        .maybeSingle();

    editBtn.onclick = () => {
        posterInput.value = existingArt?.custom_poster || '';
        modal.style.display = 'flex';
    };

    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    saveBtn.onclick = async () => {
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;

        const customPoster = posterInput.value.trim() || null;

        const { error } = await supabaseClient
            .from('custom_imgs')
            .upsert({
                user_id: currentUser.id,
                media_id: String(personId),
                media_type: category,
                custom_poster: customPoster
            }, { onConflict: 'user_id,media_id,media_type' });

        if (!error) {
            location.reload(); 
        } else {
            alert("Error saving art: " + error.message);
            saveBtn.textContent = "Save Art";
            saveBtn.disabled = false;
        }
    };
}

// --- HELPER LOGIC ---
function formatPlays(numStr) {
    const num = parseInt(numStr);
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

async function setupHeader() {
    const searchInput = document.getElementById('search-input');
    const loginBtn = document.getElementById('login-btn');
    const profileMenu = document.getElementById('profile-menu');

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim() !== "") {
            window.location.href = `index.html?search=${encodeURIComponent(searchInput.value)}`;
        }
    });

    const { data: { user } } = await supabaseClient.auth.getUser();
    currentUser = user;

    if (user) {
        loginBtn.style.display = 'none'; 
        profileMenu.style.display = 'inline-block';
        
        const avatar = document.getElementById('nav-avatar');
        if (user.user_metadata && user.user_metadata.avatar_url) {
            avatar.src = user.user_metadata.avatar_url;
        }
    } else {
        loginBtn.style.display = 'inline-block';
        profileMenu.style.display = 'none';
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

initCastPage();