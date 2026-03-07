const params = new URLSearchParams(window.location.search);
const id = params.get('id');
const type = params.get('type');

async function initDetails() {
    const config = await fetch('config.json').then(r => r.json());
    const options = { method: 'GET', headers: { accept: 'application/json', Authorization: `Bearer ${config.tmdb_token}` } };

    try {
        const data = await fetch(`https://api.themoviedb.org/3/${type}/${id}`, options).then(r => r.json());
        document.getElementById('media-title').textContent = data.title || data.name;
        document.getElementById('media-overview').textContent = data.overview;
        document.getElementById('poster-area').innerHTML = `<img src="https://image.tmdb.org/t/p/w500${data.poster_path}">`;
        if (data.backdrop_path) document.getElementById('backdrop-overlay').style.backgroundImage = `url(https://image.tmdb.org/t/p/original${data.backdrop_path})`;
        
        const year = (data.release_date || data.first_air_date || '').split('-')[0];
        document.getElementById('media-meta').textContent = `${year} • ${data.genres.map(g => g.name).join(', ')}`;
        setupRater();
    } catch (err) { console.error(err); }
}

function setupRater() {
    const stars = document.querySelectorAll('.star');
    const storageKey = `rating-${type}-${id}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) updateStars(saved);

    stars.forEach(star => {
        star.onclick = () => {
            const val = star.getAttribute('data-value');
            localStorage.setItem(storageKey, val);
            updateStars(val);
        };
    });
}

function updateStars(rating) {
    document.querySelectorAll('.star').forEach(s => s.classList.toggle('active', s.getAttribute('data-value') <= rating));
}

initDetails();