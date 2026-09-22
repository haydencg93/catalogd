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
const statsContent = Selector('#stats-content');
const depthTabs = Selector('#depth-1-tabs .tab-btn');
const controlsContainer = Selector('#depth-2-controls');
const filterMovieBtn = Selector('.filter-btn[data-stats-filter="movie"]');

fixture `stats-interactions`
    .page`127.0.0.1:5500/stats.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/stats.html');
        // Hydration check
        await t.expect(statsContent.getStyleProperty('display')).notEql('none', { timeout: 15000 });
    });

test('Depth tabs inject correct secondary controls', async t => {
    // All-time has no secondary controls
    await t.expect(controlsContainer.childElementCount).eql(0);

    // By Year injects one select
    await t.click(depthTabs.withText('By Year'));
    await t.expect(controlsContainer.child('select').count).eql(1);

    // By Season injects two selects
    await t.click(depthTabs.withText('By Season & Year'));
    await t.expect(controlsContainer.child('select').count).eql(2);
});

test('Filter navigation toggles active UI states', async t => {
    await t.expect(filterMovieBtn.hasClass('active')).notOk();
    await t.click(filterMovieBtn);
    await t.expect(filterMovieBtn.hasClass('active')).ok();
});