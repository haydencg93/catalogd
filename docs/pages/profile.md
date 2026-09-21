# Catalogd: Profile Page Documentation

The Profile page acts as the central identity and portfolio hub for a Catalogd user. It aggregates their media logs, active tracking statuses, followed fandoms, and social connections into a comprehensive, multi-tabbed interface. The page dynamically adjusts its layout, features, and visible data based on whether the active user is the profile owner or a visitor.

## Core Technologies & Integrations

The Profile page orchestrates a massive amount of data using a hybrid local/remote fetching strategy:

* **Supabase:** Serves as the backend, querying multiple tables including `profiles`, `media_status`, `user_characters`, `user_fandoms`, `media_logs`, and `follows`.


* **External Media APIs:** TMDB, OpenLibrary, Last.fm, and YouTube oEmbed APIs are used to asynchronously fetch posters, covers, and titles for logged items.


* **Sortable.js:** Loaded via CDN to enable fluid, drag-and-drop reordering of followed people and fandoms.


* **CSS Grid & Flexbox:** Extensively used to manage responsive layouts, stat cards, and dynamic media grids.



## Initialization, Routing & Privacy

When `initProfile()` executes, it checks the URL parameters to determine whose profile to load.

* **ID Resolution:** It looks for a `userId` or `id` parameter. If it only finds a `user` (username) parameter (used for clean shareable links), it queries the `profiles` table to resolve the username into a database ID.


* **Ownership Check:** The script compares the resolved profile ID against the authenticated user's ID to set the `isOwner` boolean.


* **Privacy Enforcement:** The application fetches the target user's profile data, which includes privacy flags like `show_active_status`, `show_paused_dropped_status`, `show_characters`, and `show_fandoms`. If `isOwner` is false and a privacy flag is triggered, the script hides the corresponding section and injects a "This section is private" message into the DOM. The "Tags" tab and "Re-Watch" radar are strictly owner-only and are hidden from visitors by default.



## Profile Header & Social Interactions

The top of the profile renders the user's customized identity.

* **Visuals:** The `.profile-banner` and `.avatar-placeholder` elements are styled using background images. If no avatar exists, it falls back to the UI Avatars API; if that fails, it renders the first letter of their name.


* **Social Links:** The application parses a `socials` JSON object stored in the profile to dynamically append hyperlink icons (Instagram, Last.fm, Letterboxd, etc.) to the `.user-bio-container`.


* **Copy Link:** A small link icon (🔗) is injected next to the username. Clicking it builds a clean URL (`?user=username`) and uses `navigator.clipboard.writeText()` to copy it, providing visual feedback by temporarily changing the icon to a green checkmark (✅).


* **Follow Mechanism:** If viewing another user's profile, a "Follow" button is generated beneath the header, allowing the user to toggle a relationship in the `follows` table. Clicking the "Followers" or "Following" stat cards opens `#social-modal`, which lists the respective users and provides quick links to their profiles.



## Tabbed Navigation & Content Grids

The profile is divided into several tabs controlled by `switchTab()`: Home, Library, People, Fandoms, On Hold, and Tags.

### The Home Tab

The default view aggregates the most critical data.

* **Your Next Re-Watch (Radar):** The `calculateRevisits()` function scans the user's `media_logs` to find items rated 4 stars or higher. It calculates the time difference since the log date against media-specific thresholds (e.g., 1 year for movies/TV, 2 years for books, 6 months for albums). Eligible items populate a horizontally scrolling flex container.


* **Active Tracking:** Renders items marked as "Currently Watching/Reading" in the `media_status` table. The script calculates progress text directly on the card (e.g., pulling the latest episode logged to display "S1 E5", or the latest page to display "Pg 120").


* **Recent Activity:** Displays the 10 most recent logs.


* **Favorites:** Renders 5 custom favorites per category, pulling from a JSON object stored in the user's profile.



### The Library Tab

The Library acts as a comprehensive, paginated archive of everything the user has interacted with. Because users might log the same movie multiple times or mark it as "watching", the script uses a `libraryMap` to deduplicate records based on a composite key (`${media_type}_${media_id}`). It retains the *earliest* interaction date for chronologically sorting the grid, but retains the *latest* star rating and heart status for the display card. The library is paginated using `LIBRARY_PAGE_SIZE = 50`.

### People & Fandoms Tabs

These tabs display tracked cast/crew and official collections/franchises. If the active user is the owner, a "Reorder" button appears. Clicking it activates `isManagingPeople` or `isManagingFandoms`, modifying the cursor to `grab` and initializing `Sortable.js` on the CSS Grid. Upon clicking "Save Order", the script loops through the new DOM arrangement to update the `rank` integer for every row in the database.

### The Tags Tab

This owner-only tab counts the occurrences of custom strings across the user's `media_logs` to build a `.tags-cloud-container`. Clicking a specific tag pill opens `#tag-details-modal`, which renders a list of every log featuring that tag, sorted chronologically.

## Responsive CSS Architecture

The `profile.css` file employs advanced layout shifting to maintain usability on mobile devices (screens under 768px).

* **Header Dissolution:** On desktop, the profile header uses standard flexbox layout. On mobile, the wrapper `.profile-header-main` is given `display: contents !important`. This CSS trick visually deletes the wrapper, allowing its child elements (the text info and the stat cards) to snap directly into a master CSS Grid defined on the `.profile-header`, stacking them efficiently beneath the avatar.


* **Horizontal Tab Scrolling:** The `.profile-tabs` container is converted to a horizontally scrolling menu (`flex-wrap: nowrap !important`, `overflow-x: auto !important`) and hides the scrollbar using `scrollbar-width: none` to keep the UI clean.


* **Grid Density:** To maximize screen real estate, all media grids (Favorites, Active, Recent, Library) are forced into a dense 4-column layout (`grid-template-columns: repeat(4, 1fr) !important`). Category badges and text labels are hidden on smaller cards (like People) to prevent visual clutter.