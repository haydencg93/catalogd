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
const totalLogsStat = Selector('#total-logs');
const toggleFiltersBtn = Selector('#toggle-filters-btn');
const advancedFiltersPanel = Selector('#advanced-filters');

const ratingHeader = Selector('th[data-sort="rating"]');
const ratingSortIcon = Selector('#rating-sort-icon');

const diaryTableBody = Selector('#diary-body');
const reviewModal = Selector('#review-modal');
const closeReviewModalBtn = Selector('.close-modal');

// ----------------------------------------
// Test Suite
// ----------------------------------------
fixture `diary-interactions`
    .page`127.0.0.1:5500/diary.html`
    .beforeEach(async t => {
        await t.useRole(authenticatedUser);
        await t.navigateTo('http://127.0.0.1:5500/diary.html');
        
        // Hydration check: Ensure the database fetch completes before interacting
        await t.expect(totalLogsStat.innerText).notEql('0', { timeout: 15000 });
    });

test('Advanced filters panel toggles visibility', async t => {
    await t.expect(advancedFiltersPanel.hasClass('show')).notOk();
    
    await t.click(toggleFiltersBtn);
    await t.expect(advancedFiltersPanel.hasClass('show')).ok();
    
    await t.click(toggleFiltersBtn);
    await t.expect(advancedFiltersPanel.hasClass('show')).notOk();
});

test('Table headers trigger sort order changes', async t => {
    // Click rating header once
    await t.click(ratingHeader);
    const initialIcon = await ratingSortIcon.innerText;
    
    // Click rating header again to reverse sort
    await t.click(ratingHeader);
    const reversedIcon = await ratingSortIcon.innerText;
    
    await t.expect(initialIcon).notEql(reversedIcon);
});

test('Review modal opens and closes correctly', async t => {
    // Find the first row that actually has a review indicator
    const reviewIcon = diaryTableBody.find('.review-indicator').nth(0);
    
    // Only proceed if a review exists in the test data
    if (await reviewIcon.exists) {
        await t.click(reviewIcon);
        
        await t.expect(reviewModal.getStyleProperty('display')).eql('block');
        await t.expect(Selector('#modal-title').innerText).contains('Review:');
        
        await t.click(closeReviewModalBtn);
        await t.expect(reviewModal.getStyleProperty('display')).eql('none');
    } else {
        console.warn('No reviews found in test account diary. Skipping modal interaction.');
    }
});