import { Selector } from 'testcafe';

// Elements
const searchInput = Selector('#search-input');
const searchFilter = Selector('#search-filter');
const resultsGrid = Selector('#results-grid');
const mediaCards = Selector('.media-card');

// Buttons & Tabs
const advSearchBtn = Selector('#adv-search-btn');
const recsBtn = Selector('#recs-btn');
const pickerBtn = Selector('#picker-btn');
const tabs = {
    movie: Selector('#btn-movie'),
    tv: Selector('#btn-tv'),
    book: Selector('#btn-book'),
    album: Selector('#btn-album'),
    youtube: Selector('#btn-youtube')
};

// Auth Elements
const authModal = Selector('#auth-modal');
const authSwitchBtn = Selector('#auth-switch');
const confirmBtn = Selector('#auth-confirm-btn');
const signupFields = Selector('#signup-fields');

fixture `index-interactions`
    .page`127.0.0.1:5500/index.html`;

test('Static routing buttons navigate appropriately', async t => {
    await t.click(advSearchBtn);
    await t.expect(await t.eval(() => window.location.href)).contains('adv-search.html');
    
    await t.navigateTo('http://127.0.0.1:5500/index.html');
    await t.click(recsBtn);
    await t.expect(await t.eval(() => window.location.href)).contains('recs.html');
    
    await t.navigateTo('http://127.0.0.1:5500/index.html');
    await t.click(pickerBtn);
    await t.expect(await t.eval(() => window.location.href)).contains('picker.html');
});

test('Search execution populates media cards', async t => {
    await t.typeText(searchInput, 'Dune').pressKey('enter');
    await t.expect(mediaCards.count).gt(0, { timeout: 10000 });
});

test('Filter dropdown auto-triggers new search', async t => {
    await t.typeText(searchInput, 'Batman').pressKey('enter');
    await t.expect(mediaCards.count).gt(0, { timeout: 10000 });

    await t.click(searchFilter).click(searchFilter.find('option').withAttribute('value', 'tv'));
    await t.expect(mediaCards.nth(0).getAttribute('data-type')).eql('tv', { timeout: 10000 });
});

test('Tab switching updates UI placeholders', async t => {
    await t.click(tabs.youtube);
    await t.expect(tabs.youtube.hasClass('active')).ok();
    await t.expect(searchInput.getAttribute('placeholder')).contains('Paste a YouTube link');
    
    await t.click(tabs.book);
    await t.expect(tabs.book.hasClass('active')).ok();
    await t.expect(searchInput.getAttribute('placeholder')).contains('Search for movies, shows, books');
});

test('Auth modal toggles state correctly and intercepts alerts', async t => {
    await t.eval(() => document.getElementById('auth-modal').style.display = 'flex');
    await t.setNativeDialogHandler((type) => type === 'alert');

    await t.click(authSwitchBtn);
    await t.expect(confirmBtn.innerText).eql('Sign Up');
    await t.expect(signupFields.getStyleProperty('display')).eql('block');
    
    await t.click(confirmBtn);
    const history = await t.getNativeDialogHistory();
    await t.expect(history[0].text).contains('Please fill in all fields');
    
    await t.click(authSwitchBtn);
    await t.expect(confirmBtn.innerText).eql('Sign In');
    await t.expect(signupFields.getStyleProperty('display')).eql('none');
});