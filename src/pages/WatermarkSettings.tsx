import React, { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/SettingsWindow.css';

interface WatermarkSettingsProps {
  onBack: () => void;
}

const WatermarkSettings: React.FC<WatermarkSettingsProps> = ({ onBack }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  
  const [imagePath, setImagePath] = useState('');
  const [position, setPosition] = useState('bottomRight');
  const [opacity, setOpacity] = useState('100');

  const handleSelectImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Image',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp']
        }]
      });

      if (selected && typeof selected === 'string') {
        setImagePath(selected);
      }
    } catch (error) {
      console.error('Failed to select image:', error);
    }
  };

  return (
    <div className="settings-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="settings-header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <button onClick={onBack} className="back-button" style={{ color: theme.colors.primary }}>
          ← {t('buttons.back')}
        </button>
        <h1>{t('watermark.title')}</h1>
      </header>
      
      <div className="settings-content">
        <div className="setting-group">
          <label>{t('watermark.selectImage')}</label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button onClick={handleSelectImage} style={{ background: theme.colors.primary, color: '#fff', padding: '8px 16px', borderRadius: '6px' }}>
              {t('buttons.browse')}
            </button>
            {imagePath && (
              <span style={{ color: theme.colors.textSecondary, fontSize: '14px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {imagePath}
              </span>
            )}
          </div>
        </div>

        <div className="setting-group">
          <label>{t('watermark.position')}</label>
          <select value={position} onChange={(e) => setPosition(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="topLeft">{t('watermark.positions.topLeft')}</option>
            <option value="topRight">{t('watermark.positions.topRight')}</option>
            <option value="bottomLeft">{t('watermark.positions.bottomLeft')}</option>
            <option value="bottomRight">{t('watermark.positions.bottomRight')}</option>
            <option value="center">{t('watermark.positions.center')}</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('watermark.opacity')} (%)</label>
          <input type="range" value={opacity} onChange={(e) => setOpacity(e.target.value)} 
                 min="0" max="100" />
          <span style={{ color: theme.colors.textSecondary }}>{opacity}%</span>
        </div>

        {imagePath && (
          <div className="setting-group">
            <label>Preview</label>
            <div style={{ 
              background: theme.colors.surface, 
              borderColor: theme.colors.border,
              padding: '20px',
              borderRadius: '8px',
              border: '1px solid',
              textAlign: 'center'
            }}>
              <img 
                src={`file://${imagePath}`} 
                alt="Watermark preview" 
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '200px',
                  opacity: parseInt(opacity) / 100
                }} 
              />
            </div>
          </div>
        )}
      </div>

      <div className="settings-footer" style={{ borderColor: theme.colors.border }}>
        <button style={{ background: theme.colors.primary, color: '#fff' }}>
          {t('buttons.apply')}
        </button>
        <button style={{ background: theme.colors.secondary, color: '#fff' }}>
          {t('buttons.reset')}
        </button>
      </div>
    </div>
  );
};

export default WatermarkSettings;
