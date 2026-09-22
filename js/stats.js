// Import necessary modules and functions
import { loadConfig } from './core/config.js';
import { getSupabaseClient } from './core/supabase.js';
import {
    getSafeDate,
    checkIsOngoing,
    filterStatsData,
    calculateBasicStats
} from './logic/stats-logic.js';

// Load configuration and initialize Supabase client
let supabaseClient = null;

// Global vars
let currentUser = null;
let allMediaLogs = [];
let earliestDate = new Date();
let statsChartInstance = null;
let currentDepth = 'all-time';
let currentPeriod = 'all';
let currentFilter = 'all'; 
let isOngoingPeriod = true;

// ----------------------------------------
// Initialization
// ----------------------------------------
async function initStats() {
    try {
        supabaseClient = await getSupabaseClient();
        await document.querySelector('app-header')?.initializeAuth(supabaseClient);

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        currentUser = user;

        const avatar = document.getElementById('nav-avatar');
        if (avatar && currentUser.user_metadata && currentUser.user_metadata.avatar_url) {
            avatar.src = currentUser.user_metadata.avatar_url;
        }

        // 1. Fetch all user logs to determine boundaries and calculate raw stats
        const { data: logs } = await supabaseClient
            .from('media_logs')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('watched_on', { ascending: true });

        if (logs && logs.length > 0) {
            allMediaLogs = logs;
            earliestDate = new Date(logs[0].watched_on || logs[0].created_at);
        }

        switchStatsDepth('all-time'); // Initialize UI

    } catch (err) {
        console.error("Stats Init Error:", err);
    }
}

// ----------------------------------------
// Time & Date Utilities
// ----------------------------------------
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
    return weekNo;
}

// ----------------------------------------
// UI Routing & Filters
// ----------------------------------------
window.switchStatsDepth = (depth) => {
    currentDepth = depth;
    
    // Update active tab styling
    document.querySelectorAll('#depth-1-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.statsDepth === depth);
    });

    const controlsContainer = document.getElementById('depth-2-controls');
    controlsContainer.innerHTML = ''; // Clear existing controls

    const currentYear = new Date().getFullYear();
    const earliestYear = earliestDate.getFullYear();

    if (depth === 'all-time') {
        currentPeriod = 'all';
        loadStatsData();
    } 
    else if (depth === 'by-year') {
        // Generate Year Dropdown
        let selectHtml = `<select id="year-select" class="stats-dropdown">`;
        for (let y = currentYear; y >= earliestYear; y--) {
            selectHtml += `<option value="${y}">${y}</option>`;
        }
        selectHtml += `</select>`;
        controlsContainer.innerHTML = selectHtml;
        document.getElementById('year-select').addEventListener('change', (event) => window.updatePeriod(event.target.value));
        currentPeriod = currentYear.toString();
        loadStatsData();
    }
    else if (depth === 'by-season') {
        // Generate Season & Year Dropdowns
        controlsContainer.innerHTML = `
            <select id="season-select" class="stats-dropdown">
                <option value="Winter">Winter</option>
                <option value="Spring">Spring</option>
                <option value="Summer">Summer</option>
                <option value="Fall">Fall</option>
            </select>
            <select id="season-year-select" class="stats-dropdown"></select>
        `;
        document.getElementById('season-select').addEventListener('change', () => window.generateSeasonYears());
        document.getElementById('season-year-select').addEventListener('change', (event) => {
            const season = document.getElementById('season-select').value;
            window.updatePeriod(`${season} ${event.target.value}`);
        });
        generateSeasonYears(); // Populate the second dropdown based on default "Winter"
    }
};

