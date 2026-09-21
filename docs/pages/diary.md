# Catalogd: Diary Page Documentation

The Diary page serves as a comprehensive, sortable ledger of a user’s media consumption history across movies, television, books, music, and YouTube videos. It operates as both a personal dashboard for the logged-in user and a public-facing portfolio when visiting another user's profile.

## Technologies & Core Integrations

The Diary relies on a hybrid data fetching approach, combining local backend data with live third-party API enrichment:

* **Supabase:** Serves as the primary backend, authenticating the user and querying the `media_logs`, `profiles`, and `custom_imgs` tables.


* **The Movie Database (TMDB):** Enriches movie and TV log entries with official titles, release years, and poster images via a secure proxy.


* **OpenLibrary API:** Provides metadata and cover art for book entries using normalized library IDs.


* **Last.fm API:** Supplies album covers, release years, and tracklists for music entries.


* **YouTube oEmbed API:** Retrieves video titles and thumbnails for logged YouTube links.


* **Vanilla JavaScript & CSS:** Manages client-side pagination, complex array sorting, and responsive layout shifting without heavy frontend frameworks.



## Initialization & View Modes

When the page initializes via `initDiary()`, it determines the context of the visit by checking for an `id` query parameter in the URL.

* **Owner View:** If no ID is present, or the ID matches the authenticated session, the page loads the user's own diary. This grants full access to edit and delete actions, as well as personal tags.


* **Visitor View:** If a different user's ID is detected, the application fetches that user's `display_name` from the `profiles` table to update the page title (e.g., "Justin's Diary"). It dynamically injects a `<style>` block to hide the action/tag columns and prepends a "Back to Profile" navigation button to the header.



## Data Pipeline & Rendering

Instead of storing massive amounts of redundant metadata in the database, Catalogd logs only the essential identifiers (e.g., `media_id`, `media_type`, `watched_on`, `rating`).

When rendering the diary table, the `fetchAndFormatRow()` function iterates through the logs and fires asynchronous requests to the appropriate external API (TMDB, OpenLibrary, etc.) to hydrate the row with fresh posters and release years. Before applying the external poster, the script checks a pre-loaded `customImgsMap` to see if the user has uploaded custom artwork for that specific media item, overriding the default image if a match is found.

The row is then constructed to display badges for "Liked" (❤️) and "Rewatch" (🔁) statuses, alongside a clickable review icon (📝) that triggers a modal containing the user's detailed notes.

## Sorting, Filtering & Pagination

To ensure high performance, the Diary loads items in chunks of 10 (`PAGE_SIZE = 10`). All filtering and sorting operations are handled on the client side:

* **Dynamic Filters:** The application parses the complete `allLogs` array to dynamically generate the "Year" and "Tag" dropdown filters. Release years are grouped by decades and specific years to keep the dropdown organized.


* **Multi-Faceted Search:** The `applyFilters()` function evaluates every log against the active text search, rating, year, liked status, review status, rewatch status, and tags.


* **Complex Sorting:** Clicking a table header triggers `applyCurrentSort()`, which organizes the array by Date, Name, Release Year, or Rating. If two items tie (e.g., both given 5 stars), the script applies a secondary fallback sort based on the date the item was logged (`watched_on` or `created_at`).



## Dynamic Statistics

Above the diary table, a `.diary-stats` flex container displays real-time analytics based on the currently filtered view. As the user adjusts filters, `updateStatsDisplay()` recalculates the total logs, average rating, and counts for each media type. To accurately calculate the "Total Songs" listened to, the script asynchronously queries the Last.fm API to count the tracks on each full album logged, caching the results in `albumTrackCache` to prevent redundant API calls during subsequent filter changes.

## Responsive CSS Architecture

The Diary employs an advanced CSS technique to maintain readability on mobile devices. When the screen width drops below 768px, the standard HTML `<table>` layout is dismantled.

The CSS hides the `<thead>` and forces the `<tr>` elements to behave as CSS Grid containers (`display: grid`). Using `grid-template-areas`, it remaps individual `<td>` cells into a compact card layout. For example, the poster image spans the left side of the card, while the title, date, rating, and actions stack neatly on the right. This entirely circumvents the horizontal scrolling issues typical of HTML tables on mobile devices.