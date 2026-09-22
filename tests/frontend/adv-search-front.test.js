import { Selector } from 'testcafe';

// Elements
const moviePill = Selector('.pill[data-id="movie"][data-group="type"]');
const tvPill = Selector('.pill[data-id="tv"][data-group="type"]');
const movieDurationWrapper = Selector('#movie-duration-wrapper');
const tvDurationWrapper = Selector('#tv-duration-wrapper');

const keywordSearchInput = Selector('#genre-search');
const keywordSearchResults = Selector('#genres-search-results');
const keywordSelectedContainer = Selector('#genres-selected-container');
const textSearchInput = Selector('#text-search-input');

const findMatchesBtn = Selector('#find-matches-btn');
const resultsGrid = Selector('#results-grid');
const mediaCards = Selector('.media-card');

fixture `adv-search-interactions`
    .page`127.0.0.1:5500/adv-search.html`;

test('Type selection toggles duration visibility', async t => {
    // Wait for the API payload to render the DOM before clicking anything
    await t.expect(Selector('#core-genres-container .pill').count).gt(0, { timeout: 10000 });

    await t.expect(moviePill.hasClass('active')).ok();
    await t.expect(movieDurationWrapper.getStyleProperty('display')).eql('block');
    await t.expect(tvDurationWrapper.getStyleProperty('display')).eql('none');

    // Deselect Movie, Select TV
    await t.click(moviePill);
    await t.click(tvPill);
    
    await t.expect(moviePill.hasClass('active')).notOk();
    await t.expect(tvPill.hasClass('active')).ok();
    
    await t.expect(movieDurationWrapper.getStyleProperty('display')).eql('none');
    await t.expect(tvDurationWrapper.getStyleProperty('display')).eql('block');
});

test('Duration pills toggle active state', async t => {
    await t.expect(Selector('#core-genres-container .pill').count).gt(0, { timeout: 10000 });

    const durationPill = Selector('.pill[data-group="movie-duration"]').nth(0);
    
    await t.click(durationPill);
    await t.expect(durationPill.hasClass('active')).ok();
    
    await t.click(durationPill);
    await t.expect(durationPill.hasClass('active')).notOk();
});

test('Keyword search populates and selects themes', async t => {
    await t.typeText(keywordSearchInput, 'cyberpunk');
    
    // Wait for debounce and API fetch
    await t.expect(keywordSearchResults.getStyleProperty('display')).notEql('none', { timeout: 10000 });
    await t.expect(keywordSearchResults.child('.pill').count).gt(0);
    
    const firstKeyword = keywordSearchResults.child('.pill').nth(0);
    const keywordName = await firstKeyword.innerText;
    
    await t.click(firstKeyword);
    
    // Verify it moved to selected container
    await t.expect(keywordSelectedContainer.getStyleProperty('display')).notEql('none');
    await t.expect(keywordSelectedContainer.innerText).contains(keywordName.replace(' ×', ''));
});

test('Search execution triggers loader and populates grid', async t => {
    await t.expect(Selector('#core-genres-container .pill').count).gt(0, { timeout: 10000 });
    
    // Use a highly specific search to avoid TMDB rate limits on batch detail fetching
    await t.typeText(textSearchInput, 'Inception');
    await t.click(findMatchesBtn);
    
    // Wait for the targeted pipeline to finish and verify the final state
    await t.expect(mediaCards.count).gt(0, { timeout: 15000 });
    await t.expect(Selector('#adv-search-loader').getStyleProperty('display')).eql('none');
});
