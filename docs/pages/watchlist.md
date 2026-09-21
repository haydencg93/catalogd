# Catalogd: Watchlist Page Documentation

The Watchlist page operates as a dedicated dashboard for users to review media they've flagged for future consumption. It aggregates data spanning multiple APIs into a unified, filterable grid.

## Core Technologies & Integrations

The Watchlist functions primarily through a combination of asynchronous API calls and local client-side state management:

* **Supabase:** Serves as the primary data store, querying the `user_watchlist`, `profiles`, and `custom_imgs` tables.


* **External Media APIs:** To render the visual grid, the application queries TMDB (movies/TV), OpenLibrary (books), Last.fm (music), and YouTube oEmbed (videos) to hydrate basic database records with full poster images and titles.



## Initialization & View Context

When the page initializes via `initWatchlist()`, it parses the URL to determine whether the user is viewing their own watchlist or visiting another profile.

* **ID Resolution:** It checks for an `id` query parameter. If none is found, it defaults to the authenticated user's ID.


* **Visitor View Handling:** If the active user is not the profile owner (`isViewerOwner` is false), the script queries the `profiles` table to retrieve the owner's `display_name`. It dynamically updates the `<h1>` tag (e.g., "Justin's Watchlist") and injects a "Back to Profile" navigation button into the header.



The application then fetches every record assigned to the target user in the `user_watchlist` table, sorting them by `created_at` in descending order so the most recently added items appear first.

## Client-Side Pagination & Filtering

Because users often accumulate hundreds of items in their watchlists, rendering them all simultaneously would bottleneck the browser due to the sheer volume of asynchronous API calls required to fetch poster images. To solve this, Catalogd employs strict client-side pagination (`WATCHLIST_PAGE_SIZE = 50`).

When the user clicks a filter button (e.g., "Movies", "Books"), `filterWatchlist()` executes:

1. **Array Filtering:** It filters the master `allWatchlistItems` array down to the selected media type.


2. **Pagination Calculation:** It calculates the `totalPages` and slices the filtered array (`filtered.slice(startIndex, endIndex)`) to extract only the 50 items needed for the current page.


3. **UI Updates:** The script updates the `#watchlist-subtitle` to reflect the *total* number of filtered items (not just the 50 on the screen). It then renders the `#watchlist-pagination` container, generating "Previous" and "Next" buttons if the total exceeds the page size. Clicking these buttons increments or decrements the `currentWatchlistPage` integer, re-renders the grid, and smoothly scrolls the user back to the top of the page.



## Media Hydration & Rendering

The `renderWatchlist()` function iterates through the paginated slice of items. For each item, it uses a `try/catch` block to securely fetch the metadata from the appropriate external API based on the `media_type`.

* If the fetch succeeds, it extracts the title and constructs the image URL (e.g., `[https://image.tmdb.org/t/p/w500/](https://image.tmdb.org/t/p/w500/)...`).


* If the fetch fails, it provides a safe fallback using the Placehold.co API.


* Before returning the object, it cross-references the `customImgsMap` (populated during initialization) to see if the user uploaded custom artwork for that specific item, overriding the API poster if a match is found.



The fully hydrated items are mapped into `.media-card` HTML strings and injected into the CSS Grid. Each card includes an `onclick` listener that routes the user to the item's Details page.

## Responsive CSS Architecture

The `watchlist.css` file extends the base styling from the Profile page while applying specific layout tweaks.

On desktop devices, the `.media-card` components utilize a `2/3` aspect ratio and feature a hover effect that slightly translates the card upward (`transform: translateY(-5px)`) while projecting a soft, green box shadow to match Catalogd's accent theme.

To optimize the layout for mobile devices (screens under 768px), media queries apply several structural overrides:

* **Header Alignment:** The `<h1>` title and subtitle switch to `text-align: center`. The `.filter-nav` container adopts `flex-wrap: wrap` to ensure the category buttons stack neatly instead of overflowing the screen.


* **Grid Density:** To maximize vertical screen real estate, the `#watchlist-grid` is forced into a dense 4-column layout (`grid-template-columns: repeat(4, 1fr) !important`). This ensures users can scan their watchlist efficiently without excessive scrolling.