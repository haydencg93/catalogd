const params = new URLSearchParams(window.location.search);
const personId = params.get('personId');
let supabaseClient = null;

async function initCastPage() {
    try {
        const configResponse = await fetch('config.json');
        const config = await configResponse.json();
        
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);
        setupHeader();

        const headers = { Authorization: `Bearer ${config.tmdb_token}` };

        // 1. Fetch Person Bio
        const person = await fetch(`https://api.themoviedb.org/3/person/${personId}`, { headers }).then(r => r.json());
        document.getElementById('person-name').textContent = person.name;
        document.getElementById('person-biography').textContent = person.biography || "No biography available.";
        
        if (person.profile_path) {
            document.getElementById('person-image-container').innerHTML = `
                <img src="https://image.tmdb.org/t/p/w300${person.profile_path}" alt="${person.name}" class="person-img">
            `;
        }

        // 2. Fetch Credits
        const credits = await fetch(`https://api.themoviedb.org/3/person/${personId}/combined_credits`, { headers }).then(r => r.json());

        // 3. Known For Section (Top 4 by popularity)
        const knownFor = [...credits.cast]
            .sort((a, b) => b.popularity - a.popularity)
            .slice(0, 4);

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
                                    ${(item.release_date || item.first_air_date || '').split('-')[0]}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.getElementById('person-bio-area').insertAdjacentHTML('beforeend', knownForHtml);

        // 4. Sort Full Filmography by Year
        const sorted = credits.cast.sort((a, b) => {
            const dateA = a.release_date || a.first_air_date || '0000';
            const dateB = b.release_date || b.first_air_date || '0000';
            return dateB.localeCompare(dateA);
        });

        // 5. Render Filmography with Mini Posters
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

    } catch (err) {
        console.error("Error:", err);
    }
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