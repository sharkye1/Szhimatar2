/**
 * DuoEasterEggOverlay - Easter Egg animation overlay
 * 
 * Activated by 15 rapid clicks on DUO button (within 2 seconds between clicks)
 * Shows energy burst animation from DUO button center
 * 
 * Easter Egg Feature - Non-production UI enhancement
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, easeInOut, easeOut } from 'framer-motion';
import { createPortal } from 'react-dom';
import './DuoEasterEggOverlay.css';

// Feature flag - can be disabled in production
const ENABLE_EASTER_EGGS = true;

interface DuoEasterEggOverlayProps {
  active: boolean;
  originPosition?: { x: number; y: number };
  onComplete: () => void;
}

interface LightningBolt {
  id: number;
  angle: number;
  delay: number;
  length: number;
  width: number;
}

const DuoEasterEggOverlay: React.FC<DuoEasterEggOverlayProps> = ({
  active,
  originPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  onComplete,
}) => {
  const [show, setShow] = useState(false);
  const [lightnings, setLightnings] = useState<LightningBolt[]>([]);

  // Generate lightning bolts on activation
  useEffect(() => {
    if (!ENABLE_EASTER_EGGS) return;

    if (active) {
      setShow(true);
      console.log('[DuoEasterEggOverlay] Easter egg activated at:', originPosition);

      // Generate 30 lightning bolts with slight randomness (angle, length, width)
      const newLightnings: LightningBolt[] = Array.from({ length: 30 }, (_, i) => {
        const baseAngle = (i / 30) * 360;
        const jitter = (Math.random() - 0.5) * 14; // ±7 degrees
        const length = 280 + Math.random() * 240; // 280..520px
        const width = 2 + Math.random() * 4; // 2..6px
        return {
          id: i,
          angle: baseAngle + jitter,
          delay: i * 0.03,
          length,
          width,
        };
      });
      setLightnings(newLightnings);
      
      const timer = setTimeout(() => {
        setShow(false);
        onComplete();
      }, 4000);
    
      return () => clearTimeout(timer);
    }   
  }, [active, onComplete]);

  // Framer Motion variants for lightning
  const lightningVariants = {
    initial: {
      opacity: 0,
      scale: 0.3,
    },
    animate: {
      opacity: [0, 1, 0.5, 1, 0],
      scale: [0.3, 1, 0.9, 0.2],
      x: [-2, 2, -2],
      y: [-2, 2, -2],
      transition: {
        duration: 0.05,
        ease: 'linear' as const,
        repeat: Infinity,
        repeatType: 'mirror' as const,
      },
    },
  };

  const ringVariants = {
    initial: {
      scale: 0.1,
      opacity: 0,
    },
    animate: {
      scale: [0.1, 3],
      opacity: [1, 0],
      transition: {
        duration: 1.5,
        ease: easeOut,
      },
    },
  };

  const particleVariants = {
    initial: {
      opacity: 0,
      scale: 0,
    },
    animate: (angle: number) => ({
      opacity: [1, 0],
      scale: [1, 0],
      x: Math.cos((angle * Math.PI) / 180) * 360,
      y: Math.sin((angle * Math.PI) / 180) * 360,
      transition: {
        duration: 1.2,
        ease: easeOut,
      },
    }),
  };

  if (!ENABLE_EASTER_EGGS || !show) return null;

  // Portal renders into document.body, NOT into RenderModeSelector
  // This ensures overlay is not affected by parent overflow: hidden
  return createPortal(
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          key="overlay"
          className="duo-easter-egg-overlay"
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            x: [-4, 4, -3, 3, 0],
            y: [-2, 2, -1, 1, 0],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: easeInOut }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 9999,
            overflow: 'hidden',
            filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
          }}
          layout
        >
          {/* Flash effect */}
          <motion.div
            key="flash"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'white',
              pointerEvents: 'none',
            }}
            initial={{ opacity: 0.8 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: easeOut }}
          />

          {/* Central energy burst */}
          <motion.div
            className="energy-burst"
            style={{
              position: 'absolute',
              left: originPosition.x,
              top: originPosition.y,
              translateX: '-50%',
              translateY: '-50%',
              filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
            }}
            variants={ringVariants}
            initial="initial"
            animate="animate"
            layout
          />

          {/* Expanding rings */}
          {[0, 1, 2, 3].map((ring) => (
            <motion.div
              key={`ring-${ring}`}
              className="energy-ring"
              style={{
                position: 'absolute',
                left: originPosition.x,
                top: originPosition.y,
                translateX: '-50%',
                translateY: '-50%',
                filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
              }}
              variants={ringVariants}
              initial="initial"
              animate="animate"
              transition={{
                duration: ring === 3 ? 2.6 : 1.5,
                delay: ring * 0.2,
                ease: easeOut,
              }}
              layout
            />
          ))}

          {/* Lightning bolts radiating from center */}
          {lightnings.map((bolt) => (
            <motion.div
              key={`lightning-${bolt.id}`}
              className="lightning-bolt"
              style={{
                position: 'absolute',
                left: originPosition.x,
                top: originPosition.y,
                transformOrigin: 'top center',
                rotate: bolt.angle,
                width: bolt.width,
                height: bolt.length,
                filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
              }}
              variants={lightningVariants}
              initial="initial"
              animate="animate"
              transition={{ delay: bolt.delay }}
              layout
            />
          ))}

          {/* Energy particles */}
          {Array.from({ length: 50 }).map((_, i) => {
            const angle = (i / 50) * 360;
            return (
              <motion.div
                key={`particle-${i}`}
                className="energy-particle"
                style={{
                  position: 'absolute',
                  left: originPosition.x,
                  top: originPosition.y,
                  translateX: '-50%',
                  translateY: '-50%',
                  filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
                }}
                variants={particleVariants}
                initial="initial"
                animate="animate"
                custom={angle}
                transition={{ delay: i * 0.02 }}
                layout
              />
            );
          })}

          {/* Secret message - fades in/out */}
          <motion.div
            style={{
              position: 'absolute',
              bottom: '25%',
              left: '50%',
              translateX: '-50%',
              color: '#76b900',
              fontSize: '40px',
              fontWeight: 'bold',
              textAlign: 'center',
              letterSpacing: '10px',
              textTransform: 'uppercase',
              userSelect: 'none',
              pointerEvents: 'none',
              filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
            }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: [0, 1, 1, 0], scale: 1 }}
            exit={{ opacity: 0, scale: 1.2, letterSpacing: 30 }}
            transition={{
              duration: 4,
              times: [0, 0.2, 0.8, 1],
              ease: easeInOut,
            }}
            layout
          >
            <span className="easter-egg-message">DUO POWER</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body // ← Critical: renders into body, not into RenderModeSelector
  );
};

export default DuoEasterEggOverlay;
