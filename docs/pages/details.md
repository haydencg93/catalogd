# Catalogd: Details Page Documentation

The Details page serves as the central hub for interacting with a specific piece of media in the Catalogd application. It dynamically adapts its layout, data sources, and interactive components based on the `type` of media requested (movie, TV show, book, album, or YouTube video) via URL parameters.

## Core Technologies & APIs

The page aggregates data from multiple third-party APIs and a proprietary backend to construct a unified interface:

* **TMDB API (via Proxy):** Fetches core metadata, watch providers, translations, and cast/crew for movies and TV shows.


* **OpenLibrary API:** Retrieves book metadata, page counts, and author information.


* **Last.fm API:** Sources album tracklists, cover art, and artist biographies.


* **YouTube oEmbed API:** Retrieves metadata and thumbnail data for YouTube video links.


* **TVMaze API:** Acts as a supplementary data source for TV shows, filling in missing episode summaries and thumbnail images by cross-referencing TMDB/IMDB IDs.


* **Supabase (BaaS):** Handles all user state, including logs (`media_logs`), statuses (`media_status`), custom artwork (`custom_imgs`), friend reviews, and AI recommendations.



## Initialization and Routing Logic

When the page loads, `details.js` extracts the `id` and `type` from the URL query string using `URLSearchParams`. The `initDetails()` function acts as a master router, executing completely different fetch pipelines based on the media type:

```javascript
// Example routing logic from initDetails()
if (type === 'youtube') {
    // Fetch via YouTube oEmbed
} else if (type === 'album') {
    // Parse composite ID and fetch via Last.fm
    const [artistName, albumName] = decodedId.split('|||');
} else if (type === 'book') {
    // Fetch via OpenLibrary JSON endpoints
} else {
    // Standard TMDB fetch for movies and TV
}

```

This routing not only dictates the data fetched but drastically alters the DOM structure. For example, if the type is `youtube`, the static poster image is replaced with a responsive YouTube `<iframe>`. If the type is `album`, the standard TV tracker is repurposed into a music Tracklist.

## Media-Specific Features & Tracking

### TV Shows & Anime Filler

For TV shows, the application renders an interactive Episode Tracker. It populates a dropdown with available seasons and dynamically generates a grid of checkboxes for each episode. As users check off episodes, progress is saved to the `episode_logs` table in Supabase, and a visual progress bar updates accordingly.

If the TMDB keywords indicate the TV show is an "Anime", the application queries a custom Supabase table (`filler_list_mgnt`). This integrates with a backend web scraper to pull data from AnimeFillerList.com, allowing users to view a modal that categorizes episodes into "Canon", "Mixed", or "Filler".

### Books

The book interface replaces streaming providers with links to libraries (WorldCat, OverDrive) and retailers (ThriftBooks, Amazon). It includes a reading progress tracker that allows users to log their current page. Because OpenLibrary page counts can be inaccurate, users can toggle a "Manual page count" preference, which saves their custom page total to the `book_progress_preferences` table.

## User Interaction and Social Features

* **Logging and History:** Users can log their interactions (e.g., watched, read, listened) which populate the "Your Logs" section. The application fetches friend activity by querying the `follows` table to find the user's network, then querying `media_logs` to display reviews from those specific friends.


* **Status Management:** Users can assign a status (e.g., "Currently Watching", "Paused", "Dropped") via a modal. This data is upserted into the `media_status` table.


* **Favorites:** The application allows users to pin media to five distinct favorite slots per media type. Clicking the heart icon opens a modal to add or replace items within the user's `profiles` JSON payload.


* **Custom Artwork:** Authenticated users can override the default API posters and backdrops by providing direct image URLs, saving the preferences to the `custom_imgs` table.



## AI Recommendations (Taste Graph)

The "If You Liked This..." section utilizes a Supabase Edge Function (`/functions/v1/get-recommendations`) to generate mathematically similar media suggestions. The client sends the current media ID to the vector database, which returns an array of visually rich recommendations complete with a "Match Percentage". To ensure the recommendation engine is aware of the current item, `checkAndQueueMedia()` silently checks if the item exists in the `global_movies` table; if absent, it upserts the metadata so a nightly background process can generate its machine learning embeddings.

## Responsive Layout Architecture

The interface utilizes CSS Grid (`.details-container`) to manage a two-column layout on desktop displays. To handle mobile screens (under `768px`), the CSS applies a structural override:

```css
@media (max-width: 768px) {
    #left-col, .info-pane {
        display: contents !important;
    }
}

```

By setting `display: contents` on the primary column wrappers, the CSS dissolves the parent containers. This allows all child elements (the title, poster, overview, trackers) to become direct siblings within the master grid, enabling granular repositioning via `grid-row` properties so elements stack logically on small screens.