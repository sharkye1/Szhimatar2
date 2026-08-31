import React, { useEffect, useRef } from 'react';
import '../styles/cursor-glow.css';
import { useIsProcessing } from '../hooks/useRenderQueue';

export const CursorGlow: React.FC = () => {
  const glowRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const isProcessing = useIsProcessing();

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let lastRenderedX = -1;
    let lastRenderedY = -1;

    const root = document.documentElement;

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

        root.style.setProperty('--mouse-x', `${targetX}px`);
        root.style.setProperty('--mouse-y', `${targetY}px`);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
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
        if (glowRef.current) {
          glowRef.current.classList.remove('moving');
          glowRef.current.classList.add('idle');
        }
        if (auraRef.current) {
          auraRef.current.classList.remove('moving');
          auraRef.current.classList.add('idle');
        }
      }, 150);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (idleTimer) clearTimeout(idleTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (glowRef.current && auraRef.current) {
      if (isProcessing) {
        glowRef.current.classList.add('rendering');
        auraRef.current.classList.add('rendering');
      } else {
        glowRef.current.classList.remove('rendering');
        auraRef.current.classList.remove('rendering');
      }
    }
  }, [isProcessing]);

  return (
    <>
      <div className={`window-render-glow ${isProcessing ? 'active' : ''}`} />
      <div ref={auraRef} className="cursor-aura idle" />
      <div ref={glowRef} className="cursor-glow idle" />
    </>
  );
};

export default CursorGlow;

