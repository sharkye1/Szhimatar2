import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, Image, Loader2,
  Maximize, Minimize, Play, RefreshCcw,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { FFmpegCommandBuilder, resolveRenderVideoSettings } from '../services/RenderService';
import type { PreviewJob } from '../services/RenderService';
import type { RenderMode, RenderSlot } from '../services/RenderScheduler';
import type { AudioSettings, VideoSettings, WatermarkSettings } from '../types';
import './PreviewPanel.css';

type PreviewMedia =
  | { kind: 'frame'; original: string; processed: string; sharedAspect: number | null }
  | { kind: 'video'; path: string; directory: string };

type PreviewResult = { key: string } & ({ media: PreviewMedia } | { error: string });

interface PreviewPanelProps {
  job?: PreviewJob;
  videoSettings: VideoSettings;
  audioSettings: AudioSettings;
  watermarkSettings: WatermarkSettings;
  renderMode: RenderMode;
  gpuAvailable: boolean;
  isVisible: boolean;
  onToggle: () => void;
  embedded?: boolean;
}

function releaseVideo(directory: string) {
  void invoke('release_preview', { directory }).catch(error => console.warn('[Preview] Cleanup failed:', error));
}

function formatTime(seconds: number): string {
  const tenths = Math.floor(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const remainder = Math.floor(tenths / 10) % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}.${tenths % 10}`;
}

export default function PreviewPanel({
  job, videoSettings, audioSettings, watermarkSettings, renderMode, gpuAvailable,
  isVisible, onToggle, embedded = false,
}: PreviewPanelProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'frame' | 'video'>('frame');
  const [slot, setSlot] = useState<RenderSlot>();
  const [position, setPosition] = useState<number>();
  const [divider, setDivider] = useState(50);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<PreviewResult>();
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const nativeFullscreen = useRef(false);
  const changingFullscreen = useRef(false);
  const running = useRef(Promise.resolve());

  const duration = Math.max(0, job?.durationSeconds || 0);
  const start = Math.max(0, Math.min(duration, job?.trimStartSec ?? 0));
  const end = Math.max(start, Math.min(duration, job?.trimEndSec || duration));
  const maxPosition = end - Math.min(0.25, (end - start) / 2);
  const currentTime = Math.max(start, Math.min(maxPosition, position ?? start));
  const speed = videoSettings.codec === 'copy' && videoSettings.targetFormat !== 'gif'
    ? 1 : videoSettings.speed || 1;
  const sampleStart = mode === 'frame' ? Math.max(start, currentTime - 1) : currentTime;
  const sampleEnd = mode === 'frame' ? currentTime + 2 : currentTime + Math.min(5, 3 * speed);
  const sampleDuration = (end > start ? Math.min(end, sampleEnd) : sampleEnd) - sampleStart;
  const canChooseSlot = renderMode === 'duo' && gpuAvailable;
  const activeSlot = canChooseSlot ? (slot ?? job?.assignedSlot ?? 'gpu') : renderMode;
  const preferGpu = activeSlot === 'gpu' && gpuAvailable;
  const inputPath = job?.inputPath;
  const outputPath = videoSettings.targetFormat === 'gif'
    ? 'preview.gif'
    : videoSettings.targetFormat === 'video' && job?.outputPath.toLowerCase().endsWith('.gif')
      ? inputPath : job?.outputPath;
  const request = inputPath ? JSON.stringify({
    inputPath, outputPath, sampleStart, sampleDuration, currentTime, mode, speed,
    videoSettings, audioSettings, watermarkSettings, preferGpu, revision,
  }) : '';

  useEffect(() => {
    setResult(undefined);
    if (!isVisible || !request) return;
    let cancelled = false;
    let videoDirectory: string | undefined;
    const timeout = window.setTimeout(() => {
      // Let an in-flight encode finish. When settings change again, only the latest queued request runs.
      running.current = running.current.then(async () => {
        if (cancelled) return;
        const params = JSON.parse(request) as {
          inputPath: string;
          outputPath?: string;
          sampleStart: number;
          sampleDuration: number;
          currentTime: number;
          mode: 'frame' | 'video';
          speed: number;
          videoSettings: VideoSettings;
          audioSettings: AudioSettings;
          watermarkSettings: WatermarkSettings;
          preferGpu: boolean;
        };
        try {
          const settings = await resolveRenderVideoSettings(params.videoSettings, params.inputPath);
          if (cancelled) return;
          const builder = new FFmpegCommandBuilder(
            settings, params.audioSettings, params.watermarkSettings, params.preferGpu, params.outputPath
          );
          const validation = builder.validate();
          if (!validation.valid) throw new Error(validation.errors.join('\n'));
          const outputExtension = params.outputPath?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() ?? 'mp4';
          const media = await invoke<PreviewMedia>('render_preview', {
            inputPath: params.inputPath,
            sampleStart: params.sampleStart,
            sampleDuration: params.sampleDuration,
            sourceTime: params.currentTime,
            frameTime: params.mode === 'frame' ? (params.currentTime - params.sampleStart) / params.speed : null,
            outputExtension,
            ffmpegArgs: builder.buildArgs(),
          });
          if (media.kind === 'video') {
            if (cancelled) releaseVideo(media.directory);
            else videoDirectory = media.directory;
          }
          if (!cancelled) setResult({ key: request, media });
        } catch (error) {
          if (!cancelled) setResult({ key: request, error: String(error) });
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (videoDirectory) releaseVideo(videoDirectory);
    };
  }, [isVisible, request]);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(
      panelRef.current && document.fullscreenElement === panelRef.current
    ));
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const restoreWindow = useCallback(() => {
    if (!nativeFullscreen.current) return;
    nativeFullscreen.current = false;
    void appWindow.setFullscreen(false).catch(error => console.warn('[Preview] Fullscreen exit failed:', error));
  }, []);

  useEffect(() => restoreWindow, [restoreWindow]);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        restoreWindow();
      }
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [expanded, restoreWindow]);

  const toggleFullscreen = async () => {
    if (changingFullscreen.current) return;
    if (expanded) {
      setExpanded(false);
      restoreWindow();
      return;
    }
    changingFullscreen.current = true;
    try {
      if (typeof window.__TAURI_IPC__ === 'function') {
        if (!(await appWindow.isFullscreen())) {
          await appWindow.setFullscreen(true);
          nativeFullscreen.current = true;
        }
        if (panelRef.current) setExpanded(true);
        else restoreWindow();
      } else if (document.fullscreenElement === panelRef.current) {
        await document.exitFullscreen();
      } else {
        if (!panelRef.current?.requestFullscreen) {
          setExpanded(true);
        } else {
          await panelRef.current.requestFullscreen();
        }
      }
    } catch {
      setExpanded(true);
    } finally {
      changingFullscreen.current = false;
    }
  };

  if (!isVisible) {
    return embedded ? null : (
      <button className="preview-toggle-btn" type="button" onClick={onToggle}
        title={t('preview.show')} aria-label={t('preview.show')}>
        <Eye size={18} />
      </button>
    );
  }

  const current = result?.key === request ? result : undefined;
  const media = current && 'media' in current ? current.media : undefined;
  const error = current && 'error' in current ? current.error : undefined;
  const isLoading = Boolean(request) && !current;
  const refresh = () => setRevision(value => value + 1);
  const enlarged = fullscreen || expanded;
  const fullscreenLabel = enlarged ? t('preview.exitFullscreen') : t('preview.fullscreen');
  const showBitrateWarning = preferGpu && ['h264', 'h265', 'hevc'].includes(videoSettings.codec) &&
    videoSettings.targetFormat !== 'gif' && Boolean(videoSettings.rateControlMode && videoSettings.rateControlMode !== 'crf') &&
    !videoSettings.fpsAuto && Number(videoSettings.fps) >= 60 &&
    Number(videoSettings.resolution.split('x')[1]) >= 1080 &&
    Number(videoSettings.bitrate) > 0 && Number(videoSettings.bitrate) < 6;

  const panel = (
    <section ref={panelRef}
      className={`preview-panel${embedded ? ' preview-panel-embedded' : ''}${expanded ? ' preview-panel-expanded' : ''}`}
      aria-label={t('preview.title')}>
      <header className="preview-header">
        <h3>{t('preview.title')}</h3>
        <div className="preview-header-actions">
          {canChooseSlot && job && videoSettings.targetFormat !== 'gif' && videoSettings.codec !== 'copy' && (
            <select className="preview-slot" value={activeSlot} onChange={event => setSlot(event.target.value as RenderSlot)}
              aria-label={t('preview.encoderSlot')} title={t('preview.encoderSlot')}>
              <option value="cpu">CPU</option>
              <option value="gpu">GPU</option>
            </select>
          )}
          <button type="button" className={`preview-mode-btn ${mode === 'frame' ? 'active' : ''}`}
            onClick={() => setMode('frame')} aria-pressed={mode === 'frame'}
            title={t('preview.frameMode')} aria-label={t('preview.frameMode')}>
            <Image size={16} />
          </button>
          <button type="button" className={`preview-mode-btn ${mode === 'video' ? 'active' : ''}`}
            onClick={() => setMode('video')} aria-pressed={mode === 'video'}
            title={t('preview.videoMode')} aria-label={t('preview.videoMode')}>
            <Play size={16} />
          </button>
          <button type="button" className="preview-mode-btn"
            onClick={() => void toggleFullscreen()} title={fullscreenLabel} aria-label={fullscreenLabel}>
            {enlarged ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
          {!enlarged && (
            <button type="button" className="preview-mode-btn" onClick={onToggle}
              title={t('preview.hide')} aria-label={t('preview.hide')}>
              <EyeOff size={16} />
            </button>
          )}
        </div>
      </header>

      {showBitrateWarning && (
        <div className="preview-warning"><AlertTriangle size={16} />{t('preview.lowBitrateWarning')}</div>
      )}

      <div className="preview-content" aria-busy={isLoading}>
        {!inputPath ? (
          <div className="preview-placeholder"><Image size={48} /><p>{t('preview.selectVideo')}</p></div>
        ) : isLoading ? (
          <div className="preview-loading" role="status"><Loader2 className="spin" size={32} /><p>{t('preview.generating')}</p></div>
        ) : error ? (
          <div className="preview-error" role="alert"><p>{error}</p>
            <button type="button" onClick={refresh}><RefreshCcw size={16} />{t('preview.retry')}</button>
          </div>
        ) : media?.kind === 'frame' ? (
          <div className={`preview-split-view${media.sharedAspect ? '' : ' preview-side-by-side'}`}
            style={media.sharedAspect ? { '--preview-aspect': media.sharedAspect } as CSSProperties : undefined}>
            <div className="preview-original">
              <img src={`data:image/png;base64,${media.original}`} alt={t('preview.original')} draggable={false} />
            </div>
            <div className="preview-processed"
              style={media.sharedAspect ? { clipPath: `inset(0 0 0 ${divider}%)` } : undefined}>
              <img src={`data:image/png;base64,${media.processed}`} alt={t('preview.processed')} draggable={false} />
            </div>
            <span className="preview-label preview-label-original">{t('preview.original')}</span>
            <span className="preview-label preview-label-processed">{t('preview.processed')}</span>
            {media.sharedAspect && (
              <>
                <div className="preview-divider" style={{ left: `${divider}%` }} aria-hidden>
                  <div className="preview-divider-handle"><ChevronLeft size={12} /><ChevronRight size={12} /></div>
                </div>
                <input className="preview-divider-input" type="range" min={0} max={100} value={divider}
                  onChange={event => setDivider(event.target.valueAsNumber)} aria-label={t('preview.compare')} />
              </>
            )}
          </div>
        ) : media?.kind === 'video' && (
          <div className="preview-video-container">
            <video key={media.path} src={convertFileSrc(media.path)} controls loop autoPlay muted playsInline
              onError={() => setResult({ key: request, error: t('preview.videoLoadError') })} />
          </div>
        )}
      </div>

      {end > start && (
        <div className="preview-timeline">
          <div className="preview-time-display">{formatTime(currentTime)} / {formatTime(end)}</div>
          <input className="preview-slider" type="range" min={start} max={maxPosition} step="any"
            value={currentTime} onChange={event => setPosition(event.target.valueAsNumber)}
            aria-label={t('preview.position')} aria-valuetext={formatTime(currentTime)} />
        </div>
      )}

      <button type="button" className="preview-refresh-btn" onClick={refresh} disabled={isLoading || !inputPath}>
        <RefreshCcw className={isLoading ? 'spin' : undefined} size={16} />{t('preview.refresh')}
      </button>
    </section>
  );

  return panel;
}
