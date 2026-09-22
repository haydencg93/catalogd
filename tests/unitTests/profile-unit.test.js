import { describe, it, expect } from 'vitest';
import {
    buildLibraryArray,
    calculateRevisitCandidates,
    sortTrackedEntities
} from '../../js/logic/profile-logic.js';

describe('Library Array Compilation', () => {
    it('excludes dropped items', () => {
        const statuses = [{ media_id: '1', media_type: 'movie', status: 'dropped' }];
        const logs = [{ media_id: '1', media_type: 'movie', rating: 5 }];
        
        const library = buildLibraryArray(statuses, logs);
        expect(library.length).toBe(0);
    });

    it('merges logs and statuses, prioritizing earliest add date and latest rating', () => {
        const statuses = [{ media_id: '2', media_type: 'tv', status: 'active', created_at: '2020-01-01T00:00:00Z' }];
        const logs = [
            { media_id: '2', media_type: 'tv', rating: 3, created_at: '2021-01-01T00:00:00Z', watched_on: '2021-01-01' },
            { media_id: '2', media_type: 'tv', rating: 5, created_at: '2022-01-01T00:00:00Z', watched_on: '2022-01-01' } // Newest log
        ];
        
        const library = buildLibraryArray(statuses, logs);
        expect(library.length).toBe(1);
        expect(library[0].first_added).toBe('2020-01-01T00:00:00Z'); // Earliest date preserved
        expect(library[0].rating).toBe(5); // Latest rating preserved
    });
});

describe('Revisit Candidate Math', () => {
    it('filters out low ratings and recent watches', () => {
        const nowMs = new Date('2024-01-01T00:00:00Z').getTime();
        const logs = [
            { media_id: '1', media_type: 'movie', rating: 3, watched_on: '2020-01-01' }, // High enough age, low rating
            { media_id: '2', media_type: 'movie', rating: 5, watched_on: '2023-12-01' }, // High rating, too recent (1 mo)
            { media_id: '3', media_type: 'movie', rating: 5, watched_on: '2021-01-01' }  // High rating, > 1 year ago
        ];

        const candidates = calculateRevisitCandidates(logs, nowMs);
        expect(candidates.movie.length).toBe(1);
        expect(candidates.movie[0].media_id).toBe('3');
    });
});

describe('Tracked Entity Sorting', () => {
    it('filters by category and sorts by rank', () => {
        const entities = [
            { id: 1, type: 'actor', rank: 2 },
            { id: 2, type: 'character', rank: 1 },
            { id: 3, type: 'actor', rank: 1 }
        ];

        const sortedActors = sortTrackedEntities(entities, 'type', 'actor');
        expect(sortedActors.length).toBe(2);
        expect(sortedActors[0].id).toBe(3); // Rank 1 should be first
        expect(sortedActors[1].id).toBe(1); // Rank 2 should be second
    });
});