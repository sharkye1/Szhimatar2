export const ALL_THEME_NAMES = [
  'light',
  'dark-red',
  'blue-ocean',
  'dark-blue',
  'dark-orange',
  'dark-green',
  'purple-pink',
  'dark-gray',
  'pink',
  'sunny-yellow',
  'mint-glass',
  'paper-sepia',
  'nord-soft',
  'graphite-light',
  'amoled-night',
  'catppuccin-mocha',
  'everforest',
  'tokyo-night',
  'warm-amber',
] as const;

export type ThemeName = (typeof ALL_THEME_NAMES)[number];

export const LIGHT_THEMES: readonly string[] = [
  'light',
  'sunny-yellow',
  'mint-glass',
  'paper-sepia',
  'graphite-light',
];

/**
 * Checks whether the given theme is considered a light theme.
 */
export const isLightTheme = (name: string): boolean => {
  return LIGHT_THEMES.includes(name);
};

/**
 * Returns true if the current local time falls into the dark-only window:
 * after 17:00 (5:00 PM) in the evening and until 07:00 (7:00 AM) in the morning.
 */
export const isDarkThemeOnlyTime = (date: Date = new Date()): boolean => {
  const hour = date.getHours();
  return hour >= 17 || hour < 7;
};

/**
 * Picks a random theme name:
 * - If time is after 17:00 (or before 07:00), only dark themes are eligible.
 * - During daytime (07:00 - 16:59), all themes are eligible.
 * - Tries to select a theme different from currentTheme if alternatives exist.
 */
export const getRandomThemeName = (currentTheme?: string, date: Date = new Date()): string => {
  const darkOnly = isDarkThemeOnlyTime(date);
  const eligibleThemes = darkOnly
    ? ALL_THEME_NAMES.filter((name) => !isLightTheme(name))
    : [...ALL_THEME_NAMES];

  const choices = eligibleThemes.filter((name) => name !== currentTheme);
  const pool = choices.length > 0 ? choices : eligibleThemes;

  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
};
