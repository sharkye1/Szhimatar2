import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import type { 
  AppPreset, 
  VideoSettings, 
  AudioSettings, 
  MainScreenSettings,
  WatermarkSettings,
} from '../types';
import '../styles/PresetManager.css';

type PresetEntry = {
  name: string;
  isDefault: boolean;
};

interface PresetManagerProps {
  // Current settings to save
  currentVideoSettings: VideoSettings;
  currentAudioSettings: AudioSettings;
  currentMainScreenSettings: MainScreenSettings;
  currentWatermarkSettings?: WatermarkSettings;
  // Callback to apply preset
  onApplyPreset: (preset: AppPreset) => void;
  // Controlled selected preset
  selectedPresetName: string;
  setSelectedPresetName: React.Dispatch<React.SetStateAction<string>>;
}

const PresetManager: React.FC<PresetManagerProps> = ({
  currentVideoSettings,
  currentAudioSettings,
  currentMainScreenSettings,
  currentWatermarkSettings,
  onApplyPreset,
  selectedPresetName,
  setSelectedPresetName,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDescription, setNewPresetDescription] = useState('');
  const [notification, setNotification] = useState<string>('');

  // Load presets on mount
  useEffect(() => {
    loadPresetList();
  }, []);

  const loadPresetList = async () => {
    try {
      const presetNames = await invoke<string[]>('list_presets');
      const entries = await Promise.all(
        presetNames.map(async (name) => {
          try {
            const content = await invoke<string>('load_preset', { name });
            const parsed = JSON.parse(content) as AppPreset;
            return { name, isDefault: !!parsed.isDefault } as PresetEntry;
          } catch (error) {
            console.error('Failed to parse preset', name, error);
            return { name, isDefault: false } as PresetEntry;
          }
        })
      );
      setPresets(entries);
    } catch (error) {
      console.error('Failed to load presets:', error);
      showNotification(t('presets.errorLoading'));
    }
  };

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) {
      showNotification(t('presets.errorEmptyName'));
      return;
    }

    // Validate preset name (no special characters)
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(newPresetName)) {
      showNotification(t('presets.errorInvalidName'));
      return;
    }

    try {
      setIsLoading(true);

      const preset: AppPreset = {
        name: newPresetName.trim(),
        description: newPresetDescription.trim() || undefined,
        video: currentVideoSettings,
        audio: currentAudioSettings,
        mainScreen: currentMainScreenSettings,
        watermark: currentWatermarkSettings,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };

      await invoke('save_preset', {
        name: preset.name,
        content: JSON.stringify(preset, null, 2),
      });

      showNotification(t('presets.saved'));
      setNewPresetName('');
      setNewPresetDescription('');
      setShowSaveDialog(false);
      await loadPresetList();
    } catch (error) {
      console.error('Failed to save preset:', error);
      showNotification(t('presets.errorSaving'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadPreset = async (presetName: string) => {
    try {
      setIsLoading(true);
      const content = await invoke<string>('load_preset', { name: presetName });
      const preset: AppPreset = JSON.parse(content);

      // Validate preset structure before applying
      if (!preset.video || !preset.audio || !preset.mainScreen) {
        throw new Error('Invalid preset structure');
      }

      onApplyPreset(preset); // This will also update selectedPresetName via handleApplyPreset
      showNotification(t('presets.applied'));
    } catch (error) {
      console.error('Failed to load preset:', error);
      showNotification(t('presets.errorLoading'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPresetName) return;

    try {
      setIsLoading(true);
      await invoke('delete_preset', { name: selectedPresetName });
      showNotification(t('presets.deleted'));
      setSelectedPresetName('');
      setShowDeleteDialog(false);
      await loadPresetList();
    } catch (error) {
      console.error('Failed to delete preset:', error);
      showNotification(t('presets.errorDeleting'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleMakeDefault = async () => {
    if (!selectedPresetName) return;
    try {
      setIsLoading(true);
      const presetNames = await invoke<string[]>('list_presets');
      await Promise.all(
        presetNames.map(async (name) => {
          const content = await invoke<string>('load_preset', { name });
          const parsed = JSON.parse(content) as AppPreset;
          const updated: AppPreset = { ...parsed, isDefault: name === selectedPresetName };
          await invoke('save_preset', {
            name: parsed.name || name,
            content: JSON.stringify(updated, null, 2),
          });
        })
      );
      await loadPresetList();
      showNotification(t('presets.defaultSet'));
    } catch (error) {
      console.error('Failed to set default preset:', error);
      showNotification(t('presets.errorSaving'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="preset-manager" style={{ borderColor: theme.colors.border }}>
      <div className="preset-selector-row">
        <label style={{ color: theme.colors.text }}>{t('presets.label')}</label>
        <div className="preset-controls">
          <select
            value={selectedPresetName}
            onChange={(e) => setSelectedPresetName(e.target.value)}
            disabled={isLoading}
            style={{
              background: theme.colors.surface,
              color: theme.colors.text,
              borderColor: theme.colors.border,
            }}
          >
            <option value="">{t('presets.selectPreset')}</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.isDefault ? `⚡ ${p.name}` : p.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => selectedPresetName && handleLoadPreset(selectedPresetName)}
            disabled={!selectedPresetName || isLoading}
            className="btn-apply"
            style={{ background: theme.colors.primary, color: '#fff' }}
          >
            {t('presets.apply')}
          </button>

          <button
            onClick={() => setShowSaveDialog(true)}
            disabled={isLoading}
            className="btn-save"
            style={{ background: theme.colors.success, color: '#fff' }}
          >
            💾 {t('presets.save')}
          </button>

          {selectedPresetName && !presets.find((p) => p.name === selectedPresetName)?.isDefault && (
            <button
              onClick={handleMakeDefault}
              disabled={isLoading}
              className="btn-apply"
              style={{ background: theme.colors.secondary, color: theme.colors.text }}
            >
              ⚡ {t('presets.makeDefault')}
            </button>
          )}

          <button
            onClick={() => setShowDeleteDialog(true)}
            disabled={!selectedPresetName || isLoading}
            className="btn-delete"
            style={{ background: theme.colors.error, color: '#fff' }}
          >
            🗑️ {t('presets.delete')}
          </button>
        </div>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="preset-dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div
            className="preset-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.colors.surface,
              color: theme.colors.text,
              borderColor: theme.colors.border,
            }}
          >
            <h3>{t('presets.saveDialogTitle')}</h3>
            <input
              type="text"
              placeholder={t('presets.namePlaceholder')}
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              maxLength={50}
              style={{
                background: theme.colors.background,
                color: theme.colors.text,
                borderColor: theme.colors.border,
              }}
            />
            <textarea
              placeholder={t('presets.descriptionPlaceholder')}
              value={newPresetDescription}
              onChange={(e) => setNewPresetDescription(e.target.value)}
              maxLength={200}
              rows={3}
              style={{
                background: theme.colors.background,
                color: theme.colors.text,
                borderColor: theme.colors.border,
              }}
            />
            <div className="dialog-buttons">
              <button
                onClick={handleSavePreset}
                disabled={!newPresetName.trim() || isLoading}
                style={{ background: theme.colors.success, color: '#fff' }}
              >
                {t('presets.saveButton')}
              </button>
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setNewPresetName('');
                  setNewPresetDescription('');
                }}
                style={{ background: theme.colors.secondary, color: theme.colors.text }}
              >
                {t('presets.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="preset-dialog-overlay" onClick={() => setShowDeleteDialog(false)}>
          <div
            className="preset-dialog preset-dialog-confirm"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.colors.surface,
              color: theme.colors.text,
              borderColor: theme.colors.border,
            }}
          >
            <h3>{t('presets.deleteDialogTitle')}</h3>
            <p>{t('presets.deleteConfirmation').replace('{name}', selectedPresetName)}</p>
            <div className="dialog-buttons">
              <button
                onClick={handleDeletePreset}
                disabled={isLoading}
                style={{ background: theme.colors.error, color: '#fff' }}
              >
                {t('presets.deleteButton')}
              </button>
              <button
                onClick={() => setShowDeleteDialog(false)}
                style={{ background: theme.colors.secondary, color: theme.colors.text }}
              >
                {t('presets.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div
          className="preset-notification"
          style={{
            background: theme.colors.success,
            color: '#fff',
          }}
        >
          {notification}
        </div>
      )}
    </div>
  );
};

export default PresetManager;
