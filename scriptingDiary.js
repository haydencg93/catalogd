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
            .order('watched_on', { ascending: false });

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
        let title, year, image;
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

        return `
            <tr>
                <td class="diary-year">${log.watched_on || 'Unknown'}</td>
                <td><img src="${image}" class="diary-poster" alt="poster"></td>
                <td class="diary-name" onclick="window.location.href='details.html?id=${log.media_id}&type=${log.media_type}'">${title}</td>
                <td class="diary-year">${year}</td>
                <td class="star-rating">${'★'.repeat(log.rating)}</td>
                <td class="review-indicator">${log.notes ? '📝' : ''}</td>
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

initDiary();