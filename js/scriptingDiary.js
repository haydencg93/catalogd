import { loadConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';

let supabaseClient = null;

let allLogs = [];
let filteredLogs = [];
let currentPage = 1;
const PAGE_SIZE = 10;
let sortOrder = 'desc';
let currentType = 'all';
let diaryOwnerId = null;
let isViewerOwner = false;
let customImgsMap = new Map();
let currentSortColumn = 'date';

async function initDiary() {
    try {
        const config = await loadConfig();
        supabaseClient = await getSupabaseClient();
        await customElements.whenDefined('app-header');
        await document.querySelector('app-header').initializeAuth(supabaseClient);

        // 1. Identify whose diary to load
        const params = new URLSearchParams(window.location.search);
        const urlId = params.get('id');
        const { data: { session } } = await supabaseClient.auth.getSession();
        const loggedInUserId = session?.user?.id;

        // Fallback to logged-in user if no ID is in URL
        diaryOwnerId = urlId || loggedInUserId;
        isViewerOwner = (diaryOwnerId === loggedInUserId);

        if (!diaryOwnerId) {
            window.location.href = 'index.html';
            return;
        }

        // --- FETCH ALL CUSTOM IMAGES FOR THIS DIARY OWNER ---
        const { data: customImgs } = await supabaseClient
            .from('custom_imgs')
            .select('*')
            .eq('user_id', diaryOwnerId);
            
        if (customImgs) {
            customImgs.forEach(img => {
                customImgsMap.set(`${img.media_type}_${img.media_id}`, img);
            });
        }

        // 2. UI Adjustments for Networking
        const pageTitle = document.querySelector('h1');        
        if (!isViewerOwner) {
            // Fetch owner name for the title
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('display_name')
                .eq('id', diaryOwnerId)
                .single();
            
            pageTitle.textContent = profile ? `${profile.display_name}'s Diary` : "Diary";
            
            // HIDE Action column (Edit/Delete) for non-owners via CSS injection
            const style = document.createElement('style');
            style.innerHTML = `
                #diary-table th:nth-child(8), 
                #diary-table td:nth-child(8) { display: none !important; }
            `;
            document.head.appendChild(style);
            
            // --- NEW: Inject the "Back to Profile" Context Button ---
            const navActions = document.querySelector('.nav-actions');
            if (navActions && !document.getElementById('context-profile-btn')) {
                const contextBtn = document.createElement('button');
                contextBtn.id = 'context-profile-btn';
                contextBtn.className = 'secondary-btn';
                contextBtn.style.marginRight = '10px';
                contextBtn.textContent = profile ? `← ${profile.display_name}'s Profile` : '← Back to Profile';
                contextBtn.onclick = () => window.location.href = `profile.html?id=${diaryOwnerId}`;
                
                // Prepend puts it at the very left of the nav-actions container
                navActions.prepend(contextBtn);
            }
        }

        // 3. Fetch logs for the SPECIFIC user
        const { data: logs } = await supabaseClient
            .from('media_logs')
            .select('*')
            .eq('user_id', diaryOwnerId) 
            .order('watched_on', { ascending: false })
            .order('created_at', { ascending: false });

        allLogs = logs || [];

        // Build Year Filter (Based on Release Year)
        const yearSelect = document.getElementById('year-filter');
        const uniqueYearsRaw = [...new Set(allLogs.map(l => l.release_year))];
        
        // Filter out specific numeric years
        const uniqueYears = uniqueYearsRaw
            .filter(y => y && !isNaN(y) && y.toString().trim() !== '')
            .map(Number)
            .sort((a,b) => b - a);
            
        // Calculate Decades
        const decades = [...new Set(uniqueYears.map(y => Math.floor(y / 10) * 10))].sort((a,b) => b - a);

        let yearHTML = '<optgroup label="None"><option value="all">All Release Years</option></optgroup>';

        if (decades.length > 0) {
            yearHTML += '<optgroup label="Decades">';
            decades.forEach(d => { yearHTML += `<option value="${d}s">${d}s</option>`; });
            yearHTML += '</optgroup>';
        }

        if (uniqueYears.length > 0) {
            yearHTML += '<optgroup label="Specific Years">';
            uniqueYears.forEach(y => { yearHTML += `<option value="${y}">${y}</option>`; });
            yearHTML += '</optgroup>';
        }

        // Check for null, empty strings, or invalid years
        const hasUnknown = uniqueYearsRaw.some(y => !y || isNaN(y) || y.toString().trim() === '');
        if (hasUnknown) {
            yearHTML += '<optgroup label="Unknown"><option value="unknown">Unknown</option></optgroup>';
        }
        
        yearSelect.innerHTML = yearHTML;

        // Build Tag Filter
        const allTags = [...new Set(allLogs.flatMap(l => l.tags || []))].sort();
        const tagSelect = document.getElementById('tag-filter');
        tagSelect.innerHTML = '<option value="all">All Tags</option>'; // Reset first
        allTags.forEach(t => tagSelect.innerHTML += `<option value="${t}">${t}</option>`);
        
        applyFilters();
        setupLoadMore(config);
    } catch (err) {
        console.error("Diary init error:", err);
    }
}

// --- BIND TABLE SORTING EVENTS ---
// By assigning these directly in JS, we bypass browser policies blocking inline HTML onclicks.
const dateHeader = document.getElementById('th-sort-date');
if (dateHeader) dateHeader.addEventListener('click', () => toggleSort('date'));

const nameHeader = document.getElementById('th-sort-name');
if (nameHeader) nameHeader.addEventListener('click', () => toggleSort('name'));

const releasedHeader = document.getElementById('th-sort-released');
if (releasedHeader) releasedHeader.addEventListener('click', () => toggleSort('released'));

const ratingHeader = document.getElementById('th-sort-rating');
if (ratingHeader) ratingHeader.addEventListener('click', () => toggleSort('rating'));

// --- FOOLPROOF SORTING LISTENER (EVENT DELEGATION) ---
document.addEventListener('click', function(event) {
    // 1. Check if the click happened on (or inside) a sortable header
    const th = event.target.closest('th.sortable');
    if (!th) return; // Ignore clicks anywhere else on the page

    // 2. Identify which column was clicked using our data attribute
    const column = th.getAttribute('data-sort');
    if (!column) return;

    console.log(`[CLICK CAPTURED] Firing sort for: ${column}`);
    
    // 3. Clear all other icons
    ['date', 'name', 'released', 'rating'].forEach(col => {
        if (col !== column) {
            const icon = document.getElementById(`${col}-sort-icon`);
            if (icon) icon.textContent = '';
        }
    });

    // 4. Toggle the sort order
    if (currentSortColumn === column) {
        sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    } else {
        currentSortColumn = column;
        sortOrder = column === 'name' ? 'asc' : 'desc'; 
    }

    // 5. Update the correct icon
    const iconSpan = document.getElementById(`${column}-sort-icon`);
    if (iconSpan) iconSpan.textContent = sortOrder === 'desc' ? '↓' : '↑';
    
    // 6. Reset page to 1, sort the array, and redraw the table
    currentPage = 1; 
    
    if (typeof window.applyCurrentSort === 'function') {
        window.applyCurrentSort();
    }
    
    loadConfig()
        .then(c => renderDiary(c))
        .catch(err => console.error("Config fetch failed:", err));
});

// 1. Unified Filter Logic
window.applyFilters = async () => {
    const searchTerm = document.getElementById('diary-search').value.toLowerCase();
    const ratingLimit = document.getElementById('rating-filter').value;
    const yearLimit = document.getElementById('year-filter').value;
    const likedLimit = document.getElementById('liked-filter').value;
    const reviewLimit = document.getElementById('review-filter').value;
    const rewatchLimit = document.getElementById('rewatch-filter').value;
    const tagLimit = document.getElementById('tag-filter').value;
    
    const config = await loadConfig();

    filteredLogs = allLogs.filter(log => {
        const matchesType = currentType === 'all' || log.media_type === currentType;
        const matchesRating = ratingLimit === 'all' || Math.floor(log.rating) == parseInt(ratingLimit);
        
        const matchesLiked = likedLimit === 'all' || (likedLimit === 'liked' ? log.is_liked : !log.is_liked);
        const matchesReview = reviewLimit === 'all' || (reviewLimit === 'reviewed' ? (log.notes && log.notes.trim() !== '') : (!log.notes || log.notes.trim() === ''));
        const matchesRewatch = rewatchLimit === 'all' || (rewatchLimit === 'rewatch' ? log.is_rewatch : !log.is_rewatch);
        const matchesTag = tagLimit === 'all' || (log.tags && log.tags.includes(tagLimit));
        const matchesYear = yearLimit === 'all' || 
            (yearLimit === 'unknown' ? (!log.release_year || isNaN(log.release_year) || log.release_year.toString().trim() === '') :
            (yearLimit.endsWith('s') ? 
                (log.release_year && log.release_year.toString().startsWith(yearLimit.substring(0,3))) : 
                log.release_year == yearLimit));

        // Text Search
        const matchesSearch = searchTerm === '' || (log.media_title && log.media_title.toLowerCase().includes(searchTerm));

        return matchesType && matchesRating && matchesYear && matchesLiked && matchesReview && matchesRewatch && matchesTag && matchesSearch;
    });

    applyCurrentSort();

    currentPage = 1;
    await renderDiary(config); 
    updateStatsDisplay(config);
};

function applyCurrentSort() {
    console.log(`[APPLY SORT] Sorting ${filteredLogs.length} items by ${currentSortColumn} in ${sortOrder} order.`);
    
    filteredLogs.sort((a, b) => {
        let valA, valB;
        
        if (currentSortColumn === 'date') {
            valA = a.watched_on ? new Date(a.watched_on).getTime() : 0;
            valB = b.watched_on ? new Date(b.watched_on).getTime() : 0;
        } else if (currentSortColumn === 'name') {
            valA = (a.media_title || '').toString().toLowerCase();
            valB = (b.media_title || '').toString().toLowerCase();
        } else if (currentSortColumn === 'released') {
            valA = parseInt(a.release_year);
            valB = parseInt(b.release_year);
        } else if (currentSortColumn === 'rating') {
            valA = parseFloat(a.rating) || 0;
            valB = parseFloat(b.rating) || 0;
        }

        // Safety fallback: Treat NaN values as 0 so sort doesn't crash
        if (typeof valA === 'number' && isNaN(valA)) valA = 0;
        if (typeof valB === 'number' && isNaN(valB)) valB = 0;

        // Secondary fallback to Date
        if (valA === valB) {
            const tA = a.watched_on ? new Date(a.watched_on).getTime() : 0;
            const tB = b.watched_on ? new Date(b.watched_on).getTime() : 0;
            const safeTA = isNaN(tA) ? 0 : tA;
            const safeTB = isNaN(tB) ? 0 : tB;

            if (safeTA === safeTB) {
                const cA = new Date(a.created_at).getTime();
                const cB = new Date(b.created_at).getTime();
                const diff = (isNaN(cB) ? 0 : cB) - (isNaN(cA) ? 0 : cA);
                // Respect the asc/desc toggle even on the tie-breaker
                return sortOrder === 'desc' ? diff : -diff; 
            }
            
            const diff2 = safeTB - safeTA;
            // Respect the asc/desc toggle even on the tie-breaker
            return sortOrder === 'desc' ? diff2 : -diff2; 
        }

        if (valA < valB) return sortOrder === 'desc' ? 1 : -1;
        if (valA > valB) return sortOrder === 'desc' ? -1 : 1;
        return 0;
    });
}

const albumTrackCache = {};

async function updateStatsDisplay(config) {
    const totalLogs = filteredLogs.length;
    const totalRatingSum = filteredLogs.reduce((acc, log) => acc + (log.rating || 0), 0);
    const avgRating = totalLogs > 0 ? (totalRatingSum / totalLogs).toFixed(1) : "0.0";
    const totalMovies = filteredLogs.filter(l => l.media_type === 'movie').length;
    const totalBooks = filteredLogs.filter(l => l.media_type === 'book' && l.is_finished === true).length;
    
    // Split Albums and Songs
    const albumLogs = filteredLogs.filter(l => l.media_type === 'album' && !l.episode_number);
    const songLogs = filteredLogs.filter(l => l.media_type === 'album' && l.episode_number);
    const totalAlbums = albumLogs.length; 

    const totalYoutube = filteredLogs.filter(l => l.media_type === 'youtube').length;
    const uniqueSeries = filteredLogs.filter(l => l.media_type === 'tv' && (l.log_level === 'entire' || (!l.season_number && !l.episode_number))).length;
    const totalSeasons = filteredLogs.filter(l => l.media_type === 'tv' && l.season_number && !l.episode_number).length;
    const directEpisodes = filteredLogs.filter(l => l.episode_number && l.media_type === 'tv').length;
    const episodesInSeasons = filteredLogs.reduce((acc, l) => acc + (l.ep_count_in_season || 0), 0);
    const totalEpisodes = directEpisodes + episodesInSeasons;
    const totalMinutes = filteredLogs.reduce((acc, log) => acc + (log.runtime || 0), 0);

    const d = Math.floor(totalMinutes / 1440);
    const h = Math.floor((totalMinutes % 1440) / 60);
    const m = totalMinutes % 60;

    document.getElementById('total-logs').textContent = totalLogs;
    document.getElementById('avg-rating').textContent = avgRating;
    document.getElementById('total-movies').textContent = totalMovies;
    document.getElementById('total-series').textContent = uniqueSeries;
    document.getElementById('total-books').textContent = totalBooks;
    
    const albumStat = document.getElementById('total-albums');
    if (albumStat) albumStat.textContent = totalAlbums; 
    
    const ytStat = document.getElementById('total-youtube');
    if (ytStat) ytStat.textContent = totalYoutube;
    
    const timeElement = document.getElementById('total-time');
    if (timeElement) timeElement.textContent = `${d}d ${h}h ${m}m`;

    // --- NEW: ASYNC SONG CALCULATION ---
    const songStat = document.getElementById('total-songs');
    if (songStat) {
        songStat.textContent = "..."; // Show a loading state briefly
        
        let totalSongs = songLogs.length; // Start with individually logged tracks
        
        // Asynchronously fetch the track counts for full albums
        for (const log of albumLogs) {
            if (albumTrackCache[log.media_id]) {
                totalSongs += albumTrackCache[log.media_id];
            } else {
                try {
                    const decodedId = decodeURIComponent(log.media_id);
                    const [artistName, albumName] = decodedId.split('|||');
                    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
                    const trackCount = res.album?.tracks?.track?.length || 0;
                    albumTrackCache[log.media_id] = trackCount;
                    totalSongs += trackCount;
                } catch (e) {
                    console.error("Failed to fetch track count for", log.media_id);
                }
            }
        }
        songStat.textContent = totalSongs;
    }
}

// 2. Type Switcher (All/Movie/TV/Book)
window.filterType = (type) => {
    currentType = type;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.id === `btn-${type}`) btn.classList.add('active');
    });
    applyFilters();
};

