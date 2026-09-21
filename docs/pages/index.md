# Catalogd: Index (Home) Page Documentation

The Index page (`index.html`) serves as the primary entry point and central discovery hub for the Catalogd application. It provides users with a multi-faceted search engine, dynamic "For You" recommendations, trending media feeds, and access to the authentication flow. The page is designed to be highly responsive, featuring a "liquid glass" cinematic aesthetic and robust client-side routing to handle complex searches and tab switching seamlessly.

## Core Technologies & Integrations

The Index page orchestrates multiple external APIs alongside a proprietary backend to deliver a unified media experience:

* **Supabase (BaaS):** Manages user authentication (Sign Up, Sign In, Password Reset), email confirmation hashing, rate-limiting logic, and queries user logs (`media_logs`) to calculate "For You" recommendations.


* **TMDB API (via Proxy):** Sources trending movies and TV shows, and powers the search engine for standard media types and cast/crew.


* **OpenLibrary API:** Fetches trending books and executes book and author search queries.


* **Last.fm API:** Provides trending albums and executes music search queries.


* **YouTube API (oEmbed & Regex):** Allows users to search for YouTube videos directly by pasting a URL.


* **Vanilla JS & Web Components:** Employs ES6 modules, custom web components (`<app-header>`), and `AbortController` to manage complex asynchronous state without relying on front-end frameworks.



## Initialization & Authentication Flow

When the page loads, `loadConfig()` initiates the setup process. It first triggers `checkEmailConfirmation()` which intercepts the URL hash fragment—a security mechanism used by Supabase to pass session tokens or errors following an email confirmation link.

The application then initializes the `<app-header>` web component and triggers `checkUserStatus()`. If a user is authenticated, the app ensures they are following the official "Catalogd" profile (via `ensureCatalogdFollow()`) and caches their custom artwork (`customImgsMap`) and streaming provider preferences.

### The Authentication Modal

Clicking the login button triggers the `#auth-modal`. The modal dynamically switches between "Sign In" and "Sign Up" modes via `toggleAuthMode()`.

**Sign Up Rate Limiting:** To prevent abuse, Catalogd employs a custom rate-limiting strategy during registration. Before attempting to create a user via Supabase Auth, `performSignUp()` checks the `email_managament` table to count how many successful sign-ups occurred in the last rolling hour. If the count exceeds the limit (e.g., 2 per hour due to default SMTP restrictions), the application intercepts the request, queues the email as an `invite_scheduled` action, and alerts the user that their spot is reserved. If the limit is not met, the standard Supabase Auth flow proceeds.

## The Search Engine

The unified search bar allows users to query across all media types simultaneously or filter by a specific category (Movies, TV, Books, Music, Users, Cast, Authors).

When the user hits "Enter" or types in the box, `unifiedSearch(query)` executes.

1. **Request Cancellation:** To prevent race conditions from rapid typing, `beginContentRequest()` utilizes an `AbortController` to cancel any pending API fetches.


2. **YouTube Detection:** A Regex pattern intercepts the query to check if it's a valid YouTube URL. If matched, it immediately routes the user to the details page for that video.


3. **Parallel Fetching:** The `fetchSearchData()` function fires multiple API requests concurrently using `Promise.all()`. Depending on the selected filter, it may hit TMDB, OpenLibrary, Last.fm, and the Supabase `profiles` table simultaneously.


4. **Sorting & Deduplication:** The combined results are sorted locally via `sortSearchResults()`, prioritizing exact matches and items that start with the query string. Authors and Cast Members are deduplicated using a `Set` to prevent overlapping names from cluttering the grid.



## Dynamic Content Tabs

If the search bar is empty, the page defaults to displaying trending and recommended content based on the active tab (Movie, TV, Book, Music, YouTube).

### Trending Items

The `getTrendingItems(type)` function fetches the daily trending lists from the respective APIs. For books, it attempts to fetch from OpenLibrary's trending endpoint; if that fails (e.g., returns raw HTML instead of JSON), it falls back to a generalized fiction search.

### "For You" Recommendations

For authenticated users on the Movie or TV tabs, the application generates personalized "For You" recommendations.

1. **Vibe Calculation:** `getForYouItems()` queries the user's `media_logs` to find their highest-rated items (4 stars or above). It then fetches the TMDB keyword and genre data for those specific items, assigning weighted scores based on the star rating (e.g., a 5-star rating applies a 5x multiplier to its genres).


2. **Candidate Generation:** The top 3 genres and top 5 keywords are used to generate custom TMDB Discover API URLs.


3. **Provider Filtering:** If the user has configured their streaming services, `evaluateProviderAvailability()` strictly filters the API results to ensure the recommendations are actually available on the platforms the user pays for (or are completely free).



### The "Vibe" Box

Below the search bar, the `.vibe-container` provides a highly stylized, visual representation of the user's current tastes. `calculateAndRenderVibe()` determines the user's top genre and top theme based on their recent high-rated logs. This data is synced to the `vibes_control` table in Supabase, which manages a background queue to generate and assign custom, AI-generated background images for those specific genres/themes.

## Responsive CSS Architecture

The styling (`index.css`) utilizes a dark, cinematic "liquid glass" theme.

* **Animated Backgrounds:** The `body` background utilizes radial gradients and animated, blurred pseudo-elements (`::before`, `::after`) that float continuously (`animation: liquidFloat`) to create a dynamic, glowing aesthetic.


* **Media Cards:** The `.media-card` components utilize CSS Grid for the layout and feature an interactive 3D tilt effect applied via JavaScript `mousemove` listeners on desktop devices. The cards employ specific `aspect-ratio` rules to ensure posters render perfectly regardless of the media type (e.g., Books use `305/500`, Movies use `500/750`).


* **Mobile Adaptability:** When the viewport drops below 768px, media queries reorganize the header flexbox, stack the search bar and its filter dropdown vertically, and wrap the filter navigation buttons (`.filter-btn`) to ensure touch-friendly targets.