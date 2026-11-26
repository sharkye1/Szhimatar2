import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDownloadTimestamp, parseDownloadTimestamp } from '../utils/downloadHelpers';

type Props = {
  duration: number;
  start: number;
  end: number;
  theme: any;
  startLabel: string;
  endLabel: string;
  onChange: (start: number, end: number) => void;
  onPreview?: (time: number, handle: 'start' | 'end') => void;
  onPreviewEnd?: () => void;
  preview?: React.ReactNode;
  minimumDuration?: number;
};

export default function TimeRangeEditor({ duration, start, end, theme, startLabel, endLabel, onChange, onPreview, onPreviewEnd, preview, minimumDuration = 0.001 }: Props) {
  const [startText, setStartText] = useState(formatDownloadTimestamp(start));
  const [endText, setEndText] = useState(formatDownloadTimestamp(end));
  const [editing, setEditing] = useState<'start' | 'end' | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [previewRect, setPreviewRect] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!preview) return;
    const update = () => {
      const rect = sliderRef.current?.getBoundingClientRect();
      if (rect) setPreviewRect({ left: rect.left, top: rect.top, width: rect.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [!!preview, sliderWidth]);
  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const observer = new ResizeObserver(([entry]) => setSliderWidth(entry.contentRect.width));
    observer.observe(slider);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (editing !== 'start') setStartText(formatDownloadTimestamp(start)); }, [start, editing]);
  useEffect(() => { if (editing !== 'end') setEndText(formatDownloadTimestamp(end)); }, [end, editing]);
  const commit = (handle: 'start' | 'end', text: string) => {
    const value = parseDownloadTimestamp(text);
    if (value !== null && value >= 0 && value <= duration && (handle === 'start' ? end - value >= minimumDuration : value - start >= minimumDuration)) {
      onChange(handle === 'start' ? value : start, handle === 'end' ? value : end);
    }
    setEditing(null);
    if (handle === 'start') setStartText(formatDownloadTimestamp(value !== null && value >= 0 && value <= duration && end - value >= minimumDuration ? value : start));
    else setEndText(formatDownloadTimestamp(value !== null && value - start >= minimumDuration && value <= duration ? value : end));
  };
  const durationAbove = (end - start) / duration * Math.max(0, sliderWidth - 14) < 90;
  const minGap = Math.min(minimumDuration, duration);
  const move = (handle: 'start' | 'end', value: number) => {
    const next = handle === 'start' ? Math.max(0, Math.min(value, end - minGap)) : Math.min(duration, Math.max(value, start + minGap));
    onChange(handle === 'start' ? next : start, handle === 'end' ? next : end);
    onPreview?.(next, handle);
  };
  return <div className="time-range-editor" style={{ ['--trim-accent' as string]: theme.colors.primary }}>
    <input className="time-range-value" aria-label={startLabel} value={startText} onFocus={() => setEditing('start')} onChange={e => setStartText(e.target.value)} onBlur={() => commit('start', startText)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} style={{ color: theme.colors.text, borderColor: theme.colors.border, background: theme.colors.surface }} />
    <div className={`trim-slider-wrap${durationAbove ? ' has-raised-duration' : ''}`} ref={sliderRef}>
      {preview && previewRect && createPortal(<div className={`trim-preview-portal${durationAbove ? ' has-raised-duration' : ''}`} style={{ left: previewRect.left, top: previewRect.top, width: previewRect.width }}>{preview}</div>, document.body)}
      <div className="trim-slider-track" style={{ background: theme.colors.border }} />
      <div className="trim-slider-selected" style={{ left: `calc(7px + ${start / duration * 100}% - ${start / duration * 14}px)`, width: `calc(${(end - start) / duration * 100}% - ${(end - start) / duration * 14}px)`, background: theme.colors.primary }} />
      <span className={`trim-slider-duration${durationAbove ? ' is-above' : ''}`} style={{ left: `calc(7px + ${(start + end) / (2 * duration) * 100}% - ${(start + end) / (2 * duration) * 14}px)`, color: theme.colors.text, background: theme.colors.surface, borderColor: theme.colors.border }}>{formatDownloadTimestamp(end - start)}</span>
      {(['start', 'end'] as const).map(handle => <input key={handle} type="range" className={`trim-range trim-range-${handle}`} min={0} max={duration} step="any" value={handle === 'start' ? start : end} aria-label={handle === 'start' ? startLabel : endLabel} onChange={e => move(handle, Number(e.target.value))} onMouseDown={() => onPreview?.(handle === 'start' ? start : end, handle)} onTouchStart={() => onPreview?.(handle === 'start' ? start : end, handle)} onMouseUp={onPreviewEnd} onTouchEnd={onPreviewEnd} onBlur={onPreviewEnd} />)}
    </div>
    <input className="time-range-value" aria-label={endLabel} value={endText} onFocus={() => setEditing('end')} onChange={e => setEndText(e.target.value)} onBlur={() => commit('end', endText)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} style={{ color: theme.colors.text, borderColor: theme.colors.border, background: theme.colors.surface }} />
  </div>;
}
