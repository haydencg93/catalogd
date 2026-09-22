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
const mediaTypeSelect = Selector('#media-type-select');
const sourceSelect = Selector('#source-select');
const listSelectGroup = Selector('#list-select-group');
const tasteOption = sourceSelect.find('option[value="taste"]');

const rollBtn = Selector('#roll-btn');
const loader = Selector('#loader');
const resultContainer = Selector('#result-container');
const errorMsg = Selector('#error-message');


// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `picker-interactions`
    .page`127.0.0.1:5500/picker.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/picker.html');
        
        // Hydration check
        await t.expect(mediaTypeSelect.exists).ok({ timeout: 10000 });
    });

test('Media Type selection toggles Taste Profile availability', async t => {
    // Taste profile is available for movies
    await t.expect(tasteOption.hasAttribute('hidden')).notOk();
    
    // Switch to Book
    await t.click(mediaTypeSelect).click(mediaTypeSelect.find('option[value="book"]'));
    
    // Taste profile should now be hidden
    await t.expect(tasteOption.hasAttribute('hidden')).ok();
    
    // Revert
    await t.click(mediaTypeSelect).click(mediaTypeSelect.find('option[value="movie"]'));
});

test('Source selection toggles Specific List dropdown', async t => {
    await t.expect(listSelectGroup.getStyleProperty('display')).eql('none');
    
    await t.click(sourceSelect).click(sourceSelect.find('option[value="list"]'));
    
    await t.expect(listSelectGroup.getStyleProperty('display')).notEql('none');
});

test('Execution UI flow displays loader and resolves', async t => {
    // Override native alerts just in case the user has no lists/taste data
    await t.setNativeDialogHandler(() => true);

    await t.click(rollBtn);
    
    // Loader should appear immediately
    await t.expect(loader.getStyleProperty('display')).notEql('none');
    
    // The pipeline will eventually resolve to either an error message or a winner card
    // depending on the test account's exact database state. We check that ONE of them becomes visible.
    const containerVisible = resultContainer.getStyleProperty('display');
    const errorVisible = errorMsg.getStyleProperty('display');
    
    // Wait up to 15 seconds for the loader to hide
    await t.expect(loader.getStyleProperty('display')).eql('none', { timeout: 15000 });
    
    // At this point, one of the two result elements must be visible
    const finalContainerState = await resultContainer.getStyleProperty('display');
    const finalErrorState = await errorMsg.getStyleProperty('display');
    
    await t.expect(finalContainerState !== 'none' || finalErrorState !== 'none').ok('Neither the result container nor the error message was displayed.');
});