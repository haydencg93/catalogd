# Catalogd: Log Page Documentation

The Log page allows users to record their interactions with media, assigning ratings, written reviews, tags, dates, and interaction scopes (e.g., watching an entire series vs. a single episode) to an item. This data populates the user's Diary, tracks their statistics, and fuels their personalized "For You" recommendations.

## UI Adaptation & Media Scoping

When `initLog()` fires, the application dynamically adapts the DOM based on the media `type` parameter present in the URL. The `#log-scope` `<select>` menu acts as the primary driver for these changes.

### Movie & YouTube Configuration

For movies and YouTube videos, the scope is strictly limited to the "Entire" media.

* Because the YouTube oEmbed API does not return a video duration, the page unhides a custom `#youtube-input-group`, requiring the user to manually input the video's length in minutes.



### TV Show Configuration

For TV shows, the script populates the scope dropdown with "Entire Series", "Specific Season", and "Specific Episode".

* If the user selects Season or Episode, `setupDropdowns()` unhides secondary `<select>` menus (`#season-select` and `#episode-select`) that are dynamically populated with TMDB data.


* A warning banner is displayed alerting the user that logging individual seasons or episodes does not count toward their overarching profile statistics (which require "Entire Series" logs).



### Book Configuration

For books, the scope dropdown updates to "Entire Book", "Specific Chapter", or "Specific Page".

* An `onchange` listener toggles the visibility of the chapter and page number text inputs.


* If "Entire Book" is selected, the application exposes a custom page count override field, acknowledging that OpenLibrary's official page counts can sometimes be inaccurate.



### Music (Album) Configuration

For albums, the scope is updated to "Entire Album" or "Specific Track".

* `setupAlbumDropdowns()` parses the Last.fm tracklist and calculates durations to format the dropdown options cleanly (e.g., `1. Track Name (3:45)`).


* If a specific track is chosen, the `currentMediaRuntime` variable is updated to reflect only that track's duration.



## Interaction Mechanisms

* **Half-Star Rating System:** The star rater is built using raw JavaScript calculating cursor positions. When a user clicks a star (`.star`), `setupStars()` uses `getBoundingClientRect()` to determine the element's width and compares it to the cursor's `clientX` position. If the click lands on the left half of the element, it assigns a `.5` rating (e.g., `2.5`); if on the right half, it assigns a whole number. The UI is updated by applying the `.half-active` or `.active` CSS classes.


* **Tagging:** Users type into `#log-tags-input` and press "Enter". The `setupTagsInput()` listener intercepts the keystroke, converts the string to lowercase, replaces spaces with hyphens, and pushes it into the `currentTags` array. The UI is updated by rendering `<span class="tag-pill">` elements.


* **Default State Handlers:** The `#watched-date` input is automatically pre-filled with the current local date using the browser's timezone offset. The application also queries the `media_logs` table to see if the user has previously logged this item; if so, it automatically toggles the "Rewatch" state to `true`.



## Data Submission (Upsert Logic)

When the user clicks "Save to Diary", `saveLog()` packages the global variables and DOM values into a data payload.

The submission process uses Supabase's `upsert` method.

* **Creation vs. Editing:** If the URL contains a `logId` parameter (indicating the user is editing an existing log), the script fetches the old data via `fetchExistingLogData()` and injects the `logId` into the payload. Because an ID is provided, Supabase updates the existing row instead of inserting a new one.


* **Book Overrides:** If the media is a book and the scope is "Entire", the application fetches the total page count from OpenLibrary, checks if the user provided a custom override, and flags the log as `is_finished: true`.


* **TV Show Hierarchy:** If the user logs an "Entire Series", the application fetches the total episode count from TMDB and clears any specific season/episode integers from the payload to maintain relational integrity.



After a successful `upsert`, the user is redirected back to the media's Details page.

## Responsive CSS Constraints

The `log.css` file ensures the form remains usable on mobile devices by shrinking the touch targets and reorganizing flex layouts:

* The `.star` class is given an explicit `font-size: 2.3rem` on screens under 768px to prevent the 5-star row from wrapping onto a second line.


* The `.media-actions` flexbox (housing the Like and Rewatch buttons) is forced into a vertical column (`flex-direction: column`), expanding the buttons to `width: 100%` for easier tapping.


* The `.log-card` container utilizes `box-sizing: border-box` and sets `max-width: 100%` on text inputs and dropdowns to prevent them from overflowing the viewport boundaries.