import React, { useEffect, useRef } from 'react';
import '../styles/cursor-glow.css';
import { useIsProcessing } from '../hooks/useRenderQueue';
import { useSettings } from '../contexts/SettingsContext';
import { appWindow } from '@tauri-apps/api/window';

export const CursorGlow: React.FC = () => {
  const glowRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const isProcessing = useIsProcessing();
  const { settings } = useSettings();

  useEffect(() => {
    if (settings.ecoMode) return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let unlistenFocus: (() => void) | null = null;
    let isMounted = true;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let lastRenderedX = -1;
    let lastRenderedY = -1;

    const hideGlow = () => {
      if (glowRef.current) {
        glowRef.current.classList.remove('moving');
        glowRef.current.classList.add('idle');
      }
      if (auraRef.current) {
        auraRef.current.classList.remove('moving');
        auraRef.current.classList.add('idle');
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const render = () => {
      rafId = null;

      if (targetX !== lastRenderedX || targetY !== lastRenderedY) {
        lastRenderedX = targetX;
        lastRenderedY = targetY;

        const translateVal = `${targetX}px ${targetY}px`;
        if (glowRef.current) {
          glowRef.current.style.translate = translateVal;
        }
        if (auraRef.current) {
          auraRef.current.style.translate = translateVal;
        }
      }
    };

    const isWindowBlurredOrPaused = () => {
      if (document.hidden) return true;
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
      if (document.body.classList.contains('app-paused')) return true;
      return false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Do not wake up cursor effects if window is paused, blurred, or hidden
      if (isWindowBlurredOrPaused()) {
        return;
      }

      targetX = e.clientX;
      targetY = e.clientY;

      if (glowRef.current && auraRef.current) {
        glowRef.current.classList.add('moving');
        glowRef.current.classList.remove('idle');
        auraRef.current.classList.add('moving');
        auraRef.current.classList.remove('idle');
      }

      if (rafId === null) {
        rafId = requestAnimationFrame(render);
      }

      if (idleTimer) {
        clearTimeout(idleTimer);
      }

      idleTimer = setTimeout(() => {
        hideGlow();
      }, 150);
    };

    const handleBlur = () => {
      hideGlow();
    };

    const handleFocus = () => {
      // Intentionally do not immediately show glow on focus; wait for active mouse movement
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hideGlow();
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    appWindow.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        hideGlow();
      }
    }).then(unlisten => {
      if (isMounted) {
        unlistenFocus = unlisten;
      } else {
        unlisten();
      }
    }).catch(err => {
      console.warn('[CursorGlow] Failed to listen to onFocusChanged:', err);
    });

    return () => {
      isMounted = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (unlistenFocus) {
        unlistenFocus();
      }
      if (idleTimer) clearTimeout(idleTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [settings.ecoMode]);

  useEffect(() => {
    if (settings.ecoMode) return;

    if (glowRef.current && auraRef.current) {
      if (isProcessing) {
        glowRef.current.classList.add('rendering');
        auraRef.current.classList.add('rendering');
      } else {
        glowRef.current.classList.remove('rendering');
        auraRef.current.classList.remove('rendering');
      }
    }
  }, [isProcessing, settings.ecoMode]);

  if (settings.ecoMode) {
    return null;
  }

  return (
    <>
      <div className={`window-render-glow ${isProcessing ? 'active' : ''}`} />
      <div ref={auraRef} className="cursor-aura idle" />
      <div ref={glowRef} className="cursor-glow idle" />
    </>
  );
};

export default CursorGlow;


