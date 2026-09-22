import { describe, it, expect } from 'vitest';
import {
    getSafeDate,
    checkIsOngoing,
    filterStatsData,
    calculateBasicStats
} from '../../js/logic/stats-logic.js';

describe('Date Normalization', () => {
    it('appends noon offset to raw YYYY-MM-DD strings', () => {
        const date = getSafeDate({ watched_on: '2024-01-01' });
        expect(date.getHours()).toBe(12);
    });

    it('leaves full ISO strings intact', () => {
        const date = getSafeDate({ created_at: '2024-01-01T08:30:00Z' });
        expect(date.getUTCHours()).toBe(8);
    });
});

describe('Ongoing Period Evaluation', () => {
    it('evaluates year boundaries dynamically', () => {
        const mockNow = new Date('2024-06-01T12:00:00Z');
        expect(checkIsOngoing('by-year', '2024', mockNow)).toBe(true);
        expect(checkIsOngoing('by-year', '2023', mockNow)).toBe(false);
    });

    it('handles Winter wrap-around logic', () => {
        const mockNowInJan = new Date('2024-01-15T12:00:00Z');
        expect(checkIsOngoing('by-season', 'Winter 2023-2024', mockNowInJan)).toBe(true);
    });
});

describe('Data Filtering', () => {
    const mockLogs = [
        { media_type: 'movie', watched_on: '2023-05-15' }, // Spring 2023
        { media_type: 'tv', watched_on: '2023-12-15' }     // Winter 2023-2024
    ];

    it('filters by media type', () => {
        const res = filterStatsData(mockLogs, 'movie', 'all-time', 'all');
        expect(res.length).toBe(1);
        expect(res[0].media_type).toBe('movie');
    });

    it('filters by exact season bounds', () => {
        const res = filterStatsData(mockLogs, 'all', 'by-season', 'Winter 2023-2024');
        expect(res.length).toBe(1);
        expect(res[0].media_type).toBe('tv');
    });
});

describe('Statistics Math', () => {
    it('multiplies TV runtimes by episode counts for entire series logs', () => {
        const mockLogs = [
            { media_type: 'tv', log_level: 'entire', runtime: 30, ep_count_in_season: 10 }
        ];
        const stats = calculateBasicStats(mockLogs);
        // 30 mins * 10 eps = 300 mins = 5.0 hours
        expect(stats.hoursWatched).toBe('5.0');
        expect(stats.totalTvEpisodes).toBe(10);
    });

    it('sums finished book pages', () => {
        const mockLogs = [
            { media_type: 'book', is_finished: true, total_pages: 300 },
            { media_type: 'book', is_finished: false, total_pages: 500 } // Should be ignored
        ];
        const stats = calculateBasicStats(mockLogs);
        expect(stats.totalPages).toBe(300);
    });
});