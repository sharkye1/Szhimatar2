import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import MainWindow from './pages/MainWindow';
import VideoSettings from './pages/VideoSettings';
import AudioSettings from './pages/AudioSettings';
import GeneralSettings from './pages/GeneralSettings';
import WatermarkSettings from './pages/WatermarkSettings';
import MotionScreen from './components/MotionScreen';

type Screen = 'main' | 'video' | 'audio' | 'general' | 'watermark';

function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('main');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentScreen !== 'main') {
        setCurrentScreen('main');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentScreen]);

  const navigateTo = (screen: Screen) => setCurrentScreen(screen);
  const goBack = () => setCurrentScreen('main');

  return (
    <ThemeProvider>
      <LanguageProvider>
        {/* Persistent themed frame to prevent white flashes */}
        <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
          <AnimatePresence mode="wait" initial={false}>
            {currentScreen === 'main' && (
              <MotionScreen key="screen-main">
                <MainWindow onNavigate={navigateTo} />
              </MotionScreen>
            )}
            {currentScreen === 'video' && (
              <MotionScreen key="screen-video">
                <VideoSettings onBack={goBack} />
              </MotionScreen>
            )}
            {currentScreen === 'audio' && (
              <MotionScreen key="screen-audio">
                <AudioSettings onBack={goBack} />
              </MotionScreen>
            )}
            {currentScreen === 'general' && (
              <MotionScreen key="screen-general">
                <GeneralSettings onBack={goBack} />
              </MotionScreen>
            )}
            {currentScreen === 'watermark' && (
              <MotionScreen key="screen-watermark">
                <WatermarkSettings onBack={goBack} />
              </MotionScreen>
            )}
          </AnimatePresence>
        </div>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
