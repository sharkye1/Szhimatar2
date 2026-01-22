import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * VideoGuide Component
 * 
 * Displays a YouTube video guide only when internet is available.
 * The video URL can be changed in one place (YOUTUBE_VIDEO_URL constant).
 */

// ⚙️ Change this URL to use a different YouTube video
const YOUTUBE_VIDEO_ID = 'Wd2OiAwO0To'; // https://www.youtube.com/watch?v=Wd2OiAwO0To

interface VideoGuideProps {
  /** Optional: Custom title for the video guide section */
  title?: string;
}

/**
 * Check internet connectivity by attempting to load a small resource
 * Uses a 2-second timeout to avoid UI freezing
 */
const checkInternetConnection = async (): Promise<boolean> => {
  try {
    // Try to fetch a tiny resource with a 2-second timeout
    await Promise.race([
      fetch('https://www.google.com/favicon.ico', { 
        mode: 'no-cors',
        cache: 'no-cache'
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 2000)
      ),
    ]);
    return true;
  } catch (error) {
    console.debug('Internet check failed:', error);
    return false;
  }
};

/**
 * Convert YouTube watch URL or video ID to embed URL
 */
const getYouTubeEmbedUrl = (videoId: string): string => {
  // If it's a full URL, extract the video ID
  if (videoId.includes('youtube.com') || videoId.includes('youtu.be')) {
    const urlParams = new URLSearchParams(new URL(videoId).search);
    const id = urlParams.get('v');
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  
  // Otherwise treat it as a video ID
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
};

export const VideoGuide: React.FC<VideoGuideProps> = ({ 
  title = ''
}) => {
  const { theme } = useTheme();
  const [showVideo, setShowVideo] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkConnection = async () => {
      setIsChecking(true);
      try {
        const isConnected = await checkInternetConnection();
        setShowVideo(isConnected);
      } catch (error) {
        console.debug('Internet check error:', error);
        setShowVideo(false);
      } finally {
        setIsChecking(false);
      }
    };

    // Check connection immediately
    checkConnection();

    // Re-check every 10 minutes to detect connection changes
    const interval = setInterval(checkConnection, 600000);

    return () => clearInterval(interval);
  }, []);

  // Don't render anything if still checking or no internet
  if (isChecking || !showVideo) {
    return null;
  }

  const embedUrl = getYouTubeEmbedUrl(YOUTUBE_VIDEO_ID);

  return (
    <div className="setting-group" style={{ marginTop: '20px' }}>
      <label>{title}</label>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '12px 0',
        }}
      >
        <iframe
          width="560"
          height="315"
          src={embedUrl}
          title="Setup Guide"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            borderRadius: 8,
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.surface,
          }}
        />
      </div>
    </div>
  );
};

export default VideoGuide;
