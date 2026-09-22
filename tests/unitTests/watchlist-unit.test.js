import { describe, it, expect } from 'vitest';
import { calculatePagination } from '../../js/logic/watchlist-logic.js';

describe('Watchlist Pagination Math', () => {
    const mockItems = [
        { id: 1, media_type: 'movie' },
        { id: 2, media_type: 'movie' },
        { id: 3, media_type: 'tv' }
    ];

    it('filters items correctly before paginating', () => {
        const res = calculatePagination(mockItems, 1, 10, 'movie');
        expect(res.totalFilteredItems).toBe(2);
        expect(res.paginatedItems.length).toBe(2);
    });

    it('bounds the current page to a minimum of 1', () => {
        const res = calculatePagination(mockItems, -5, 10, 'all');
        expect(res.boundedCurrentPage).toBe(1);
    });

    it('caps the current page to the maximum total pages', () => {
        // 3 items with pageSize 1 means 3 total pages
        const res = calculatePagination(mockItems, 99, 1, 'all');
        expect(res.boundedCurrentPage).toBe(3);
        expect(res.totalPages).toBe(3);
    });

    it('slices the array strictly to the page size', () => {
        const res = calculatePagination(mockItems, 1, 2, 'all');
        expect(res.paginatedItems.length).toBe(2);
        expect(res.paginatedItems[0].id).toBe(1);
        expect(res.paginatedItems[1].id).toBe(2);
    });
});