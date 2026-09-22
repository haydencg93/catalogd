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
const tagInput = Selector('#log-tags-input');
const tagsContainer = Selector('#tags-display-container');

const likeBtn = Selector('#like-btn');
const rewatchBtn = Selector('#rewatch-btn');

const scopeDropdown = Selector('#log-scope');
const scopeOptionEpisode = scopeDropdown.find('option').withAttribute('value', 'episode');
const tvDropdownGroup = Selector('#dropdown-group');
const episodeSelect = Selector('#episode-select');


// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `log-interactions`
    .page`127.0.0.1:5500/log.html?id=1399&type=tv` // Game of Thrones (TV)
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/log.html?id=1399&type=tv');
        
        // Hydration check: Wait for TMDB fetch to resolve
        await t.expect(mediaTitle.innerText).notEql('Loading...', { timeout: 15000 });
        await t.expect(mediaTitle.innerText).notEql('', { timeout: 15000 });
    });

test('Tag input generates pill elements on Enter', async t => {
    await t.typeText(tagInput, 'Epic Fantasy');
    await t.pressKey('enter');
    
    await t.expect(tagsContainer.childElementCount).gt(0);
    await t.expect(tagsContainer.innerText).contains('epic-fantasy');
});

test('Action buttons toggle active classes', async t => {
    const initiallyLiked = await likeBtn.hasClass('active');
    await t.click(likeBtn);
    if (initiallyLiked) {
        await t.expect(likeBtn.hasClass('active')).notOk({ timeout: 5000 });
    } else {
        await t.expect(likeBtn.hasClass('active')).ok({ timeout: 5000 });
    }

    const initiallyRewatched = await rewatchBtn.hasClass('active');
    await t.click(rewatchBtn);
    if (initiallyRewatched) {
        await t.expect(rewatchBtn.hasClass('active')).notOk({ timeout: 5000 });
    } else {
        await t.expect(rewatchBtn.hasClass('active')).ok({ timeout: 5000 });
    }
});

test('TV scope dropdown manipulates secondary input visibility', async t => {
    // Default state for TV is 'entire', so dropdowns are hidden
    await t.expect(tvDropdownGroup.getStyleProperty('display')).eql('none');
    
    // Switch to Specific Episode
    await t.click(scopeDropdown);
    await t.click(scopeOptionEpisode);
    
    // Verify visibility toggled
    await t.expect(tvDropdownGroup.getStyleProperty('display')).notEql('none');
    await t.expect(episodeSelect.getStyleProperty('display')).notEql('none');
});