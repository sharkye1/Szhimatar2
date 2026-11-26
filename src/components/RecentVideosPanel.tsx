import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { ChevronDown, Film } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { RECENT_VIDEO_LIMIT, type RecentVideo, videoVersionKey } from '../utils/recentVideos';
import '../styles/RecentVideos.css';

interface RecentVideosPanelProps {
  videos: RecentVideo[];
  loading: boolean;
  variant?: 'empty' | 'queue';
  status: string;
  onAdd: (video: RecentVideo) => void;
}

const CLOSE_DELAY_MS = 1000;

function relativeTime(timestamp: number, language: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const format = new Intl.RelativeTimeFormat(language === 'ru' ? 'ru' : 'en', { numeric: 'auto', style: 'short' });
  if (seconds < 45) return format.format(0, 'second');
  if (seconds < 60 * 60) return format.format(-Math.max(1, Math.floor(seconds / 60)), 'minute');
  return format.format(-Math.floor(seconds / 3600), 'hour');
}

export function RecentVideosPanel({ videos, loading, variant = 'empty', status, onAdd }: RecentVideosPanelProps) {
  const { language, t } = useLanguage();
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [, setClock] = useState(0);
  const closeTimer = useRef<number>();
  const hovered = useRef(false);
  const openedByTap = useRef(false);
  const focusCard = useRef(false);

  function cancelClose() {
    window.clearTimeout(closeTimer.current);
  }

  function open() {
    cancelClose();
    setExpanded(true);
  }

  function close() {
    cancelClose();
    openedByTap.current = false;
    setExpanded(false);
  }

  function delayClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      const focus = document.activeElement;
      const keyboardOnPanel = panelRef.current?.contains(focus) && focus?.matches(':focus-visible');
      if (!hovered.current && !openedByTap.current && !keyboardOnPanel) close();
    }, CLOSE_DELAY_MS);
  }

  function leave() {
    if (!hovered.current) return;
    hovered.current = false;
    delayClose();
  }

  function handlePointerEnter(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    hovered.current = true;
    open();
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!hovered.current && !event.currentTarget.contains(event.relatedTarget)) delayClose();
  }

  useEffect(() => {
    function handlePointerDown(event: globalThis.PointerEvent) {
      if (openedByTap.current && event.target instanceof Node && !panelRef.current?.contains(event.target)) {
        close();
      }
    }
    function handlePointerOut(event: globalThis.PointerEvent) {
      if (event.pointerType === 'mouse' && !event.relatedTarget) leave();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerout', handlePointerOut);
    window.addEventListener('blur', leave);
    return () => {
      cancelClose();
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerout', handlePointerOut);
      window.removeEventListener('blur', leave);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    if (focusCard.current) {
      focusCard.current = false;
      panelRef.current?.querySelector<HTMLButtonElement>('.recent-video-card')?.focus();
    }
    const interval = window.setInterval(() => setClock((clock) => clock + 1), 15_000);
    return () => window.clearInterval(interval);
  }, [expanded]);

  const placeholders = loading && !videos.length;
  return (
    <section
      ref={panelRef}
      className={`recent-videos recent-videos--${variant}${expanded ? ' is-open' : ''}${!videos.length && !placeholders ? ' has-no-videos' : ''}`}
      aria-label={t('recentVideos.title')}
      onClick={(event) => event.stopPropagation()}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') leave(); }}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.stopPropagation();
          close();
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`recent-videos-trigger${variant === 'queue' ? ' queue-add-btn' : ''}`}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={(event) => {
          if (expanded) { close(); return; }
          if (event.detail === 0) focusCard.current = true;
          else openedByTap.current = true;
          open();
        }}
      >
        {t('recentVideos.title')} <ChevronDown size={14} aria-hidden="true" />
      </button>

      <div id={id} className="recent-videos-viewport" aria-hidden={!expanded} aria-busy={loading}>
        {videos.length || placeholders ? (
          <div className={`recent-videos-cards${videos.length === 1 ? ' has-one' : videos.length === 2 ? ' has-two' : ''}`}>
            {placeholders && Array.from({ length: RECENT_VIDEO_LIMIT }, (_, index) => (
              <div className="recent-video-card recent-video-placeholder" key={index} aria-hidden="true">
                <span className="recent-video-image"><Film size={25} /></span>
              </div>
            ))}
            {videos.map((video) => (
              <button
                key={videoVersionKey(video)}
                className="recent-video-card"
                type="button"
                tabIndex={expanded ? undefined : -1}
                title={video.name}
                onClick={() => onAdd(video)}
              >
                <span className="recent-video-image" aria-hidden="true">
                  {video.thumbnail
                    ? <img src={`data:image/jpeg;base64,${video.thumbnail}`} alt="" draggable={false} />
                    : <Film size={25} />}
                </span>
                <span className="recent-video-meta">
                  <span className="recent-video-name">{video.name}</span>
                  <span className="recent-video-age">
                    {t(`recentVideos.${video.activity}`).replace('{time}', relativeTime(video.activityAt, language))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="recent-videos-empty">{t('recentVideos.empty')}</p>
        )}
      </div>
      {status && <p className="recent-videos-status" role="status">{status}</p>}
    </section>
  );
}
