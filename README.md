# Catalogd

Catalogd is a unified, comprehensive media tracking platform designed to cure decision paralysis and consolidate your digital footprint. Instead of scattering your logs across Letterboxd (Movies), Goodreads (Books), Trakt (TV), and Last.fm (Music), Catalogd centralizes your consumption history into a single, interconnected ecosystem powered by machine learning, API integrations, and highly customizable curation tools.

## How to Navigate & Use Catalogd

Catalogd is designed to be as deep as you want it to be. Whether you are casually logging a weekend movie or meticulously tracking every chapter of a novel and generating AI-driven vibe boards, this guide will show you how to extract the maximum value from the platform safely and effectively.

### 1. Getting the Most Out of Catalogd

The platform thrives on data density. To get the most accurate AI recommendations ("For You") and the most visually appealing Statistics dashboard, you should strive to log consistently.

* **Rate Honestly:** Catalogd supports half-star ratings. Use the full spectrum (0.5 to 5.0). The recommendation engine heavily weights 4.0+ star ratings to determine your "Vibe."
* **Connect Your Services:** Navigate to your **Settings** and select the streaming services you actively subscribe to. This allows Catalogd to filter recommendations and the "Random Decider" so it only suggests media you can actually watch without renting or buying.
* **Consolidate Your History:** Use the advanced CSV import tools to bring in your historical data from Letterboxd and Last.fm so your Catalogd diary reflects your true all-time consumption.

### 2. Feature Guide: Using the Ecosystem

Catalogd features a modular design where different media types unlock different capabilities.

#### Logging & Tracking

* **Movies & YouTube:** Logged as single entities. YouTube entries require you to manually input the runtime since the API cannot fetch it.
* **TV Shows:** You can log an *Entire Series*, a *Specific Season*, or a *Specific Episode*. **Warning:** Only "Entire Series" logs will count toward your overarching profile statistics (total shows watched). Use the Episode Tracker on a TV show's details page to check off episodes as you watch them.
* **Books:** You can log an *Entire Book*, a *Specific Chapter*, or a *Specific Page*. OpenLibrary page counts can occasionally be inaccurate; if you notice a discrepancy, toggle the "Manual page count" switch on the book's details page to override the official count.
* **Music:** Sync your Last.fm account in settings to bulk-import your scrobbles, or manually log *Entire Albums* and *Specific Tracks*.

#### Curation & Lists

* **Tier Lists:** When creating a new list, toggle "Tiered List." This allows you to rank media into S, A, B, C, D, F, and NS (Not Sorted) categories with customizable hex colors for each tier row.
* **Custom Cards:** Can't find a niche YouTube video or an indie zine in the search engine? Click "+ Custom Card" inside any of your lists to upload your own image, title, and media type.
* **Collaborative Lists:** As a list owner, click "Collaborators" and type a friend's username to grant them edit access. They will be able to add, remove, and reorder items on your list.

#### Discovery & Fandoms