window.generateSeasonYears = () => {
    const season = document.getElementById('season-select').value;
    const yearSelect = document.getElementById('season-year-select');
    yearSelect.innerHTML = '';

    const currentYear = new Date().getFullYear();
    const earliestYear = earliestDate.getFullYear();

    if (season === 'Winter') {
        // Pairs (e.g., 2023-2024)
        for (let y = currentYear; y >= earliestYear; y--) {
            // Include current year wrapping into next if we are in December
            yearSelect.innerHTML += `<option value="${y-1}-${y}">${y-1}-${y}</option>`;
        }
    } else {
        // Single Years
        for (let y = currentYear; y >= earliestYear; y--) {
            yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
        }
    }
    
    // Trigger update with combined string
    updatePeriod(`${season} ${yearSelect.value}`);
};

window.updatePeriod = (newPeriod) => {
    currentPeriod = newPeriod;
    loadStatsData();
};

window.filterStats = (type) => {
    currentFilter = type;
    document.querySelectorAll('.filter-nav .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.statsFilter === type);
    });
    loadStatsData();
};

// ----------------------------------------
// Data Sync & Queueing
// ----------------------------------------
async function queueStatsForUpdate() {
    try {
        // 1. Check if a row already exists for this exact configuration
        const { data: existingRow } = await supabaseClient
            .from('user_stats')
            .select('id')
            .eq('user_id', currentUser.id)
            .eq('stat_depth', currentDepth)
            .eq('stat_period', currentPeriod)
            .eq('media_type', currentFilter)
            .maybeSingle();

        if (existingRow) {
            // Update existing row
            await supabaseClient
                .from('user_stats')
                .update({ needs_update: true })
                .eq('id', existingRow.id);
        } else {
            // Insert a new tracking row
            await supabaseClient
                .from('user_stats')
                .insert({
                    user_id: currentUser.id,
                    stat_depth: currentDepth,
                    stat_period: currentPeriod,
                    media_type: currentFilter,
                    heavy_stats: {},
                    needs_update: true
                });
        }
        return true;
    } catch (err) {
        console.error("Error queuing stats update:", err);
        return false;
    }
}

async function loadStatsData() {
    document.getElementById('stats-content').style.display = 'none';
    document.getElementById('stats-loader').style.display = 'block';

    isOngoingPeriod = checkIsOngoing(currentDepth, currentPeriod, new Date());
    
    const filteredLogs = filterStatsData(allMediaLogs, currentFilter, currentDepth, currentPeriod);

    // 2. Fetch Heavy Stats from `user_stats`
    const { data: dbStats } = await supabaseClient
        .from('user_stats')
        .select('heavy_stats, needs_update')
        .eq('user_id', currentUser.id)
        .eq('stat_depth', currentDepth)
        .eq('stat_period', currentPeriod)
        .eq('media_type', currentFilter)
        .maybeSingle();

    let heavyStatsData = dbStats?.heavy_stats || {};
    let isQueued = dbStats?.needs_update || false;

    // If no row exists at all for this period, automatically queue it
    if (!dbStats) {
        console.log(`No stats row found for ${currentPeriod} ${currentFilter}. Auto-queuing...`);
        const success = await queueStatsForUpdate();
        if (success) {
            isQueued = true;
        }
    }

    // Manage the Refresh Button UI
    const refreshBtn = document.getElementById('refresh-stats-btn');
    const refreshStatus = document.getElementById('refresh-status');
    
    if (isQueued) {
        // If it's queued (either manually or automatically), hide button and show green text
        refreshBtn.style.display = 'none';
        refreshStatus.style.display = 'block';
    } else {
        refreshBtn.style.display = 'inline-block';
        refreshBtn.innerText = '↻ Refresh This Period';
        refreshBtn.disabled = false;
        refreshStatus.style.display = 'none';
    }

    // 3. Render Basic Stats & Chart
    renderBasicStats(filteredLogs);
    renderChart(filteredLogs);

    // 4. Render Heavy Stats / Vibes dynamically
    const heavyArea = document.getElementById('heavy-stats-area');
    
    if (hasRealHeavyData(heavyStatsData)) {
        renderHeavyStats(heavyStatsData);
    } else if (isQueued) {
        heavyArea.innerHTML = `<p class="meta" style="color: #10b981; margin-top: 40px; text-align: center;">Your deep insights are currently queued for processing. Check back soon!</p>`;
    } else if (isOngoingPeriod || currentDepth === 'all-time') {
        heavyArea.innerHTML = `<p class="meta" style="margin-top: 40px; text-align: center;">Detailed insights (Vibes, Top Actors, Genres) are automatically generated at the end of a time period. You can generate them now by clicking Refresh below.</p>`;
    } else {
        heavyArea.innerHTML = `<p class="meta" style="margin-top: 40px; text-align: center;">No deep insights available. Click Refresh below to generate them!</p>`;
    }

    renderMilestones(filteredLogs);

    document.getElementById('stats-loader').style.display = 'none';
    document.getElementById('stats-content').style.display = 'block';
}

