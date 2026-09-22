import { describe, it, expect } from 'vitest';
import {
    deduplicateResults,
    applyTextFilter,
    checkYearLocally,
    checkLanguage,
    checkProviders,
    getProviderParams,
    buildBaseUrl
} from '../../js/logic/adv-search-logic.js';

describe('Result Filtering & Sorting', () => {
    it('deduplicateResults removes duplicate TMDB IDs', () => {
        const results = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 1, title: 'A' }];
        const unique = deduplicateResults(results);
        expect(unique.length).toBe(2);
    });

    it('applyTextFilter prioritizes title matches over overview matches', () => {
        const results = [
            { title: 'Other', overview: 'A movie about Batman', popularity: 10 },
            { title: 'Batman Begins', overview: 'Hero', popularity: 5 }
        ];
        const sorted = applyTextFilter(results, 'batman');
        expect(sorted[0].title).toBe('Batman Begins');
    });

    it('checkYearLocally validates min and max bounds', () => {
        const item = { release_date: '1999-03-31' };
        expect(checkYearLocally(item, { minYear: '1990', maxYear: '2000' })).toBe(true);
        expect(checkYearLocally(item, { minYear: '2000', maxYear: '2010' })).toBe(false);
    });
});

describe('API Payload Evaluation', () => {
    it('checkLanguage respects original vs both rules', () => {
        const detailData = {
            original_language: 'es',
            translations: { translations: [{ iso_639_1: 'en' }] }
        };
        
        // Fails if we only want original language English
        expect(checkLanguage(detailData, 'original', ['en'])).toBe(false);
        // Passes if we accept translations
        expect(checkLanguage(detailData, 'both', ['en'])).toBe(true);
    });

    it('checkProviders evaluates flatrate and free options', () => {
        const detailData = {
            'watch/providers': { results: { US: { flatrate: [{ provider_id: 8 }] } } }
        };
        
        expect(checkProviders(detailData, false, ['8', '15'])).toBe(true);
        expect(checkProviders(detailData, false, ['15'])).toBe(false);
    });
});

describe('URL Construction', () => {
    it('getProviderParams formats strings correctly based on includeFree', () => {
        expect(getProviderParams({ providersStr: '8|15', includeFree: true })).toBe('&with_watch_monetization_types=flatrate|free|ads');
        expect(getProviderParams({ providersStr: '8|15', includeFree: false })).toBe('&with_watch_providers=8|15&with_watch_monetization_types=flatrate|free|ads');
    });

    it('buildBaseUrl concatenates all filter rules', () => {
        const filters = {
            providersStr: '8',
            includeFree: false,
            keywordsStr: '123',
            coreGenresStr: '28',
            selectedIsos: [],
            minYear: '2020',
            maxYear: null
        };
        
        const url = buildBaseUrl('movie', filters, 'https://proxy.com');
        expect(url).toContain('https://proxy.com/api/tmdb/discover/movie');
        expect(url).toContain('with_watch_providers=8');
        expect(url).toContain('with_keywords=123');
        expect(url).toContain('with_genres=28');
        expect(url).toContain('primary_release_date.gte=2020-01-01');
    });
});