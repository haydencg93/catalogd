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
const editNameInput = Selector('#edit-name');
const spotifyPill = Selector('.pill[data-id="spotify"]');

const exportRangeSelect = Selector('#export-range-select');
const exportDateInputs = Selector('#date-range-inputs');
const optionRange = exportRangeSelect.find('option').withAttribute('value', 'range');
const optionAll = exportRangeSelect.find('option').withAttribute('value', 'all');

const importWatchlistBtn = Selector('button[data-import-type="watchlist"]');
const overwriteToggle = Selector('#overwrite-toggle');


// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `settings-interactions`
    .page`127.0.0.1:5500/settings.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/settings.html');
        // Hydration check
        await t.expect(editNameInput.value).notEql('', { timeout: 15000 });
    });

test('Service pills toggle active state on click', async t => {
    // Note: State might be active or inactive depending on the test account's DB status.
    const initiallyActive = await spotifyPill.hasClass('active');
    
    await t.click(spotifyPill);
    
    if (initiallyActive) {
        await t.expect(spotifyPill.hasClass('active')).notOk();
    } else {
        await t.expect(spotifyPill.hasClass('active')).ok();
    }
    
    // Revert state
    await t.click(spotifyPill);
});

test('Export range selector toggles date inputs', async t => {
    await t.expect(exportDateInputs.getStyleProperty('display')).eql('none');
    
    await t.click(exportRangeSelect).click(optionRange);
    
    await t.expect(exportDateInputs.getStyleProperty('display')).notEql('none');
    await t.expect(Selector('#export-start-date').value).notEql(''); // Verifies JS populated default dates
    
    await t.click(exportRangeSelect).click(optionAll);
    
    await t.expect(exportDateInputs.getStyleProperty('display')).eql('none');
});

test('Import UI toggles and error handling', async t => {
    await t.setNativeDialogHandler(() => true);

    await t.expect(overwriteToggle.checked).notOk();
    await t.click(overwriteToggle);
    await t.expect(overwriteToggle.checked).ok();

    await t.click(importWatchlistBtn);
    
    // Fetch the dialog history from the browser context
    const history = await t.getNativeDialogHistory();
    await t.expect(history[0].text).contains('Please select the watchlist CSV file');
});