// ----------------------------------------
// Component Renderers
// ----------------------------------------
function renderBasicStats(logs) {
    const grid = document.getElementById('basic-stats-grid');
    if (!logs || logs.length === 0) {
        grid.innerHTML = '<div class="stats-box" style="grid-column: 1/-1;"><span class="meta">No activity found for this period.</span></div>';
        return;
    }

    const stats = calculateBasicStats(logs);

    // Build the dynamic HTML
    let html = `
        <div class="stats-box"><div class="stats-box-value">${stats.totalLogs}</div><div class="stats-box-label">Logs</div></div>
    `;

    if (currentFilter === 'book') {
        const entireBooks = logs.filter(l => l.media_type === 'book' && l.is_finished === true).length;
        html += `<div class="stats-box"><div class="stats-box-value">${entireBooks}</div><div class="stats-box-label">Entire Books Read</div></div>`;
        html += `<div class="stats-box"><div class="stats-box-value">${stats.totalPages.toLocaleString()}</div><div class="stats-box-label">Pages Read</div></div>`;
    } else if (currentFilter === 'tv') {
        html += `<div class="stats-box"><div class="stats-box-value">${stats.totalShows}</div><div class="stats-box-label">Complete Shows</div></div>`;
        html += `<div class="stats-box"><div class="stats-box-value">${stats.totalTvSeasons}</div><div class="stats-box-label">Total Seasons</div></div>`;
        html += `<div class="stats-box"><div class="stats-box-value">${stats.totalTvEpisodes}</div><div class="stats-box-label">Total Episodes</div></div>`;
        html += `<div class="stats-box"><div class="stats-box-value">${stats.hoursWatched}</div><div class="stats-box-label">Hours</div></div>`;
    } else if (currentFilter === 'all') {
        html += `<div class="stats-box"><div class="stats-box-value">${stats.hoursWatched}</div><div class="stats-box-label">Hours</div></div>`;
        html += `<div class="stats-box"><div class="stats-box-value">${stats.totalPages.toLocaleString()}</div><div class="stats-box-label">Pages Read</div></div>`;
    } else {
        html += `<div class="stats-box"><div class="stats-box-value">${stats.hoursWatched}</div><div class="stats-box-label">Hours</div></div>`;
    }

    html += `
        <div class="stats-box"><div class="stats-box-value">${stats.totalReviews}</div><div class="stats-box-label">Reviews</div></div>
        <div class="stats-box"><div class="stats-box-value">${stats.fiveStars}</div><div class="stats-box-label">5-Star Ratings</div></div>
    `;

    // First and Last Logic
    if (currentFilter === 'all') {
        const firstWatch = stats.sortedLogs.find(l => l.media_type === 'movie' || l.media_type === 'tv');
        const firstRead = stats.sortedLogs.find(l => l.media_type === 'book');
        const firstListen = stats.sortedLogs.find(l => l.media_type === 'album');
        const firstVid = stats.sortedLogs.find(l => l.media_type === 'youtube');

        if (firstWatch) html += `<div class="stats-box context-box"><div class="stats-box-label">First Watch</div><div class="meta">${firstWatch.media_title || 'Unknown'}</div></div>`;
        if (firstRead) html += `<div class="stats-box context-box"><div class="stats-box-label">First Read</div><div class="meta">${firstRead.media_title || 'Unknown'}</div></div>`;
        if (firstListen) html += `<div class="stats-box context-box"><div class="stats-box-label">First Listen</div><div class="meta">${firstListen.media_title || 'Unknown'}</div></div>`;
        if (firstVid) html += `<div class="stats-box context-box"><div class="stats-box-label">First Video</div><div class="meta">${firstVid.media_title || 'Unknown'}</div></div>`;
    } else {
        html += `
            <div class="stats-box context-box"><div class="stats-box-label">First Log</div><div class="meta">${stats.sortedLogs[0].media_title || 'Unknown'}</div></div>
            <div class="stats-box context-box"><div class="stats-box-label">Last Log</div><div class="meta">${stats.sortedLogs[stats.sortedLogs.length-1].media_title || 'Unknown'}</div></div>
        `;
    }

    grid.innerHTML = html;
}

