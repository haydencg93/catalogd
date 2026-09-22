import { describe, it, expect } from 'vitest';
import {
    buildYoutubeFallbackData,
    getLogScopeLabel,
    categorizeProviders,
    normalizeCredits
} from '../../js/logic/details-logic.js';

describe('YouTube Fallback Generation', () => {
    it('flags invalid IDs and returns fallback data', () => {
        const invalid = buildYoutubeFallbackData('short');
        expect(invalid.isValidId).toBe(false);
        expect(invalid.isUnavailable).toBe(true);
        
        const valid = buildYoutubeFallbackData('dQw4w9WgXcQ');
        expect(valid.isValidId).toBe(true);
    });
});

describe('Log Scope Labeling', () => {
    it('formats TV show scopes based on episode and season presence', () => {
        expect(getLogScopeLabel({ season_number: 1, episode_number: 2 }, 'tv', {})).toBe('S1 E2');
        expect(getLogScopeLabel({ season_number: 1 }, 'tv', {})).toBe('Season 1');
        expect(getLogScopeLabel({}, 'tv', {})).toBe('Entire Series');
    });

    it('formats Book scopes based on page or chapter presence', () => {
        expect(getLogScopeLabel({ current_page: 50, is_finished: false }, 'book', {})).toBe('Page 50');
        expect(getLogScopeLabel({ chapter_number: 3 }, 'book', {})).toBe('Chapter 3');
        expect(getLogScopeLabel({ is_finished: true }, 'book', {})).toBe('Entire Book');
    });

    it('formats Album scopes using global track data', () => {
        const mockData = { tracks: [{ name: 'Track A' }, { name: 'Track B' }] };
        expect(getLogScopeLabel({ episode_number: 2 }, 'album', mockData)).toBe('Track 2: Track B');
    });
});

describe('Watch Provider Categorization', () => {
    it('merges free and ad-supported arrays without duplication', () => {
        const mockResults = {
            free: [{ provider_id: 1, name: 'Tubi' }],
            ads: [{ provider_id: 1, name: 'Tubi' }, { provider_id: 2, name: 'Pluto' }]
        };
        
        const categorized = categorizeProviders(mockResults);
        expect(categorized.freeToWatchList.length).toBe(2);
    });

    it('isolates unhandled providers into the otherList', () => {
        const mockResults = {
            flatrate: [{ provider_id: 8, name: 'Netflix' }],
            unknown_category: [{ provider_id: 99, name: 'Niche Channel' }, { provider_id: 8, name: 'Netflix' }]
        };
        
        const categorized = categorizeProviders(mockResults);
        expect(categorized.streamList.length).toBe(1);
        expect(categorized.otherList.length).toBe(1); // Should exclude Netflix since it's in flatrate
        expect(categorized.otherList[0].provider_id).toBe(99);
    });
});

describe('Credits Normalization', () => {
    it('appends episode counts only for TV shows', () => {
        const mockRes = { cast: [{ name: 'Actor A', total_episode_count: 5 }], crew: [] };
        
        const tvCredits = normalizeCredits(mockRes, 'tv');
        expect(tvCredits.fullCast[0].epCountStr).toBe('5 Eps');

        const movieCredits = normalizeCredits(mockRes, 'movie');
        expect(movieCredits.fullCast[0].epCountStr).toBe('');
    });

    it('identifies the director correctly', () => {
        const mockRes = { 
            cast: [], 
            crew: [{ job: 'Writer', name: 'A' }, { job: 'Director', name: 'B' }] 
        };
        const credits = normalizeCredits(mockRes, 'movie');
        expect(credits.director.name).toBe('B');
    });
});