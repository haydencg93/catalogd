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
const mediaTitle = Selector('#media-title');
const watchlistBtn = Selector('#watchlist-btn');
const statusBtn = Selector('#status-btn');
const statusModal = Selector('#status-modal');
const activeStatusOption = Selector('.status-option[data-status="active"]');
const viewAllCastBtn = Selector('#view-all-cast-btn');

const fillerContainer = Selector('#filler-status-container');
const viewFillerBtn = Selector('#view-filler-btn');
const requestFillerBtn = Selector('#request-filler-btn');

const trackerHeader = Selector('#tv-tracker h3');
const castHeader = Selector('#cast-section h3');
const posterArea = Selector('#poster-area');


// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `details-interactions`
    .page`127.0.0.1:5500/details.html?id=550&type=movie`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
    });

test('Movie interactions: Watchlist, Status Modal, and Cast', async t => {
    await t.navigateTo('http://127.0.0.1:5500/details.html?id=550&type=movie');
    await t.expect(mediaTitle.innerText).notEql('', { timeout: 15000 });
    
    // Hydration check: Wait for the API pipeline to finish rendering the cast
    await t.expect(Selector('#cast-list').childElementCount).gt(0, { timeout: 10000 });

    // 1. Watchlist Toggle
    const isWatchlisted = await watchlistBtn.hasClass('active');
    await t.click(watchlistBtn);
    if (isWatchlisted) {
        await t.expect(watchlistBtn.hasClass('active')).notOk({ timeout: 5000 });
    } else {
        await t.expect(watchlistBtn.hasClass('active')).ok({ timeout: 5000 });
    }
    await t.click(watchlistBtn); // Revert state

    // 2. Status Modal
    await t.click(statusBtn);
    await t.expect(statusModal.getStyleProperty('display')).notEql('none');
    
    await t.click(activeStatusOption);
    await t.expect(statusModal.getStyleProperty('display')).eql('none');
    await t.expect(statusBtn.hasClass('active')).ok();
});

test('Anime Filler configurations load appropriately', async t => {
    // 1. Hunter x Hunter (Has Filler - Corrected ID)
    await t.navigateTo('http://127.0.0.1:5500/details.html?id=46298&type=tv');
    await t.expect(mediaTitle.innerText).eql('Hunter x Hunter', { timeout: 15000 });
    
    await t.expect(fillerContainer.getStyleProperty('display')).notEql('none');
    await t.expect(viewFillerBtn.exists).ok();

    // 2. The Wind Rises (No Filler)
    await t.navigateTo('http://127.0.0.1:5500/details.html?id=149870&type=movie');
    await t.expect(mediaTitle.innerText).eql('The Wind Rises', { timeout: 15000 });
    
    await t.expect(fillerContainer.getStyleProperty('display')).notEql('none');
    await t.expect(requestFillerBtn.exists).ok();
});

test('Book details render reading trackers and purchase links', async t => {
    await t.navigateTo('http://127.0.0.1:5500/details.html?id=OL27448W&type=book');
    await t.expect(mediaTitle.innerText).contains('Lord of the Rings', { timeout: 15000 });
    
    await t.expect(trackerHeader.innerText).eql('Reading Progress');
    await t.expect(castHeader.innerText).eql('Authors & Writers');
    
    // Corrected assertion: Target the title attribute of the image rather than the innerText
    await t.expect(Selector('#providers-list img').withAttribute('title', 'WorldCat').exists).ok();
});

test('Album details format tracklists and artist data', async t => {
    await t.navigateTo('http://127.0.0.1:5500/details.html?id=Michael%20Jackson%7C%7C%7CThriller&type=album');
    await t.expect(mediaTitle.innerText).eql('Thriller', { timeout: 15000 });
    
    await t.expect(trackerHeader.innerText).eql('Tracklist');
    await t.expect(castHeader.innerText).eql('Artist');
    await t.expect(Selector('#cast-list').innerText).contains('Michael Jackson');
});

test('YouTube details inject iframes and channel attribution', async t => {
    await t.navigateTo('http://127.0.0.1:5500/details.html?id=dQw4w9WgXcQ&type=youtube');
    await t.expect(mediaTitle.innerText).notEql('Unknown YouTube video', { timeout: 15000 });
    
    await t.expect(posterArea.child('div').child('iframe').exists).ok();
    await t.expect(castHeader.innerText).eql('Channel');
});