function renderChart(logs) {
    const ctx = document.getElementById('statsChart');
    if (!ctx) return;
    
    // Destroy existing chart if it exists
    if (statsChartInstance) {
        statsChartInstance.destroy();
    }

    if (!logs || logs.length === 0) return;

    const labels = [];
    const dataCounts = {};

    if (currentDepth === 'all-time') {
        // Bin by Year
        logs.forEach(l => {
            const y = getSafeDate(l).getFullYear();
            dataCounts[y] = (dataCounts[y] || 0) + 1;
        });
    } else {
        // Bin by Week
        logs.forEach(l => {
            const d = getSafeDate(l);
            // Format: "Wk 12" or "Dec 1st Week" depending on preference, sticking to Wk #
            const w = `Wk ${getWeekNumber(d)}`;
            dataCounts[w] = (dataCounts[w] || 0) + 1;
        });
    }

    // Sort Keys properly
    const sortedKeys = Object.keys(dataCounts).sort((a, b) => {
        if (currentDepth === 'all-time') return parseInt(a) - parseInt(b);
        return parseInt(a.replace('Wk ', '')) - parseInt(b.replace('Wk ', ''));
    });

    const dataset = sortedKeys.map(k => dataCounts[k]);

    statsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedKeys,
            datasets: [{
                label: 'Logs',
                data: dataset,
                backgroundColor: 'rgba(79, 70, 229, 0.6)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9ab' } },
                x: { grid: { display: false }, ticks: { color: '#9ab' } }
            }
        }
    });
}

