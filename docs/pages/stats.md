# Catalogd: Stats Page Documentation

The Stats page serves as an advanced analytics dashboard for Catalogd users, providing granular breakdowns of their media consumption habits over various timeframes. It calculates raw metrics directly on the client, generates interactive charts using `Chart.js`, and coordinates with a background worker to deliver computationally heavy insights (like favorite actors and AI-generated vibes).

## Core Technologies & Integrations

The Stats page relies on a hybrid data processing approach:

* **Supabase:** Serves as the primary data store, querying `media_logs` for local calculation and `user_stats` for asynchronous heavy data.


* **Vanilla JavaScript:** Executes complex date mathematics, array filtering, and reduction algorithms natively in the browser to calculate basic stats.


* **Chart.js:** An external library loaded via CDN used to render responsive, dynamic bar charts visualizing logging frequency over time.



## Initialization & View Configuration

When `initStats()` fires, it queries the `media_logs` table to pull every interaction the user has ever recorded. The earliest log date is extracted (`earliestDate`) to dynamically set the boundaries for the time-period dropdowns.

The page offers three levels of "depth" (`switchStatsDepth`):

1. **All-Time:** Considers the entire `allMediaLogs` array.


2. **By Year:** Generates a `<select>` dropdown populated with years ranging from the current year down to the user's `earliestYear`.


3. **By Season:** Generates two dropdowns (Season and Year). The script translates meteorological seasons into strict Date boundaries (e.g., "Winter 2023-2024" spans Dec 1 to the end of Feb).



## Client-Side Calculations (Basic Stats & Milestones)

Once a depth and filter (e.g., Movies, Books, All) are selected, `loadStatsData()` triggers `filterLogsLocally()`. This function applies the date boundaries and media type filters to the master array.

The resulting `filteredLogs` array is passed to `renderBasicStats()` and `renderMilestones()`:

* **Raw Aggregates:** Utilizing `Array.reduce()`, the script calculates total hours watched, total pages read, and total TV episodes consumed. It explicitly isolates TV shows logged as an "entire" series to accurately count total seasons without double-counting individual episode logs.


* **Contextual Stats:** It sorts the array chronologically to extract and display the "First Watch" and "Last Log" for the selected period.


* **Milestones:** The application tracks the progressive total of each media type. When a type hits a threshold (e.g., every 1,000th movie or 10th book, depending on the current depth), it pushes a milestone object to the UI, rendering it with custom badges.



### Chart.js Integration

The `renderChart()` function destroys any existing chart instance to prevent memory leaks. It bins the `filteredLogs` by year (if the depth is "All-Time") or by Week Number (using a custom `getWeekNumber()` date utility) to build the data array. It then instantiates a new `Chart` object with Catalogd's specific styling constraints (hidden gridlines, transparent backgrounds, indigo bars).

## Asynchronous Heavy Stats (Background Worker)

Calculating top actors, top directors, and AI vibes requires fetching massive amounts of deep metadata from external APIs for hundreds of logs—an operation too heavy for the client. Catalogd handles this asynchronously.

1. **Database Lookup:** `loadStatsData()` queries the `user_stats` table looking for a row that matches the exact configuration currently being viewed (e.g., `user_id`, `all-time`, `all`, `movie`).


2. **State Evaluation:** If no row exists, `queueStatsForUpdate()` immediately inserts a blank row with `needs_update = true`. A background Edge Function periodically scans for this flag, calculates the heavy stats, and saves the JSON payload to the database.


3. **UI Feedback:**
* If the row indicates `needs_update` is true, the UI displays a green message: "Your deep insights are currently queued for processing.".


* If the period being viewed is actively ongoing (checked via `checkIsOngoing()`), the system displays a manual "Refresh This Period" button, allowing users to force a recalculation without wasting server resources on constantly updating active periods.




4. **Rendering:** If the JSON payload exists, `renderHeavyStats()` builds the UI. It parses the `vibe` object to construct a customized "Your Vibe" box, utilizing the user's top genre and theme to display AI-generated background images alongside proper CC licensing attribution (`image_genre_attribution`).



## Responsive CSS Architecture

The `stats.css` file ensures the dashboard remains readable on mobile devices (`max-width: 768px`).

* **Horizontal Tabs:** To save vertical space, the primary `#depth-1-tabs` container is converted to a horizontally scrolling menu (`flex-wrap: nowrap !important`, `overflow-x: auto !important`) with the scrollbar hidden (`scrollbar-width: none`).


* **Grid Density:** The primary `.stats-grid` shrinks from an auto-flowing multi-column layout to a strict 2-column layout (`grid-template-columns: repeat(2, 1fr)`). The text inside the `.stats-box-value` elements scales down from `2rem` to `1.5rem` to prevent numbers from overflowing the tight boundaries.