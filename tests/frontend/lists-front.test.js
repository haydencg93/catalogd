import { Role, Selector } from 'testcafe';
import {
    TEST_USERNAME,
    TEST_PASS
} from '../../misc/test-account.js';

// ----------------------------------------
// Authentication Role Setup
// ----------------------------------------
const authenticatedUser = Role('http://127.0.0.1:5500/index.html', async t => {
    await t.setNativeDialogHandler((type, text) => {
        console.error('Login Alert Triggered:', text);
        return true; 
    });

    await t.eval(() => document.getElementById('auth-modal').style.display = 'flex');
    await t.typeText('#auth-email', TEST_USERNAME); 
    await t.typeText('#auth-password', TEST_PASS); 
    await t.click('#auth-confirm-btn');
    
    await t.expect(Selector('#auth-modal').getStyleProperty('display')).eql('none', { timeout: 10000 });
}, { preserveUrl: true });


// ----------------------------------------
// Selectors
// ----------------------------------------
const listsContainer = Selector('#lists-container');
const listNameInput = Selector('#list-name-input');
const createTieredToggle = Selector('#create-tiered-toggle');
const createListBtn = Selector('#create-list-btn');

const sharedTabBtn = Selector('button[data-list-filter="shared"]');
const tierTabBtn = Selector('button[data-list-filter="tier"]');

const manageListsBtn = Selector('#manage-lists-btn');
const saveOrderBtn = Selector('#save-lists-order-btn');

// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `lists-interactions`
    .page`127.0.0.1:5500/lists.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        
        // Force browser back to the target page after Role execution
        // Appending a dummy id avoids an immediate redirect to index.html if the session loads slightly too slow
        await t.navigateTo('http://127.0.0.1:5500/lists.html');
        
        // Hydration check: Wait for Supabase to resolve and clear the loading text
        await t.expect(listsContainer.innerText).notEql('Loading your lists...', { timeout: 15000 });
    });

test('Create List inputs and toggles accept interaction', async t => {
    await t.typeText(listNameInput, 'My New Test List');
    await t.click(createTieredToggle);
    
    // We click the button to ensure the event listener doesn't throw synchronous JS errors
    await t.click(createListBtn);
});

test('Filter tabs switch active state successfully', async t => {
    await t.click(sharedTabBtn);
    await t.expect(sharedTabBtn.hasClass('active')).ok();
    
    await t.click(tierTabBtn);
    await t.expect(tierTabBtn.hasClass('active')).ok();
    await t.expect(sharedTabBtn.hasClass('active')).notOk();
});

test('Reorder lists mode toggles button visibility', async t => {
    // Only visible if there are lists, so we check if it exists first
    if (await manageListsBtn.exists && await manageListsBtn.getStyleProperty('display') !== 'none') {
        await t.click(manageListsBtn);
        
        await t.expect(manageListsBtn.getStyleProperty('display')).eql('none');
        await t.expect(saveOrderBtn.getStyleProperty('display')).notEql('none');
        
        // Reset state
        await t.click(saveOrderBtn);
    }
});