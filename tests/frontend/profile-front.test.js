import { Role, Selector } from 'testcafe';
import {
    TEST_USERNAME,
    TEST_PASS
} from '../../misc/test-account.js';

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

// Selectors
const profileName = Selector('#user-display-name');
const tabBtns = Selector('.tab-btn');
const tabLibrary = Selector('#tab-library');
const tabPeople = Selector('#tab-people');

const libFilterMovie = Selector('button[data-library-filter="movie"]');

const followersBtn = Selector('#followers-stat-btn');
const socialModal = Selector('#social-modal');

fixture `profile-interactions`
    .page`127.0.0.1:5500/profile.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/profile.html');
        
        // Hydration check 1: Profile metadata
        await t.expect(profileName.innerText).notEql('Loading...', { timeout: 15000 });
        // Hydration check 2: Wait for async rendering loops to finish binding event listeners
        await t.expect(Selector('#library-grid').innerText).notContains('Loading library...', { timeout: 15000 });
    });

test('Profile tabs toggle active content containers', async t => {
    // Navigate to People tab
    await t.click(tabBtns.withText('People'));
    
    await t.expect(tabPeople.hasClass('active')).ok();
    await t.expect(tabLibrary.hasClass('active')).notOk();
    
    // Navigate to Library tab
    await t.click(tabBtns.withText('Library'));
    
    await t.expect(tabLibrary.hasClass('active')).ok();
    await t.expect(tabPeople.hasClass('active')).notOk();
});

test('Library filters toggle active state', async t => {
    await t.click(tabBtns.withText('Library'));
    
    await t.expect(libFilterMovie.hasClass('active')).notOk();
    await t.click(libFilterMovie);
    await t.expect(libFilterMovie.hasClass('active')).ok();
});

test('Social modal opens on followers click', async t => {
    await t.expect(socialModal.getStyleProperty('display')).eql('none');
    await t.click(followersBtn);
    await t.expect(socialModal.getStyleProperty('display')).notEql('none');
});