# Catalogd: Fandom Page Documentation

The Fandom page acts as an immersive lore and franchise hub within Catalogd, extending beyond standard media tracking to provide comprehensive Wikipedia plot summaries, expansive character rosters, and official franchise collections. By linking proprietary user data with a web of external encyclopedic APIs, it centralizes a media property's expanded universe into a single interface.

## Core Technologies & API Ecosystem

The page leverages a complex pipeline of data fetching and entity resolution to combine fragmented media metadata:

* **Supabase:** Manages user authentication, followed fandoms (`user_fandoms`), followed characters (`user_characters`), and custom user artwork (`custom_imgs`).


* **Wikidata SPARQL Endpoint:** Acts as a Rosetta Stone, mapping internal TMDB/TVDB identifiers to their corresponding Wikipedia article titles.


* **Wikipedia APIs (REST & Action):** The REST API fetches page summaries and thumbnail images, while the Action API parses the article's sections to extract the specific "Plot" or "Synopsis" content.


* **The Movie Database (TMDB):** Provides high-resolution posters, primary titles, and structured cast/character arrays (via `aggregate_credits`).


* **TheTVDB API:** Supplies official franchise collections, universe lists, and saga groupings.



## Initialization & Entity Routing

Upon loading, `fandom.js` extracts the `id`, `type`, and `listId` from the URL parameters. The `initFandomPage()` function routes the data fetching process into two primary pathways: Collections or Standard Media.

### Pathway A: Collections & Franchises

If the URL indicates a collection (e.g., `listId` is present), the application queries TheTVDB for official franchise lists.

* **ID Resolution:** Because TVDB collections often return bare entity "stubs" without images or names, the script fetches the extended TVDB metadata for each item. To ensure users can click these collection items and navigate back to Catalogd's TMDB-based Details pages, `resolveTmdbId()` cross-references each TVDB ID against TMDB's external ID endpoints.


* **Artwork Fallback Handling:** The TVDB API sometimes substitutes a collection's curated artwork with the poster of the first item in the list. The script detects this via the `imageIsFallback` flag; if true, it dynamically requests the TMDB `belongs_to_collection` poster as a higher-quality replacement.



### Pathway B: Standard Media Lore

For individual movies, TV shows, or albums, the application uses a `propertyMap` to match the media type to its Wikidata property (e.g., 'movie' maps to 'P4947').

* **Wikidata Resolution:** The `getWikipediaTitle()` function executes a SPARQL query, passing the property ID and TMDB ID to locate the exact Wikipedia article URL.


* **Plot Extraction & Sanitization:** Once the Wikipedia title is resolved, `fetchWikipediaLore()` pulls the summary and plot. Because the raw Wikipedia HTML includes unwanted interface elements, `scrubWikipediaHeaders()` is applied. This function strips out edit links (`.mw-editsection`), removes unnecessary headers, and rewrites relative `/wiki/` links into absolute `[https://en.wikipedia.org/](https://en.wikipedia.org/)...` URLs so they function correctly inside Catalogd.



## UI Components and User Interactions

The Fandom page offers several interactive layers allowing users to curate their experience:

* **Follow Fandom:** A primary button allows authenticated users to save the current franchise or media universe to their profile, triggering an insert or delete against the `user_fandoms` table.


* **Character Grid:** Extracted from TMDB credits, characters are rendered in a responsive grid. Users can click a character card to route to their dedicated Cast page, or click the internal "Follow" button to save the character to their `user_characters` roster.


* **Character Modal:** If a media property has more than 24 characters, a "View All Characters" button spawns `#character-modal`. This modal features a client-side text search input and paginates the remaining characters using a "Load More" mechanism.


* **Custom Art Overrides:** Like the Details page, users can override the default TMDB/TVDB posters. The `setupFandomCustomArt()` function injects a hidden modal (`#fandom-custom-art-modal`) into the DOM, allowing users to paste custom image URLs that are stored in Supabase.



## Responsive CSS Architecture

The interface utilizes CSS Grid and Flexbox for desktop viewing, separated into a left column (`#left-col`) for artwork and an info pane (`.info-pane`) for encyclopedic text.

To optimize the layout for mobile devices (screens under 768px), `fandom.css` employs a structural CSS override:

1. **Container Dissolution:** It applies `display: contents !important` to both `#left-col` and `.info-pane`. This visually deletes the column wrappers, dropping all inner elements (titles, posters, plot sections) directly into the parent flex container.


2. **Explicit Ordering:** The CSS uses the `order` property to strictly orchestrate the vertical stacking order of these newly freed elements. The title is forced to the top (`order: 1`), followed by the meta tags (`order: 2`), the poster and action buttons (`order: 3`), and finally the heavy text descriptions and character grids (`order: 5`).


3. **Content Wrapping:** Wikipedia tables are forced to `width: 100% !important` to prevent horizontal overflow, and character names in the grid are given `word-wrap: break-word` and `white-space: normal` to ensure long fictional names wrap cleanly on small screens.