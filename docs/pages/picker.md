# Catalogd: Random Decider Page Documentation

The Random Decider page functions as a personalized media recommendation engine designed to combat decision paralysis. By leveraging user data, external APIs, and algorithmic filtering, it randomly selects a single piece of media tailored to the user's specific parameters, such as media type, source pool, and streaming availability.

## Core Technologies & Integrations

The Random Decider relies on a blend of client-side randomization and backend data aggregation:

* **Supabase:** Authenticates the user and queries their `media_logs`, `user_watchlist`, `media_lists`, and `profiles` to build personalized candidate pools.


* **TMDB API:** Supplies candidate pools for movies, TV shows, and anime, while providing crucial `watch/providers` data to filter out inaccessible titles.


* **OpenLibrary & Last.fm APIs:** Used to fetch fallback or list-specific candidates for books and music.


* **Vanilla JavaScript:** Executes the randomization logic, array shuffling, and sequential API fetching required to validate winners.



## Initialization & User State

When `initPicker()` executes, the application establishes the user's authentication state via `setupHeaderAndUser()`. If the user is authenticated, the script queries the `profiles` table to cache their `services.streaming` array into a global variable (`userStreamingProviderIds`). This ensures the algorithm knows exactly which platforms (e.g., Netflix, Hulu) the user subscribes to.

If the user is not authenticated, the personalized dropdown options (Watchlist, Re-watch Radar, Specific List) are restricted, and the engine defaults to pulling from a general "Trending" pool.

## Candidate Pool Generation (The "Sources")

The application builds an array of candidate IDs (`poolIds`) based on the user's selection in the `#source-select` dropdown.

### 1. Taste Profile (For You)

If the user selects "Taste Profile", `getTastePool()` queries the user's `media_logs` for items rated 4 stars or higher. It fetches the TMDB metadata for these highly-rated items to tally the most frequent genres. The top three genres are then passed to the TMDB Discover API to pull three pages of relevant results, constructing a large pool of tailored candidates. (If the user is logged out, this defaults to TMDB's weekly trending list).

### 2. Re-watch Radar

The `getRewatchPool()` function queries the user's `media_logs` to find items they rated 4 stars or higher. It then applies a date filter, isolating items where the `watched_on` or `created_at` date occurred more than one year (365 days) ago.

### 3. Watchlists & Specific Lists

For these sources, the application directly queries Supabase.

* If "Specific List" is chosen, `handleSourceChange()` triggers an immediate lookup of the user's owned and collaborative lists. To prevent dead-ends, it filters the dropdown to only display lists that actually contain the requested media type.



### Anime Handling

Because TMDB does not have a dedicated "Anime" media type, the application routes anime requests as `tv` items. It applies client-side filtering via `isAnime()` to ensure the item possesses both the "Animation" genre (ID: 16) and a Japanese country of origin ('JP' or 'ja').

## The "Roll the Dice" Execution Pipeline

When the user clicks the "Roll the Dice" button, `pickRandom()` executes the core algorithm:

1. **Deduplication & Shuffling:** The `poolIds` array is deduplicated using a `Set` and then aggressively randomized using a standard Fisher-Yates shuffle algorithm (`shuffleArray()`).


2. **Sequential Validation:** The script enters a `for` loop, iterating through the shuffled IDs one by one. It fetches the full details for the current ID (including `watch/providers`).


3. **Provider Verification:** If the "Only pick titles available on my preferred services" checkbox is ticked, the script cross-references the item's streaming availability (flatrate, free, or ads) against the user's cached `userStreamingProviderIds`.


4. **Winner Declaration:** Because the array is already shuffled, the *very first* item in the loop that passes the provider check is declared the winner. The `break` statement halts the loop immediately, preventing unnecessary API calls.



## UI Rendering & Responsiveness

Once a winner is found, `renderWinner()` populates the `#result-container` (the `.winner-card`).

* The card dynamically generates `.genre-pill` elements and injects the top 5 available streaming provider logos so the user knows exactly where to watch it.


* Action buttons allow the user to view the item's full Details page, immediately mark it as "Currently Watching" (which upserts to `media_status` and removes it from their watchlist), or "Re-roll" to run the algorithm again.



The CSS (`picker.css`) utilizes a visually distinct "Glassmorphism" aesthetic for the result card, applying `backdrop-filter: blur(25px)` and a glowing accent border (`box-shadow: 0 15px 40px var(--accent-glow)`). On mobile devices (max-width: 768px), the flex direction of the `.winner-card` changes to `column`, centering the poster above the text and action buttons to maintain readability.