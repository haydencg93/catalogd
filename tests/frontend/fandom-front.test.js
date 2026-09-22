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
        console.error('Login Alert:', text);
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
const fandomTitle = Selector('#fandom-title');
const editArtBtn = Selector('#edit-art-btn');
const artModal = Selector('#fandom-custom-art-modal');
const posterInput = Selector('#fandom-custom-poster-input');
const saveArtBtn = Selector('#save-fandom-art-btn');
const castGrid = Selector('#fandom-cast-content .cast-grid');
const firstFollowBtn = Selector('[data-character-follow]').nth(0);


// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `fandom-interactions`
    .page`127.0.0.1:5500/fandom.html?id=11&type=movie`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
    });

test('Standard Fandom loads Wikipedia lore and character grid', async t => {
    await t.navigateTo('http://127.0.0.1:5500/fandom.html?id=11&type=movie');
    
    // Hydration check: Await Wikipedia lore resolution
    await t.expect(fandomTitle.innerText).notEql('Loading Wikipedia Lore...', { timeout: 15000 });
    
    // Validate cast grid rendered
    await t.expect(castGrid.exists).ok({ timeout: 15000 });
    await t.expect(castGrid.childElementCount).gt(0);
});

test('Character Follow button toggles state in DOM', async t => {
    await t.navigateTo('http://127.0.0.1:5500/fandom.html?id=11&type=movie');
    await t.expect(castGrid.exists).ok({ timeout: 15000 });
    
    // Capture initial state
    const initialText = await firstFollowBtn.innerText;
    
    await t.click(firstFollowBtn);
    
    // Verify the state switched
    await t.expect(firstFollowBtn.innerText).notEql(initialText);
    
    // Revert state to keep test account clean
    await t.click(firstFollowBtn);
});

test('Custom Art modal triggers on fandom page', async t => {
    await t.navigateTo('http://127.0.0.1:5500/fandom.html?id=11&type=movie');
    await t.expect(fandomTitle.innerText).notEql('Loading Wikipedia Lore...', { timeout: 15000 });
    
    await t.click(editArtBtn);
    await t.expect(artModal.getStyleProperty('display')).notEql('none');
    
    await t.typeText(posterInput, 'https://example.com/poster.jpg', { replace: true });
    await t.click(saveArtBtn);
});

test('Collection View overrides standard layout', async t => {
    // ListId 11 is the Star Wars Collection
    await t.navigateTo('http://127.0.0.1:5500/fandom.html?listId=11');
    
    await t.expect(fandomTitle.innerText).notEql('Loading Wikipedia Lore...', { timeout: 15000 });
    await t.expect(Selector('#fandom-meta').innerText).eql('Official Collection');
    
    // Ensure the plot section is hidden as defined in list fetch logic
    await t.expect(Selector('#fandom-plot-section').getStyleProperty('display')).eql('none');
});