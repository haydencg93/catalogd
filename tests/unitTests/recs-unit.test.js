import { describe, it, expect } from 'vitest';
import {
    getUniversalId,
    validateVibeInput,
    evaluateStreamingAvailability
} from '../../js/logic/recs-logic.js';

describe('ID Normalization', () => {
    it('standardizes OpenLibrary works keys into integers', () => {
        expect(getUniversalId('/works/OL27448W', 'book')).toBe(100027448);
        expect(getUniversalId('OL123W', 'book')).toBe(100000123);
    });

    it('passes TMDB IDs as integers', () => {
        expect(getUniversalId('550', 'movie')).toBe(550);
        expect(getUniversalId(1399, 'tv')).toBe(1399);
    });
});

describe('Vibe Input Validation', () => {
    const mockInputs = [
        { universalId: 1 }, { universalId: 2 }, { universalId: 3 }, 
        { universalId: 4 }, { universalId: 5 }
    ];

    it('rejects arrays that have reached the 5-item limit', () => {
        const res = validateVibeInput(mockInputs, { universalId: 6 });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('up to 5 items');
    });

    it('rejects duplicate universal IDs', () => {
        const current = [{ universalId: 100 }];
        const res = validateVibeInput(current, { universalId: 100 });
        expect(res.valid).toBe(false);
    });

    it('approves valid, unique inputs under the limit', () => {
        const current = [{ universalId: 100 }];
        const res = validateVibeInput(current, { universalId: 200 });
        expect(res.valid).toBe(true);
    });
});

describe('Streaming Availability Math', () => {
    it('approves media available on free or ad-supported platforms', () => {
        const providers = { free: [{ provider_id: 11 }] };
        expect(evaluateStreamingAvailability(providers, ['99'])).toBe(true);
    });

    it('approves media if user subscribes to the flatrate service', () => {
        const providers = { flatrate: [{ provider_id: 8 }] };
        expect(evaluateStreamingAvailability(providers, ['8', '15'])).toBe(true);
    });

    it('rejects media if user lacks the required subscription', () => {
        const providers = { flatrate: [{ provider_id: 8 }] };
        expect(evaluateStreamingAvailability(providers, ['15'])).toBe(false);
    });
});