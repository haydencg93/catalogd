const params = new URLSearchParams(window.location.search);
let mediaId = params.get('id');
const mediaType = params.get('type');

// Unblockable Inline SVG Placeholders
const FALLBACK_POSTER = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='750'><rect width='500' height='750' fill='%2314181c'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%239ab'>No Image</text></svg>`;
const FALLBACK_AVATAR = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450'><rect width='300' height='450' fill='%2314181c'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='18' fill='%239ab'>No Image</text></svg>`;

// We only map standard entertainment media now
const propertyMap = {
    'movie': 'P4947',   
    'tv': 'P4983',      
    'album': 'P3192'    
};

async function initFandomPage() {
    if (!mediaId || !mediaType || !propertyMap[mediaType]) {
        showError("Fandom exploration is currently only available for Movies, TV Shows, and Albums.");
        return;
    }

    const propertyId = propertyMap[mediaType];
    
    try {
        const wikiTitle = await getWikipediaTitle(propertyId, mediaId);
        
        // 1. Fetch Plot and Summaries from Wikipedia (IF IT EXISTS)
        if (wikiTitle) {
            await fetchWikipediaLore(wikiTitle);
        } else {
            showError("No Wikipedia lore found for this item in Wikidata.");
        }
        
        // 2. Fetch Characters from Structured JSON APIs (TMDB)
        await fetchStructuredCharacters(mediaId, mediaType);

    } catch (error) {
        console.error("Fandom Fetch Error:", error);
        showError("Failed to load Wikipedia lore.");
    }
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
    tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6, .mw-editsection').forEach(el => el.remove());
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
        
        const imageEl = document.getElementById('fandom-image');
        if (summaryRes.thumbnail && summaryRes.thumbnail.source) {
            imageEl.src = summaryRes.thumbnail.source; 
        } else {
            imageEl.src = FALLBACK_POSTER;
        }

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

async function fetchStructuredCharacters(externalId, type) {
    if (type !== 'movie' && type !== 'tv') return;

    document.querySelector('#fandom-cast-section h3').textContent = "Characters";
    document.getElementById('fandom-cast-section').style.display = 'block';
    const gridContainer = document.getElementById('fandom-cast-content');
    gridContainer.innerHTML = '<p class="meta">Loading characters...</p>';

    try {
        const config = await fetch('config.json').then(r => r.json());
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${externalId}/credits?language=en-US`, {
            headers: { Authorization: `Bearer ${config.tmdb_token}` }
        }).then(r => r.json());
        
        if (!res.cast || res.cast.length === 0) {
            gridContainer.innerHTML = `<p class="meta">No structured character data found.</p>`;
            return;
        }

        const characters = res.cast.slice(0, 24).map(c => {
            let cleanName = c.character ? c.character.replace(/\(voice\)/gi, '').trim() : "Unknown";
            cleanName = cleanName.split('/')[0].trim();
            
            return {
                name: cleanName,
                wikiId: cleanName.replace(/\s+/g, '_'), 
                tmdbImage: c.profile_path ? `https://image.tmdb.org/t/p/w300${c.profile_path}` : null
            };
        }).filter(c => c.name !== "Unknown" && c.name.length > 1);

        let gridHtml = `<div class="fandom-character-grid">`;
        
        characters.forEach((char, index) => {
            const imgId = `fandom-img-${index}`;
            const fallbackImg = char.tmdbImage || FALLBACK_AVATAR;

            gridHtml += `
                <div class="fandom-character-card" style="cursor: default;">
                    <div class="fandom-char-img-wrapper">
                        <img id="${imgId}" src="${fallbackImg}" class="fandom-char-img" loading="lazy">
                    </div>
                    <div class="fandom-char-info">
                        <p class="fandom-char-text" style="font-weight: bold; font-size: 1rem; color: #fff;">${char.name}</p>
                    </div>
                </div>
            `;

            fetchCharacterPreviewImage(char.wikiId, imgId);
        });

        gridHtml += `</div>`;
        gridContainer.innerHTML = gridHtml;

    } catch (err) {
        console.error("Structured Character Error:", err);
        gridContainer.innerHTML = `<p class="meta">Failed to load structured character data.</p>`;
    }
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
    window.location.href = `cast.html?characterWiki=${encodeURIComponent(wikiId)}&mediaId=${mediaId}&mediaType=${mediaType}`;
};

function showError(message) {
    document.getElementById('fandom-title').textContent = "Lore Unavailable";
    document.getElementById('fandom-overview').textContent = message;
    document.getElementById('fandom-meta').textContent = "---";
}

initFandomPage();