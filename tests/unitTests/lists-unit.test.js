import { describe, it, expect } from 'vitest';
import {
    processFetchedLists,
    filterListsByCategory
} from '../../js/logic/lists-logic.js';

describe('Privacy and Compilation Logic', () => {
    const mockOwned = [
        { id: '1', user_id: 'owner123', is_public: true, created_at: '2020-01-01', sort_rank: 2 },
        { id: '2', user_id: 'owner123', is_public: false, created_at: '2020-01-02', sort_rank: 1 }
    ];
    
    const mockCollabRecords = [
        { media_lists: { id: '3', user_id: 'other456', is_public: false, created_at: '2020-01-03', sort_rank: null } }
    ];

    it('hides private lists from unauthorized visitors', () => {
        const processed = processFetchedLists(mockOwned, [], 'owner123', 'visitor789', new Set(), false);
        expect(processed.length).toBe(1);
        expect(processed[0].id).toBe('1'); // Only the public list survives
    });

    it('allows private lists if the visitor is a collaborator', () => {
        const visitorCollabs = new Set(['2']);
        const processed = processFetchedLists(mockOwned, [], 'owner123', 'visitor789', visitorCollabs, false);
        expect(processed.length).toBe(2); // The private list (id: 2) is allowed
    });

    it('merges owned and collaborative lists and sorts properly', () => {
        const processed = processFetchedLists(mockOwned, mockCollabRecords, 'owner123', 'owner123', new Set(), true);
        expect(processed.length).toBe(3);
        
        // Sort order check: sort_rank 1 -> sort_rank 2 -> null sort_rank (falls back to created_at)
        expect(processed[0].id).toBe('2'); // rank 1
        expect(processed[1].id).toBe('1'); // rank 2
        expect(processed[2].id).toBe('3'); // null rank
    });
});

describe('Category Filtering Logic', () => {
    const lists = [
        { id: 'A', user_id: 'me', is_tiered: false },
        { id: 'B', user_id: 'them', is_tiered: false },
        { id: 'C', user_id: 'me', is_tiered: true }
    ];

    it('filters owned standard lists', () => {
        const result = filterListsByCategory(lists, 'owned', 'me');
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('A');
    });

    it('filters shared standard lists', () => {
        const result = filterListsByCategory(lists, 'shared', 'me');
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('B');
    });

    it('filters tier lists regardless of ownership', () => {
        const result = filterListsByCategory(lists, 'tier', 'me');
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('C');
    });
});