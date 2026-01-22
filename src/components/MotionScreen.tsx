import React, { ReactNode } from 'react';
import { motion, Transition, TargetAndTransition } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { useSettings, ScreenAnimationType } from '../contexts/SettingsContext';

interface MotionScreenProps {
  children: ReactNode;
  animationType?: ScreenAnimationType;
}

interface AnimationConfig {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
}

// Animation presets
const getAnimationConfig = (type: ScreenAnimationType): AnimationConfig => {
  switch (type) {
    case 'soft-blur':
      return {
        initial: {
          opacity: 0,
          clipPath: 'inset(8% 6% 10% 6% round 24px)',
          filter: 'blur(6px) contrast(110%)',
        },
        animate: {
          opacity: 1,
          clipPath: 'inset(0% 0% 0% 0% round 14px)',
          filter: 'blur(0px) contrast(100%)',
        },
        exit: {
          opacity: 0,
          clipPath: 'inset(6% 6% 8% 6% round 24px)',
          filter: 'blur(4px) contrast(110%)',
        },
        transition: {
          duration: 0.32,
          ease: [0.22, 1, 0.36, 1],
        },
      };

    case 'physics':
      return {
        initial: {
          opacity: 0,
          scale: 0.92,
          y: 30,
        },
        animate: {
          opacity: 1,
          scale: 1,
          y: 0,
        },
        exit: {
          opacity: 0,
          scale: 0.95,
          y: -20,
        },
        transition: {
          type: 'spring',
          stiffness: 300,
          damping: 25,
          mass: 0.8,
        },
      };

    case 'scale-fade':
      return {
        initial: {
          opacity: 0,
          scale: 0.96,
        },
        animate: {
          opacity: 1,
          scale: 1,
        },
        exit: {
          opacity: 0,
          scale: 1.02,
        },
        transition: {
          duration: 0.22,
          ease: 'easeInOut',
        },
      };

    case 'none':
      return {
        initial: { opacity: 1 },
        animate: { opacity: 1 },
        exit: { opacity: 1 },
        transition: { duration: 0 },
      };

    case 'default':
    default:
      return {
        initial: {
          opacity: 0,
          y: 12,
          scale: 0.985,
        },
        animate: {
          opacity: 1,
          y: 0,
          scale: 1,
        },
        exit: {
          opacity: 0,
          y: -12,
          scale: 0.985,
        },
        transition: {
          duration: 0.25,
          ease: 'easeOut',
        },
      };
  }
};

// Unified screen transition component
export const MotionScreen: React.FC<MotionScreenProps> = ({ children, animationType }) => {
  const { theme } = useTheme();
  
  // Try to use settings context, fallback to prop or default
  let effectiveAnimation: ScreenAnimationType = 'default';
  try {
    const { screenAnimation } = useSettings();
    effectiveAnimation = animationType || screenAnimation;
  } catch {
    // SettingsProvider not available, use prop or default
    effectiveAnimation = animationType || 'default';
  }

  const config = getAnimationConfig(effectiveAnimation);

  return (
    <motion.div
      className="motion-screen"
      initial={config.initial}
      animate={config.animate}
      exit={config.exit}
      transition={config.transition}
      style={{
        background: theme.colors.background,
        color: theme.colors.text,
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        willChange: 'opacity, transform, filter',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Optional subtle overlay during transition to smooth gradients */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 0 }}
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          inset: 0,
          background: theme.colors.background,
        }}
      />

      {children}
    </motion.div>
  );
};

export default MotionScreen;
