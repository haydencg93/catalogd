let supabaseClient = null;
let allLogs = [];
let filteredLogs = [];
let currentPage = 1;
const PAGE_SIZE = 10;
let sortOrder = 'desc'; // Default newest to oldest
let currentType = 'all';

async function initDiary() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) { window.location.href = 'index.html'; return; }

        // Fetch logs sorted by date descending by default
        const { data: logs } = await supabaseClient
            .from('media_logs')
            .select('*')
            .order('watched_on', { ascending: false }) // Primary Sort: The date inputted
            .order('created_at', { ascending: false }); // Secondary Sort: The actual time of the log

        allLogs = logs || [];
        
        // Initial filter application
        applyFilters();
        
        setupLoadMore(config.tmdb_token);
    } catch (err) {
        console.error("Diary init error:", err);
    }
}

// 1. Unified Filter Logic
window.applyFilters = async () => {
    const searchTerm = document.getElementById('diary-search').value.toLowerCase();
    const ratingLimit = document.getElementById('rating-filter').value;
    const configRes = await fetch('config.json');
    const config = await configRes.json();

    // Filter by Type (All, Movie, TV, Book)
    filteredLogs = allLogs.filter(log => {
        const matchesType = currentType === 'all' || log.media_type === currentType;
        const matchesRating = ratingLimit === 'all' || log.rating == parseInt(ratingLimit);
        return matchesType && matchesRating;
    });

    // Reset pagination and render
    currentPage = 1;
    renderDiary(config.tmdb_token);

    // --- Dynamic Stats Calculation ---
    const totalLogs = filteredLogs.length;

    const totalRatingSum = filteredLogs.reduce((acc, log) => acc + (log.rating || 0), 0);
    const avgRating = totalLogs > 0 ? (totalRatingSum / totalLogs).toFixed(1) : "0.0";

    const totalMovies = filteredLogs.filter(l => l.media_type === 'movie').length;
    const totalBooks = filteredLogs.filter(l => l.media_type === 'book').length;

    // Series: Count unique TMDB IDs where type is TV
    const uniqueSeries = new Set(
        filteredLogs.filter(l => l.media_type === 'tv').map(l => l.media_id)
    ).size;

    // Seasons: Count logs where a season_number exists but episode_number is null
    const totalSeasons = filteredLogs.filter(l => 
        l.media_type === 'tv' && l.season_number && !l.episode_number
    ).length;

    // Episodes: Direct Episode Logs + Sum of Episodes within Season Logs
    const directEpisodes = filteredLogs.filter(l => l.episode_number).length;
    const episodesInSeasons = filteredLogs.reduce((acc, l) => acc + (l.ep_count_in_season || 0), 0);
    const totalEpisodes = directEpisodes + episodesInSeasons;

    // Time: sum of the runtime column
    const totalMinutes = filteredLogs.reduce((acc, log) => acc + (log.runtime || 0), 0);
    const d = Math.floor(totalMinutes / 1440);
    const h = Math.floor((totalMinutes % 1440) / 60);
    const m = totalMinutes % 60;

    // Update UI
    document.getElementById('total-logs').textContent = totalLogs;
    document.getElementById('avg-rating').textContent = avgRating;
    document.getElementById('total-movies').textContent = totalMovies;
    document.getElementById('total-books').textContent = totalBooks;
    document.getElementById('total-series').textContent = uniqueSeries;
    document.getElementById('total-seasons').textContent = totalSeasons;
    document.getElementById('total-episodes').textContent = totalEpisodes;

    const timeElement = document.getElementById('total-time');
    if (timeElement) {
        timeElement.textContent = `${d}d ${h}h ${m}m`;
    }
};

// 2. Type Switcher (All/Movie/TV/Book)
window.filterType = (type) => {
    currentType = type;
    
    // Update active UI button
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

            // If the watched_on dates are exactly the same...
            if (dateA.getTime() === dateB.getTime()) {
                // ...sort by the creation timestamp instead
                const createA = new Date(a.created_at);
                const createB = new Date(b.created_at);
                return sortOrder === 'desc' ? createB - createA : createA - createB;
            }

            return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        });

        fetch('config.json').then(r => r.json()).then(c => renderDiary(c.tmdb_token));
    }
};

async function renderDiary(token, append = false) {
    const tbody = document.getElementById('diary-body');
    const loadMoreContainer = document.getElementById('load-more-container');
    const searchTerm = document.getElementById('diary-search').value.toLowerCase();
    
    if (!append) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Loading...</td></tr>';
        currentPage = 1;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    
    // Get the current slice
    let pageItems = filteredLogs.slice(start, end);

    let html = '';
    for (const log of pageItems) {
        const rowHtml = await fetchAndFormatRow(log, token);
        
        // Final Title Search Filter (since titles aren't in the DB, we filter during render)
        if (searchTerm) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = rowHtml;
            const titleText = tempDiv.querySelector('.diary-name').textContent.toLowerCase();
            if (!titleText.includes(searchTerm)) continue;
        }
        
        html += rowHtml;
    }

    if (!append) {
        tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center">No matches found.</td></tr>';
    } else {
        tbody.innerHTML += html;
    }

    loadMoreContainer.style.display = end < filteredLogs.length ? 'block' : 'none';
}

async function fetchAndFormatRow(log, token) {
    try {
        let title, year, image, displayTitle;
        
        // 1. Fetch Basic Media Info
        if (log.media_type === 'book') {
            const res = await fetch(`https://openlibrary.org${log.media_id}.json`).then(r => r.json());
            title = res.title;
            year = res.first_publish_date || 'N/A';
            image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-S.jpg` : '';
        } else {
            const res = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}`, {
                headers: { Authorization: `Bearer ${token}` }
            }).then(r => r.json());
            title = res.title || res.name;
            year = (res.release_date || res.first_air_date || '').split('-')[0];
            image = `https://image.tmdb.org/t/p/w92${res.poster_path}`;
        }

        // 2. Logic to build the "Display Title" based on log depth
        if (log.media_type === 'tv') {
            if (log.episode_number) {
                // It's an episode log
                displayTitle = `${title} <span class="diary-meta">S${log.season_number} E${log.episode_number}</span>`;
            } else if (log.season_number) {
                // It's a full season log
                displayTitle = `${title} <span class="diary-meta">Season ${log.season_number}</span>`;
            } else {
                // It's a general series log
                displayTitle = title;
            }
        } else {
            displayTitle = title;
        }

        let reviewHtml = '<td></td>';
        if (log.notes) {
            // Escape single quotes and newlines so they don't break the onclick string
            const safeTitle = title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const safeNotes = log.notes
                .replace(/'/g, "\\'")
                .replace(/"/g, "&quot;")
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r");

            reviewHtml = `<td class="review-indicator" onclick="showReviewModal('${safeTitle}', '${safeNotes}')">📝</td>`;
        }
        return `
            <tr>
                <td class="diary-year">${log.watched_on || 'Unknown'}</td>
                <td><img src="${image}" class="diary-poster" alt="poster"></td>
                <td class="diary-name" onclick="window.location.href='details.html?id=${log.media_id}&type=${log.media_type}'">
                    ${displayTitle}
                </td>
                <td class="diary-year">${year}</td>
                <td class="star-rating">${'★'.repeat(log.rating)}</td>
                ${reviewHtml}
            </tr>`;
    } catch (e) { 
        return ''; 
    }
}

function setupLoadMore(token) {
    const btn = document.getElementById('load-more-btn');
    if (btn) {
        btn.onclick = () => {
            currentPage++;
            renderDiary(token, true);
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

initDiary();