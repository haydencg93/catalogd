import { describe, it, expect } from 'vitest';
import {
    calculateNewRating,
    formatTag,
    determineTotalPages,
    deriveTVScopePayload
} from '../../js/logic/log-logic.js';

describe('Star Rating Mathematics', () => {
    it('returns a half-star value when the left half is clicked', () => {
        expect(calculateNewRating(0, 4, true)).toBe(3.5);
    });

    it('returns a full-star value when the right half is clicked', () => {
        expect(calculateNewRating(0, 4, false)).toBe(4.0);
    });

    it('demotes a full star to a half star if clicked twice on the right side', () => {
        // Current rating is already 4.0, user clicks right side of 4 again
        expect(calculateNewRating(4.0, 4, false)).toBe(3.5);
    });
});

describe('String Sanitization', () => {
    it('formats tags to lowercase hyphenated strings', () => {
        expect(formatTag('  Sci Fi  ')).toBe('sci-fi');
        expect(formatTag('POST-Apocalyptic')).toBe('post-apocalyptic');
    });
});

describe('Book Page Overrides', () => {
    it('prioritizes valid custom inputs over API defaults', () => {
        expect(determineTotalPages(300, '450')).toBe(450);
        expect(determineTotalPages(300, '')).toBe(300);
        expect(determineTotalPages(undefined, '100')).toBe(100);
    });
});

describe('TV Scope Payload Generation', () => {
    it('formats payload for Entire Series', () => {
        const payload = deriveTVScopePayload('entire', null, null, 73);
        expect(payload.log_level).toBe('entire');
        expect(payload.ep_count_in_season).toBe(73);
        expect(payload.season_number).toBeNull();
    });

    it('formats payload for Specific Episode', () => {
        const payload = deriveTVScopePayload('episode', '1', '5', 73);
        expect(payload.log_level).toBe('episode');
        expect(payload.season_number).toBe(1);
        expect(payload.episode_number).toBe(5);
    });
});