function renderHeavyStats(heavyData) {
    const area = document.getElementById('heavy-stats-area');
    
    if (!hasRealHeavyData(heavyData)) {
        area.innerHTML = '';
        return;
    }

    let html = `<h3 class="section-title" style="font-size: 1.4rem; margin-top: 50px;">Deeper Insights</h3>`;

    // Only build the grid if there are actual text stats to show
    const hasLists = (heavyData.top_actors && heavyData.top_actors.length > 0) || 
                     (heavyData.top_directors && heavyData.top_directors.length > 0) || 
                     (heavyData.top_genres && heavyData.top_genres.length > 0) || 
                     (heavyData.top_themes && heavyData.top_themes.length > 0);

    if (hasLists) {
        html += `<div class="stats-grid">`;
        if (heavyData.top_actors && heavyData.top_actors.length > 0) {
            html += `<div class="stats-box context-box"><div class="stats-box-label">Most Watched Actors</div>
                     <div class="meta" style="color: #fff;">${heavyData.top_actors.join('<br>')}</div></div>`;
        }
        if (heavyData.top_directors && heavyData.top_directors.length > 0) {
            html += `<div class="stats-box context-box"><div class="stats-box-label">Most Watched Directors</div>
                     <div class="meta" style="color: #fff;">${heavyData.top_directors.join('<br>')}</div></div>`;
        }
        if (heavyData.top_genres && heavyData.top_genres.length > 0) {
            html += `<div class="stats-box context-box"><div class="stats-box-label">Top 3 Genres</div>
                     <div class="meta" style="color: #fff;">${heavyData.top_genres.slice(0, 3).join('<br>')}</div></div>`;
        }
        if (heavyData.top_themes && heavyData.top_themes.length > 0) {
            html += `<div class="stats-box context-box"><div class="stats-box-label">Top 3 Themes</div>
                     <div class="meta" style="color: #fff;">${heavyData.top_themes.slice(0, 3).join('<br>')}</div></div>`;
        }
        html += `</div>`;
    }

    // Vibes Integration
    if (heavyData.vibe && currentFilter !== 'youtube' && currentFilter !== 'all') {

        // No more external placeholder image — if there's nothing to show yet, just
        // fall back to a plain gradient background. (Matches renderVibeBox in scriptingIndex.js)
        const fallbackGradient = 'linear-gradient(135deg, #2a2f3a, #1b1f27)';

        function backgroundStyle(img) {
            return img ? `background-image: url('${img}'); background-size: cover; background-position: center;`
                        : `background: ${fallbackGradient};`;
        }

        // Builds a small, unobtrusive credit line for a CC-licensed image. Returns
        // an empty string if there's nothing to attribute (e.g. the fallback gradient,
        // or a public-domain image where we chose not to show a credit).
        function attributionHtml(attr) {
            if (!attr || !attr.text) return '';
            const style = 'position:absolute;bottom:6px;right:8px;font-size:10px;line-height:1.2;' +
                'color:rgba(255,255,255,0.65);background:rgba(0,0,0,0.35);padding:2px 6px;' +
                'border-radius:4px;text-decoration:none;pointer-events:auto;z-index:2;';
            const label = attr.url
                ? `<a href="${attr.url}" target="_blank" rel="noopener noreferrer" class="vibe-attribution-link" style="${style}">${attr.text}</a>`
                : `<div class="vibe-attribution" style="${style}">${attr.text}</div>`;
            return label;
        }

        // Two separate attribution objects — one per image — instead of a single
        // combined string. Matches the genreAttr / themeAttr split in scriptingIndex.js.
        const genreAttr = { text: heavyData.vibe.image_genre_attribution, url: heavyData.vibe.image_genre_attribution_url };
        const themeAttr = { text: heavyData.vibe.image_theme_attribution, url: heavyData.vibe.image_theme_attribution_url };

        // Books & Music don't have a meaningful "genre" half for this feature —
        // just show the theme, full-width, with no blend divider.
        const themeOnly = (currentFilter === 'book' || currentFilter === 'album');

        const vibeBoxInner = themeOnly
            ? `<div class="vibe-half" style="${backgroundStyle(heavyData.vibe.image_theme)}">
                    <span class="vibe-text">${heavyData.vibe.theme}</span>
                    ${attributionHtml(themeAttr)}
                </div>`
            : `<div class="vibe-half" style="${backgroundStyle(heavyData.vibe.image_genre)}">
                    <span class="vibe-text">${heavyData.vibe.genre}</span>
                    ${attributionHtml(genreAttr)}
                </div>
                <div class="vibe-half" style="${backgroundStyle(heavyData.vibe.image_theme)}">
                    <span class="vibe-text">${heavyData.vibe.theme}</span>
                    ${attributionHtml(themeAttr)}
                </div>
                <div class="vibe-blend"></div>`;

        html += `
            <div class="vibe-container">
                <div class="vibe-title">Your Vibe</div>
                <div class="vibe-box">
                    ${vibeBoxInner}
                </div>
            </div>
        `;
    }

    area.innerHTML = html;
}

function hasRealHeavyData(heavy) {
    if (!heavy) return false;
    if (heavy.top_actors && heavy.top_actors.length > 0) return true;
    if (heavy.top_directors && heavy.top_directors.length > 0) return true;
    if (heavy.top_genres && heavy.top_genres.length > 0) return true;
    if (heavy.top_themes && heavy.top_themes.length > 0) return true;
    if (heavy.vibe) return true;
    return false;
}