// 3. Date Sorting Logic
window.toggleSort = (column) => {
    if (column === 'date') {
        sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
        document.getElementById('date-sort-icon').textContent = sortOrder === 'desc' ? '↓' : '↑';
        
        filteredLogs.sort((a, b) => {
            const dateA = new Date(a.watched_on || 0);
            const dateB = new Date(b.watched_on || 0);
            if (dateA.getTime() === dateB.getTime()) {
                const createA = new Date(a.created_at);
                const createB = new Date(b.created_at);
                return sortOrder === 'desc' ? createB - createA : createA - createB;
            }
            return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        });

        loadConfig().then(c => renderDiary(c));
    }
};

async function renderDiary(config, append = false) {
    const tbody = document.getElementById('diary-body');
    const loadMoreContainer = document.getElementById('load-more-container');
    const searchTerm = document.getElementById('diary-search').value.toLowerCase();
    
    if (!append) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Loading...</td></tr>';
        currentPage = 1;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    let pageItems = filteredLogs.slice(start, end);

    try {
        const rowPromises = pageItems.map(log => fetchAndFormatRow(log, config));
        const rows = await Promise.all(rowPromises);

        let html = '';
        for (const rowHtml of rows) {
            if (!rowHtml) continue;
            if (searchTerm.trim() !== "") {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = rowHtml;
                if (!tempDiv.textContent.toLowerCase().includes(searchTerm)) continue;
            }
            html += rowHtml;
        }

        if (!append) {
            tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center">No matches found.</td></tr>';
        } else {
            tbody.innerHTML += html;
        }

        loadMoreContainer.style.display = end < filteredLogs.length ? 'block' : 'none';
    } catch (err) {
        console.error("Render error:", err);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: red;">Error loading data.</td></tr>';
    }
}

