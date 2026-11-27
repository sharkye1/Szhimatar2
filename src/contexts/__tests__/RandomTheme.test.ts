import { describe, it, expect } from 'vitest';
import { isDarkThemeOnlyTime, getRandomThemeName, isLightTheme } from '../../utils/themeUtils';

describe('Random Theme Behavior', () => {
  it('enforces dark-only theme selection after 17:00', () => {
    // Current time or simulated 17:00, 18:00, 23:00, etc.
    const eveningTimes = [
      new Date('2026-11-20T17:00:00'),
      new Date('2026-11-20T17:30:00'),
      new Date('2026-11-20T19:00:00'),
      new Date('2026-11-20T23:59:00'),
      new Date('2026-11-20T01:00:00'),
      new Date('2026-11-20T06:59:00'),
    ];

    for (const time of eveningTimes) {
      expect(isDarkThemeOnlyTime(time)).toBe(true);
      for (let i = 0; i < 20; i++) {
        const theme = getRandomThemeName('light', time);
        expect(isLightTheme(theme)).toBe(false);
      }
    }
  });

  it('allows any theme during daytime before 17:00 (after 07:00)', () => {
    const dayTimes = [
      new Date('2026-11-20T07:00:00'),
      new Date('2026-11-20T12:00:00'),
      new Date('2026-11-20T16:59:00'),
    ];

    for (const time of dayTimes) {
      expect(isDarkThemeOnlyTime(time)).toBe(false);
    }
  });
});
