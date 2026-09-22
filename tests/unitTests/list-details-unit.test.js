import { describe, it, expect } from 'vitest';
import {
    processSearchResults,
    normalizeListItemDetails,
    calculateNewItemRank
} from '../../js/logic/list-details-logic.js';

describe('Search Results Normalization', () => {
    it('safely handles empty or null payloads', () => {
        const results = processSearchResults(null, null, null, false);
        expect(results.length).toBe(0);
    });

    it('filters out persons for tiered lists and maps composite album IDs', () => {
        const tmdb = [{ id: 1, title: 'Movie A', media_type: 'movie' }, { id: 2, name: 'Actor A', media_type: 'person' }];
        const albums = { results: { albummatches: { album: [{ name: 'Thriller', artist: 'MJ' }] } } };
        
        // isTiered = false (Filters out person)
        const standardResults = processSearchResults(tmdb, [], null, false);
        expect(standardResults.length).toBe(1);
        expect(standardResults[0].type).toBe('movie');

        // Album ID generation
        const albumResults = processSearchResults([], [], albums, false);
        expect(albumResults[0].id).toBe(encodeURIComponent('MJ|||Thriller'));
    });
});

describe('List Item Details Mapping', () => {
    it('prioritizes custom art over API data', () => {
        const item = { media_type: 'movie', media_id: '123' };
        const apiResponse = { title: 'Standard Title', poster_path: '/standard.jpg' };
        const customMap = new Map();
        customMap.set('movie_123', { custom_poster: 'https://custom.jpg' });

        const result = normalizeListItemDetails(item, apiResponse, customMap);
        expect(result.poster).toBe('https://custom.jpg');
    });

    it('generates UI avatars for character types', () => {
        const item = { media_type: 'character', media_title: 'Luke Skywalker' };
        const result = normalizeListItemDetails(item, null, new Map());
        expect(result.poster).toContain('ui-avatars.com');
        expect(result.poster).toContain('Luke%20Skywalker');
    });
});

describe('Rank Calculation', () => {
    it('assigns ranks only if the list is ranked or tiered', () => {
        expect(calculateNewItemRank(5, true, false).newRank).toBe(6);
        expect(calculateNewItemRank(5, false, true).newRank).toBe(6);
        expect(calculateNewItemRank(5, false, false).newRank).toBeNull();
    });

    it('assigns NS tier rank only if the list is tiered', () => {
        expect(calculateNewItemRank(5, false, true).newTierRank).toBe('NS');
        expect(calculateNewItemRank(5, true, false).newTierRank).toBe('NS'); // Ranked logic triggers default NS
    });
});