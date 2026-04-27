let supabaseClient = null;
let allLogs = [];
let filteredLogs = [];
let currentPage = 1;
const PAGE_SIZE = 10;
let sortOrder = 'desc';
let currentType = 'all';
let diaryOwnerId = null;
let isViewerOwner = false;

async function initDiary() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

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
                #diary-table th:nth-child(7), 
                #diary-table td:nth-child(7) { display: none !important; }
            `;
            document.head.appendChild(style);
        }

        // 3. Fetch logs for the SPECIFIC user
        const { data: logs } = await supabaseClient
            .from('media_logs')
            .select('*')
            .eq('user_id', diaryOwnerId) // Filter by the target user ID
            .order('watched_on', { ascending: false })
            .order('created_at', { ascending: false });

        allLogs = logs || [];
        
        applyFilters();
        setupLoadMore(config);

        // 4. Update the "Profile" back button to stay in context
        const backToProfileBtn = document.querySelector('button[onclick*="profile.html"]');
        if (backToProfileBtn) {
            backToProfileBtn.removeAttribute('onclick'); // Removes the hardcoded HTML link
            backToProfileBtn.onclick = () => {
                window.location.href = `profile.html?id=${diaryOwnerId}`;
            };
        }

    } catch (err) {
        console.error("Diary init error:", err);
    }
}

// 1. Unified Filter Logic
// 1. Unified Filter Logic
window.applyFilters = async () => {
    const searchTerm = document.getElementById('diary-search').value.toLowerCase();
    const ratingLimit = document.getElementById('rating-filter').value;
    
    const configRes = await fetch('config.json');
    const config = await configRes.json();

    filteredLogs = allLogs.filter(log => {
        const matchesType = currentType === 'all' || log.media_type === currentType;
        const matchesRating = ratingLimit === 'all' || Math.floor(log.rating) == parseInt(ratingLimit);
        return matchesType && matchesRating;
    });

    currentPage = 1;
    await renderDiary(config); 
    updateStatsDisplay(config); // NEW: We now pass the config to the stats display
};

const albumTrackCache = {}; // NEW: Caches track counts so your diary stays lightning fast

async function updateStatsDisplay(config) {
    const totalLogs = filteredLogs.length;
    const totalRatingSum = filteredLogs.reduce((acc, log) => acc + (log.rating || 0), 0);
    const avgRating = totalLogs > 0 ? (totalRatingSum / totalLogs).toFixed(1) : "0.0";
    const totalMovies = filteredLogs.filter(l => l.media_type === 'movie').length;
    const totalBooks = filteredLogs.filter(l => l.media_type === 'book').length;
    
    // Split Albums and Songs
    const albumLogs = filteredLogs.filter(l => l.media_type === 'album' && !l.episode_number);
    const songLogs = filteredLogs.filter(l => l.media_type === 'album' && l.episode_number);
    const totalAlbums = albumLogs.length; 

    const totalYoutube = filteredLogs.filter(l => l.media_type === 'youtube').length;
    const uniqueSeries = new Set(filteredLogs.filter(l => l.media_type === 'tv').map(l => l.media_id)).size;
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
    
    document.getElementById('total-seasons').textContent = totalSeasons;
    document.getElementById('total-episodes').textContent = totalEpisodes;
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

        fetch('config.json').then(r => r.json()).then(c => renderDiary(c));
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

// FIXED: Parameter changed from 'token' to 'config'
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
            const res = await fetch(`https://openlibrary.org${log.media_id}.json`).then(r => r.json());
            title = res.title;
            year = res.first_publish_date || 'N/A';
            image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-S.jpg` : 'https://via.placeholder.com/92x138?text=No+Cover';
        } else {
            // FIXED: Now uses config.tmdb_token
            const res = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}`, {
                headers: { Authorization: `Bearer ${config.tmdb_token}` } 
            }).then(r => r.json());
            title = res.title || res.name;
            year = (res.release_date || res.first_air_date || '').split('-')[0];
            image = res.poster_path ? `https://image.tmdb.org/t/p/w92${res.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Poster';
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
            const safeTitle = title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const safeNotes = log.notes.replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
            reviewHtml = `<td class="review-indicator" onclick="showReviewModal('${safeTitle}', '${safeNotes}')">📝</td>`;
        }

        return `
            <tr id="row-${log.id}">
                <td class="diary-year">${log.watched_on || 'Unknown'}</td>
                <td><img src="${image}" class="diary-poster" alt="poster" onerror="this.src='https://via.placeholder.com/92x138?text=No+Image';"></td>
                <td class="diary-name" onclick="window.location.href='details.html?id=${log.media_id}&type=${log.media_type}'">
                    <div style="display: flex; align-items: center; flex-wrap: wrap;">
                        ${displayTitle}
                        ${badgeRow}
                    </div>
                </td>
                <td class="diary-year">${year}</td>
                <td class="star-rating">${'★'.repeat(Math.floor(log.rating)) + (log.rating % 1 !== 0 ? '½' : '')}</td>
                ${reviewHtml}
                <td style="text-align:center;">
                    <div style="display: flex; gap: 15px; justify-content: center; align-items: center;">
                        <span onclick="window.location.href='log.html?id=${log.media_id}&type=${log.media_type}&logId=${log.id}'" 
                            style="cursor:pointer; color:var(--accent); font-size: 1.1rem;" title="Edit Log">✏️</span>
                        <span onclick="deleteDiaryEntry('${log.id}')" 
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

window.onclick = (event) => {
    const modal = document.getElementById('review-modal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
};

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