import { describe, it, expect, vi } from 'vitest';

describe('MainWindow Drag and Drop logic', () => {
  const SUPPORTED_VIDEO_EXTENSIONS = [
    'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm',
    'm4v', '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv', 'mpg', 'mpeg'
  ];
  const VIDEO_EXT_REGEX = new RegExp(`\\.(${SUPPORTED_VIDEO_EXTENSIONS.join('|')})$`, 'i');

  describe('VIDEO_EXT_REGEX validation', () => {
    it('accepts all supported video extensions case-insensitively', () => {
      const validSamples = [
        'video.mp4', 'CLIP.MP4', 'test.mkv', 'test.MKV', 'movie.mov',
        'file.avi', 'stream.webm', 'video.flv', 'clip.wmv', 'cam.mts',
        'cam.m2ts', 'disc.vob', 'dvd.mpg', 'dvd.mpeg', 'phone.3gp', 'sample.ts'
      ];
      for (const file of validSamples) {
        expect(VIDEO_EXT_REGEX.test(file.trim())).toBe(true);
      }
    });

    it('rejects non-video extensions', () => {
      const invalidSamples = [
        'image.png', 'photo.jpg', 'doc.pdf', 'archive.zip',
        'script.js', 'styles.css', 'video.mp3', 'data.json',
        'program.exe', '', '   ', 'mp4', 'just-text'
      ];
      for (const file of invalidSamples) {
        expect(VIDEO_EXT_REGEX.test(file.trim())).toBe(false);
      }
    });
  });

  describe('Variant 1: Tauri FileDrop hover & drop event filtering', () => {
    // Simulates the hover handler logic from MainWindow.tsx
    const handleTauriHover = (
      payload: { type: string; paths?: unknown },
      setIsDragging: (val: boolean) => void
    ) => {
      const paths = (payload as { paths?: string[] }).paths;
      const hasValidPaths =
        Array.isArray(paths) &&
        paths.some((p) => typeof p === 'string' && p.trim().length > 0);
      if (hasValidPaths) {
        setIsDragging(true);
      } else {
        setIsDragging(false);
      }
    };

    it('activates isDragging only when paths is a non-empty array with valid file strings', () => {
      const setIsDragging = vi.fn();

      // Valid paths from native OS Explorer drag
      handleTauriHover({ type: 'hover', paths: ['C:\\Videos\\sample.mp4'] }, setIsDragging);
      expect(setIsDragging).toHaveBeenLastCalledWith(true);

      // Empty paths emitted by WRY on text / HTML / URL drag
      handleTauriHover({ type: 'hover', paths: [] }, setIsDragging);
      expect(setIsDragging).toHaveBeenLastCalledWith(false);

      // Undefined or null paths
      handleTauriHover({ type: 'hover', paths: undefined }, setIsDragging);
      expect(setIsDragging).toHaveBeenLastCalledWith(false);

      // Array with only empty or whitespace strings
      handleTauriHover({ type: 'hover', paths: ['', '   '] }, setIsDragging);
      expect(setIsDragging).toHaveBeenLastCalledWith(false);
    });

    // Simulates the drop handler logic from MainWindow.tsx
    const handleTauriDrop = async (
      payload: { type: string; paths?: unknown },
      setIsDragging: (val: boolean) => void,
      addFiles: (files: string[]) => Promise<void>,
      triggerDropSuccess: () => void,
      triggerDropError: () => void
    ) => {
      setIsDragging(false);
      const droppedPaths = payload.paths;
      if (Array.isArray(droppedPaths)) {
        const validFiles = droppedPaths.filter(
          (filePath): filePath is string =>
            typeof filePath === 'string' && VIDEO_EXT_REGEX.test(filePath.trim())
        );
        if (validFiles.length > 0) {
          await addFiles(validFiles);
          triggerDropSuccess();
        } else if (droppedPaths.length > 0) {
          triggerDropError();
        }
      }
    };

    it('processes valid video files and triggers success', async () => {
      const setIsDragging = vi.fn();
      const addFiles = vi.fn().mockResolvedValue(undefined);
      const triggerDropSuccess = vi.fn();
      const triggerDropError = vi.fn();

      await handleTauriDrop(
        { type: 'drop', paths: ['C:\\Videos\\test.mp4', 'C:\\Videos\\notes.txt'] },
        setIsDragging,
        addFiles,
        triggerDropSuccess,
        triggerDropError
      );

      expect(setIsDragging).toHaveBeenCalledWith(false);
      expect(addFiles).toHaveBeenCalledWith(['C:\\Videos\\test.mp4']);
      expect(triggerDropSuccess).toHaveBeenCalled();
      expect(triggerDropError).not.toHaveBeenCalled();
    });

    it('triggers error shake when only non-video files are dropped', async () => {
      const setIsDragging = vi.fn();
      const addFiles = vi.fn().mockResolvedValue(undefined);
      const triggerDropSuccess = vi.fn();
      const triggerDropError = vi.fn();

      await handleTauriDrop(
        { type: 'drop', paths: ['C:\\Documents\\notes.txt', 'C:\\Pictures\\image.png'] },
        setIsDragging,
        addFiles,
        triggerDropSuccess,
        triggerDropError
      );

      expect(setIsDragging).toHaveBeenCalledWith(false);
      expect(addFiles).not.toHaveBeenCalled();
      expect(triggerDropSuccess).not.toHaveBeenCalled();
      expect(triggerDropError).toHaveBeenCalled();
    });

    it('does not trigger error or add files on empty paths drop (text drop)', async () => {
      const setIsDragging = vi.fn();
      const addFiles = vi.fn().mockResolvedValue(undefined);
      const triggerDropSuccess = vi.fn();
      const triggerDropError = vi.fn();

      await handleTauriDrop(
        { type: 'drop', paths: [] },
        setIsDragging,
        addFiles,
        triggerDropSuccess,
        triggerDropError
      );

      expect(setIsDragging).toHaveBeenCalledWith(false);
      expect(addFiles).not.toHaveBeenCalled();
      expect(triggerDropSuccess).not.toHaveBeenCalled();
      expect(triggerDropError).not.toHaveBeenCalled();
    });
  });

  describe('Variant 2: Safety reset listeners', () => {
    it('resets isDragging on pointerdown, pointercancel, Escape keydown, blur, dragend, and window dragleave', () => {
      let isDragging = true;
      const setIsDragging = (val: boolean) => {
        isDragging = val;
      };

      const handlePointerDown = () => setIsDragging(false);
      const handlePointerCancel = () => setIsDragging(false);
      const handleKeyDown = (key: string) => {
        if (key === 'Escape') setIsDragging(false);
      };
      const handleBlur = () => setIsDragging(false);
      const handleDragEnd = () => setIsDragging(false);
      const handleDragLeave = (clientX: number, clientY: number, hasRelatedTarget: boolean) => {
        if (!hasRelatedTarget || clientX <= 0 || clientY <= 0) {
          setIsDragging(false);
        }
      };

      // Pointerdown
      isDragging = true;
      handlePointerDown();
      expect(isDragging).toBe(false);

      // Pointercancel
      isDragging = true;
      handlePointerCancel();
      expect(isDragging).toBe(false);

      // Escape keydown
      isDragging = true;
      handleKeyDown('Escape');
      expect(isDragging).toBe(false);

      // Non-escape keydown (should not reset)
      isDragging = true;
      handleKeyDown('Enter');
      expect(isDragging).toBe(true);

      // Blur
      isDragging = true;
      handleBlur();
      expect(isDragging).toBe(false);

      // DragEnd
      isDragging = true;
      handleDragEnd();
      expect(isDragging).toBe(false);

      // Window dragleave (cursor left viewport)
      isDragging = true;
      handleDragLeave(0, 0, false);
      expect(isDragging).toBe(false);
    });
  });

  describe('Variant 3: HTML5 dragover & dragstart guards', () => {
    it('sets isDragging(true) only when DragEvent types include "Files"', () => {
      const setIsDragging = vi.fn();

      const handleDragOver = (types?: string[]) => {
        if (types && Array.from(types).includes('Files')) {
          setIsDragging(true);
        } else {
          setIsDragging(false);
        }
      };

      // File drag from OS
      handleDragOver(['Files']);
      expect(setIsDragging).toHaveBeenLastCalledWith(true);

      // Text selection drag
      handleDragOver(['text/plain']);
      expect(setIsDragging).toHaveBeenLastCalledWith(false);

      // Empty or undefined
      handleDragOver([]);
      expect(setIsDragging).toHaveBeenLastCalledWith(false);
      handleDragOver(undefined);
      expect(setIsDragging).toHaveBeenLastCalledWith(false);
    });

    it('dragstart listener cancels accidental element/text drags', () => {
      const preventDefault = vi.fn();
      const handleDragStart = (e: { preventDefault: () => void }) => {
        e.preventDefault();
      };

      handleDragStart({ preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });
  });
});
