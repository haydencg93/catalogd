import { describe, it, expect } from 'vitest';
import { 
    calculateWeight, 
    evaluateProviderAvailability,
    sortSearchResults,
    resolveBookImage,
    attributionHtml,
    buildDiscoverUrls,
    backgroundStyle,
    extractYouTubeId,
    normalizeTMDBItem,
    normalizeUserItem
} from '../../js/logic/index-logic.js';

describe('Data Formatting Helpers', () => {
    it('resolveBookImage uses edition key first', () => {
        expect(resolveBookImage({ cover_edition_key: 'A', cover_i: 'B' })).toContain('A-M.jpg');
    });

    it('attributionHtml creates valid links', () => {
        const attr = { text: 'Unsplash', url: 'https://unsplash.com' };
        expect(attributionHtml(attr)).toContain('href="https://unsplash.com"');
    });

    it('backgroundStyle defaults to fallback gradient', () => {
        expect(backgroundStyle(null, 'linear-gradient(black, white)')).toContain('linear-gradient(black, white)');
    });

    it('buildDiscoverUrls generates correct proxy strings', () => {
        const { keywordUrls } = buildDiscoverUrls('movie', ['28'], ['123'], 'https://proxy.com');
        expect(keywordUrls[0]).toContain('https://proxy.com/api/tmdb/discover/movie');
        expect(keywordUrls[0]).toContain('with_genres=28');
        expect(keywordUrls[0]).toContain('with_keywords=123');
    });
});

describe('Search & Ranking Logic', () => {
    it('extractYouTubeId extracts IDs from valid links', () => {
        expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(extractYouTubeId('not a link')).toBeNull();
    });

    it('normalizeTMDBItem handles person deduplication', () => {
        const seenNames = new Set(['john doe']);
        const item = { media_type: 'person', name: 'John Doe', id: 1 };
        
        // Should return null because name is in the set
        expect(normalizeTMDBItem(item, 'all', seenNames)).toBeNull();
        
        const newItem = { media_type: 'person', name: 'Jane Doe', id: 2 };
        const result = normalizeTMDBItem(newItem, 'all', seenNames);
        expect(result.title).toBe('Jane Doe');
        expect(seenNames.has('jane doe')).toBe(true);
    });

    it('normalizeUserItem builds standard avatar links', () => {
        const rawUser = { username: 'testuser', display_name: 'Test', avatar_url: null, id: 1 };
        const result = normalizeUserItem(rawUser);
        expect(result.image).toContain('ui-avatars.com');
        expect(result.year).toBe('@testuser');
    });

    it('prioritizes exact matches then prefix matches', () => {
        const data = [{ title: 'The Matrix' }, { title: 'Matrix Reloaded' }, { title: 'Matrix' }];
        sortSearchResults(data, 'matrix');
        expect(data[0].title).toBe('Matrix');
        expect(data[1].title).toBe('Matrix Reloaded');
        expect(data[2].title).toBe('The Matrix');
    });
});

describe('Provider & Rating Logic', () => {
    it('calculateWeight returns correct tier multipliers', () => {
        expect(calculateWeight(5)).toBe(5);
        expect(calculateWeight(4.5)).toBe(2.5);
        expect(calculateWeight(3)).toBe(1);
    });

    it('evaluateProviderAvailability validates free streaming options', () => {
        const item = { 'watch/providers': { results: { US: { free: [{ provider_id: 11 }] } } } };
        // Even if user hasn't subscribed to anything, free options should pass
        expect(evaluateProviderAvailability(item, ['999'])).toBe(true);
    });
});