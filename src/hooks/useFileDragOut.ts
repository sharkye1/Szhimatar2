import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

const DRAG_STATE_EVENT = 'szhimatar-file-drag-state';
const DRAG_THRESHOLD_PX = 6;

// Global tracking to prevent self-drop into MainWindow file drop listener
let globalIsSelfDragging = false;
let globalLastSelfDragEndTime = 0;
let globalCurrentDragFilePath: string | null = null;

export function isSelfDragActive(): boolean {
  if (globalIsSelfDragging) return true;
  // 300ms cooldown window after native drag ends to catch delayed WebView2 drop events
  return Date.now() - globalLastSelfDragEndTime < 300;
}

export function isSelfDraggedPath(path: string): boolean {
  if (!isSelfDragActive()) return false;
  if (!globalCurrentDragFilePath) return true;
  return path.toLowerCase() === globalCurrentDragFilePath.toLowerCase();
}

export interface DragStateDetail {
  isDragging: boolean;
  fileName?: string;
  filePath?: string;
}

export function dispatchDragState(detail: DragStateDetail) {
  window.dispatchEvent(new CustomEvent<DragStateDetail>(DRAG_STATE_EVENT, { detail }));
}

export function useDragOverlayState() {
  const [dragState, setDragState] = useState<DragStateDetail>({ isDragging: false });

  useEffect(() => {
    const handleDragState = (e: Event) => {
      const customEvent = e as CustomEvent<DragStateDetail>;
      setDragState(customEvent.detail || { isDragging: false });
    };

    window.addEventListener(DRAG_STATE_EVENT, handleDragState);
    return () => window.removeEventListener(DRAG_STATE_EVENT, handleDragState);
  }, []);

  return dragState;
}

export function useFileDragOut() {
  const isDraggingRef = useRef(false);

  const startFileDrag = useCallback((filePath: string, fileName?: string, e?: React.MouseEvent) => {
    if (!filePath) return;

    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const startX = e ? e.clientX : 0;
    const startY = e ? e.clientY : 0;
    let dragInitiated = false;

    const executeNativeDrag = async () => {
      if (dragInitiated) return;
      dragInitiated = true;
      globalIsSelfDragging = true;
      globalCurrentDragFilePath = filePath;
      isDraggingRef.current = true;

      // Dispatch active drag state to show overlay
      dispatchDragState({ isDragging: true, fileName, filePath });

      const cleanUpNative = () => {
        dispatchDragState({ isDragging: false });
        isDraggingRef.current = false;
        globalIsSelfDragging = false;
        globalLastSelfDragEndTime = Date.now();
        window.removeEventListener('mouseup', cleanUpNative);
        window.removeEventListener('focus', cleanUpNative);
        window.removeEventListener('blur', cleanUpNative);
        window.removeEventListener('pointerup', cleanUpNative);
      };

      window.addEventListener('mouseup', cleanUpNative, { once: true });
      window.addEventListener('focus', cleanUpNative, { once: true });
      window.addEventListener('blur', cleanUpNative, { once: true });
      window.addEventListener('pointerup', cleanUpNative, { once: true });

      try {
        await invoke('start_drag_file', { filePath });
      } catch (err) {
        console.error('File drag-out failed:', err);
      } finally {
        cleanUpNative();
      }
    };

    // If mouse event was not provided, execute immediately
    if (!e) {
      executeNativeDrag();
      return;
    }

    // Threshold tracking (prevent accidental triggers on simple clicks)
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const distance = Math.hypot(dx, dy);

      if (distance >= DRAG_THRESHOLD_PX) {
        cleanupThresholdListeners();
        executeNativeDrag();
      }
    };

    const handleMouseUp = () => {
      cleanupThresholdListeners();
    };

    const cleanupThresholdListeners = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    window.addEventListener('blur', handleMouseUp, { once: true });
  }, []);

  return { startFileDrag };
}
