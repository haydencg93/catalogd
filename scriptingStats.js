let supabaseClient = null;
let currentUser = null;
let allMediaLogs = [];
let earliestDate = new Date();
let statsChartInstance = null;

// Current State
let currentDepth = 'all-time';
let currentPeriod = 'all'; // e.g., '2023', 'Winter 2023-2024'
let currentFilter = 'all'; 
let isOngoingPeriod = true;

async function initStats() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        currentUser = user;

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

// --- TIME & ONGOING LOGIC ---

function checkIsOngoing(depth, period) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11

    if (depth === 'all-time') return true; 
    
    if (depth === 'by-year') {
        return parseInt(period) === currentYear;
    }

    if (depth === 'by-season') {
        // Parse "Season Year" (e.g., "Winter 2023-2024" or "Summer 2024")
        const parts = period.split(' ');
        const season = parts[0];
        
        let targetStart, targetEnd;

        if (season === 'Winter') {
            const years = parts[1].split('-');
            targetStart = new Date(years[0], 11, 1); // Dec 1
            targetEnd = new Date(years[1], 2, 0);    // Last day of Feb
        } else if (season === 'Spring') {
            targetStart = new Date(parts[1], 2, 1);  // Mar 1
            targetEnd = new Date(parts[1], 5, 0);    // Last day of May
        } else if (season === 'Summer') {
            targetStart = new Date(parts[1], 5, 1);  // Jun 1
            targetEnd = new Date(parts[1], 8, 0);    // Last day of Aug
        } else if (season === 'Fall') {
            targetStart = new Date(parts[1], 8, 1);  // Sep 1
            targetEnd = new Date(parts[1], 11, 0);   // Last day of Nov
        }

        return now >= targetStart && now <= targetEnd;
    }
    return false;
}

// --- UI ROUTING ---

window.switchStatsDepth = (depth) => {
    currentDepth = depth;
    
    // Update active tab styling
    document.querySelectorAll('#depth-1-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick').includes(depth));
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
        let selectHtml = `<select id="year-select" class="stats-dropdown" onchange="updatePeriod(this.value)">`;
        for (let y = currentYear; y >= earliestYear; y--) {
            selectHtml += `<option value="${y}">${y}</option>`;
        }
        selectHtml += `</select>`;
        controlsContainer.innerHTML = selectHtml;
        currentPeriod = currentYear.toString();
        loadStatsData();
    }
    else if (depth === 'by-season') {
        // Generate Season & Year Dropdowns
        controlsContainer.innerHTML = `
            <select id="season-select" class="stats-dropdown" onchange="generateSeasonYears()">
                <option value="Winter">Winter</option>
                <option value="Spring">Spring</option>
                <option value="Summer">Summer</option>
                <option value="Fall">Fall</option>
            </select>
            <select id="season-year-select" class="stats-dropdown" onchange="updatePeriod(document.getElementById('season-select').value + ' ' + this.value)"></select>
        `;
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
        btn.classList.toggle('active', btn.getAttribute('onclick').includes(`('${type}')`));
    });
    loadStatsData();
};

// --- DATA FETCHING & RENDERING ---

async function loadStatsData() {
    document.getElementById('stats-content').style.display = 'none';
    document.getElementById('stats-loader').style.display = 'block';

    isOngoingPeriod = checkIsOngoing(currentDepth, currentPeriod);
    
    // 1. Filter local `allMediaLogs` by `currentPeriod` and `currentFilter`
    const filteredLogs = filterLogsLocally();

    // 2. Fetch Heavy Stats from `user_stats` IF the period is completed
    let heavyStatsData = {};
    if (!isOngoingPeriod && currentDepth !== 'all-time') {
        const { data: dbStats } = await supabaseClient
            .from('user_stats')
            .select('heavy_stats')
            .eq('user_id', currentUser.id)
            .eq('stat_depth', currentDepth)
            .eq('stat_period', currentPeriod)
            .eq('media_type', currentFilter)
            .maybeSingle();
            
        if (dbStats) heavyStatsData = dbStats.heavy_stats;
    }

    // 3. Render Basic Stats (Totals, Hours, First/Last) from `filteredLogs`
    renderBasicStats(filteredLogs);
    
    // 4. Render Chart (By Year = bars per year; By Year tab = bars per week)
    renderChart(filteredLogs);

    // 5. Render Heavy Stats / Vibes
    const heavyArea = document.getElementById('heavy-stats-area');
    if (isOngoingPeriod || currentDepth === 'all-time') {
        heavyArea.innerHTML = `<p class="meta">Detailed insights (Vibes, Top Actors, Genres) are generated at the end of this time period.</p>`;
    } else {
        renderHeavyStats(heavyStatsData);
    }

    // 6. Calculate & Render Milestones locally
    renderMilestones(filteredLogs);

    document.getElementById('stats-loader').style.display = 'none';
    document.getElementById('stats-content').style.display = 'block';
}

// --- HELPERS ---

function getSafeDate(log) {
    let d = log.watched_on || log.created_at;
    if (d && d.length === 10) d += "T12:00:00"; // Fix timezone offset for YYYY-MM-DD
    return new Date(d);
}

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
    return weekNo;
}

// --- DATA FETCHING & RENDERING (COMPLETED) ---

