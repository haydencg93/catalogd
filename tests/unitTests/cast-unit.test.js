import { describe, it, expect } from 'vitest';
import {
    extractYear,
    formatPlays,
    deduplicateCredits,
    calculateKnownForScore
} from '../../js/logic/cast-logic.js';

describe('Data Parsing Formatting', () => {
    it('extractYear pulls 4-digit years from mixed string formats', () => {
        expect(extractYear({ first_publish_date: '1999-10-31' })).toBe('1999');
        expect(extractYear({ publish_date: 'October 2001' })).toBe('2001');
        expect(extractYear({ created: { value: '2020-01-01' } })).toBe('2020');
        expect(extractYear({})).toBeNull();
    });

    it('formatPlays converts large numbers to K and M shorthand', () => {
        expect(formatPlays('500')).toBe('500');
        expect(formatPlays('1500')).toBe('1.5K');
        expect(formatPlays('2500000')).toBe('2.5M');
    });
});

describe('Credit Array Processing', () => {
    it('deduplicateCredits removes items without posters and duplicate IDs', () => {
        const rawCredits = [
            { id: 1, title: 'A', poster_path: '/img1.jpg' },
            { id: 1, title: 'A Duplicate', poster_path: '/img1.jpg' }, // Duplicate ID
            { id: 2, title: 'B', poster_path: null }, // Missing poster
            { id: 3, title: 'C', poster_path: '/img3.jpg' }
        ];
        
        const clean = deduplicateCredits(rawCredits);
        expect(clean.length).toBe(2);
        expect(clean[0].id).toBe(1);
        expect(clean[1].id).toBe(3);
    });

    it('calculateKnownForScore doubles movie votes and retains tv votes', () => {
        const movie = { media_type: 'movie', vote_count: 100 };
        const tv = { media_type: 'tv', vote_count: 100 };
        const missingData = {};

        expect(calculateKnownForScore(movie)).toBe(200);
        expect(calculateKnownForScore(tv)).toBe(100);
        expect(calculateKnownForScore(missingData)).toBe(0);
    });
});
