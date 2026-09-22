import { Role, Selector } from 'testcafe';
import {
    TEST_USERNAME,
    TEST_PASS
} from '../../misc/test-account.js';

const authenticatedUser = Role('http://127.0.0.1:5500/index.html', async t => {
    await t.setNativeDialogHandler(() => true);
    await t.eval(() => document.getElementById('auth-modal').style.display = 'flex');
    await t.typeText('#auth-email', TEST_USERNAME); 
    await t.typeText('#auth-password', TEST_PASS); 
    await t.click('#auth-confirm-btn');
    await t.expect(Selector('#auth-modal').getStyleProperty('display')).eql('none', { timeout: 10000 });
}, { preserveUrl: true });

// Selectors
const subtitle = Selector('#watchlist-subtitle');
const allBtn = Selector('#btn-all');
const movieBtn = Selector('#btn-movie');
const grid = Selector('#watchlist-grid');

fixture `watchlist-interactions`
    .page`127.0.0.1:5500/watchlist.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/watchlist.html');
        // Hydration check
        await t.expect(subtitle.innerText).notEql('Loading...', { timeout: 15000 });
    });

test('Filter tabs toggle active state and update grid', async t => {
    await t.expect(allBtn.hasClass('active')).ok();
    await t.expect(movieBtn.hasClass('active')).notOk();

    await t.click(movieBtn);

    await t.expect(movieBtn.hasClass('active')).ok();
    await t.expect(allBtn.hasClass('active')).notOk();
    
    // Ensure the grid doesn't crash during re-render
    await t.expect(grid.exists).ok();
});