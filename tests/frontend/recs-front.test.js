import { Role, Selector } from 'testcafe';
import {
    TEST_USERNAME,
    TEST_PASS
} from '../../misc/test-account.js';

// ----------------------------------------
// Authentication Role Setup
// ----------------------------------------
const authenticatedUser = Role('http://127.0.0.1:5500/index.html', async t => {
    await t.setNativeDialogHandler(() => true);
    await t.eval(() => document.getElementById('auth-modal').style.display = 'flex');
    await t.typeText('#auth-email', TEST_USERNAME); 
    await t.typeText('#auth-password', TEST_PASS); 
    await t.click('#auth-confirm-btn');
    await t.expect(Selector('#auth-modal').getStyleProperty('display')).eql('none', { timeout: 10000 });
}, { preserveUrl: true });


// ----------------------------------------
// Selectors
// ----------------------------------------
const searchInput = Selector('#rec-search-input');
const searchResults = Selector('#rec-search-results');
const firstSearchResult = Selector('.search-item-dropdown').nth(0);

const tagsContainer = Selector('#active-inputs-container');
const emptyMsg = Selector('#empty-inputs-msg');
const vibeTag = Selector('.vibe-tag');

const generateBtn = Selector('#generate-btn');


// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `recs-interactions`
    .page`127.0.0.1:5500/recs.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/recs.html');
    });

test('UI initializes in a locked state', async t => {
    await t.expect(generateBtn.hasAttribute('disabled')).ok();
    await t.expect(emptyMsg.getStyleProperty('display')).notEql('none');
});

test('Search triggers dropdown and populates tags', async t => {
    await t.typeText(searchInput, 'Inception');
    
    // Wait for debounce and TMDB/OpenLibrary fetches
    await t.expect(searchResults.getStyleProperty('display')).notEql('none', { timeout: 10000 });
    
    await t.click(firstSearchResult);
    
    // Dropdown should hide, tag should appear
    await t.expect(searchResults.getStyleProperty('display')).eql('none');
    await t.expect(tagsContainer.child('.vibe-tag').exists).ok();
    await t.expect(generateBtn.hasAttribute('disabled')).notOk();
});

test('Removing tags restores the empty state', async t => {
    // Setup state
    await t.typeText(searchInput, 'Matrix');
    await t.expect(searchResults.getStyleProperty('display')).notEql('none', { timeout: 10000 });
    await t.click(firstSearchResult);
    
    // Action
    await t.click(vibeTag.find('button'));
    
    // Verify restored state
    await t.expect(tagsContainer.child('.vibe-tag').exists).notOk();
    await t.expect(emptyMsg.getStyleProperty('display')).notEql('none');
    await t.expect(generateBtn.hasAttribute('disabled')).ok();
});

test('Generate button triggers edge function pipeline', async t => {
    await t.setNativeDialogHandler(() => true); 
    
    await t.typeText(searchInput, 'Dune');
    await t.expect(searchResults.getStyleProperty('display')).notEql('none', { timeout: 10000 });
    await t.click(firstSearchResult);
    
    await t.click(generateBtn);
    
    await t.expect(Selector('#results-header').exists).ok({ timeout: 15000 });
});