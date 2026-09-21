# Catalogd: Lists Page Documentation

The Lists page provides users with an intuitive interface to create, view, and organize custom media collections (standard, ranked, or tiered lists). It serves as a dashboard for accessing all `media_lists` tied to an account, handling both owned lists and lists shared via the `list_collaborators` table.

## Initial Setup & View State

The `initLists()` function establishes the viewing context by checking URL parameters.

* **Owner View:** If viewing one's own profile, the "Create New List" panel and "Reorder Lists" buttons are exposed.


* **Visitor View:** If visiting another user, the page title adapts (e.g., "Justin's Lists"), the creation and management controls are hidden, and a contextual "Back to Profile" button is injected into the navigation bar.



## Data Retrieval & Aggregation

To populate the dashboard, `fetchUserLists()` queries two primary sources in Supabase:

1. **Owned Lists:** Retrieves rows from `media_lists` where `user_id` matches the target profile.


2. **Collaborative Lists:** Queries `list_collaborators` to find list IDs the user was invited to, then joins the `media_lists` table to fetch the corresponding metadata.



These queries use foreign key joins (`select('*, list_items(...)')`) to pull the first three items assigned to each list. The lists are aggregated, deduplicated using a `Map`, and sorted by a custom `sort_rank` (or by creation date if no manual order is set).

To protect user privacy, if a visitor is viewing the page, the application filters out any list marked `is_public: false` unless the visitor is an explicit collaborator on that list.

## Interactive Rendering & The CSS Grid

The `renderFilteredLists()` function renders the array of lists into the `#lists-container` based on the active tab ('owned', 'shared', or 'tier').

For each list card, the script iterates through the three nested items it fetched earlier. It fires asynchronous requests to TMDB, OpenLibrary, or Last.fm to fetch the poster URLs for those items. Like other pages in Catalogd, it cross-references the `customImgsMap` to apply user-uploaded artwork overrides.

These posters are rendered inside a `.list-poster-preview` container. The CSS utilizes a negative left margin (`margin-left: -40px`) on subsequent images within this flexbox to create an overlapping "stack" effect, visually communicating that the card represents a collection. Badges (e.g., "Shared", "Tiered", "Private") are dynamically appended to the card based on the list's boolean flags.

## List Creation & Ordering

* **Creation:** When the user clicks "Create List", `createList()` inserts a new row into the `media_lists` table. The boolean `is_tiered` flag is determined by a checkbox in the UI. If checked, the list is automatically flagged as `is_ranked` as well, since all tier lists require sorting capabilities.


* **Drag-and-Drop Organization:** Users can manually dictate the display order of their lists. Clicking "Reorder Lists" enables a `Sortable.js` instance on the CSS Grid. After dragging the cards into a new arrangement, clicking "Save Order" loops through the DOM to determine the new index positions and executes sequential updates to the `sort_rank` column in Supabase.



## Mobile Adaptability

When the viewport width drops below 768px, `lists.css` forces the layout to adapt significantly:

1. **Creation Panel:** The "Create New List" input group shifts from a horizontal flexbox into a stacked column layout (`flex-direction: column !important`).


2. **Card Scaling:** To maximize screen real estate, the `.list-grid` is forced into a dense, 3-column layout (`grid-template-columns: repeat(3, minmax(0, 1fr))`). The individual list cards shrink their padding, reduce their font sizes, and shrink the overlapping poster previews to fit elegantly inside the narrow grid.