* **Random Decider:** Accessible from the home page, this tool cures decision paralysis by randomly selecting a piece of media from your Watchlist, your Re-Watch Radar (highly-rated items you haven't seen in over a year), your AI-generated Taste Profile, or your lists.
* **Fandoms Hub:** Clicking the "Explore Fandom Wiki" button on a movie or tv show page merges TMDB cast data with Wikipedia plot summaries. Between the fandom and media page, you are able to follow movie and tv show fandom hubs, Official Collection (official lists the movie/tv show is a part of) pages, characters, people (actors, and crew members, authors, and musical artists) to have them pinned on your profile page.


### 3. Tips and Tricks

* **Custom Artwork Overrides:** Dislike the official movie poster or book cover? Click "Edit Art" on any details or fandom page. You can paste a direct URL to a custom image, which will permanently override the default artwork across your entire Catalogd experience.
* **Filler Episode Bypassing:** When viewing an Anime, Catalogd presents a filler list from AnimeFillerList.com if already scraped. Click "View Filler Episodes" to see a complete breakdown of Canon, Mixed, and Filler episodes so you know what to skip. If a filler list doesn't exist, you may request our scraper to find it or paste the direct URL to the AnimeFillerList.com link of the Anime you are wanting.
* **Advanced Search:** The Advanced Search isn't just for genres. You can search the proprietary Catalogd database for specific *fictional characters* (e.g., "Luke Skywalker") or highly specific themes/tropes (e.g., "Cyberpunk", "Zombies") and cross-reference them against runtimes and streaming availability.
* **The ML Vibe Engine:** Your profile dynamically generates a "Vibe" box with background imagery matching your current top genre and theme. If you want to change your vibe, log a few highly-rated items in a different genre and click the refresh button on your Stats page.

### 4. Safety, Privacy, and Public Data

Catalogd is a social platform, meaning certain actions are broadcasted. It is highly recommended that you review your **Privacy Settings** to understand your digital footprint.

**What is PUBLIC by default:**

* Your display name, username, bio, and social media links.
* Your Diary (Media Logs), including your star ratings, dates watched, and written reviews.
    * Option to be private is coming soon.
* Your "Currently Watching/Reading" active, Paused, and Dropped statuses.
    * Option for private exists.
* Your public Lists, followed Fandoms, and tracked Characters.
    * Option for private exists.
* Your Favorites and overarching profile statistics.

**What is PRIVATE by default:**

* Your custom Tags. Only you can view your tag cloud and the logs associated with them.
    * Option to be public is coming soon.
* Lists toggled to "Private" during creation or editing.
* Your account email and password.

**Privacy Controls:**
If you prefer to use Catalogd as a solitary tracker, navigate to **Settings > Privacy**. Here, you can completely hide your Active Status, Paused/Dropped items, Followed Fandoms, and Tracked People from your public profile.

**Account Deletion:**
Located in the "Danger Zone" of your Settings, account deletion is permanent and immediate. It will wipe your authentication record, custom images, lists, and logs. It is highly recommended that you use the "Full Account Export" tool to download a `.zip` file of your CSV data before proceeding with deletion.

# Catalogd Architecture & Pipeline Documentation

This section provides a technical breakdown of Catalogd's background architecture. The application uses a hybrid architecture: the client interacts with Supabase and proxy endpoints for real-time browsing, while asynchronous Node.js background workers handle rate-sensitive operations, machine learning vector generation, screen-scraping, and transactional email queuing.

```
+---------------------------------------------------------------------------------------+
|                                    CLIENT BROWSER                                     |
|  Vanilla JS Modules • Web Components (<app-header>) • Client Auth Token • PapaParse   |
+-------------------+------------------------------+------------------------------------+
                    |                              |
       Direct Reads | & Upserts       API Proxy    | (CORS/Key Masking)
                    v                              v
+-----------------------------+        +-----------------------------------------------+
|      SUPABASE BACKEND       |        |             EXTERNAL API SERVICES             |
|  - PostgreSQL Tables        |        |  - TMDB API (Movies / TV / Cast / Providers)  |
|  - Auth & Admin API         |        |  - OpenLibrary API (Books / Authors)          |
|  - Edge Functions (Vectors) |        |  - Last.fm API (Music / Scrobbles / Albums)   |
|  - Queue Tables             |        |  - YouTube oEmbed API (Metadata)              |
+--------------+--------------+        +-----------------------------------------------+
               |
               | Scheduled Workers / Cron Queues
               v
+---------------------------------------------------------------------------------------+
|                              BACKGROUND WORKER SCRIPTS                                |
|  - process_emails.js   : SMTP Rate-Limit Throttler (2 invites/hr)                     |
|  - index_2.js/scraper  : Cheerio-based AnimeFillerList Scraper                        |
|  - fill_characters.js  : TMDB Batch Cast & Character Ingestion                        |
|  - generate_embeddings : Xenova Transformers -> 384-dim Vectors -> Qdrant DB          |
|  - update_stats.js     : Aggregation Worker (Actor/Director Tallies + Openverse)      |
|  - update_vibes.js     : Visual Vibe Resolver (Openverse OAuth2 + Keyword Overrides)  |
+---------------------------------------------------------------------------------------+

```


## 1. Asynchronous Background Workers

Because serverless frontends and third-party APIs enforce strict rate limits, Catalogd delegates batch and compute-heavy processes to background Node.js worker scripts.

### A. Transactional Email Queue Worker (`process_emails.js`)

* **Purpose**: Manages user signup invites without exceeding transactional SMTP quotas.


* **Mechanism**:
1. Connects to Supabase using `SUPABASE_SERVICE_ROLE_KEY` to access the admin API.


2. Queries the `email_managament` table for rows matching `action = 'invite_scheduled'` and `done = false`, ordered chronologically (`time_stamp_curr` ascending).


3. Limits processing to **2 rows per run** (`.limit(2)`) to respect hourly rate limits.


4. Triggers `supabase.auth.admin.inviteUserByEmail(targetEmail)`.


5. Updates the record with `done = true` and `success = true|false`.





```javascript
// Rate-limited batch processing from process_emails.js
const { data: pendingInvites, error: fetchError } = await supabase
  .from('email_managament')
  .select('*')
  .eq('action', 'invite_scheduled')
  .eq('done', false)
  .order('time_stamp_curr', { ascending: true })
  .limit(2);

```

### B. Anime Filler Scraper Worker (`index.js` & `scraper.js`)

* **Purpose**: Populates the anime canon/mixed/filler episode database on demand.


* **Mechanism**:
1. Inspects CLI arguments (`process.argv[2]`) for single runs, or queries `filler_list_mgnt` for records where `notes IS NULL`.


2. The scraper (`scraper.js`) queries [https://www.animefillerlist.com/shows/](https://www.animefillerlist.com/shows/)${slug} using `axios` and parses the DOM using `cheerio`.


3. Uses a fallback cascade:
* Tries `manualSlug` if submitted by a user through the client modal.


* Tries the raw database slug.


* Tries the slugified variant via `slugify()`.




4. Extracts `.EpisodeList tr` elements, parsing columns: `td.Number`, `td.Title a`, and `td.Type span`.


5. Upserts the structured JSON array into `filler_list_mgnt.filler_content` and marks `notes = 'Successfully scraped'`.





```javascript
// Cheerio parsing from scraper.js
$('table.EpisodeList tr').each((i, el) => {
    const number = $(el).find('td.Number').text().trim();
    const title = $(el).find('td.Title a').text().trim();
    const type = $(el).find('td.Type span').text().trim();
    if (number && title) episodes.push({ number, title, type });
});

```

### C. Character Ingestion Worker (`fill_characters.js`)

* **Purpose**: Enriches Catalogd's internal database (`global_movies`) with cast character rosters to power the Advanced Search "Specific Characters" filter.


* **Mechanism**:
1. Queries `global_movies` in batches of 50 for movies/TV shows where `characters IS NULL`.


2. Queries TMDB endpoints directly using a Bearer token:
* TV Shows: `/3/tv/${id}/aggregate_credits`

* Movies: `/3/movie/${id}/credits`



3. Maps `character` fields (or `roles[0].character` for TV), cleans out empty strings, slices the top 15 actors, and joins them into a comma-delimited string.


4. Updates the `characters` column in `global_movies`.


5. Enforces an explicit 250ms pause between items (`await delay(250)`) to maintain an external request rate of 4 requests/sec, well below API thresholds.





### D. ML Vector Embedding Pipeline (`generate_embeddings.js`)

* **Purpose**: Generates mathematical vector embeddings from catalog text descriptions, indexing them into Qdrant for semantic search and recommendation matching.


* **Mechanism**:
1. Loads `@xenova/transformers` locally using the `Xenova/all-MiniLM-L6-v2` model (routing downloads through [https://hf-mirror.com](https://hf-mirror.com) to prevent CI rate-limiting).


2. Queries `global_movies` for un-indexed records (`is_embedded = false` and `tags IS NOT NULL`) in batches of 100.


3. Concatenates media context: `mathInputString = ${movie.tags}`, `${movie.characters || ''}`.


4. Computes normalized, mean-pooled 384-dimensional dense vectors.


5. Upserts points into Qdrant collection `'movies'` alongside rich search payloads (`title`, `characters`, `overview`, `media_type`, `popularity`, `release_year`).


6. Updates `global_movies.is_embedded = true`.





```javascript
// Embedding computation and vector upsert
const output = await generateEmbedding(mathInputString, { pooling: 'mean', normalize: true });

await qdrant.upsert('movies', {
    wait: true,
    points: [{
        id: movie.tmdb_id,
        vector: Array.from(output.data),
        payload: {
            title: movie.title,
            characters: movie.characters,
            overview: movie.overview,
            media_type: movie.media_type,
            popularity: movie.popularity,
            release_year: movie.release_year
        }
    }]
});

```

### E. Analytics & Heavy Insights Worker (`update_stats.js`)

* **Purpose**: Offloads heavy client analytics from `stats.html`.


* **Mechanism**:
1. Queries `user_stats` where `needs_update = true`.


2. Fetches the target user's `media_logs` matching the specified `stat_depth` (all-time, year, season) and date period.


3. Interrogates external APIs to build distribution tallies:
* TMDB: Tallies actors from `credits.cast`, directors/executive producers from `credits.crew`, and genres/keywords.


* OpenLibrary: Parses `subjects` into theme tallies.


* Last.fm: Calls `album.gettoptags` to extract musical descriptors.




4. Extracts the top 3 items from each tally.


5. Resolves matching Openverse photography licenses for the top genre and theme.


6. Writes the structured object into `user_stats.heavy_stats` and resets `needs_update = false`.





### F. Vibe Generation Worker (`update_vibes.js`)

* **Purpose**: Generates licensed cover visuals representing a user's recent media taste profile.


* **Mechanism**:
1. Inspects `vibes_control` where `needs_update = true`.


2. Reads mapped tags (e.g., "Sci-Fi", "LGBT", "Coming of Age") and runs them through a translation dictionary (`vibe_overrides.json`) to convert media tags into photographic search terms (e.g., "lgbt" -> "rainbow flag"; "western" -> "desert").


3. Requests an OAuth2 client credentials token from the Openverse API ([https://api.openverse.org/v1/auth_tokens/token/](https://api.openverse.org/v1/auth_tokens/token/)).


4. Queries Openverse:
* Pass 1: Searches commercial photograph collections restricted to CC0 stock sources (`stocksnap`, `rawpixel`).


* Pass 2: Widens the search to the general Openverse pool if Pass 1 yields zero hits.


* Pass 3: Falls back to TMDB movie backdrops if Openverse returns rate limits or empty results.




5. Extracts license metadata, generating attribution text and license links (supporting CC0, PDM, CC BY, and CC BY-SA).


6. Updates `vibes_control` with image URLs and attribution objects.




## 2. External API Reference

| Service | Primary Endpoints Used | Authentication Method | Usage Context |
| --- | --- | --- | --- |
| **TMDB** | `/search/*`, `/discover/*`, `/{type}/{id}`, `/trending/*`, `/watch/providers`, `/aggregate_credits` | Proxy Header / Bearer Token (`TMDB_TOKEN`) | Core metadata, watch providers, credit listings, and cast|
| **OpenLibrary** | `/search.json`, `/authors/{id}.json`, `/works/{id}.json`, `/trending/daily.json` | Public / Anonymous | Book metadata, page counts, author biographies, cover art|
| **Last.fm** | `album.getinfo`, `album.search`, `artist.getinfo`, `tag.gettopalbums`, `album.gettoptags` | Proxy API Key (`LASTFM_KEY`) | Discographies, album tracks, play counts, music genres |
| **YouTube** | [https://www.youtube.com/oembed](https://www.youtube.com/oembed) | Public / Anonymous | Video title resolution, channel attribution, thumbnails|
| **TVMaze** | `/shows/{id}/episodes`, `/lookup/shows`, `/shows/{id}/seasons` | Public / Anonymous | TV episode air dates, episode summaries, guest star lists|
| **Wikipedia** | `/api/rest_v1/page/summary/*`, `/w/api.php?action=parse` | Public / Origin CORS | Character overviews, plot synopses, infobox summaries|
| **Wikidata** | [https://query.wikidata.org/sparql](https://query.wikidata.org/sparql) | Public SPARQL (`Accept: application/json`) | Bridges TMDB/TVDB IDs to canonical Wikipedia article titles|
| **TheTVDB** | `/v4/lists/{id}/extended`, `/v4/movies/{id}/extended`, `/v4/series/{id}/extended` | Proxy Header / API Token | Franchise sagas, universe groupings, collection lists|
| **Openverse** | `/v1/auth_tokens/token/`, `/v1/images/` | OAuth2 Bearer Token (`OPENVERSE_CLIENT_ID`) | Curated CC0 and Creative Commons background imagery for Vibes|
| **Qdrant** | Collection `movies` (`/collections/movies/points`) | API Key (`QDRANT_API_KEY`) | Stores vector points and serves Edge Function vector search|

# Catalogd Database & CI/CD Documentation

This final section outlines the structural foundation of Catalogd. It details the PostgreSQL database schema hosted on Supabase and the automated GitHub Actions workflows that orchestrate the background workers, ensuring the platform remains continuously updated, fast, and secure.

## 1. Database Schema Architecture

Catalogd relies on a heavily relational PostgreSQL database via Supabase to maintain data integrity across users, media logs, and background queues. The schema is categorized into four primary domains:

### Core User & Tracking Data

* **`profiles`**: The central user table, linked to Supabase Auth (`auth.users`), storing display names, bios, custom social links, and privacy preferences. It also houses JSONB payloads for customized favorites and streaming service selections.


* **`media_logs`**: The core diary table. It stores all user interactions (movies, TV, books, albums, YouTube) alongside ratings, textual notes, watch dates, and custom tags. It includes specific tracking columns like `current_page`, `chapter_number`, and `ep_count_in_season` to handle distinct media types gracefully.


* **`episode_logs`**: A highly granular tracking table specifically for checking off individual TV episodes, mapped by `series_id`, `season_number`, and `episode_number`.


* **`media_status`**: Tracks active consumption states using strict constraints: `active`, `completed`, `dropped`, or `paused`.


* **`user_watchlist`**: A lightweight table storing items flagged for future consumption.



### Social & Curation Ecosystem

* **`follows`**: Maps follower/following relationships between user `profiles`.


* **`media_lists`**: The parent table for custom collections. It contains flags for list configuration (`is_ranked`, `is_tiered`, `is_public`) and stores custom hex codes in the `tier_colors` JSONB column.


* **`list_items`**: Maps individual media items to a `list_id`. It handles sorting via the `rank` integer and categorizes tiered lists via the `tier_rank` string. It also supports fully custom items via the `is_custom` flag.


* **`list_collaborators`**: A junction table that links secondary users to a `list_id`, granting them edit permissions.



### Fandom & Personalization

* **`user_fandoms` & `user_characters`**: Stores the user's followed franchise collections and fictional characters/actors, complete with manual ranking integers.


* **`custom_imgs`**: Stores direct URLs for custom posters and backgrounds, keyed to a unique combination of `user_id`, `media_id`, and `media_type`.


* **`book_progress_preferences`**: Saves individual user preferences (like manual page count overrides) for specific books.



### Background Worker Queues

* **`global_movies`**: A cached registry of TMDB and OpenLibrary items used specifically by the machine learning pipeline, tracking whether an item has been successfully embedded (`is_embedded`).


* **`user_stats` & `vibes_control`**: Queue tables for heavy background processing. When a user requests updated analytics or vibe artwork, the `needs_update` boolean is flagged, alerting the background workers to process the row.


* **`filler_list_mgnt`**: Tracks anime titles and their scraped canon/filler status.


* **`email_managament`**: A rate-limiting queue that safely manages transactional email invites to prevent SMTP threshold breaches.



## 2. GitHub Actions & CI/CD Pipelines

To keep the frontend serverless and snappy, all backend scripts (detailed in Part 2) are executed on strict schedules using GitHub Actions. These workflows provision an `ubuntu-latest` runner, configure Node.js (v22 or v20), install specific dependencies, and inject the necessary API secrets.

### Scheduled Nightly Workers

Catalogd performs its heavy lifting starting at midnight UTC (`0 0 * * *`) via standard cron jobs:

* **Nightly ML Embedding Worker (`nightly-embed.yml`):** Targets the `seederAi` directory. It sequentially executes `fill_characters.js` to enrich media metadata, followed immediately by `generate_embeddings.js` to compute vector points and push them to the Qdrant database.


* **Nightly Vibe Updater (`nightly-vibes.yml`):** Targets the `vibes` directory, running `update_vibes.js` to query the Openverse API and map new background art for users whose tastes have changed.


* **Nightly User Stats Queue (`update-stats.yml`):** Targets the `statsWorker` directory, running `update_stats.js` to aggregate heavy analytical data (like top actors and directors) for user profiles.


* **Anime Filler Scraper (`scrape-anime.yml`):** Targets the `animeFillerListApi` directory, running `index.js` to scrape new episode data. Notably, this workflow also features a `workflow_dispatch` trigger, allowing administrators to manually trigger a scrape for a specific anime by providing an `anime_name` input directly from the GitHub UI.



### Hourly Queues

* **Hourly Email Queue Worker (`hourly-emails.yml`):** Runs at the 19th minute of every hour (`19 * * * *`). It targets the `emailWorker` directory and runs `process_emails.js`. By running hourly, it safely clears the invite backlog without tripping Supabase's strict 2-emails-per-hour SMTP limit.



### Continuous Deployment (Beta Sync)

* **Sync Test Branch to Beta (`sync-beta.yml`):** This workflow automates Catalogd's beta deployment process. It is triggered whenever code is pushed to the `test` branch.


* **Mechanism:** It checks out the `test` branch, then clones a separate, remote repository named `catalogd-beta` using a secure Personal Access Token (`BETA_TOKEN`).


* **Sanitization:** Because the beta repository acts as a pure frontend host (e.g., via GitHub Pages), the workflow uses `rsync` and `rm -rf` to aggressively strip out all backend worker directories (`animeFillerListApi`, `emailWorker`, `seederAi`, `statsWorker`, `vibes`) and their associated workflow `.yml` files.


* **Deployment:** It commits the clean, sanitized codebase and pushes it to the `main` branch of the `catalogd-beta` repository, automating and creating a GitHub Pages environment for the testing of Catalogd before being merged into the main branch of `catalogd`.



## 3. Developer Environment Setup

If you wish to fork or contribute to Catalogd, you must configure a robust environment of API keys. The background workers rely on a `.env` file (typically stored in a `misc/` directory) or GitHub Repository Secrets.

**Required Secrets:**

* `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: Required for admin-level database overrides.


* `TMDB_TOKEN`: A Bearer token for accessing The Movie Database endpoints.


* `LASTFM_KEY`: API Key for Last.fm track and tag lookups.


* `QDRANT_URL` and `QDRANT_API_KEY`: Required for the machine learning vector database.


* `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET`: Required for the OAuth2 client credentials grant to fetch commercial-free imagery.



To run the workers locally, simply navigate to their respective directories, run `npm install`, and execute them via `node <filename>.js` to process your local or remote queues.