async function fetchAndFormatRow(log, config) { 
    try {
        let title, year, image, displayTitle;
        let tracks = [];
        
        // 1. Fetch Basic Media Info
        if (log.media_type === 'youtube') {
            const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${log.media_id}`).then(r => r.json());
            title = res.title || 'Unknown Video';
            year = 'YouTube'; 
            image = res.thumbnail_url || 'https://via.placeholder.com/92x138?text=No+Thumb';
        } else if (log.media_type === 'album') {
            const decodedId = decodeURIComponent(log.media_id);
            const [artistName, albumName] = decodedId.split('|||');
            
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}&api_key=${config.lastfm_key}&format=json`).then(r => r.json());
            
            title = res.album?.name || 'Unknown Album';
            
            year = 'Album'; // Fallback just in case
            if (res.album?.wiki?.published) {
                // Scans the published string (e.g. "06 Apr 1999, 00:00") for a 4-digit year
                const yearMatch = res.album.wiki.published.match(/\d{4}/);
                if (yearMatch) year = yearMatch[0];
            }

            image = 'https://via.placeholder.com/92x138?text=No+Cover';
            if (res.album?.image && res.album.image.length > 2 && res.album.image[2]['#text']) {
                image = res.album.image[2]['#text'];
            }
            tracks = res.album?.tracks?.track || [];
        } else if (log.media_type === 'book') {
            const res = await fetch(`https://openlibrary.org${log.media_id}.json`).then(r => r.json()).catch(() => ({}));
            title = res.title || 'Unknown Book';
            year = res.first_publish_date || 'N/A';
            image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-S.jpg` : 'https://placehold.co/92x138/1b2228/9ab?text=No+Cover';
        } else {
            const res = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}?language=en-US`, {
                headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } 
            }).then(r => r.json());
            
            if (res.success === false) throw new Error("TMDB returned an error JSON");
            
            title = res.title || res.name || 'Unknown Title'; // Fallback prevents "undefined"
            year = (res.release_date || res.first_air_date || '').split('-')[0];
            image = res.poster_path ? `https://image.tmdb.org/t/p/w92${res.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Poster';
        }

        // --- NEW: OVERRIDE WITH CUSTOM POSTER ---
        const customArt = customImgsMap.get(`${log.media_type}_${String(log.media_id)}`);
        if (customArt && customArt.custom_poster) {
            image = customArt.custom_poster;
        }

        // 2. Logic to build the "Display Title" based on log depth
        if (log.media_type === 'tv') {
            if (log.episode_number) {
                displayTitle = `${title} <span class="diary-meta">S${log.season_number} E${log.episode_number}</span>`;
            } else if (log.season_number) {
                displayTitle = `${title} <span class="diary-meta">Season ${log.season_number}</span>`;
            } else {
                displayTitle = title;
            }
        } else if (log.media_type === 'album') {
            if (log.episode_number && tracks[log.episode_number - 1]) {
                displayTitle = `${tracks[log.episode_number - 1].name} <span class="diary-meta">${title}</span>`;
            } else {
                displayTitle = title;
            }
        } else {
            displayTitle = title;
        }

        let rewatchText = 'Rewatch';
        if (log.media_type === 'book') rewatchText = 'Reread';
        else if (log.media_type === 'album') rewatchText = 'Relisten';
        
        const heartBadge = log.is_liked ? `<span title="Liked" style="display: inline-flex; align-items: center; font-size: 0.9rem;">❤️</span>` : '';
        const rewatchBadge = log.is_rewatch ? 
            `<span title="${rewatchText}" style="font-size: 0.75rem; color: #9ab; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 4px;">🔁</span>` 
            : '';
            
        const badgeRow = (log.is_liked || log.is_rewatch) ? 
            `<div style="display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; vertical-align: middle;">
                ${heartBadge}
                ${rewatchBadge}
            </div>` : '';

        // 3. Review Indicator
        let reviewHtml = '<td></td>';
        if (log.notes) {
            reviewHtml = `<td class="review-indicator" data-review-title="${encodeURIComponent(title)}" data-review-notes="${encodeURIComponent(log.notes)}">📝</td>`;
        }

        // 4. Tags Setup
        const tagsHtml = (log.tags && log.tags.length > 0) ? 
            `<div class="diary-tags-container">
                ${log.tags.map(tag => `<span class="diary-tag">${tag}</span>`).join('')}
            </div>` : '';

        return `
            <tr id="row-${log.id}">
                <td class="diary-year">${log.watched_on || 'Unknown'}</td>
                <td><img src="${image}" class="diary-poster" data-type="${log.media_type}" alt="poster" data-fallback="https://via.placeholder.com/92x138?text=No+Image"></td>
                <td class="diary-name" data-diary-route="details.html?id=${encodeURIComponent(log.media_id)}&type=${encodeURIComponent(log.media_type)}">
                    <div style="display: flex; align-items: center; flex-wrap: wrap;">
                        ${displayTitle}
                        ${badgeRow}
                    </div>
                </td>
                <td class="diary-year">${year}</td>
                <td class="star-rating">${'★'.repeat(Math.floor(log.rating)) + (log.rating % 1 !== 0 ? '½' : '')}</td>
                ${reviewHtml}
                <td>${tagsHtml}</td> <!-- New Tags Column -->
                <td style="text-align:center;">
                    <div style="display: flex; gap: 15px; justify-content: center; align-items: center;">
                        <span data-diary-route="log.html?id=${encodeURIComponent(log.media_id)}&type=${encodeURIComponent(log.media_type)}&logId=${encodeURIComponent(log.id)}"
                            style="cursor:pointer; color:var(--accent); font-size: 1.1rem;" title="Edit Log">✏️</span>
                        <span data-delete-diary="${encodeURIComponent(log.id)}"
                            style="cursor:pointer; color:#ff4d4d; font-size: 1.1rem;" title="Delete Log">🗑️</span>
                    </div>
                </td>
            </tr>`;
    } catch (e) { 
        return ''; 
    }
}

function setupLoadMore(config) {
    const btn = document.getElementById('load-more-btn');
    if (btn) {
        btn.onclick = () => {
            currentPage++;
            renderDiary(config, true);
        };
    }
}

window.showReviewModal = (title, notes) => {
    const modal = document.getElementById('review-modal');
    document.getElementById('modal-title').textContent = `Review: ${title}`;
    document.getElementById('modal-body').textContent = notes;
    modal.style.display = 'block';
};

// Close modal logic
document.querySelector('.close-modal').onclick = () => {
    document.getElementById('review-modal').style.display = 'none';
};

document.addEventListener('click', (event) => {
    const routeTarget = event.target.closest('[data-diary-route]');
    if (routeTarget) {
        window.location.href = routeTarget.dataset.diaryRoute;
        return;
    }
    const reviewTarget = event.target.closest('[data-review-title]');
    if (reviewTarget) {
        window.showReviewModal(decodeURIComponent(reviewTarget.dataset.reviewTitle), decodeURIComponent(reviewTarget.dataset.reviewNotes));
        return;
    }
    const deleteTarget = event.target.closest('[data-delete-diary]');
    if (deleteTarget) window.deleteDiaryEntry(decodeURIComponent(deleteTarget.dataset.deleteDiary));
});
document.addEventListener('error', (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.dataset.fallback) {
        image.src = image.dataset.fallback;
        delete image.dataset.fallback;
    }
}, true);

window.onclick = (event) => {
    // 1. Review Modal Logic
    const modal = document.getElementById('review-modal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }

    // 2. Profile Dropdown Logic
    const dropdown = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
};

document.getElementById('diary-search')?.addEventListener('input', () => applyFilters());
document.querySelectorAll('#advanced-filters select').forEach((select) => {
    select.addEventListener('change', () => applyFilters());
});
document.getElementById('toggle-filters-btn')?.addEventListener('click', () => {
    document.getElementById('advanced-filters')?.classList.toggle('show');
});
document.querySelectorAll('[data-diary-type]').forEach((button) => {
    button.addEventListener('click', () => window.filterType(button.dataset.diaryType));
});

window.deleteDiaryEntry = async (logId) => {
    if (!confirm("Are you sure you want to delete this entry from your diary?")) return;

    try {
        // 1. Delete from Supabase
        const { error } = await supabaseClient
            .from('media_logs')
            .delete()
            .eq('id', logId);

        if (error) {
            alert("Error: " + error.message);
            return;
        }

        // 2. Show the success alert
        alert("Entry deleted successfully.");

        // 3. Force a full page reload
        // This ensures all global arrays and the table are rebuilt from scratch
        setTimeout(() => {
            location.reload();
                         });

    } catch (err) {
        console.error("Delete failed:", err);
        alert("An unexpected error occurred.");
    }
};

initDiary();