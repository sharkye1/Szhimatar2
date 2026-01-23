/**
 * DuoEasterEggOverlay - Easter Egg animation overlay
 * 
 * Activated by 15 rapid clicks on DUO button (within 2 seconds between clicks)
 * Shows energy burst animation from DUO button center
 * 
 * Easter Egg Feature - Non-production UI enhancement
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import './DuoEasterEggOverlay.css';

// Feature flag - can be disabled in production
const ENABLE_EASTER_EGGS = true;
console.log('DuoEasterEggOverlay mounted');

interface DuoEasterEggOverlayProps {
  active: boolean;
  originPosition?: { x: number; y: number };
  onComplete: () => void;
}

const DuoEasterEggOverlay: React.FC<DuoEasterEggOverlayProps> = ({
  active,
  onComplete,
}) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!ENABLE_EASTER_EGGS) return;

    if (active) {
      setShow(true);
      console.log('[DuoEasterEggOverlay] Easter egg activated');
      
      const timer = setTimeout(() => {
        setShow(false);
        onComplete();
      }, 4000);
    
      return () => clearTimeout(timer);
    }   
  }, [active, onComplete]);

  if (!ENABLE_EASTER_EGGS || !show) return null;

  // Portal renders into document.body, NOT into RenderModeSelector
  // So overflow: hidden doesn't affect it!
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          className="duo-easter-egg-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {/* Существующий контент остается без изменений */}
          {/* ... lightning, rings, particles ... */}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body  // ← Критично! Рендерится в body, не в RenderModeSelector
  );
};

export default DuoEasterEggOverlay;
