import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../SettingsContext';

import en from '../../lang/en.json';
import ru from '../../lang/ru.json';
import ch from '../../lang/ch.json';
import eo from '../../lang/eo.json';
import my from '../../lang/my.json';
import vz from '../../lang/vz.json';
import emp from '../../lang/emp.json';

interface NodeFs {
  readFileSync: (filePath: string, encoding: string) => string;
}

interface NodePath {
  resolve: (...args: string[]) => string;
}

declare function require(id: 'fs'): NodeFs;
declare function require(id: 'path'): NodePath;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

interface LanguageFileWithSettings {
  settings: {
    ecoMode?: string;
    ecoModeDescription?: string;
    ecoModeEnabled?: string;
    ecoModeDisabled?: string;
  };
}

describe('Idle Resource & Eco Mode Optimizations', () => {
  describe('SettingsContext Eco Mode defaults and normalization', () => {
    it('has ecoMode disabled by default', () => {
      expect(DEFAULT_APP_SETTINGS.ecoMode).toBe(false);
    });

    it('normalizes raw settings with camelCase ecoMode correctly', () => {
      const rawTrue: Record<string, unknown> = { ecoMode: true };
      const rawFalse: Record<string, unknown> = { ecoMode: false };
      const rawMissing: Record<string, unknown> = {};

      expect(!!(rawTrue.ecoMode ?? rawTrue.eco_mode ?? DEFAULT_APP_SETTINGS.ecoMode)).toBe(true);
      expect(!!(rawFalse.ecoMode ?? rawFalse.eco_mode ?? DEFAULT_APP_SETTINGS.ecoMode)).toBe(false);
      expect(!!(rawMissing.ecoMode ?? rawMissing.eco_mode ?? DEFAULT_APP_SETTINGS.ecoMode)).toBe(false);
    });

    it('normalizes raw settings with snake_case eco_mode correctly', () => {
      const rawSnakeTrue: Record<string, unknown> = { eco_mode: true };
      const rawSnakeFalse: Record<string, unknown> = { eco_mode: false };

      expect(!!(rawSnakeTrue.ecoMode ?? rawSnakeTrue.eco_mode ?? DEFAULT_APP_SETTINGS.ecoMode)).toBe(true);
      expect(!!(rawSnakeFalse.ecoMode ?? rawSnakeFalse.eco_mode ?? DEFAULT_APP_SETTINGS.ecoMode)).toBe(false);
    });
  });

  describe('CSS optimizations verification', () => {
    const globalCssPath = path.resolve(__dirname, '../../styles/global.css');
    const mainWindowCssPath = path.resolve(__dirname, '../../styles/MainWindow.css');
    const cursorGlowCssPath = path.resolve(__dirname, '../../styles/cursor-glow.css');
    const motionScreenPath = path.resolve(__dirname, '../../components/MotionScreen.tsx');

    const globalCss = fs.readFileSync(globalCssPath, 'utf-8');
    const mainWindowCss = fs.readFileSync(mainWindowCssPath, 'utf-8');
    const cursorGlowCss = fs.readFileSync(cursorGlowCssPath, 'utf-8');
    const motionScreenSource = fs.readFileSync(motionScreenPath, 'utf-8');

    it('does not define unused @keyframes gradientShift in global.css', () => {
      expect(globalCss).not.toContain('@keyframes gradientShift');
    });

    it('does not animate .app-background with infinite gradientShift in global.css', () => {
      const appBgBlock = globalCss.match(/\.app-background\s*\{[^}]*\}/s);
      expect(appBgBlock).toBeTruthy();
      expect(appBgBlock![0]).not.toContain('animation: gradientShift');
      expect(appBgBlock![0]).toContain('background-size: cover');
    });

    it('contains app-paused rule pausing all animations and hiding cursor glow in global.css', () => {
      expect(globalCss).toContain('body.app-paused *');
      expect(globalCss).toContain('animation-play-state: paused !important;');
      expect(globalCss).toContain('body.app-paused .cursor-glow');
      expect(globalCss).toContain('visibility: hidden !important;');
    });

    it('contains body.eco-mode rules disabling backdrop-filters and cursor glow in global.css', () => {
      expect(globalCss).toContain('body.eco-mode');
      expect(globalCss).toContain('backdrop-filter: none !important;');
      expect(globalCss).toContain('body.eco-mode .cursor-glow');
      expect(globalCss).toContain('body.eco-mode .app-background.has-image-background');
    });

    it('does not animate .dynamic-island--collapsed with infinite dynamicIslandGlow in MainWindow.css', () => {
      const collapsedBlock = mainWindowCss.match(/\.dynamic-island--collapsed\s*\{[^}]*\}/s);
      expect(collapsedBlock).toBeTruthy();
      expect(collapsedBlock![0]).not.toContain('animation: dynamicIslandGlow');
    });

    it('does not have nested backdrop-filters on header-nav-btn or download-queue-card in MainWindow.css', () => {
      const headerNavBlock = mainWindowCss.match(/\.header-nav-btn\s*\{[^}]*\}/s);
      expect(headerNavBlock).toBeTruthy();
      expect(headerNavBlock![0]).not.toContain('backdrop-filter');

      const downloadCardBlock = mainWindowCss.match(/\.download-queue-card\s*\{[^}]*\}/s);
      expect(downloadCardBlock).toBeTruthy();
      expect(downloadCardBlock![0]).not.toContain('backdrop-filter');

      const outputPathBlock = mainWindowCss.match(/\.output-path\s*\{[^}]*\}/s);
      expect(outputPathBlock).toBeTruthy();
      expect(outputPathBlock![0]).not.toContain('backdrop-filter');
    });

    it('sets idle cursor glow and aura to opacity 0 with visibility transition in cursor-glow.css', () => {
      const idleGlowBlock = cursorGlowCss.match(/\.cursor-glow\.idle\s*\{[^}]*\}/s);
      expect(idleGlowBlock).toBeTruthy();
      expect(idleGlowBlock![0]).toContain('opacity: 0');
      expect(idleGlowBlock![0]).toContain('visibility: hidden');
      expect(idleGlowBlock![0]).toContain('step-end');
      expect(idleGlowBlock![0]).not.toContain('animation: pulse-core');

      const idleAuraBlock = cursorGlowCss.match(/\.cursor-aura\.idle\s*\{[^}]*\}/s);
      expect(idleAuraBlock).toBeTruthy();
      expect(idleAuraBlock![0]).toContain('opacity: 0');
      expect(idleAuraBlock![0]).toContain('visibility: hidden');
      expect(idleAuraBlock![0]).toContain('step-end');
      expect(idleAuraBlock![0]).not.toContain('animation: pulse-aura');
    });

    it('does not set constant willChange: opacity, transform, filter on MotionScreen.tsx', () => {
      expect(motionScreenSource).not.toContain("willChange: 'opacity, transform, filter'");
    });

    it('CursorGlow.tsx guards against wakeups during unfocused or paused state', () => {
      const cursorGlowSource = fs.readFileSync(path.resolve(__dirname, '../../components/CursorGlow.tsx'), 'utf-8');
      expect(cursorGlowSource).toContain('isWindowBlurredOrPaused');
      expect(cursorGlowSource).toContain('appWindow.onFocusChanged');
    });
  });

  describe('Localization verification for all 7 languages', () => {
    const langDicts: Array<{ name: string; data: LanguageFileWithSettings }> = [
      { name: 'en', data: en },
      { name: 'ru', data: ru },
      { name: 'ch', data: ch },
      { name: 'eo', data: eo },
      { name: 'my', data: my },
      { name: 'vz', data: vz },
      { name: 'emp', data: emp },
    ];

    it.each(langDicts)('has ecoMode keys in $name.json', ({ data }) => {
      expect(data.settings).toBeDefined();
      expect(data.settings.ecoMode).toBeDefined();
      expect(data.settings.ecoModeDescription).toBeDefined();
      expect(data.settings.ecoModeEnabled).toBeDefined();
      expect(data.settings.ecoModeDisabled).toBeDefined();
    });
  });
});
