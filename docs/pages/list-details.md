# Catalogd: List Details Page Documentation

The List Details page is the central management hub for user-generated collections in Catalogd. It provides a robust interface for curating, ranking, and collaborating on custom media lists spanning movies, TV shows, books, music, and YouTube videos. The page dynamically adapts its layout based on the list's configuration (standard, ranked, or tiered) and the active user's permission level.

## Core Technologies & Libraries

The List Details page integrates several tools to handle its dynamic interactions and data management:

* **Supabase:** Serves as the backend for retrieving and updating list metadata (`media_lists`), list contents (`list_items`), and access permissions (`list_collaborators`).


* **External Media APIs:** TMDB, OpenLibrary, Last.fm, and YouTube oEmbed APIs are queried simultaneously to power the "Add to List" search bar.


* **Sortable.js:** A lightweight JavaScript library loaded via CDN (`Sortable.min.js`) that provides fluid, touch-friendly drag-and-drop reordering for ranked and tiered lists.



## Initialization & Permission Routing

When `list-details.js` loads, `initListDetails()` fetches the list metadata and establishes the user's permission level. The application divides users into three distinct roles, dynamically adjusting the DOM for each:

* **Owner:** The user who created the list. They have full access to add items, reorder lists, edit list details, manage tier colors, invite collaborators, and permanently delete the list.


* **Collaborator:** A user invited by the owner. They can add items, reorder the list, and edit the list's name and description, but they cannot invite others or delete the list. Instead of a "Collaborators" button, they see a red "Leave List" button.


* **Visitor:** Any other user. If the list is marked private (`is_public === false`), they are alerted and redirected to the home page. If public, all editing controls, search bars, and reorder buttons are hidden via CSS, and a "Back to Lists" navigation button is prepended to the header.



## Adding Items to the List

Authorized users can populate the list using two distinct methods located in the `#add-to-list-section`:

1. **Unified Search Bar:** Typing into the search input triggers `setupSearch()`, which concurrently queries TMDB, OpenLibrary, and Last.fm. A Regex check intercepts YouTube URLs and queries the oEmbed API. Clicking a search result inserts a new record into the `list_items` table, automatically assigning it the next available rank or dropping it into the default "NS" (Not Sorted) tier.


2. **Custom Cards:** Clicking "+ Custom Card" opens `#custom-card-modal`, allowing users to manually define an item that doesn't exist in external databases. Users provide a Name, an optional Image URL, and a media Type. This item is flagged as `is_custom: true` in Supabase and renders alongside API-backed media.



## List Rendering & Drag-and-Drop Reordering

The `renderList()` function clears active `Sortable` instances and determines the appropriate layout to render based on the list's configuration.

### Standard & Ranked Layouts

If the list is standard, `renderStandardList()` generates a CSS Grid of `.media-card` elements. If the list is configured as "Ranked", numerical `.rank-badge` elements are appended to the top-left corner of each poster.

### Tier List Layout

If the list is configured as a Tier List, `renderTieredList()` builds specific rows for tiers (S, A, B, C, D, F, and a default NS tier). Each `.tier-row` receives a customizable background color mapped from the `tier_colors` JSON object stored in Supabase.

### Reordering Logic

Clicking "Reorder Items" enables management mode (`isManaging = true`).

* This instantiates `Sortable` on the grid container or across all tier containers using the `group: 'shared-tiers'` property, allowing cross-tier dragging.


* CSS classes like `.sortable-ghost` (the semi-transparent placeholder left behind) and `.sortable-chosen` (the actively dragged item) provide visual feedback.


* Clicking "Save Order" loops through the DOM elements in their new visual order, calculates their new integer rank (and new tier assignment, if applicable), and issues a batch update to Supabase.



## Collaboration & Settings

The Owner can click "Collaborators" to open `#collab-modal`. By typing a username into the input, the application queries the `profiles` table to find the user's ID and inserts a relationship into the `list_collaborators` table, granting them immediate edit access.

Clicking "Edit List" opens `#edit-list-modal`, exposing settings for the list's name, description, privacy toggle, and a checkbox to enable/disable "Ranked" mode. If the list is tiered, an `#edit-tier-colors-section` appears, generating HTML5 color pickers (`<input type="color">`) for each tier letter. Saving these edits updates the `media_lists` row and forces a re-render of the layout.

## Mobile Responsiveness

The `list-details.css` file uses strict media queries (`max-width: 768px`) to ensure complex layouts remain usable on mobile devices.

* **Control Stacking:** The header titles and action buttons (Edit List, Collaborators) are forced to wrap and take up 100% width, ensuring touch targets are large enough.


* **Standard Grids:** The standard `.list-items-grid` is forced into a dense 4-column layout (`grid-template-columns: repeat(4, 1fr)`), scaling down font sizes and utilizing `word-break: break-word` to ensure long titles fit on narrow cards.


* **Tier Lists:** Tier content containers drop their standard flex wrapping in favor of a forced 2-column layout. The cards are given `flex: 0 0 calc(50% - 5px) !important` to ensure they sit side-by-side perfectly within the tight mobile viewport.