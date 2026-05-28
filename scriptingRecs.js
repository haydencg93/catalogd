let favoriteInputs = [];
let configData = null;
let searchTimeout = null;

// DOM Elements
const searchInput = document.getElementById('rec-search-input');
const searchResults = document.getElementById('rec-search-results');
const tagsContainer = document.getElementById('active-inputs-container');
const emptyMsg = document.getElementById('empty-inputs-msg');
const generateBtn = document.getElementById('generate-btn');
const statusMsg = document.getElementById('status-msg');
const resultsGrid = document.getElementById('results-grid');
const resultsHeader = document.getElementById('results-header');

async function initRecs() {
    try {
        const response = await fetch('config.json');
        configData = await response.json();
        setupLiveSearch();
    } catch (err) {
        console.error("[E] Could not load config.json:", err);
        statusMsg.textContent = "Error loading configuration.";
        statusMsg.style.color = "#ff4d4d";
    }
}

// Replicates the ID shifting math from your Mass Seeders
function getUniversalId(id, type) {
    if (type === 'movie' || type === 'tv') {
        return parseInt(id);
    }
    if (type === 'book') {
        // OpenLibrary returns keys like "/works/OL123W". We strip the text and add 100M.
        return parseInt(String(id).replace(/\D/g, ''), 10) + 100000000;
    }
    return id;
}

function setupLiveSearch() {
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = searchInput.value.trim();
        
        if (query.length < 3) {
            searchResults.innerHTML = '';
            searchResults.style.display = 'none';
            return;
        }

        searchTimeout = setTimeout(async () => {
            const options = { headers: { Authorization: `Bearer ${configData.tmdb_token}` } };

            try {
                // Fetch from TMDB and OpenLibrary
                const [movieRes, tvRes, bookRes] = await Promise.all([
                    fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`, options).then(r => r.json()),
                    fetch(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}`, options).then(r => r.json()),
                    fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`).then(r => r.json())
                ]);

                searchResults.innerHTML = '';
                searchResults.style.display = 'block';

                const createSearchRow = (id, title, year, type, imageUrl, subtitle) => {
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
                    div.onclick = () => {
                        addVibeInput({ 
                            id: id, 
                            universalId: getUniversalId(id, type),
                            title: title, 
                            type: type 
                        });
                        searchResults.innerHTML = ''; 
                        searchInput.value = '';
                        searchResults.style.display = 'none';
                    };
                    return div;
                };

                // Populate Movies
                (movieRes.results || []).slice(0, 3).forEach(item => {
                    const year = item.release_date ? ` (${item.release_date.split('-')[0]})` : "";
                    const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Image';
                    searchResults.appendChild(createSearchRow(item.id, item.title, year, 'movie', img, "Movie"));
                });

                // Populate TV
                (tvRes.results || []).slice(0, 3).forEach(item => {
                    const year = item.first_air_date ? ` (${item.first_air_date.split('-')[0]})` : "";
                    const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Image';
                    searchResults.appendChild(createSearchRow(item.id, item.name, year, 'tv', img, "TV Show"));
                });

                // Populate Books
                (bookRes.docs || []).slice(0, 3).forEach(book => {
                    const year = book.first_publish_year ? ` (${book.first_publish_year})` : "";
                    const img = book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : 'https://via.placeholder.com/92x138?text=No+Cover';
                    const author = book.author_name ? book.author_name[0] : "Unknown Author";
                    searchResults.appendChild(createSearchRow(book.key, book.title, year, 'book', img, author));
                });

            } catch (error) {
                console.error("Search error:", error);
            }
        }, 300);
    });

    // Close dropdown if clicked outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
        }
    });
}

function addVibeInput(item) {
    if (favoriteInputs.length >= 5) {
        return alert("You can only add up to 5 items to define your vibe.");
    }

    const isDuplicate = favoriteInputs.some(f => f.universalId === item.universalId);
    if (isDuplicate) return;

    favoriteInputs.push(item);
    renderTags();
}

function renderTags() {
    if (favoriteInputs.length === 0) {
        tagsContainer.innerHTML = '';
        tagsContainer.appendChild(emptyMsg);
        emptyMsg.style.display = 'block';
        generateBtn.disabled = true;
        return;
    }

    emptyMsg.style.display = 'none';
    tagsContainer.innerHTML = '';
    
    favoriteInputs.forEach((item, index) => {
        const tag = document.createElement('div');
        tag.className = 'vibe-tag';
        tag.innerHTML = `
            <span>[${item.type}]</span> ${item.title}
            <button onclick="removeInput(${index})">×</button>
        `;
        tagsContainer.appendChild(tag);
    });

    generateBtn.disabled = false;
}

window.removeInput = function(index) {
    favoriteInputs.splice(index, 1);
    renderTags();
};

generateBtn.addEventListener('click', async () => {
    if (!configData) return;

    const checkboxes = document.querySelectorAll('.output-checkbox input:checked');
    const desiredOutputs = Array.from(checkboxes).map(cb => cb.value);

    if (desiredOutputs.length === 0) {
        return alert("Please select at least one target media type.");
    }

    generateBtn.disabled = true;
    generateBtn.textContent = "Calculating Vibe...";
    statusMsg.textContent = "";
    resultsGrid.innerHTML = "";
    resultsHeader.style.display = "none";

    try {
        console.log("[I] Sending accurate IDs to Edge Function...");
        
        const response = await fetch(`${configData.supabase_url}/functions/v1/get-recommendations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${configData.supabase_key}` 
            },
            body: JSON.stringify({
                favoriteIds: favoriteInputs.map(f => f.universalId), // Sending pure integers!
                desiredOutputs: desiredOutputs
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status}`);
        }

        console.log("[S] Received recommendations!");
        renderRecommendations(data.recommendations);

    } catch (error) {
        console.error("[E] Recommendation Pipeline Error:", error);
        statusMsg.textContent = error.message;
        statusMsg.style.color = "#ff4d4d";
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate Recommendations";
    }
});

