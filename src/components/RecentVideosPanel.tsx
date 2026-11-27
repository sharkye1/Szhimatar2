import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type FocusEvent, type PointerEvent } from 'react';
import { Film } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { type RecentVideo, videoVersionKey } from '../utils/recentVideos';
import '../styles/RecentVideos.css';

interface RecentVideosPanelProps extends Pick<ComponentProps<'div'>, 'children' | 'onDragOver' | 'onDragLeave' | 'onDrop'> {
  enabled: boolean;
  videos: RecentVideo[];
  loading: boolean;
  variant?: 'empty' | 'queue';
  status: string;
  onAdd: (video: RecentVideo) => void;
}

const CLOSE_DELAY_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const TIME_LOCALES: Record<string, string> = { ch: 'zh-CN', eo: 'eo', my: 'isv', ru: 'ru', vz: 'ru' };

function ageUnit(elapsed: number): [Intl.RelativeTimeFormatUnit, number] {
  if (elapsed < MINUTE_MS) return ['second', 1000];
  if (elapsed < HOUR_MS) return ['minute', MINUTE_MS];
  return ['hour', HOUR_MS];
}

function RecentVideoAge({ timestamp, active, formatter }: {
  timestamp: number;
  active: boolean;
  formatter: Intl.RelativeTimeFormat;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let timer: number;
    function update() {
      const currentTime = Date.now();
      const elapsed = currentTime - timestamp;
      const [, unitMs] = ageUnit(elapsed);
      setNow(currentTime);
      timer = window.setTimeout(update, unitMs - (elapsed % unitMs));
    }
    update();
    return () => window.clearTimeout(timer);
  }, [active, timestamp]);

  const elapsed = Math.max(0, now - timestamp);
  const [unit, unitMs] = ageUnit(elapsed);
  return (
    <time className="recent-video-age" dateTime={new Date(timestamp).toISOString()}>
      {formatter.format(-Math.floor(elapsed / unitMs), unit)}
    </time>
  );
}

export function RecentVideosPanel({
  enabled, videos, loading, variant = 'empty', status, onAdd, children, onDragOver, onDragLeave, onDrop,
}: RecentVideosPanelProps) {
  const { language, isEmp, t } = useLanguage();
  const timeFormatter = useMemo(() => new Intl.RelativeTimeFormat([TIME_LOCALES[language] ?? 'en', 'en'], {
    numeric: 'always',
  }), [language]);
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const closeTimer = useRef<number>();
  const hovered = useRef(false);
  const openedByTap = useRef(false);
  const focusCard = useRef(false);
  const hasVideos = enabled && videos.length > 0;
  const isOpen = hasVideos && expanded;
  const title = t('recentVideos.title', 'Recent videos') || 'Recent videos';

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

  function focusFirstCard() {
    panelRef.current?.querySelector<HTMLButtonElement>('.recent-video-card')?.focus({ preventScroll: true });
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
    if (!hasVideos) {
      focusCard.current = false;
      hovered.current = false;
      close();
    }
  }, [hasVideos]);

  useEffect(() => {
    if (isOpen && focusCard.current) {
      focusCard.current = false;
      focusFirstCard();
    }
  }, [isOpen]);

  return (
    <div
      className={`recent-videos-area recent-videos-area--${variant}${hasVideos ? ' has-recent-videos' : ''}${isOpen ? ' is-open' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {enabled && (hasVideos || status) && (
        <section
          ref={panelRef}
          className={`recent-videos recent-videos--${variant}${isOpen ? ' is-open' : ''}`}
          aria-label={title}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={(event) => { if (event.pointerType === 'mouse') leave(); }}
          onBlur={handleBlur}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && isOpen) {
              event.stopPropagation();
              close();
              triggerRef.current?.focus();
            }
          }}
        >
          {hasVideos && (
            <>
              <button
                ref={triggerRef}
                type="button"
                className="recent-videos-fan"
                aria-label={title}
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={(event) => {
                  if (event.detail === 0) {
                    if (isOpen) focusFirstCard();
                    else focusCard.current = true;
                  } else {
                    if (openedByTap.current) {
                      close();
                      return;
                    }
                    openedByTap.current = true;
                  }
                  open();
                }}
              />

              <div id={id} className="recent-videos-viewport" aria-hidden={!isOpen} aria-busy={loading}>
                <div className={`recent-videos-cards${videos.length === 1 ? ' has-one' : videos.length === 2 ? ' has-two' : ''}`}>
                  {videos.map((video) => (
                    <button
                      key={videoVersionKey(video)}
                      className="recent-video-card"
                      type="button"
                      tabIndex={isOpen ? undefined : -1}
                      aria-label={video.name}
                      title={video.name}
                      onClick={() => onAdd(video)}
                    >
                      <span className="recent-video-image">
                        {video.thumbnail
                          ? <img src={`data:image/jpeg;base64,${video.thumbnail}`} alt="" draggable={false} />
                          : <Film size={25} aria-hidden="true" />}
                        <span className="recent-video-name">{video.name}</span>
                      </span>
                      {!isEmp && (
                        <RecentVideoAge timestamp={video.createdAt ?? video.addedAt} active={isOpen} formatter={timeFormatter} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {status && <p className="recent-videos-status" role="status">{status}</p>}
        </section>
      )}
      {children}
    </div>
  );
}
