const params = new URLSearchParams(window.location.search);
const listId = params.get('id');
let supabaseClient = null;
let tmdbToken = "";

async function initListDetails() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
    tmdbToken = config.tmdb_token;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return window.location.href = 'index.html';

    fetchListInfo();
    fetchListItems();
    setupSearch();
}

async function fetchListInfo() {
    const { data: list } = await supabaseClient
        .from('media_lists')
        .select('*')
        .eq('id', listId)
        .single();

    if (list) {
        document.getElementById('list-name').textContent = list.name;
    }
}

function setupSearch() {
    const input = document.getElementById('list-search-input');
    const resultsDiv = document.getElementById('search-results');

    input.addEventListener('input', async () => {
        const query = input.value.trim();
        if (query.length < 3) {
            resultsDiv.style.display = 'none';
            return;
        }

        // Search Movies/TV via TMDB
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${tmdbToken}` }
        }).then(r => r.json());

        // Search Books via OpenLibrary
        const bookRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3`).then(r => r.json());

        renderSearchResults(tmdbRes.results, bookRes.docs);
    });
}

function renderSearchResults(tmdb, books) {
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'block';

    // Process TMDB
    tmdb.filter(item => item.media_type !== 'person').slice(0, 5).forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
            <img src="https://image.tmdb.org/t/p/w92${item.poster_path}" onerror="this.src='placeholder.png'">
            <div>
                <strong>${item.title || item.name}</strong>
                <div class="meta">${item.media_type.toUpperCase()}</div>
            </div>
        `;
        div.onclick = () => addItem(item.id, item.media_type);
        resultsDiv.appendChild(div);
    });

    // Process Books
    books.forEach(book => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
            <img src="https://covers.openlibrary.org/b/id/${book.cover_i}-S.jpg" onerror="this.src='placeholder.png'">
            <div>
                <strong>${book.title}</strong>
                <div class="meta">BOOK</div>
            </div>
        `;
        div.onclick = () => addItem(book.key, 'book');
        resultsDiv.appendChild(div);
    });
}

async function addItem(mediaId, mediaType) {
    const { error } = await supabaseClient
        .from('list_items')
        .insert({ list_id: listId, media_id: String(mediaId), media_type: mediaType });

    if (error) {
        if (error.code === '23505') alert("Item already in list!");
        else alert("Error adding item.");
    } else {
        document.getElementById('search-results').style.display = 'none';
        document.getElementById('list-search-input').value = '';
        fetchListItems();
    }
}

async function fetchListItems() {
    const container = document.getElementById('list-content');
    const { data: items } = await supabaseClient
        .from('list_items')
        .select('*')
        .eq('list_id', listId);

    if (!items || items.length === 0) {
        container.innerHTML = "<p class='meta'>No items in this list yet.</p>";
        return;
    }

    container.innerHTML = '';
    
    // We need to fetch details for each item to show posters/titles
    for (const item of items) {
        let title, poster;
        if (item.media_type === 'book') {
            const res = await fetch(`https://openlibrary.org${item.media_id}.json`).then(r => r.json());
            title = res.title;
            poster = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : 'placeholder.png';
        } else {
            const res = await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.media_id}`, {
                headers: { Authorization: `Bearer ${tmdbToken}` }
            }).then(r => r.json());
            title = res.title || res.name;
            poster = `https://image.tmdb.org/t/p/w500${res.poster_path}`;
        }

        const card = document.createElement('div');
        card.className = 'media-card';
        card.style.position = 'relative';
        card.innerHTML = `
            <button class="remove-btn" onclick="removeItem('${item.id}')">✕</button>
            <img src="${poster}" alt="${title}" onclick="window.location.href='details.html?id=${item.media_id}&type=${item.media_type}'">
            <div class="media-info">
                <div class="title" style="font-size:0.8rem; font-weight:bold;">${title}</div>
            </div>
        `;
        container.appendChild(card);
    }
}

window.removeItem = async (itemId) => {
    if (!confirm("Remove this item?")) return;
    await supabaseClient.from('list_items').delete().eq('id', itemId);
    fetchListItems();
};

initListDetails();