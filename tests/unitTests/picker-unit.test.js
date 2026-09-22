import { describe, it, expect } from 'vitest';
import {
    shuffleArray,
    isAnime,
    getActionLabel,
    evaluatePickerProviderConstraints
} from '../../js/logic/picker-logic.js';

describe('Data Randomization & Mapping', () => {
    it('shuffleArray retains all original elements', () => {
        const original = [1, 2, 3, 4, 5];
        const shuffled = shuffleArray([...original]);
        expect(shuffled.length).toBe(5);
        expect(shuffled).toContain(1);
        expect(shuffled).toContain(5);
    });

    it('getActionLabel maps types correctly', () => {
        expect(getActionLabel('book')).toBe('Mark as Currently Reading');
        expect(getActionLabel('album')).toBe('Mark as Currently Listening');
        expect(getActionLabel('movie')).toBe('Mark as Currently Watching');
    });
});

describe('Anime Payload Identification', () => {
    it('requires genre 16 and Japanese origin/language', () => {
        const validAnime1 = { genres: [{ id: 16 }], origin_country: ['JP'] };
        const validAnime2 = { genre_ids: [16], original_language: 'ja' };
        const invalidAnime = { genres: [{ id: 16 }], origin_country: ['US'] }; // Animation, but not Japanese

        expect(isAnime(validAnime1)).toBe(true);
        expect(isAnime(validAnime2)).toBe(true);
        expect(isAnime(invalidAnime)).toBe(false);
    });
});

describe('Provider Constraint Evaluation', () => {
    it('bypasses constraints for non-video media', () => {
        const res = evaluatePickerProviderConstraints('book', true, [], {});
        expect(res.isAvailable).toBe(true);
    });

    it('returns all providers when user constraints are disabled', () => {
        const mockProviders = {
            flatrate: [{ provider_id: 8 }, { provider_id: 15 }]
        };
        const res = evaluatePickerProviderConstraints('movie', false, [], mockProviders);
        
        expect(res.isAvailable).toBe(true);
        expect(res.availableProvidersList.length).toBe(2);
    });

    it('enforces user constraints when enabled', () => {
        const mockProviders = {
            flatrate: [{ provider_id: 8 }, { provider_id: 15 }] // Netflix(8), Hulu(15)
        };
        
        // User only has Hulu (15)
        const validRes = evaluatePickerProviderConstraints('movie', true, ['15'], mockProviders);
        expect(validRes.isAvailable).toBe(true);
        expect(validRes.availableProvidersList.length).toBe(1);
        expect(validRes.availableProvidersList[0].provider_id).toBe(15);

        // User only has Max (384)
        const invalidRes = evaluatePickerProviderConstraints('movie', true, ['384'], mockProviders);
        expect(invalidRes.isAvailable).toBe(false);
    });
});