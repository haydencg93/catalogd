import { describe, it, expect } from 'vitest';
import {
    filterLogs,
    sortLogs,
    calculateStats
} from '../../js/logic/diary-logic.js';

const mockLogs = [
    { id: 1, media_type: 'movie', rating: 5, release_year: 1995, is_liked: true, notes: 'Great', runtime: 120 },
    { id: 2, media_type: 'tv', rating: 3, release_year: 2008, is_liked: false, notes: '', runtime: 45 },
    { id: 3, media_type: 'book', rating: 4, release_year: null, is_liked: true, notes: 'Good read', runtime: 0, is_finished: true }
];

describe('Diary Filtering Logic', () => {
    it('filters by media type', () => {
        const filters = { type: 'movie', rating: 'all', year: 'all', liked: 'all', review: 'all', rewatch: 'all', tag: 'all', searchTerm: '' };
        const result = filterLogs(mockLogs, filters);
        expect(result.length).toBe(1);
        expect(result[0].media_type).toBe('movie');
    });

    it('filters by decade release year', () => {
        const filters = { type: 'all', rating: 'all', year: '1990s', liked: 'all', review: 'all', rewatch: 'all', tag: 'all', searchTerm: '' };
        const result = filterLogs(mockLogs, filters);
        expect(result.length).toBe(1);
        expect(result[0].release_year).toBe(1995);
    });

    it('filters by review status', () => {
        const filters = { type: 'all', rating: 'all', year: 'all', liked: 'all', review: 'unreviewed', rewatch: 'all', tag: 'all', searchTerm: '' };
        const result = filterLogs(mockLogs, filters);
        expect(result.length).toBe(1);
        expect(result[0].media_type).toBe('tv'); // Missing notes
    });
});

describe('Diary Sorting Logic', () => {
    it('sorts ratings in descending order', () => {
        const sorted = sortLogs(mockLogs, 'rating', 'desc');
        expect(sorted[0].rating).toBe(5);
        expect(sorted[2].rating).toBe(3);
    });

    it('sorts ratings in ascending order', () => {
        const sorted = sortLogs(mockLogs, 'rating', 'asc');
        expect(sorted[0].rating).toBe(3);
        expect(sorted[2].rating).toBe(5);
    });
});

describe('Diary Statistics Calculation', () => {
    it('computes averages and sums accurately', () => {
        const stats = calculateStats(mockLogs);
        
        expect(stats.totalLogs).toBe(3);
        // (5 + 3 + 4) / 3 = 4.0
        expect(stats.avgRating).toBe('4.0');
        expect(stats.totalMovies).toBe(1);
        expect(stats.totalBooks).toBe(1);
        
        // 165 minutes = 0d 2h 45m
        expect(stats.totalMinutes).toBe(165);
        expect(stats.days).toBe(0);
        expect(stats.hours).toBe(2);
        expect(stats.minutes).toBe(45);
    });
});