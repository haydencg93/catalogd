let supabaseClient = null;

async function initProfile() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    // Set basic info
    document.getElementById('user-email').textContent = user.email.split('@')[0];
    document.getElementById('user-avatar').textContent = user.email[0].toUpperCase();
    document.getElementById('member-since').textContent = new Date(user.created_at).toLocaleDateString();

    // Fetch User Stats from media_logs
    const { data: logs, error } = await supabaseClient
        .from('media_logs')
        .select('*')
        .eq('user_id', user.id);

    if (logs) {
        calculateStats(logs);
        renderRecent(logs, config.tmdb_token);
    }

    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const closeSettings = document.getElementById('close-settings');
    const finalDeleteBtn = document.getElementById('final-delete-btn');
    const deletePasswordInput = document.getElementById('delete-confirm-password');

    // This function handles the button clicks
    function setupSettingsUI() {
        if (!openSettingsBtn) return; // Safety check

        openSettingsBtn.onclick = () => {
            settingsModal.style.display = 'flex';
        };

        closeSettings.onclick = () => {
            settingsModal.style.display = 'none';
            deletePasswordInput.value = ''; // Clear password on close
        };

        // Close modal if clicking outside the card
        window.onclick = (event) => {
            if (event.target == settingsModal) {
                settingsModal.style.display = 'none';
            }
        };
    }

    // Make sure to call this inside your initProfile() after the user is verified
    setupSettingsUI();
}

function calculateStats(logs) {
    const total = logs.length;
    const avg = total > 0 ? (logs.reduce((acc, curr) => acc + curr.rating, 0) / total).toFixed(1) : 0;
    const books = logs.filter(l => l.media_type === 'book').length;

    document.getElementById('stat-count').textContent = total;
    document.getElementById('stat-avg').textContent = avg;
    document.getElementById('stat-books').textContent = books;
}

// Just a simple list for now, you could fetch posters from TMDB later if you want it fancy
async function renderRecent(logs, token) {
    const grid = document.getElementById('recent-grid');
    grid.innerHTML = ''; // Clear loader

    if (logs.length === 0) {
        grid.innerHTML = "<p class='meta'>No activity yet.</p>";
        return;
    }

    // Sort logs by date
    const sortedLogs = logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);

    // Fetch details for each log from TMDB or OpenLibrary
    for (const log of sortedLogs) {
        let title, image;

        try {
            if (log.media_type === 'book') {
                const res = await fetch(`https://openlibrary.org${log.media_id}.json`).then(r => r.json());
                title = res.title;
                image = res.covers ? `https://covers.openlibrary.org/b/id/${res.covers[0]}-M.jpg` : '';
            } else {
                const res = await fetch(`https://api.themoviedb.org/3/${log.media_type}/${log.media_id}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }).then(r => r.json());
                title = res.title || res.name;
                image = `https://image.tmdb.org/t/p/w500${res.poster_path}`;
            }

            const card = document.createElement('div');
            card.className = 'media-card';
            card.onclick = () => window.location.href = `details.html?id=${log.media_id}&type=${log.media_type}`;
            card.innerHTML = `
                <img src="${image}" alt="${title}">
                <div class="media-info">
                    <div class="badge badge-${log.media_type}">${log.media_type}</div>
                    <div class="title" style="margin-top:8px;">${title}</div>
                    <div class="meta">${'★'.repeat(log.rating)}</div>
                </div>
            `;
            grid.appendChild(card);
        } catch (e) { console.error("Error fetching recent item", e); }
    }

    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const closeSettings = document.getElementById('close-settings');
    const finalDeleteBtn = document.getElementById('final-delete-btn');
    const deletePasswordInput = document.getElementById('delete-confirm-password');

    openSettingsBtn.onclick = () => settingsModal.style.display = 'flex';
    closeSettings.onclick = () => settingsModal.style.display = 'none';

    finalDeleteBtn.onclick = async () => {
        const password = deletePasswordInput.value;
        if (!password) return alert("Please enter your password to confirm.");

        const confirmAction = confirm("FINAL WARNING: Are you absolutely sure? This cannot be undone.");
        if (!confirmAction) return;

        // 1. Verify the password by attempting a re-login
        const { data: { user } } = await supabaseClient.auth.getUser();
        const { error: signInError } = await supabaseClient.auth.signInWithPassword({
            email: user.email,
            password: password
        });

        if (signInError) {
            alert("Incorrect password. Deletion cancelled.");
            return;
        }

        // 2. Call a custom Database Function to delete the user
        // You must create this function in your Supabase SQL Editor first!
        const { error: deleteError } = await supabaseClient.rpc('delete_user_account');

        if (deleteError) {
            console.error(deleteError);
            alert("Error: " + deleteError.message);
        } else {
            alert("Your account has been deleted. Goodbye!");
            await supabaseClient.auth.signOut();
            window.location.href = 'index.html';
        }
    };

}

initProfile();