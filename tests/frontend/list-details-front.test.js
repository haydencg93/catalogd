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
const listName = Selector('#list-name');

const editListBtn = Selector('#edit-list-btn');
const editModal = Selector('#edit-list-modal');
const closeEditBtn = Selector('#close-edit-list-modal');
const editNameInput = Selector('#edit-list-name');

const openCustomCardBtn = Selector('#open-custom-card-modal');
const customCardModal = Selector('#custom-card-modal');
const closeCustomCardBtn = Selector('#close-custom-card-modal');

const openCollabBtn = Selector('#open-collab-modal-btn');
const collabModal = Selector('#collab-modal');
const closeCollabBtn = Selector('#close-collab-modal');

// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `list-details-interactions`
    .page`127.0.0.1:5500/list-details.html?id=f712f2fc-d7e5-43e8-b3f0-a7d878823949` // YOU MUST CHANGE THIS
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.setNativeDialogHandler(() => true); // Swallows the 404 alert
        
        await t.navigateTo('http://127.0.0.1:5500/list-details.html?id=f712f2fc-d7e5-43e8-b3f0-a7d878823949');
    });

test('Edit List modal toggles and populates existing data', async t => {
    // Only owners/collaborators see this button
    await t.expect(editListBtn.getStyleProperty('display')).notEql('none');
    
    await t.click(editListBtn);
    await t.expect(editModal.getStyleProperty('display')).notEql('none');
    
    // Verify it populated the inputs from the DB fetch
    await t.expect(editNameInput.value).notEql('');
    
    await t.click(closeEditBtn);
    await t.expect(editModal.getStyleProperty('display')).eql('none');
});

test('Custom Card modal toggles successfully', async t => {
    // Only execute if the test account owns the list and the button is visible
    if (await openCustomCardBtn.exists && await openCustomCardBtn.visible) {
        await t.click(openCustomCardBtn);
        await t.expect(customCardModal.getStyleProperty('display')).notEql('none');
        
        await t.typeText('#custom-card-name', 'My Custom Entry');
        await t.expect(Selector('#submit-custom-card').exists).ok();
        
        await t.click(closeCustomCardBtn);
        await t.expect(customCardModal.getStyleProperty('display')).eql('none');
    } else {
        console.warn('Custom Card button not visible. Ensure the test account is the owner of the list.');
    }
});

test('Collaborator modal toggles successfully', async t => {
    // Button is hidden by default, wait for auth to reveal it
    if (await openCollabBtn.getStyleProperty('display') !== 'none') {
        await t.click(openCollabBtn);
        await t.expect(collabModal.getStyleProperty('display')).notEql('none');
        
        await t.expect(Selector('#collab-username').exists).ok();
        
        await t.click(closeCollabBtn);
        await t.expect(collabModal.getStyleProperty('display')).eql('none');
    } else {
        console.warn('Collaborator button not visible. Ensure the test account is the owner of list ID 1.');
    }
});