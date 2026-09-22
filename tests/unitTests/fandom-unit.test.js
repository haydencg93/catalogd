import { describe, it, expect } from 'vitest';
import {
    buildWikidataQuery,
    sortCollectionItems,
    normalizeFandomCharacter,
    processTVDBLists
} from '../../js/logic/fandom-logic.js';

describe('Wikidata SPARQL URL Generation', () => {
    it('injects variables and encodes the query string', () => {
        const url = buildWikidataQuery('P4947', '12345');
        expect(url).toContain('https://query.wikidata.org/sparql?query=');
        expect(url).toContain('P4947');
        expect(url).toContain('12345');
    });
});

describe('Collection Sorting', () => {
    it('sorts by mixed date fields with 9999 fallbacks', () => {
        const items = [
            { id: 1, year: '2005-05-19' },
            { id: 2, firstAired: '1999-05-19' },
            { id: 3 } // No date, should drop to bottom
        ];
        
        const sorted = sortCollectionItems(items);
        expect(sorted[0].id).toBe(2); // 1999
        expect(sorted[1].id).toBe(1); // 2005
        expect(sorted[2].id).toBe(3); // 9999 fallback
    });
});

describe('Character Normalization', () => {
    it('cleans (voice) tags and slashes from names', () => {
        const charA = normalizeFandomCharacter({ character: 'Darth Vader (voice)' }, 'movie');
        expect(charA.name).toBe('Darth Vader');
        expect(charA.wikiId).toBe('Darth_Vader');

        const charB = normalizeFandomCharacter({ character: 'Anakin / Vader' }, 'movie');
        expect(charB.name).toBe('Anakin');
        expect(charB.wikiId).toBe('Anakin');
    });
});

describe('TVDB List Processing', () => {
    it('prioritizes official lists and deduplicates by name', () => {
        const rawLists = [
            { name: 'Star Wars Saga', isOfficial: false },
            { name: 'Star Wars Saga', isOfficial: true }, // Should overwrite the unofficial one
            { name: 'Random List', isOfficial: false } // Should be filtered out
        ];
        
        const processed = processTVDBLists(rawLists);
        expect(processed.length).toBe(1);
        expect(processed[0].isOfficial).toBe(true);
        expect(processed[0].name).toBe('Star Wars Saga');
    });
});