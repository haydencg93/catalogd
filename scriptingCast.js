const params = new URLSearchParams(window.location.search);
const personId = params.get('personId');
const authorId = params.get('authorId');
const artistName = params.get('artist');
let supabaseClient = null;

async function initCastPage() {
    try {
        const configResponse = await fetch('config.json');
        const config = await configResponse.json();
        
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        setupHeader();

        if (authorId) {
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

// Robust year extraction from various Open Library data shapes
function extractYear(item) {
    if (!item) return null;
    const dateSources = [
        item.first_publish_date,
        item.publish_date,
        item.created?.value,
        item.last_modified?.value
    ];
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

    // Author Photo
    const imageContainer = document.getElementById('person-image-container');
    if (author.photos && author.photos.length > 0) {
        imageContainer.innerHTML = `<img src="https://covers.openlibrary.org/a/id/${author.photos[0]}-L.jpg" alt="${author.name}" class="person-img">`;
    } else {
        const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(author.name)}&background=1b2228&color=9ab&size=300`;
        imageContainer.innerHTML = `<img src="${fallback}" class="person-img">`;
    }

    // Increased limit to 1000 to ensure even the most prolific authors (King, Patterson, etc.) are fully captured
    const worksData = await fetch(`https://openlibrary.org/authors/${id}/works.json?limit=1000`).then(r => r.json());
    let rawWorks = worksData.entries || [];

    // Filter and Deduplicate
    const titleMap = new Map();
    const noiseKeywords = ["sparknotes", "literature guide", "summary of", "study guide", "cliffsnote", "workbook"];
    
    rawWorks.forEach(item => {
        const titleLower = item.title.toLowerCase().trim();
        
        // Skip noise
        if (noiseKeywords.some(keyword => titleLower.includes(keyword))) return;
        
        // Smart Deduplication: If we see the same title, keep the one that has a cover
        if (!titleMap.has(titleLower) || (!titleMap.get(titleLower).covers && item.covers)) {
            titleMap.set(titleLower, item);
        }
    });

    let works = Array.from(titleMap.values());

    // Sort by year descending
    works.sort((a, b) => {
        const yearA = extractYear(a) || '0000';
        const yearB = extractYear(b) || '0000';
        return yearB.localeCompare(yearA);
    });

    // Best Known Works Section
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

    // Full Bibliography List
    const list = document.getElementById('film-list');
    list.innerHTML = ''; // Clear previous

    const bookPlaceholder = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDQwIDYwIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNjAiIGZpbGw9IiMxYjIyMjgiLz48cGF0aCBkPSJNMTAgMTBoMjB2NDBIMTB6IiBmaWxsPSJub25lIiBzdHJva2U9IiM5YWIiIHN0cm9rZS13aWR0aD0iMiIvPjxsaW5lIHgxPSIxNSIgeTE9IjIwIiB4Mj0iMjUiIHkyPSIyMCIgc3Ryb2tlPSIjOWFiIiBzdHJva2Utd2lkdGg9IjIiLz48bGluZSB4MT0iMTUiIHkxPSIzMCIgeDI9IjI1IiB5Mj0iMzAiIHN0cm9rZT0iIzlhYiIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+`;

    works.forEach(item => {
        const yearDisplay = extractYear(item) || '----';
        const poster = item.covers 
            ? `https://covers.openlibrary.org/b/id/${item.covers[0]}-S.jpg` 
            : bookPlaceholder;

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
    
    if (person.profile_path) {
        document.getElementById('person-image-container').innerHTML = `
            <img src="https://image.tmdb.org/t/p/w300${person.profile_path}" alt="${person.name}" class="person-img">
        `;
    }

    const credits = await fetch(`https://api.themoviedb.org/3/person/${id}/combined_credits`, { headers }).then(r => r.json());
    const actingCredits = (credits.cast || []).filter(item => item.poster_path);
    const uniqueCredits = [];
    const seenIds = new Set();
    
    actingCredits.forEach(item => {
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

    const sorted = credits.cast.sort((a, b) => {
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

        return `
            <div class="film-row" onclick="window.location.href='details.html?id=${item.id}&type=${item.media_type}'">
                <span class="film-year">${year}</span>
                <img src="${poster}" class="mini-poster" alt="poster">
                <div class="film-info">
                    <span class="film-title"><strong>${item.title || item.name}</strong></span>
                    <span class="film-role">${item.character ? 'as ' + item.character : ''}</span>
                </div>
            </div>
        `;
    }).join('');
}

// --- NEW: LAST.FM ARTIST PAGE LOGIC ---
async function initArtistPage(name, apiKey) {
    try {
        // 1. Fetch Artist Bio & Top Albums
        const infoRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json`).then(r => r.json());
        const albumsRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.gettopalbums&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json&limit=50`).then(r => r.json());

        const artist = infoRes.artist;
        const albums = albumsRes.topalbums?.album || [];

        // 2. Set Header Info
        document.getElementById('person-name').textContent = artist.name;
        
        let rawSummary = artist.bio?.summary || "No biography available.";
        document.getElementById('person-biography').textContent = rawSummary.split('<a href')[0].trim();

        const filmographyHeader = document.querySelector('#filmography h3');
        if (filmographyHeader) filmographyHeader.textContent = "Discography";

        // 3. Workaround: Use Top Album Cover as Profile Picture
        let photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(artist.name)}&background=1b2228&color=9ab&size=512`;
        if (albums.length > 0 && albums[0].image && albums[0].image.length > 3 && albums[0].image[3]['#text']) {
            photoUrl = albums[0].image[3]['#text'];
        }
        document.getElementById('person-image-container').innerHTML = `<img src="${photoUrl}" alt="${artist.name}" class="person-img">`;

        // 4. Best Known Works (Top 4 Albums)
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

        // 5. Full Discography List
        const list = document.getElementById('film-list');
        list.innerHTML = '';
        
        // A cool custom SVG placeholder that looks like a vinyl record
        const albumPlaceholder = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDQwIDYwIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNjAiIGZpbGw9IiMxYjIyMjgiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjMwIiByPSIxMiIgc3Ryb2tlPSIjOWFiIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjMwIiByPSI0IiBmaWxsPSIjOWFiIi8+PC9zdmc+`;

        albums.forEach(item => {
            let img = albumPlaceholder;
            // Grab the medium sized image for the list rows
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

// Helper to format playcounts cleanly (e.g. 1.2M plays)
function formatPlays(numStr) {
    const num = parseInt(numStr);
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

async function setupHeader() {
    const searchInput = document.getElementById('search-input');
    const loginBtn = document.getElementById('login-btn');
    const profileBtn = document.getElementById('profile-btn');

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim() !== "") {
            window.location.href = `index.html?search=${encodeURIComponent(searchInput.value)}`;
        }
    });

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        loginBtn.textContent = "Sign Out";
        loginBtn.onclick = async () => {
            await supabaseClient.auth.signOut();
            location.reload();
        };
        if (profileBtn) profileBtn.style.display = 'inline-block';
    } else {
        loginBtn.onclick = () => window.location.href = 'index.html';
    }
}

initCastPage();