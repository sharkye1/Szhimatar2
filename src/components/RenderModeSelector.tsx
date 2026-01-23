/**
 * RenderModeSelector - Advanced UI component for CPU/GPU/Duo mode selection
 * 
 * Features:
 * - Auto-detection of hardware vendors (Intel/AMD CPU, NVIDIA/AMD GPU)
 * - Dynamic gradient colors based on hardware
 * - Animated energy effects for Duo Mode
 * - Pulsating glow and plasma bridge effects
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import DuoEasterEggOverlay from './DuoEasterEggOverlay';
import './RenderModeSelector.css';

// ============================================================================
// Types
// ============================================================================

export type RenderMode = 'cpu' | 'gpu' | 'duo';

interface HardwareInfo {
  cpu_vendor: string;
  gpu_vendor: string;
}

interface RenderModeSelectorProps {
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  gpuAvailable: boolean;
  isRendering?: boolean;
}

interface GradientConfig {
  primary: string;
  secondary: string;
  glow: string;
}

// ============================================================================
// Hardware-based color schemes
// ============================================================================

const CPU_GRADIENTS: Record<string, GradientConfig> = {
  intel: {
    primary: '#0071c5',
    secondary: '#00c7fd',
    glow: 'rgba(0, 113, 197, 0.6)',
  },
  amd: {
    primary: '#ed1c24',
    secondary: '#ff6b35',
    glow: 'rgba(237, 28, 36, 0.6)',
  },
  unknown: {
    primary: '#6366f1',
    secondary: '#a78bfa',
    glow: 'rgba(99, 102, 241, 0.6)',
  },
};

const GPU_GRADIENTS: Record<string, GradientConfig> = {
  nvidia: {
    primary: '#76b900',
    secondary: '#b8e986',
    glow: 'rgba(118, 185, 0, 0.6)',
  },
  amd: {
    primary: '#ff0000',
    secondary: '#ff7f50',
    glow: 'rgba(255, 0, 0, 0.6)',
  },
  intel: {
    primary: '#0071c5',
    secondary: '#00bcd4',
    glow: 'rgba(0, 113, 197, 0.6)',
  },
  unknown: {
    primary: '#8b5cf6',
    secondary: '#c4b5fd',
    glow: 'rgba(139, 92, 246, 0.6)',
  },
};

// ============================================================================
// Component
// ============================================================================

const RenderModeSelector: React.FC<RenderModeSelectorProps> = ({
  mode,
  onModeChange,
  gpuAvailable,
  isRendering = false,
}) => {
  const { t } = useLanguage();
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo>({
    cpu_vendor: 'unknown',
    gpu_vendor: 'unknown',
  });
  const [isHovered, setIsHovered] = useState<'cpu' | 'gpu' | 'duo' | null>(null);

  // Easter Egg: Click counter state
  const [duoClickCount, setDuoClickCount] = useState(0);
  const [lastDuoClickTime, setLastDuoClickTime] = useState(0);
  const [easterEggActive, setEasterEggActive] = useState(false);
  const [easterEggOrigin, setEasterEggOrigin] = useState({ x: 0, y: 0 });
  const duoButtonRef = useRef<HTMLButtonElement>(null);

  // Detect hardware on mount
  useEffect(() => {
    const detectHardware = async () => {
      try {
        const info = await invoke<HardwareInfo>('detect_hardware_info');
        setHardwareInfo(info);
        console.log('[RenderModeSelector] Hardware detected:', info);
      } catch (error) {
        console.warn('[RenderModeSelector] Failed to detect hardware:', error);
      }
    };
    detectHardware();
  }, []);

  // Get gradient configs based on hardware
  const cpuGradient = useMemo(() => 
    CPU_GRADIENTS[hardwareInfo.cpu_vendor] || CPU_GRADIENTS.unknown,
    [hardwareInfo.cpu_vendor]
  );

  const gpuGradient = useMemo(() => 
    GPU_GRADIENTS[hardwareInfo.gpu_vendor] || GPU_GRADIENTS.unknown,
    [hardwareInfo.gpu_vendor]
  );

  // State calculations
  const isCpuActive = mode === 'cpu' || mode === 'duo';
  const isGpuActive = mode === 'gpu' || mode === 'duo';
  const isDuoActive = mode === 'duo';
  const duoDisabled = !gpuAvailable;

  // Click handlers
  const handleCpuClick = useCallback(() => {
    onModeChange('cpu');
  }, [onModeChange]);

  const handleGpuClick = useCallback(() => {
    if (gpuAvailable) {
      onModeChange('gpu');
    }
  }, [gpuAvailable, onModeChange]);

  const handleDuoClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    // Normal mode change (always execute first)
    if (gpuAvailable) {
      onModeChange('duo');
    }

    // Easter Egg: Track rapid clicks on DUO button
    const now = Date.now();
    
    // CRITICAL: Get button rect BEFORE any setState calls
    // React events are pooled and cleared after handler completes
    // If we try to access event.currentTarget inside setState callback, it will be null
    const button = event.currentTarget;
    const buttonRect = button.getBoundingClientRect();
    const buttonCenter = {
      x: buttonRect.left + buttonRect.width / 2,
      y: buttonRect.top + buttonRect.height / 2,
    };

    // Use functional updates to avoid stale closure issues
    setLastDuoClickTime((prevTime) => {
      const timeSinceLastClick = now - prevTime;

      // Reset counter if more than 2 seconds passed
      if (timeSinceLastClick > 2000) {
        setDuoClickCount(1);
        return now;
      }

      // Increment counter using functional update
      setDuoClickCount((prevCount) => {
        const newCount = prevCount + 1;

        // Trigger easter egg on 15th click
        if (newCount >= 15) {
          console.log('EASTER EGG TRIGGERED');

          // Set origin position (already calculated from event above)
          setEasterEggOrigin(buttonCenter);
          
          // Then activate easter egg
          setEasterEggActive(true);
          
          // Reset counter to prevent repeated triggers
          return 0;
        }

        return newCount;
      });

      return now;
    });
  }, [gpuAvailable, onModeChange]);

  // Animation intensity based on rendering state
  const pulseIntensity = isRendering ? 1.2 : 1;
  const glowIntensity = isRendering ? 1.5 : 1;

  return (
    <div 
      className={`render-mode-selector ${isDuoActive ? 'duo-active' : ''} ${isRendering ? 'rendering' : ''}`}
      style={{
        '--cpu-primary': cpuGradient.primary,
        '--cpu-secondary': cpuGradient.secondary,
        '--cpu-glow': cpuGradient.glow,
        '--gpu-primary': gpuGradient.primary,
        '--gpu-secondary': gpuGradient.secondary,
        '--gpu-glow': gpuGradient.glow,
        '--pulse-intensity': pulseIntensity,
        '--glow-intensity': glowIntensity,
      } as React.CSSProperties}
    >
      {/* Outer glow for Duo Mode */}
      <AnimatePresence>
        {isDuoActive && (
          <motion.div 
            className="duo-outer-glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>

      {/* Energy bridge between CPU and GPU */}
      <AnimatePresence>
        {isDuoActive && (
          <motion.div 
            className="energy-bridge"
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <div className="plasma-flow" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* CPU Button */}
      <motion.button
        className={`mode-button cpu-button ${isCpuActive ? 'active' : ''} ${isHovered === 'cpu' ? 'hovered' : ''}`}
        onClick={handleCpuClick}
        onMouseEnter={() => setIsHovered('cpu')}
        onMouseLeave={() => setIsHovered(null)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className="button-content">
          <div className="button-icon">
            <CpuIcon />
          </div>
          <span className="button-label">CPU</span>
          <span className="vendor-badge">{hardwareInfo.cpu_vendor.toUpperCase()}</span>
        </div>
        {isCpuActive && <div className="active-indicator" />}
      </motion.button>

      {/* Duo Button (Center) */}
      <motion.button
        ref={duoButtonRef}
        className={`mode-button duo-button ${isDuoActive ? 'active' : ''} ${isHovered === 'duo' ? 'hovered' : ''}`}
        onClick={handleDuoClick}
        
        onMouseEnter={() => setIsHovered('duo')}
        onMouseLeave={() => setIsHovered(null)}
        disabled={duoDisabled}
        title={duoDisabled ? (t('renderMode.duoDisabledTooltip') || 'GPU not available') : (t('renderMode.duoTooltip') || 'Parallel CPU + GPU rendering')}
        whileHover={!duoDisabled ? { scale: 1.05 } : {}}
        whileTap={!duoDisabled ? { scale: 0.95 } : {}}
      >
        <div className="button-content">
          {isDuoActive && <div className="energy-core" />}
          <div className="button-icon duo-icon">
            <DuoIcon />
          </div>
          <span className="button-label">DUO</span>
        </div>
        {isDuoActive && <div className="active-indicator duo-indicator" />}
      </motion.button>

      {/* GPU Button */}
      <motion.button
        className={`mode-button gpu-button ${isGpuActive ? 'active' : ''} ${isHovered === 'gpu' ? 'hovered' : ''} ${!gpuAvailable ? 'disabled' : ''}`}
        onClick={handleGpuClick}
        onMouseEnter={() => setIsHovered('gpu')}
        onMouseLeave={() => setIsHovered(null)}
        disabled={!gpuAvailable}
        title={!gpuAvailable ? (t('gpu.notAvailableTooltip') || 'GPU not available') : ''}
        whileHover={gpuAvailable ? { scale: 1.02 } : {}}
        whileTap={gpuAvailable ? { scale: 0.98 } : {}}
      >
        <div className="button-content">
          <div className="button-icon">
            <GpuIcon />
          </div>
          <span className="button-label">GPU</span>
          <span className="vendor-badge">{gpuAvailable ? hardwareInfo.gpu_vendor.toUpperCase() : 'N/A'}</span>
        </div>
        {isGpuActive && <div className="active-indicator" />}
      </motion.button>

      {/* Easter Egg: DUO Power Unleashed overlay */}
      <DuoEasterEggOverlay
        active={easterEggActive}
        originPosition={easterEggOrigin}
        onComplete={() => setEasterEggActive(false)}
      />
    </div>
  );
};

// ============================================================================
// Icons
// ============================================================================

const CpuIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
  </svg>
);

const GpuIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="6" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="18" cy="12" r="2" />
    <path d="M4 6V4M8 6V4M12 6V4M16 6V4M20 6V4" />
  </svg>
);

const DuoIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 0110 10" strokeDasharray="4 2" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

export default RenderModeSelector;