function filterLogsLocally() {
    return allMediaLogs.filter(log => {
        // 1. Media Type Filter
        if (currentFilter !== 'all' && log.media_type !== currentFilter) return false;

        // 2. Timeframe Filter
        const date = getSafeDate(log);
        
        if (currentDepth === 'by-year') {
            return date.getFullYear() === parseInt(currentPeriod);
        } 
        else if (currentDepth === 'by-season') {
            const parts = currentPeriod.split(' ');
            const season = parts[0];
            let start, end;

            if (season === 'Winter') {
                const years = parts[1].split('-');
                start = new Date(years[0], 11, 1); // Dec 1
                end = new Date(years[1], 2, 0, 23, 59, 59); // Last day of Feb
            } else if (season === 'Spring') {
                start = new Date(parts[1], 2, 1); 
                end = new Date(parts[1], 5, 0, 23, 59, 59); 
            } else if (season === 'Summer') {
                start = new Date(parts[1], 5, 1); 
                end = new Date(parts[1], 8, 0, 23, 59, 59);
            } else if (season === 'Fall') {
                start = new Date(parts[1], 8, 1); 
                end = new Date(parts[1], 11, 0, 23, 59, 59);
            }
            return date >= start && date <= end;
        }

        return true; // all-time
    });
}

function renderBasicStats(logs) {
    const grid = document.getElementById('basic-stats-grid');
    if (!logs || logs.length === 0) {
        grid.innerHTML = '<div class="stats-box" style="grid-column: 1/-1;"><span class="meta">No activity found for this period.</span></div>';
        return;
    }

    const totalLogs = logs.length;
    const totalReviews = logs.filter(l => l.notes && l.notes.trim() !== '').length;
    const fiveStars = logs.filter(l => l.rating === 5).length;
    
    // Sum runtimes (assuming runtime is stored in minutes)
    const totalRuntimeMinutes = logs.reduce((sum, l) => sum + (parseInt(l.runtime) || 0), 0);
    const hoursWatched = (totalRuntimeMinutes / 60).toFixed(1);

    // Sort chronologically for first/last logic
    const sorted = [...logs].sort((a, b) => getSafeDate(a) - getSafeDate(b));
    
    let html = `
        <div class="stats-box"><div class="stats-box-value">${totalLogs}</div><div class="stats-box-label">Logs</div></div>
        <div class="stats-box"><div class="stats-box-value">${hoursWatched}</div><div class="stats-box-label">Hours</div></div>
        <div class="stats-box"><div class="stats-box-value">${totalReviews}</div><div class="stats-box-label">Reviews</div></div>
        <div class="stats-box"><div class="stats-box-value">${fiveStars}</div><div class="stats-box-label">5-Star Ratings</div></div>
    `;

    // First and Last Logic
    if (currentFilter === 'all') {
        const firstWatch = sorted.find(l => l.media_type === 'movie' || l.media_type === 'tv');
        const firstRead = sorted.find(l => l.media_type === 'book');
        const firstListen = sorted.find(l => l.media_type === 'album');
        const firstVid = sorted.find(l => l.media_type === 'youtube');

        if (firstWatch) html += `<div class="stats-box context-box"><div class="stats-box-label">First Watch</div><div class="meta">${firstWatch.media_title || 'Unknown'}</div></div>`;
        if (firstRead) html += `<div class="stats-box context-box"><div class="stats-box-label">First Read</div><div class="meta">${firstRead.media_title || 'Unknown'}</div></div>`;
        if (firstListen) html += `<div class="stats-box context-box"><div class="stats-box-label">First Listen</div><div class="meta">${firstListen.media_title || 'Unknown'}</div></div>`;
        if (firstVid) html += `<div class="stats-box context-box"><div class="stats-box-label">First Video</div><div class="meta">${firstVid.media_title || 'Unknown'}</div></div>`;
    } else {
        html += `
            <div class="stats-box context-box"><div class="stats-box-label">First Log</div><div class="meta">${sorted[0].media_title || 'Unknown'}</div></div>
            <div class="stats-box context-box"><div class="stats-box-label">Last Log</div><div class="meta">${sorted[sorted.length-1].media_title || 'Unknown'}</div></div>
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
    
    if (!heavyData || Object.keys(heavyData).length === 0) {
        area.innerHTML = '';
        return;
    }

    let html = `<h3 class="section-title" style="font-size: 1.4rem; margin-top: 50px;">Deeper Insights</h3><div class="stats-grid">`;

    // Example Top Actors unpacking (assuming array of strings)
    if (heavyData.top_actors && heavyData.top_actors.length > 0) {
        html += `<div class="stats-box context-box"><div class="stats-box-label">Most Watched Actors</div>
                 <div class="meta" style="color: #fff;">${heavyData.top_actors.join(', ')}</div></div>`;
    }
    
    if (heavyData.top_directors && heavyData.top_directors.length > 0) {
        html += `<div class="stats-box context-box"><div class="stats-box-label">Most Watched Directors</div>
                 <div class="meta" style="color: #fff;">${heavyData.top_directors.join(', ')}</div></div>`;
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

    // Vibes Integration (Excludes YouTube / All)
    if (heavyData.vibe && currentFilter !== 'youtube' && currentFilter !== 'all') {
        html += `
            <div class="vibe-container" style="margin-top: 40px; position: relative;">
                <div class="vibe-title">Your Vibe (${currentPeriod})</div>
                <div class="vibe-box">
                    <div class="vibe-half" style="background-image: url('${heavyData.vibe.image_genre}'); background-size: cover; background-position: center;">
                        <span class="vibe-text">${heavyData.vibe.genre}</span>
                    </div>
                    ${heavyData.vibe.theme ? `
                    <div class="vibe-half" style="background-image: url('${heavyData.vibe.image_theme}'); background-size: cover; background-position: center;">
                        <span class="vibe-text">${heavyData.vibe.theme}</span>
                    </div>` : ''}
                    <div class="vibe-blend"></div> 
                </div>
            </div>
        `;
    }

    area.innerHTML = html;
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

initStats();