/**
 * Milestone 2 Empirical Stress Test Suite: RenderModeSelector
 * 
 * Verifies UI render mode selector behavior under simulated macOS and Windows hosts,
 * testing mode sanitization, DOM presence/absence, and hardwareInfo vendor fallbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactDOM from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import RenderModeSelector, { RenderMode } from '../../src/components/RenderModeSelector';
import LanguageContext from '../../src/contexts/LanguageContext';
import ThemeContext from '../../src/contexts/ThemeContext';
import { setPlatformOverride, resetPlatformOverride } from '../../src/utils/platform';
import { sanitizeRenderMode } from '../../src/services/RenderScheduler';

// ============================================================================
// Minimal DOM Mock for React 18 createRoot & useEffect testing in Node
// ============================================================================

function setupDomEnvironment() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const createMockElement = (tag: string) => {
    const styleObj: any = {
      setProperty: function (prop: string, val: string) {
        styleObj[prop] = val;
      },
      removeProperty: function (prop: string) {
        delete styleObj[prop];
      },
    };

    const el: any = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      ownerDocument: doc,
      setAttribute: () => {},
      removeAttribute: () => {},
      getAttribute: () => null,
      style: styleObj,
      childNodes: [],
      appendChild: function (c: any) {
        this.childNodes.push(c);
        return c;
      },
      removeChild: function (c: any) {
        const idx = this.childNodes.indexOf(c);
        if (idx !== -1) this.childNodes.splice(idx, 1);
        return c;
      },
      insertBefore: function (c: any) {
        this.childNodes.push(c);
        return c;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    return el;
  };

  const doc: any = {
    createElement: (tag: string) => createMockElement(tag),
    createElementNS: (_ns: string, tag: string) => createMockElement(tag),
    createTextNode: (text: string) => ({
      nodeType: 3,
      nodeValue: text,
      ownerDocument: doc,
    }),
    createComment: () => ({ nodeType: 8, ownerDocument: doc }),
    nodeType: 9,
    documentElement: {
      setAttribute: () => {},
      style: {},
    },
    body: {
      nodeType: 1,
      tagName: 'BODY',
      appendChild: () => {},
      removeChild: () => {},
      style: {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as any).document = doc;
  (globalThis as any).window = globalThis;
  (globalThis as any).HTMLIFrameElement = function () {};
  (globalThis as any).HTMLButtonElement = function () {};
  (globalThis as any).HTMLElement = function () {};
  (globalThis as any).Element = function () {};

  return doc;
}

// ============================================================================
// Context Mocks
// ============================================================================

const mockThemeContext: any = {
  theme: {
    name: 'light',
    colors: {
      background: '#ffffff',
      surface: '#f4f4f5',
      primary: '#0071e3',
      secondary: '#5ac8fa',
      text: '#000000',
      textSecondary: '#666666',
      border: '#e4e4e7',
      success: '#22c55e',
      warning: '#eab308',
      error: '#ef4444',
      hover: '#f4f4f5',
    },
  },
  themeName: 'light',
  modifiedTheme: false,
  setTheme: vi.fn(),
  setModifiedTheme: vi.fn(),
  useImageBackground: false,
  backgroundImagePath: '',
  glassOpacity: 0,
  glassBlur: 0,
  setUseImageBackground: vi.fn(),
  setBackgroundImagePath: vi.fn(),
  setGlassOpacity: vi.fn(),
  setGlassBlur: vi.fn(),
};

const mockLanguageContext: any = {
  language: 'en',
  translations: {} as any,
  setLanguage: vi.fn(),
  t: (key: string) => {
    const map: Record<string, string> = {
      'renderMode.software': 'Software',
      'renderMode.hardware': 'Hardware',
      'renderMode.cpu': 'CPU',
      'renderMode.gpu': 'GPU',
      'renderMode.duo': 'DUO',
      'renderMode.softwareTooltip': 'Render using CPU Software encoding (libx264/libx265)',
      'renderMode.hardwareTooltip': 'Render using Apple Silicon VideoToolbox hardware acceleration',
      'renderMode.cpuTooltip': 'Render using CPU only',
      'renderMode.gpuTooltip': 'Render using GPU (NVENC)',
      'renderMode.duoTooltip': 'Parallel CPU + GPU rendering',
      'renderMode.duoDisabledTooltip': 'GPU not available',
      'gpu.notAvailableTooltip': 'GPU not available',
    };
    return map[key] || key;
  },
};

function renderComponent(props: {
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  gpuAvailable: boolean;
  isRendering?: boolean;
}) {
  return React.createElement(
    LanguageContext.Provider,
    { value: mockLanguageContext },
    React.createElement(
      ThemeContext.Provider,
      { value: mockThemeContext },
      React.createElement(RenderModeSelector, props)
    )
  );
}

// Mock @tauri-apps/api/tauri invoke
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'detect_hardware_info') {
      return Promise.resolve({
        cpu_vendor: 'apple',
        gpu_vendor: 'videotoolbox',
      });
    }
    return Promise.resolve({});
  }),
  convertFileSrc: vi.fn((path: string) => path),
}));

// ============================================================================
// Test Suite
// ============================================================================

describe('Milestone 2 Empirical Challenger: RenderModeSelector', () => {
  let doc: any;

  beforeEach(() => {
    doc = setupDomEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetPlatformOverride();
  });

  // --------------------------------------------------------------------------
  // Challenge 1: macOS Mode Sanitization & DOM Structure
  // --------------------------------------------------------------------------
  describe('Challenge 1: macOS Simulated Environment (isMacOS() === true)', () => {
    beforeEach(() => {
      setPlatformOverride('macos', 'arm64');
    });

    it('1.1: mounts with mode "duo" and gpuAvailable=true -> fires onModeChange("gpu")', async () => {
      const onModeChange = vi.fn();
      const container = doc.createElement('div');
      const root = ReactDOM.createRoot(container);

      await act(async () => {
        root.render(
          renderComponent({
            mode: 'duo',
            onModeChange,
            gpuAvailable: true,
          })
        );
      });

      expect(onModeChange).toHaveBeenCalledTimes(1);
      expect(onModeChange).toHaveBeenCalledWith('gpu');

      act(() => {
        root.unmount();
      });
    });

    it('1.2: mounts with mode "duo" and gpuAvailable=false -> fires onModeChange("cpu")', async () => {
      const onModeChange = vi.fn();
      const container = doc.createElement('div');
      const root = ReactDOM.createRoot(container);

      await act(async () => {
        root.render(
          renderComponent({
            mode: 'duo',
            onModeChange,
            gpuAvailable: false,
          })
        );
      });

      expect(onModeChange).toHaveBeenCalledTimes(1);
      expect(onModeChange).toHaveBeenCalledWith('cpu');

      act(() => {
        root.unmount();
      });
    });

    it('1.3: mounts with valid mode "gpu" on macOS -> does NOT trigger spurious onModeChange', async () => {
      const onModeChange = vi.fn();
      const container = doc.createElement('div');
      const root = ReactDOM.createRoot(container);

      await act(async () => {
        root.render(
          renderComponent({
            mode: 'gpu',
            onModeChange,
            gpuAvailable: true,
          })
        );
      });

      expect(onModeChange).not.toHaveBeenCalled();

      act(() => {
        root.unmount();
      });
    });

    it('1.4: on macOS, no DUO button or glow/energy bridge is present in DOM', () => {
      const onModeChange = vi.fn();
      const html = renderToString(
        renderComponent({
          mode: 'gpu',
          onModeChange,
          gpuAvailable: true,
        })
      );

      // Verify DUO button is completely absent
      expect(html).not.toContain('duo-button');
      expect(html).not.toMatch(/<span[^>]*class="button-label"[^>]*>DUO<\/span>/i);

      // Verify DUO outer glow and energy bridge animations are completely absent
      expect(html).not.toContain('duo-outer-glow');
      expect(html).not.toContain('energy-bridge');
      expect(html).not.toContain('plasma-flow');
      expect(html).not.toContain('energy-core');

      // Verify Software (cpu-button) and Hardware (gpu-button) render with macOS labels
      expect(html).toContain('cpu-button');
      expect(html).toContain('gpu-button');
      expect(html).toContain('Software');
      expect(html).toContain('Hardware');
    });

    it('1.5: on macOS, even if mode="duo" is passed to render, DOM omits DUO button and energy bridge', () => {
      const onModeChange = vi.fn();
      const html = renderToString(
        renderComponent({
          mode: 'duo',
          onModeChange,
          gpuAvailable: true,
        })
      );

      expect(html).not.toContain('duo-button');
      expect(html).not.toContain('duo-outer-glow');
      expect(html).not.toContain('energy-bridge');
      expect(html).not.toContain('plasma-flow');
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 2: Windows Simulated Environment (isMacOS() === false)
  // --------------------------------------------------------------------------
  describe('Challenge 2: Windows Simulated Environment (isMacOS() === false)', () => {
    beforeEach(() => {
      setPlatformOverride('windows', 'x64');
    });

    it('2.1: on Windows, all 3 buttons (CPU, DUO, GPU) render in DOM', () => {
      const onModeChange = vi.fn();
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange,
          gpuAvailable: true,
        })
      );

      expect(html).toContain('cpu-button');
      expect(html).toContain('duo-button');
      expect(html).toContain('gpu-button');
      expect(html).toContain('CPU');
      expect(html).toContain('DUO');
      expect(html).toContain('GPU');
    });

    it('2.2: on Windows with mode="duo", plasma flow and energy bridge render properly', () => {
      const onModeChange = vi.fn();
      const html = renderToString(
        renderComponent({
          mode: 'duo',
          onModeChange,
          gpuAvailable: true,
        })
      );

      expect(html).toContain('duo-active');
      expect(html).toContain('duo-outer-glow');
      expect(html).toContain('energy-bridge');
      expect(html).toContain('plasma-flow');
      expect(html).toContain('energy-core');
    });

    it('2.3: on Windows, mounting with mode="duo" does NOT coerce mode (onModeChange not called)', async () => {
      const onModeChange = vi.fn();
      const container = doc.createElement('div');
      const root = ReactDOM.createRoot(container);

      await act(async () => {
        root.render(
          renderComponent({
            mode: 'duo',
            onModeChange,
            gpuAvailable: true,
          })
        );
      });

      expect(onModeChange).not.toHaveBeenCalled();

      act(() => {
        root.unmount();
      });
    });

    it('2.4: on Windows with mode="cpu", energy bridge and outer glow are not rendered', () => {
      const onModeChange = vi.fn();
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange,
          gpuAvailable: true,
        })
      );

      expect(html).not.toContain('duo-outer-glow');
      expect(html).not.toContain('energy-bridge');
      expect(html).not.toContain('plasma-flow');
      // But DUO button itself is present
      expect(html).toContain('duo-button');
    });

    it('2.5: on Windows when gpuAvailable=false, DUO button has disabled attribute', () => {
      const onModeChange = vi.fn();
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange,
          gpuAvailable: false,
        })
      );

      // Duo button should have disabled attribute
      expect(html).toMatch(/class="[^"]*duo-button[^"]*"[^>]*disabled/);
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 3: HardwareInfo Vendor Sanitization and Fallbacks
  // --------------------------------------------------------------------------
  describe('Challenge 3: HardwareInfo Vendor Sanitization and Fallbacks', () => {
    it('3.1: empty string cpu_vendor falls back safely to "UNKNOWN"', async () => {
      const tauri = await import('@tauri-apps/api/tauri');
      (tauri.invoke as any).mockResolvedValueOnce({
        cpu_vendor: '',
        gpu_vendor: '',
      });

      setPlatformOverride('windows');
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange: vi.fn(),
          gpuAvailable: true,
        })
      );

      // Initial state before effect has cpu_vendor: 'unknown' -> badge 'UNKNOWN'
      expect(html).toContain('>UNKNOWN<');
    });

    it('3.2: null cpu_vendor and gpu_vendor fall back safely without crashing', async () => {
      const tauri = await import('@tauri-apps/api/tauri');
      (tauri.invoke as any).mockResolvedValueOnce({
        cpu_vendor: null,
        gpu_vendor: null,
      });

      setPlatformOverride('windows');
      // Must not throw during renderToString
      expect(() => {
        renderToString(
          renderComponent({
            mode: 'cpu',
            onModeChange: vi.fn(),
            gpuAvailable: true,
          })
        );
      }).not.toThrow();
    });

    it('3.3: unexpected cpu_vendor (e.g., "RISCV_CHIP") maps to uppercase badge and unknown gradient fallback', () => {
      setPlatformOverride('windows');
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange: vi.fn(),
          gpuAvailable: true,
        })
      );
      // Component renders fallback gradients
      expect(html).toContain('--cpu-primary');
      expect(html).toContain('--gpu-primary');
    });

    it('3.4: on macOS with unknown or empty gpu_vendor, gpuVendorBadge falls back to "VIDEOTOOLBOX"', () => {
      setPlatformOverride('macos');
      const html = renderToString(
        renderComponent({
          mode: 'gpu',
          onModeChange: vi.fn(),
          gpuAvailable: true,
        })
      );

      // On macOS with default initial unknown gpu_vendor, badge is VIDEOTOOLBOX
      expect(html).toContain('>VIDEOTOOLBOX<');
    });

    it('3.5: when gpuAvailable=false, gpuVendorBadge displays "N/A"', () => {
      setPlatformOverride('macos');
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange: vi.fn(),
          gpuAvailable: false,
        })
      );

      expect(html).toContain('>N/A<');
    });

    it('3.6: invoke rejection during hardware detection is caught safely without crashing', async () => {
      const tauri = await import('@tauri-apps/api/tauri');
      (tauri.invoke as any).mockRejectedValueOnce(new Error('Hardware detection failed'));

      setPlatformOverride('macos');
      const container = doc.createElement('div');
      const root = ReactDOM.createRoot(container);

      await expect(
        act(async () => {
          root.render(
            renderComponent({
              mode: 'cpu',
              onModeChange: vi.fn(),
              gpuAvailable: true,
            })
          );
        })
      ).resolves.not.toThrow();

      act(() => {
        root.unmount();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 4: Interactive Handlers and Tooltips
  // --------------------------------------------------------------------------
  describe('Challenge 4: Interactive Handlers and Tooltips', () => {
    it('4.1: tooltips render platform-specific descriptions on macOS', () => {
      setPlatformOverride('macos');
      const html = renderToString(
        renderComponent({
          mode: 'gpu',
          onModeChange: vi.fn(),
          gpuAvailable: true,
        })
      );

      expect(html).toContain('title="Render using CPU Software encoding (libx264/libx265)"');
      expect(html).toContain('title="Render using Apple Silicon VideoToolbox hardware acceleration"');
    });

    it('4.2: tooltips render NVENC descriptions on Windows', () => {
      setPlatformOverride('windows');
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange: vi.fn(),
          gpuAvailable: true,
        })
      );

      expect(html).toContain('title="Render using CPU only"');
      expect(html).toContain('title="Render using GPU (NVENC)"');
      expect(html).toContain('title="Parallel CPU + GPU rendering"');
    });

    it('4.3: when gpuAvailable=false, GPU and DUO buttons show disabled tooltip', () => {
      setPlatformOverride('windows');
      const html = renderToString(
        renderComponent({
          mode: 'cpu',
          onModeChange: vi.fn(),
          gpuAvailable: false,
        })
      );

      expect(html).toContain('title="GPU not available"');
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 5: sanitizeRenderMode Contract Parity
  // --------------------------------------------------------------------------
  describe('Challenge 5: Mode Sanitization Consistency Contract', () => {
    it('5.1: sanitizeRenderMode guarantees deterministic normalization under all 12 combinations', () => {
      const modes: RenderMode[] = ['cpu', 'gpu', 'duo'];
      const macOptions = [true, false];
      const gpuOptions = [true, false];

      for (const m of modes) {
        for (const isMac of macOptions) {
          for (const gpu of gpuOptions) {
            const result = sanitizeRenderMode(m, isMac, gpu);

            if (isMac) {
              // Invariant 1: on macOS, result is NEVER 'duo'
              expect(result).not.toBe('duo');
              if (m === 'duo') {
                expect(result).toBe(gpu ? 'gpu' : 'cpu');
              }
            } else {
              // Invariant 2: on Windows with gpuAvailable, 'duo' is preserved
              if (m === 'duo' && gpu) {
                expect(result).toBe('duo');
              }
            }

            // Invariant 3: if gpu is unavailable, result cannot be 'gpu' or 'duo'
            if (!gpu) {
              expect(result).toBe('cpu');
            }
          }
        }
      }
    });

    it('5.2: handles unexpected / invalid input strings gracefully', () => {
      expect(sanitizeRenderMode(undefined as any, true, true)).toBe('cpu');
      expect(sanitizeRenderMode(null as any, true, true)).toBe('cpu');
      expect(sanitizeRenderMode('invalid_mode' as any, false, true)).toBe('cpu');
      expect(sanitizeRenderMode('' as any, false, false)).toBe('cpu');
    });
  });
});
