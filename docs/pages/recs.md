# Catalogd: ML Reccommendations Page Documentation

The ML Recommendations page functions as a personalized "Taste Engine," allowing users to manually construct a cluster of preferred media and receive mathematically calculated recommendations in return. It leverages Catalogd's proprietary Vector Search engine deployed on Supabase Edge Functions.

## Core Technologies & Ecosystem

The recommendation pipeline integrates several tools to translate user input into actionable outputs:

* **Supabase Edge Functions:** Houses the core ML logic (`/functions/v1/get-recommendations`), performing vector-based nearest-neighbor searches against Catalogd's machine-learning embedded database (`global_movies`).


* **TMDB & OpenLibrary APIs:** Used to drive the live search bar, allowing users to find and select their "Vibe Inputs". These APIs are also queried post-calculation to retrieve the `watch/providers` and high-resolution posters for the resulting matches.


* **Vanilla JS Debouncing:** Protects the search APIs from rate-limiting during rapid user typing.



## Constructing the Vibe (Inputs)

Users begin by searching for media they enjoy using the `#rec-search-input` field.

1. **Live Search:** Typing triggers a debounced `setupLiveSearch()` function. It fires three concurrent `Promise.all` requests to TMDB (Movies), TMDB (TV), and OpenLibrary (Books).


2. **Dropdown Rendering:** The results are sliced to show a maximum of 3 items per category and appended to the `#rec-search-results` dropdown.


3. **State Management:** Clicking an item adds it to the `favoriteInputs` global array. The `addVibeInput()` function strictly limits the array to 5 items to prevent the algorithm from losing focus and deduplicates identical entries using a calculated `universalId`.


4. **UI Updates:** Selected items render as `.vibe-tag` pills in the `#active-inputs-container`.



## Configuring Outputs & Execution

Before generating results, users check the target media types (Movies, TV Shows, Books) and toggle the "Only show matches on my Streaming Services" constraint.

Clicking "Generate Recommendations" locks the button and executes a `POST` request to the Supabase Edge Function.

* **Payload Construction:** The client maps the `favoriteInputs` array into a flat array of `universalId` integers (which the ML pipeline requires) and passes the selected `desiredOutputs`.


* **Edge Function Response:** The Edge Function computes the vector similarities and returns an array of media objects, each tagged with a `match_percentage`.



## Intelligent Rendering & Provider Filtering

Upon receiving the recommendations array, `renderRecommendations()` executes a loop to display the results. If the user toggled the streaming filter, the application performs real-time validation before rendering:

1. **Provider Checking:** The script fetches the detailed TMDB payload (with `append_to_response=watch/providers`) for each item. It aggregates the `flatrate` (subscription), `free`, and `ads` arrays.


2. **Intersection Analysis:** It checks if there is any intersection between the item's available platforms and the user's cached `userStreamingServices` array. If the item is only available on platforms the user does not subscribe to, the script `continue`s to the next item, completely skipping the rendering phase.


3. **Result Layout:** Approved items are injected into the `#results-grid` as `.rec-horizontal-card` elements. These cards feature a high-resolution poster, the calculated Match Percentage, and a truncated 130-character text overview.



## Responsive CSS Architecture

The page employs a CSS Grid layout for both the builder panel and the results grid.

* **The Engine Builder:** On desktop, the `.engine-builder` uses `grid-template-columns: 1fr 1fr` to present the Input and Output panels side-by-side. On mobile devices (`max-width: 768px`), this collapses to `1fr`, stacking the panels vertically.


* **Horizontal Result Cards:** Unlike standard Catalogd posters, the recommendations use a horizontal layout (`.rec-horizontal-card`) to accommodate the overview text. On mobile devices, the poster width shrinks from 120px to 90px to ensure the text remains readable within the tight viewport.