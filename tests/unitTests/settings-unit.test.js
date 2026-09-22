import { describe, it, expect } from 'vitest';
import {
    splitProviders,
    sortLanguages,
    parseYouTubeId,
    buildFavsCsvArray,
    parseLetterboxdListCsv,
    parseAdvancedCsv,
    buildImportPayload
} from '../../js/logic/settings-logic.js';

describe('TMDB Provider Splitting', () => {
    it('sorts by priority and routes to correct buckets', () => {
        const mockProviders = [
            { provider_id: 8, provider_name: 'Netflix', display_priorities: { US: 2 } }, // Streaming
            { provider_id: 2, provider_name: 'Apple TV', display_priorities: { US: 1 } }, // Buying
            { provider_id: 15, provider_name: 'Hulu', display_priorities: { US: 3 } }    // Streaming
        ];

        const { topStreaming, topBuying } = splitProviders(mockProviders);
        
        expect(topBuying.length).toBe(1);
        expect(topBuying[0].provider_name).toBe('Apple TV');
        
        expect(topStreaming.length).toBe(2);
        expect(topStreaming[0].provider_name).toBe('Netflix'); // Priority 2 comes before 3
        expect(topStreaming[1].provider_name).toBe('Hulu');
    });
});

describe('Language Sorting', () => {
    it('sorts languages alphabetically by english_name', () => {
        const langs = [{ english_name: 'Spanish' }, { english_name: 'Arabic' }, { english_name: 'English' }];
        const sorted = sortLanguages(langs);
        
        expect(sorted[0].english_name).toBe('Arabic');
        expect(sorted[1].english_name).toBe('English');
        expect(sorted[2].english_name).toBe('Spanish');
    });
});

describe('YouTube Regex Parsing', () => {
    it('extracts IDs from various valid URL formats', () => {
        expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=5')).toBe('dQw4w9WgXcQ');
    });

    it('returns null for standard search text', () => {
        expect(parseYouTubeId('Star Wars Trailer')).toBeNull();
    });
});

describe('CSV Array Compilation', () => {
    it('builds a PapaParse-ready nested array with mapped custom art', () => {
        const favs = { movie: [{ title: 'Inception', id: '123' }, { title: 'Dune', id: '456' }] };
        const customMap = new Map();
        customMap.set('movie_456', { poster: 'dune-custom.jpg', bg: '' });

        const csvData = buildFavsCsvArray(favs, customMap);
        
        // Row 0 is Headers, Row 1 is Inception, Row 2 is Dune
        expect(csvData.length).toBe(3);
        expect(csvData[0][0]).toBe('Type');
        
        // Inception: Rank 1, No custom art
        expect(csvData[1][3]).toBe(1); // Rank
        expect(csvData[1][4]).toBe(''); // Custom Poster
        
        // Dune: Rank 2, Custom art
        expect(csvData[2][3]).toBe(2); // Rank
        expect(csvData[2][4]).toBe('dune-custom.jpg'); // Custom Poster
    });
});

describe('Letterboxd CSV Parsing', () => {
    it('extracts list metadata and dynamically locates movie rows', () => {
        const rawLetterboxdList = [
            ["Letterboxd list export v7"],
            ["Date", "Name", "Tags", "URL", "Description"],
            ["2024-01-01", "My Sci-Fi List", "", "", "A cool list"],
            [],
            ["Position", "Name", "Year", "URL", "Description"],
            ["1", "Dune", "2021", "", ""]
        ];

        const res = parseLetterboxdListCsv(rawLetterboxdList);
        expect(res.error).toBeUndefined();
        expect(res.listName).toBe("My Sci-Fi List");
        expect(res.listDescription).toBe("A cool list");
        expect(res.movieRows.length).toBe(1);
        expect(res.movieRows[0][1]).toBe("Dune");
    });

    it('returns an error if the header row is missing', () => {
        const malformedList = [
            ["Letterboxd list export v7"],
            ["Date", "Name", "Tags", "URL", "Description"],
            ["2024-01-01", "My Sci-Fi List", "", "", "A cool list"]
        ];
        const res = parseLetterboxdListCsv(malformedList);
        expect(res.error).toBe("Could not find movie data in CSV.");
    });
});

describe('Advanced CSV Mapping', () => {
    it('maps a 2D array into an array of objects based on the first row', () => {
        const rawData = [
            ["Name", "Year", "Rating"],
            ["Inception", "2010", "5"],
            ["Arrival", "2016", "4.5"]
        ];
        const res = parseAdvancedCsv(rawData);
        expect(res.length).toBe(2);
        expect(res[0].Name).toBe("Inception");
        expect(res[1].Rating).toBe("4.5");
    });
});

describe('Import Payload Construction', () => {
    it('conditionally applies the ID field for overwrites', () => {
        const mediaInfo = { id: 550, type: 'movie', runtime: 139 };
        
        const newPayload = buildImportPayload('user1', mediaInfo, 'Fight Club', '1999-10-15', 5, false, null);
        expect(newPayload.id).toBeUndefined();
        expect(newPayload.runtime).toBe(139);

        const overwritePayload = buildImportPayload('user1', mediaInfo, 'Fight Club', '1999-10-15', 5, false, 'uuid-1234');
        expect(overwritePayload.id).toBe('uuid-1234');
    });
});