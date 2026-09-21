# Catalogd: Advanced Search Page Documentation

The Advanced Search page empowers users to perform highly granular, multi-faceted queries across movies and TV shows. It achieves this by combining external API data with a proprietary database, applying client-side filtering, and managing complex user interface states. This document breaks down the underlying architecture, technologies, and logical flows to ensure full comprehension of the page's mechanics.

## Technologies & Libraries

The Advanced Search page relies on a modern, vanilla web stack integrated with external services:

* **Vanilla JavaScript (ES6 Modules):** The logic relies strictly on native JS features, utilizing ES6 module imports for configuration and utilities (`import { loadConfig } from './core/config.js';`).


* **Supabase (BaaS):** Acts as the primary backend database and authentication provider. The official Supabase JS client (`@supabase/supabase-js@2`) is loaded via CDN. It is used to fetch user preferences and execute exact character searches against the `global_movies` table.


* **TMDB API (via Proxy):** The core media data, including watch providers, languages, and core genres, is sourced from The Movie Database (TMDB) API routed through a custom `PROXY_URL` to secure API keys.


* **Web Components:** The application header and authentication state are encapsulated within a custom web component (`<app-header>`).


* **CSS Variables & Flexbox/Grid:** The styling leverages CSS variables (e.g., `var(--accent)`) and CSS Grid/Flexbox for responsive layouts, alongside custom scrollbars and segmented controls.



## Page Architecture & Initialization Flow

When the user navigates to the Advanced Search page, the `initAdvSearch()` function orchestrates the setup phase.

### 1. Web Component & Authentication

The script pauses to ensure the `<app-header>` element is defined in the DOM using `customElements.whenDefined('app-header')`. Once available, it triggers `initializeAuth(supabaseClient)` to fetch the current user's session.

```javascript
// Awaiting the custom element definition ensures the header is fully parsed
await customElements.whenDefined('app-header');
const header = document.querySelector('app-header');
let currentUser = null;
if (header) {
    currentUser = await header.initializeAuth(supabaseClient);
}

```

### 2. User Preferences Injection

If a user is authenticated, `loadUserPreferences(user)` queries the `profiles` table in Supabase. It extracts the user's preferred streaming services and languages, automatically activating the corresponding filter "pills" in the UI by adding the `.active` CSS class and adding the IDs to the global state Sets.

### 3. Asynchronous Data Hydration

To populate the filter options, the application simultaneously fires asynchronous requests to the TMDB API proxy.

* **`fetchTopProviders()`:** Fetches movie and TV watch providers, sorts them by US display priority, slices the top 25, and renders them.


* **`fetchCoreGenres()`:** Fetches genres for both formats, merges them into a deduplicated Map, and sorts them alphabetically.


* **`fetchLanguages()`:** Fetches configuration languages, maps their English names to `iso_639_1` codes via `languageIsoMap`, and renders them.



## State Management & The "Pill" UI

The user interface relies heavily on interactive buttons referred to as "pills". The state of these selections is managed in JavaScript using `Set` and `Map` objects. Sets guarantee that all selected filters are unique, preventing duplicate query parameters.

### Global State Variables

* `activeTypes`: A `Set` storing 'movie' and/or 'tv' (defaults to 'movie').


* `activeProviders`, `activeCoreGenres`, `activeLanguages`: `Set` objects storing selected filter IDs or names.


* `activeKeywords`: A `Map` storing theme/keyword IDs as keys and their text names as values.



### Event Delegation

Instead of attaching event listeners to every single pill button, the application uses **Event Delegation**. A single click listener is attached to the parent `.adv-search-container`. When a click occurs, the script checks if the target is a `.pill` and extracts its `data-group` to determine which Set to update.

```javascript
// Event Delegation Example from adv-search.js
document.querySelector('.adv-search-container').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return; // Ignore clicks outside pills
    
    // Route keyword toggles separately from standard groups
    if (pill.closest('#genres-search-results') || pill.closest('#genres-selected-container')) {
        toggleKeywordPill(pill);
    } else {
        const group = pill.dataset.group;
        if (group) togglePill(pill, group);
    }
});

```

## Search Execution Pathways

When the "Find Matches" or "Load More" buttons are clicked, `executeSearch(isLoadMore)` is triggered. The application dynamically chooses between two primary search pathways based on user input.

### Pathway A: Supabase Character Database Search

If the user enters text into the `#character-search-input`, the application queries Catalogd's proprietary Supabase database (`global_movies` table) instead of TMDB.

1. **Query Building:** The application chains Supabase filters (e.g., `.ilike('characters', '%...%')`, `.gte('release_year', ...)`).


2. **Client-Side Tag Filtering:** Because tags (genres/themes) are stored as strings in Supabase, the application performs a post-fetch `.filter()` to ensure the results match the selected core genres and keywords.


3. **Detailed TMDB Validation:** If duration, provider, or language filters are active, the app fetches TMDB details for the Supabase matches via `fetchDetailedResults()` and filters out non-compliant items using `evaluateItemDetail()`.



### Pathway B: Standard TMDB API Browsing

If no character search is provided, the application routes the request to TMDB.

1. **Text Search vs. Discovery:** If the user typed in the general `#text-search-input`, the application uses the TMDB Search API (`/api/tmdb/search/...`). If no text is entered, it uses the TMDB Discover API (`/api/tmdb/discover/...`), applying the active parameters (providers, runtimes, genres) to the URL query string.


2. **Concurrency:** `fetchPromises` are generated for movies and/or TV shows using `Promise.all()` to execute requests simultaneously.


3. **Secondary Filtering & Deduplication:** Because basic TMDB endpoints do not return comprehensive streaming provider data, `fetchDetailedResults()` is called to retrieve the `watch/providers` and `translations` payload for every result. The data is subsequently filtered locally via `evaluateItemDetail()`.



## Rate Limiting & API Optimization

Fetching deep details for dozens of media items concurrently can trigger HTTP 429 "Too Many Requests" errors. The application handles this elegantly using a batched promise execution pattern.

In `fetchDetailedResults(results)`, the application processes requests in groups of 10 (`batchSize = 10`). It uses `Promise.all()` to resolve the batch, then pauses execution using `await new Promise(resolve => setTimeout(resolve, delayMs))` for 250 milliseconds before triggering the next batch.

```javascript
// Rate Limiting Concept from fetchDetailedResults
for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);
    const batchPromises = batch.map(item => fetch(/* ... */));

    const batchData = await Promise.all(batchPromises);
    detailedResults.push(...batchData);

    // Pause between batches to respect API limits
    if (i + batchSize < results.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
}

```

## User Interface & Rendering

### The Layout

The HTML structure is enclosed in an `.adv-search-container` utilizing `.adv-search-section` blocks for spacing. It features segmented controls (styled radio buttons replacing standard checkboxes) allowing users to switch logic rules smoothly, such as "Original Language Only" vs. "Original Language & Translations".

### Security & Rendering

When outputting results to the `#results-grid`, the application prevents Cross-Site Scripting (XSS) vulnerabilities. Instead of directly injecting user-generated titles or external API strings into `innerHTML`, it creates a safe memory element (`document.createElement('div')`), sets the `textContent` (which automatically sanitizes HTML tags), and then injects the sanitized string (`safeTitle.innerHTML`) into the DOM.

### Dynamic Media Loading

For items retrieved from the Supabase database that lack direct image URLs, `renderQdrantResults()` immediately injects a placeholder image into the DOM. It then triggers `fetchDynamicPoster()`, which hits the TMDB API in the background, locates the correct image path, and swaps the `src` attribute of the image element once the data returns.