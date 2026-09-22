import { Role, Selector } from 'testcafe';
import {
    TEST_USERNAME,
    TEST_PASS
} from '../../misc/test-account.js'

// ----------------------------------------
// Authentication Role Setup
// ----------------------------------------
const authenticatedUser = Role('http://127.0.0.1:5500/index.html', async t => {
    // Prevent TestCafe from crashing when Supabase throws an "Invalid Credentials" alert
    await t.setNativeDialogHandler((type, text) => {
        console.error('Login Alert Triggered:', text);
        return true; 
    });

    // Force the auth modal open
    await t.eval(() => document.getElementById('auth-modal').style.display = 'flex');
    
    // CRITICAL: You MUST replace these with a real, verified Supabase account.
    // If these credentials fail, the Role will not save a session, and the Cast page tests will fail.
    await t.typeText('#auth-email', TEST_USERNAME); 
    await t.typeText('#auth-password', TEST_PASS); 
    await t.click('#auth-confirm-btn');
    
    // Wait for Supabase to validate and close the modal before finishing role setup
    await t.expect(Selector('#auth-modal').getStyleProperty('display')).eql('none', { timeout: 10000 });
}, { preserveUrl: true });


// ----------------------------------------
// Selectors
// ----------------------------------------
const editArtBtn = Selector('#edit-art-btn');
const artModal = Selector('#custom-art-modal');
const closeArtBtn = Selector('#close-art-modal');
const posterInput = Selector('#custom-poster-input');
const saveArtBtn = Selector('#save-art-btn');

const addTierBtn = Selector('#add-to-tier-list-btn');
const tierModal = Selector('#tier-list-modal');
const closeTierBtn = Selector('#close-tier-list-modal');
const tierContainer = Selector('#user-tier-lists-selection');

const personName = Selector('#person-name');
const filmographyList = Selector('#film-list');


// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `cast-interactions`
    .page`127.0.0.1:5500/cast.html?personId=2710`
    .beforeEach(async t => {
        // Apply the authenticated session before every test starts
        await t.useRole(authenticatedUser);
        
        // CRITICAL: Force the browser back to the cast page after the Role hijacks the URL
        await t.navigateTo('http://127.0.0.1:5500/cast.html?personId=2710');
        
        // Ensure the element actually exists in the DOM before checking its text
        await t.expect(personName.exists).ok({ timeout: 10000 });
        
        // Ensure API data loads before any interactions occur
        await t.expect(personName.innerText).notEql('Loading...', { timeout: 15000 });
    });

test('Page loads and populates person data based on URL parameter', async t => {
    await t.expect(personName.innerText).notEql('No person selected.');
    await t.expect(filmographyList.childElementCount).gt(0);
});

test('Custom Art modal toggles and registers inputs', async t => {
    // Now that we are authenticated, the actual UI button will be visible and bound to JS
    await t.click(editArtBtn);
    await t.expect(artModal.getStyleProperty('display')).notEql('none');
    
    await t.typeText(posterInput, 'https://example.com/poster.jpg', { replace: true });
    
    // Click the save button to ensure the JS event listener executes without crashing the client
    await t.click(saveArtBtn);
});

test('Tier List modal opens and fetches data', async t => {
    // Clicking the actual button executes the logic to fetch lists and populate the container
    await t.click(addTierBtn);
    
    await t.expect(tierModal.getStyleProperty('display')).notEql('none');
    
    // Verifies the JS actually injected the loading state or the tier lists
    await t.expect(tierContainer.innerText).notEql('');
    
    await t.click(closeTierBtn);
    await t.expect(tierModal.getStyleProperty('display')).eql('none');
});