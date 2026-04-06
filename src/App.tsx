import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/tauri';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import MainWindow from './pages/MainWindow';
import RenderService from './services/RenderService';
import VideoSettings from './pages/VideoSettings';
import AudioSettings from './pages/AudioSettings';
import GeneralSettings from './pages/GeneralSettings';
import MotionScreen from './components/MotionScreen';
import CursorGlow from './components/CursorGlow';
import {
  VideoSettings as VideoSettingsType,
  AudioSettings as AudioSettingsType,
  MainScreenSettings,
  WatermarkSettings as WatermarkSettingsType,
  AppPreset,
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_MAIN_SCREEN_SETTINGS,
  DEFAULT_WATERMARK_SETTINGS,
} from './types';

type Screen = 'main' | 'video' | 'audio' | 'general';

type DefaultPresetResponse = {
  name: string;
  content: string;
};

function AppContent() {
  const { performanceMode, screenAnimation } = useSettings();
  const [currentScreen, setCurrentScreen] = useState<Screen>('main');
  const [videoSettings, setVideoSettings] = useState<VideoSettingsType>(DEFAULT_VIDEO_SETTINGS);
  const [audioSettings, setAudioSettings] = useState<AudioSettingsType>(DEFAULT_AUDIO_SETTINGS);
  const [mainScreenSettings, setMainScreenSettings] = useState<MainScreenSettings>(DEFAULT_MAIN_SCREEN_SETTINGS);
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>(DEFAULT_WATERMARK_SETTINGS);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('');
  const [cliFiles, setCliFiles] = useState<string[]>([]);

  // Mouse tracking for glassmorphism light effects
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const root = document.documentElement;
    root.style.setProperty('--mouse-x', `${e.clientX}px`);
    root.style.setProperty('--mouse-y', `${e.clientY}px`);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentScreen !== 'main') {
        setCurrentScreen('main');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentScreen]);

  // Load GPU availability and render mode on startup
  useEffect(() => {
    const loadGpuSettings = async () => {
      try {
        const settings = await invoke<any>('load_settings');
        
        // Set GPU availability in RenderService
        if (settings.gpuAvailable !== undefined) {
          RenderService.setGpuAvailability(!!settings.gpuAvailable);
        } else {
          // First run: check GPU compatibility
          try {
            const available = await invoke<boolean>('check_gpu_compatibility');
            RenderService.setGpuAvailability(!!available);
          } catch (e) {
            console.warn('GPU check failed:', e);
            RenderService.setGpuAvailability(false);
          }
        }
        
        // Set render mode in RenderService
        if (settings.renderMode) {
          RenderService.setRenderMode(settings.renderMode as 'cpu' | 'gpu' | 'duo');
        }
      } catch (error) {
        console.error('Failed to load GPU settings:', error);
      }
    };

    loadGpuSettings();
  }, []);

  // Apply default preset on startup (if exists)
  useEffect(() => {
    const applyDefaultPreset = async () => {
      try {
        const defaultPreset = await invoke<DefaultPresetResponse | null>('load_default_preset');
        if (defaultPreset) {
          const p = JSON.parse(defaultPreset.content) as AppPreset;
          setVideoSettings(p.video);
          setAudioSettings(p.audio);
          setMainScreenSettings(p.mainScreen);
          if (p.watermark) {
            setWatermarkSettings(p.watermark);
          }
          setSelectedPresetName(defaultPreset.name);
        }
      } catch (error) {
        console.error('Failed to apply default preset:', error);
      }
    };

    applyDefaultPreset();
  }, []);

  // Check for CLI files passed from context menu
  useEffect(() => {
    const loadCliFiles = async () => {
      try {
        const files = await invoke<string[]>('get_cli_files');
        if (files && files.length > 0) {
          console.log('[App] CLI files received:', files);
          setCliFiles(files);
        }
      } catch (error) {
        console.error('Failed to get CLI files:', error);
      }
    };

    loadCliFiles();
  }, []);

  const navigateTo = (screen: Screen) => setCurrentScreen(screen);
  const goBack = () => setCurrentScreen('main');

  const renderScreen = (key: string, content: JSX.Element) => {
    if (performanceMode) {
      return (
        <div
          key={key}
          className="motion-screen"
          style={{
            background: 'transparent',
            width: '100vw',
            height: '100vh',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {content}
        </div>
      );
    }

    return <MotionScreen key={key} animationType={screenAnimation}>{content}</MotionScreen>;
  };

  const getCurrentScreenContent = (): JSX.Element => {
    switch (currentScreen) {
      case 'video':
        return (
          <VideoSettings
            onBack={goBack}
            settings={videoSettings}
            setSettings={setVideoSettings}
            watermarkSettings={watermarkSettings}
            setWatermarkSettings={setWatermarkSettings}
          />
        );
      case 'audio':
        return (
          <AudioSettings
            onBack={goBack}
            settings={audioSettings}
            setSettings={setAudioSettings}
          />
        );
      case 'general':
        return <GeneralSettings onBack={goBack} />;
      case 'main':
      default:
        return (
          <MainWindow
            onNavigate={navigateTo}
            videoSettings={videoSettings}
            setVideoSettings={setVideoSettings}
            audioSettings={audioSettings}
            setAudioSettings={setAudioSettings}
            mainScreenSettings={mainScreenSettings}
            setMainScreenSettings={setMainScreenSettings}
            watermarkSettings={watermarkSettings}
            setWatermarkSettings={setWatermarkSettings}
            selectedPresetName={selectedPresetName}
            setSelectedPresetName={setSelectedPresetName}
            cliFiles={cliFiles}
            onCliFilesProcessed={() => setCliFiles([])}
          />
        );
    }
  };

  const currentScreenNode = renderScreen(`screen-${currentScreen}`, getCurrentScreenContent());

  return (
    <>
      {!performanceMode && <div className="app-background" />}
      {!performanceMode && <CursorGlow />}
          
          {/* Main app container with mouse tracking */}
          <div 
            className="app-root"
            onMouseMove={performanceMode ? undefined : handleMouseMove}
            style={{ width: '100vw', height: '100vh', display: 'flex', position: 'relative', zIndex: 2 }}
          >
            {performanceMode ? currentScreenNode : <AnimatePresence mode="wait" initial={false}>{currentScreenNode}</AnimatePresence>}
      </div>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <SettingsProvider>
          <AppContent />
        </SettingsProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
