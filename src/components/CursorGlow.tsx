import React, { useEffect, useRef } from 'react';
import '../styles/cursor-glow.css';
import { useRenderQueue } from '../hooks/useRenderQueue';
import { useSettings } from '../contexts/SettingsContext';

export const CursorGlow: React.FC = () => {
  const glowRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const { isProcessing } = useRenderQueue();
  const { performanceMode } = useSettings();

  useEffect(() => {
    if (performanceMode) {
      return;
    }

    let idleTimer: ReturnType<typeof setTimeout>;
    let rafId: number;
    
    let currentX = window.innerWidth / 2;
    let currentY = window.innerHeight / 2;

    const updatePos = () => {
      // Both layers track cursor IMMEDIATELY, zero lag.
      // We use the CSS `translate` property instead of `transform: translate3d`
      // because CSS `scale` property shrinks the coordinate system for `transform`,
      // which causes the glow to lag linearly behind the mouse towards the bottom right.
      if (glowRef.current) {
        glowRef.current.style.translate = `${currentX}px ${currentY}px`;
      }
      if (auraRef.current) {
        auraRef.current.style.translate = `${currentX}px ${currentY}px`;
      }
      rafId = requestAnimationFrame(updatePos);
    };
    
    rafId = requestAnimationFrame(updatePos);

    const handleMouseMove = (e: MouseEvent) => {
      currentX = e.clientX;
      currentY = e.clientY;
      
      if (glowRef.current) {
        glowRef.current.classList.add('moving');
        glowRef.current.classList.remove('idle');
      }
      if (auraRef.current) {
        auraRef.current.classList.add('moving');
        auraRef.current.classList.remove('idle');
      }

      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (glowRef.current) {
          glowRef.current.classList.remove('moving');
          glowRef.current.classList.add('idle');
        }
        if (auraRef.current) {
          auraRef.current.classList.remove('moving');
          auraRef.current.classList.add('idle');
        }
      }, 150); // AFK triggers quickly
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(idleTimer);
      cancelAnimationFrame(rafId);
    };
  }, [performanceMode]);

  useEffect(() => {
    if (performanceMode) {
      return;
    }

    if (glowRef.current && auraRef.current) {
      if (isProcessing) {
        glowRef.current.classList.add('rendering');
        auraRef.current.classList.add('rendering');
      } else {
        glowRef.current.classList.remove('rendering');
        auraRef.current.classList.remove('rendering');
      }
    }
  }, [isProcessing, performanceMode]);

  if (performanceMode) {
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