function renderMilestones(logs) {
    const area = document.getElementById('milestones-area');
    if (!logs || logs.length === 0) {
        area.innerHTML = '';
        return;
    }

    // Determine thresholds based on depth
    let thresholds = {};
    if (currentDepth === 'all-time') {
        thresholds = { movie: 1000, tv: 100, book: 10, album: 100, youtube: 1000 };
    } else if (currentDepth === 'by-year') {
        thresholds = { movie: 50, tv: 10, book: 5, album: 10, youtube: 100 };
    } else { // by-season
        thresholds = { movie: 15, tv: 5, book: 1, album: 5, youtube: 50 };
    }

    const typeCounts = { movie: 0, tv: 0, book: 0, album: 0, youtube: 0 };
    const hitMilestones = [];

    // Ensure logs are chronological for accurate milestone hitting
    const sorted = [...logs].sort((a, b) => getSafeDate(a) - getSafeDate(b));

    sorted.forEach(log => {
        const type = log.media_type;
        if (typeCounts[type] !== undefined) {
            typeCounts[type]++;
            const threshold = thresholds[type];
            if (threshold && typeCounts[type] % threshold === 0) {
                hitMilestones.push({
                    number: typeCounts[type],
                    type: type,
                    title: log.media_title || 'Unknown',
                    date: getSafeDate(log)
                });
            }
        }
    });

    if (hitMilestones.length === 0) {
        area.innerHTML = '<p class="meta" style="text-align:center;">Keep tracking to hit your next milestone!</p>';
        return;
    }

    // Sort milestones newest to oldest
    hitMilestones.sort((a, b) => b.date - a.date);

    let html = `<h3 class="section-title" style="font-size: 1.4rem;">Milestones Reached</h3>
                <div class="milestone-list">`;
                
    hitMilestones.forEach(m => {
        html += `
            <div class="milestone-item">
                <div class="milestone-badge badge-${m.type}">${m.number}</div>
                <div class="milestone-info">
                    <div class="milestone-text">You logged your <strong>${m.number}th ${m.type}</strong>!</div>
                    <div class="milestone-title">${m.title} <span class="meta">(${m.date.toLocaleDateString()})</span></div>
                </div>
            </div>
        `;
    });
    
    html += `</div>`;
    area.innerHTML = html;
}

// ----------------------------------------
// Event Delegation
// ----------------------------------------
window.toggleProfileDropdown = function(event) {
    if (event) event.stopPropagation();
    const content = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (!content || !trigger) return;
    
    const isVisible = content.style.display === 'block';
    content.style.display = isVisible ? 'none' : 'block';
    trigger.classList.toggle('active', !isVisible);
};

window.onclick = function(event) {
    const dropdown = document.getElementById('dropdown-content');
    const trigger = document.querySelector('.profile-trigger');
    if (dropdown && trigger && event.target !== trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
        trigger.classList.remove('active');
    }
};

window.signOut = async function() {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
};

window.requestStatsUpdate = async () => {
    const btn = document.getElementById('refresh-stats-btn');
    const status = document.getElementById('refresh-status');
    
    btn.disabled = true;
    btn.innerText = "Queuing...";

    const success = await queueStatsForUpdate();

    if (success) {
        btn.style.display = 'none';
        status.style.display = 'block';
    } else {
        btn.innerText = "Error - Try Again";
        btn.disabled = false;
    }
};

document.querySelectorAll('[data-stats-depth]').forEach((button) => {
    button.addEventListener('click', () => window.switchStatsDepth(button.dataset.statsDepth));
});

document.querySelectorAll('[data-stats-filter]').forEach((button) => {
    button.addEventListener('click', () => window.filterStats(button.dataset.statsFilter));
});

document.getElementById('refresh-stats-btn')?.addEventListener('click', () => window.requestStatsUpdate());

initStats();