// 4. Render the Results with Lazy Loading Posters
function renderRecommendations(recs) {
    if (!recs || recs.length === 0) {
        statusMsg.textContent = "No recommendations found. Try adding different items!";
        statusMsg.style.color = "#ffb347";
        return;
    }

    resultsHeader.style.display = "block";
    
    setTimeout(() => {
        resultsHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    recs.forEach(rec => {
        const card = document.createElement('div');
        card.className = 'rec-horizontal-card';
        card.onclick = () => {
            window.location.href = `details.html?id=${encodeURIComponent(rec.id)}&type=${rec.media_type}`;
        };
        
        const shortOverview = rec.overview ? rec.overview.substring(0, 130) + '...' : 'No overview available.';
        const imgId = `poster-${rec.id}`;

        card.innerHTML = `
            <img id="${imgId}" class="rec-poster" src="https://via.placeholder.com/120x180/1b2228/9ab?text=Loading..." alt="Poster">
            <div class="rec-info">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <span class="badge badge-${rec.media_type}">${rec.media_type}</span>
                    <span class="match-score">${rec.match_percentage}% Match</span>
                </div>
                <div class="title" style="font-size: 1.15rem; margin-top: 8px; font-weight: bold; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${rec.title}</div>
                <div class="meta" style="font-size: 0.85rem; line-height: 1.4; color: #9ab; margin-top: 8px;">${shortOverview}</div>
            </div>
        `;
        
        resultsGrid.appendChild(card);

        // Tell the background script to go find the actual image!
        fetchDynamicPoster(rec, imgId);
    });
}

// 5. The Lazy Loader
async function fetchDynamicPoster(rec, imgElementId) {
    const imgEl = document.getElementById(imgElementId);
    if (!imgEl || !configData) return;

    try {
        if (rec.media_type === 'movie' || rec.media_type === 'tv') {
            const res = await fetch(`https://api.themoviedb.org/3/${rec.media_type}/${rec.id}`, {
                headers: { Authorization: `Bearer ${configData.tmdb_token}` }
            }).then(r => r.json());
            
            if (res.poster_path) {
                imgEl.src = `https://image.tmdb.org/t/p/w185${res.poster_path}`;
            } else {
                imgEl.src = 'https://via.placeholder.com/120x180/1b2228/9ab?text=No+Poster';
            }
        } 
        else if (rec.media_type === 'book') {
            // Reverse the math! 100027329 becomes 27329
            const rawNum = parseInt(rec.id) - 100000000;
            const res = await fetch(`https://openlibrary.org/works/OL${rawNum}W.json`).then(r => r.json());
            
            if (res.covers && res.covers.length > 0) {
                imgEl.src = `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg`;
            } else {
                imgEl.src = 'https://via.placeholder.com/120x180/1b2228/9ab?text=No+Cover';
            }
        }
    } catch (e) {
        console.error(`Error fetching poster for ${rec.title}:`, e);
        imgEl.src = 'https://via.placeholder.com/120x180/1b2228/ff4d4d?text=Error';
    }
}

initRecs();