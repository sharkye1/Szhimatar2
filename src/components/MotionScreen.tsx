import React, { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';

interface MotionScreenProps {
  children: ReactNode;
}

// Unified screen transition: fade + slide + slight scale.
// Covers full viewport with themed background to avoid white flashes in dark theme.
export const MotionScreen: React.FC<MotionScreenProps> = ({ children }) => {
  const { theme } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.985 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{
        background: theme.colors.background,
        color: theme.colors.text,
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        willChange: 'opacity, transform',
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
