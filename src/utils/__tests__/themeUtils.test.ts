import { describe, it, expect } from 'vitest';
import {
  ALL_THEME_NAMES,
  LIGHT_THEMES,
  isLightTheme,
  isDarkThemeOnlyTime,
  getRandomThemeName,
} from '../themeUtils';

describe('themeUtils', () => {
  it('correctly identifies light themes', () => {
    for (const theme of LIGHT_THEMES) {
      expect(isLightTheme(theme)).toBe(true);
    }
  });

  it('correctly identifies dark themes', () => {
    const darkThemes = ALL_THEME_NAMES.filter((t) => !LIGHT_THEMES.includes(t));
    expect(darkThemes.length).toBeGreaterThan(0);
    for (const theme of darkThemes) {
      expect(isLightTheme(theme)).toBe(false);
    }
  });

  describe('isDarkThemeOnlyTime', () => {
    it('returns true after 17:00 (evening)', () => {
      const at1700 = new Date('2026-11-20T17:00:00');
      const at1830 = new Date('2026-11-20T18:30:00');
      const at2359 = new Date('2026-11-20T23:59:59');

      expect(isDarkThemeOnlyTime(at1700)).toBe(true);
      expect(isDarkThemeOnlyTime(at1830)).toBe(true);
      expect(isDarkThemeOnlyTime(at2359)).toBe(true);
    });

    it('returns true at night and early morning before 07:00', () => {
      const at0000 = new Date('2026-11-20T00:00:00');
      const at0315 = new Date('2026-11-20T03:15:00');
      const at0659 = new Date('2026-11-20T06:59:59');

      expect(isDarkThemeOnlyTime(at0000)).toBe(true);
      expect(isDarkThemeOnlyTime(at0315)).toBe(true);
      expect(isDarkThemeOnlyTime(at0659)).toBe(true);
    });

    it('returns false during daytime (07:00 to 16:59)', () => {
      const at0700 = new Date('2026-11-20T07:00:00');
      const at1200 = new Date('2026-11-20T12:00:00');
      const at1659 = new Date('2026-11-20T16:59:59');

      expect(isDarkThemeOnlyTime(at0700)).toBe(false);
      expect(isDarkThemeOnlyTime(at1200)).toBe(false);
      expect(isDarkThemeOnlyTime(at1659)).toBe(false);
    });
  });

  describe('getRandomThemeName', () => {
    it('never selects light themes after 17:00', () => {
      const eveningTime = new Date('2026-11-20T17:30:00');
      for (let i = 0; i < 100; i++) {
        const theme = getRandomThemeName(undefined, eveningTime);
        expect(isLightTheme(theme)).toBe(false);
        expect(ALL_THEME_NAMES).toContain(theme);
      }
    });

    it('never selects light themes at night (e.g. 02:00)', () => {
      const nightTime = new Date('2026-11-20T02:00:00');
      for (let i = 0; i < 100; i++) {
        const theme = getRandomThemeName(undefined, nightTime);
        expect(isLightTheme(theme)).toBe(false);
      }
    });

    it('can select both light and dark themes during daytime', () => {
      const dayTime = new Date('2026-11-20T13:00:00');
      const pickedThemes = new Set<string>();

      for (let i = 0; i < 200; i++) {
        const theme = getRandomThemeName(undefined, dayTime);
        pickedThemes.add(theme);
      }

      // Should have picked at least one light theme and at least one dark theme over 200 tries
      const hasLight = Array.from(pickedThemes).some((t) => isLightTheme(t));
      const hasDark = Array.from(pickedThemes).some((t) => !isLightTheme(t));

      expect(hasLight).toBe(true);
      expect(hasDark).toBe(true);
    });

    it('prefers a different theme from currentTheme', () => {
      const eveningTime = new Date('2026-11-20T20:00:00');
      const currentTheme = 'amoled-night';

      for (let i = 0; i < 50; i++) {
        const theme = getRandomThemeName(currentTheme, eveningTime);
        expect(theme).not.toBe(currentTheme);
      }
    });
  });
});
