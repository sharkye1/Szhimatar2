import { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { FolderPlus, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSettings } from '../contexts/SettingsContext';
import { type RecentVideoSettings as Preferences, videoPathKey } from '../utils/recentVideos';

export function RecentVideoSettings() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const [choosing, setChoosing] = useState(false);
  const [folderError, setFolderError] = useState(false);
  const preferences = settings.recentVideos;
  const update = (patch: Partial<Preferences>) => updateSettings({ recentVideos: { ...preferences, ...patch } }, true);

  async function addFolder() {
    setChoosing(true);
    setFolderError(false);
    try {
      const selected = await open({ directory: true, title: t('recentVideos.addFolder') });
      if (typeof selected === 'string' && !preferences.folders.some((folder) => videoPathKey(folder.path) === videoPathKey(selected))) {
        update({ folders: [...preferences.folders, { path: selected, recursive: true }] });
      }
    } catch {
      setFolderError(true);
    } finally {
      setChoosing(false);
    }
  }

  return (
    <section className="setting-group recent-video-settings" aria-label={t('recentVideos.title')}>
      <h3>{t('recentVideos.title')}</h3>
      <label className="recent-video-setting-option">
        <input type="checkbox" checked={preferences.enabled} onChange={(event) => update({ enabled: event.currentTarget.checked })} />
        {t('recentVideos.enabled')}
      </label>
      {preferences.enabled && (
        <>
          <label className="recent-video-setting-option">
            <input type="checkbox" checked={preferences.includeDownloads} onChange={(event) => update({ includeDownloads: event.currentTarget.checked })} />
            {t('recentVideos.downloads')}
          </label>
          {preferences.folders.length === 0 && <p className="recent-video-settings-hint">{t('recentVideos.automatic')}</p>}
          {preferences.folders.length > 0 && (
            <ul className="recent-video-folder-list">
              {preferences.folders.map((folder, index) => (
                <li key={videoPathKey(folder.path)}>
                  <span className="recent-video-folder-path" title={folder.path}>{folder.path}</span>
                  <label className="recent-video-setting-option">
                    <input type="checkbox" checked={folder.recursive} onChange={(event) => {
                      const recursive = event.currentTarget.checked;
                      update({ folders: preferences.folders.map((item, itemIndex) => itemIndex === index ? { ...item, recursive } : item) });
                    }} />
                    {t('recentVideos.subfolders')}
                  </label>
                  <button type="button" className="recent-video-settings-button" aria-label={`${t('recentVideos.removeFolder')}: ${folder.path}`}
                    onClick={() => update({ folders: preferences.folders.filter((_, itemIndex) => itemIndex !== index) })}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="recent-video-settings-button" disabled={choosing} onClick={() => void addFolder()}>
            <FolderPlus size={16} aria-hidden="true" /> {t('recentVideos.addFolder')}
          </button>
          {folderError && <p role="alert">{t('recentVideos.folderError')}</p>}
        </>
      )}
    </section>
  );
}
