/**
 * FFmpegFinder - Intelligent FFmpeg and FFprobe discovery service
 * 
 * Handles cross-platform FFmpeg detection with fallback strategies
 * Ensures absolute paths are always returned and cached
 */

import {
  searchFFmpegSingle,
  resolveAbsolutePath,
  getBinaryVersion,
  saveFFmpegPaths,
  loadFFmpegPaths,
} from '../utils/ffmpeg';

export interface FFmpegInfo {
  path: string;
  version: string;
  isValid: boolean;
}

export interface FFmpegFinderResult {
  ffmpeg: FFmpegInfo | null;
  ffprobe: FFmpegInfo | null;
  lastUpdated: Date;
}

class FFmpegFinderService {
  private cache: FFmpegFinderResult | null = null;
  private searchInProgress: Promise<FFmpegFinderResult> | null = null;

  /**
   * Find FFmpeg with intelligent fallback strategy
   * Results are cached until explicitly cleared
   */
  async findFFmpeg(skipCache: boolean = false): Promise<FFmpegFinderResult> {
    if (skipCache) {
      this.cache = null;
      this.searchInProgress = null;
    }

    // Return cached result if available
    if (!skipCache && this.cache) {
      return this.cache;
    }

    // Prevent concurrent searches
    if (this.searchInProgress) {
      return this.searchInProgress;
    }

    this.searchInProgress = this.initializeFromSavedOrSearch();
    const result = await this.searchInProgress;
    this.searchInProgress = null;
    this.cache = result;

    return result;
  }

  /**
   * Initialize by loading saved paths first, falling back to search only if none are saved
   */
  private async initializeFromSavedOrSearch(): Promise<FFmpegFinderResult> {
    const savedResult = await this.loadSavedPaths();
    if (savedResult) {
      return savedResult;
    }

    return this.performSearch();
  }

  /**
   * Perform the actual FFmpeg search
   */
  private async performSearch(): Promise<FFmpegFinderResult> {
    const ffmpeg = await this.searchForBinary('ffmpeg');
    const ffprobe = ffmpeg
      ? await this.searchForBinary('ffprobe', this.getDirectory(ffmpeg.path) || ffmpeg.path)
      : null;

    return {
      ffmpeg,
      ffprobe,
      lastUpdated: new Date()
    };
  }

  /**
   * Search for a specific binary (ffmpeg or ffprobe)
   * If searchDir is provided, checks there first (for ffprobe with ffmpeg path)
   */
  private async searchForBinary(binaryName: 'ffmpeg' | 'ffprobe', ffmpegDir?: string): Promise<FFmpegInfo | null> {
    const searchDir = ffmpegDir ? this.getDirectory(ffmpegDir) || ffmpegDir : undefined;

    // Stage 1: If ffprobe and ffmpeg dir provided, check same directory
    if (binaryName === 'ffprobe' && searchDir) {
      const nearbyProbe = await this.checkBinaryAt(searchDir, binaryName);
      if (nearbyProbe) return nearbyProbe;
    }

    // Stage 2: Try backend's search
    try {
      const result = await searchFFmpegSingle(binaryName);

      if (result.found && result.path) {
        // Resolve to absolute path if needed
        const absolutePath = await this.resolveAbsolutePath(result.path);
        const validated = await this.validateBinary(absolutePath);
        if (validated) {
          return {
            path: absolutePath,
            version: result.version,
            isValid: true
          };
        }
      }
    } catch (error) {
      console.error(`Backend search failed for ${binaryName}:`, error);
    }

    return null;
  }

  /**
   * Check if binary exists and runs at a specific location
   */
  private async checkBinaryAt(dirPath: string, binaryName: string): Promise<FFmpegInfo | null> {
    try {
      // Windows specific: need to add .exe
      const binaryPath = this.formatBinaryPath(dirPath, binaryName);
      const validated = await this.validateBinary(binaryPath);

      if (validated) {
        const version = await this.getVersion(binaryPath);
        return {
          path: binaryPath,
          version: version,
          isValid: true
        };
      }
    } catch (error) {
      console.warn(`Binary check failed at ${dirPath}:`, error);
    }

    return null;
  }

  /**
   * Format binary name for platform (adds .exe on Windows)
   */
  private formatBinaryPath(dirPath: string, binaryName: string): string {
    const sep = dirPath.includes('\\') ? '\\' : '/';
    const isWindows = dirPath.includes('\\') || binaryName.endsWith('.exe');
    const fileName = isWindows && !binaryName.endsWith('.exe') ? `${binaryName}.exe` : binaryName;
    
    return dirPath.endsWith(sep) 
      ? `${dirPath}${fileName}` 
      : `${dirPath}${sep}${fileName}`;
  }

  /**
   * Resolve a potentially relative or short path to absolute path
   * If already absolute, return as-is
   */
  private async resolveAbsolutePath(path: string): Promise<string> {
    // If already appears absolute, return it
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
      return path;
    }

    // Try to resolve via backend
    try {
      const result = await resolveAbsolutePath(path);
      return result.path;
    } catch (error) {
      console.warn(`Could not resolve absolute path for ${path}:`, error);
      return path;
    }
  }

  /**
   * Validate that binary exists and runs
   * Returns true only if binary can actually execute
   */
  private async validateBinary(binaryPath: string): Promise<boolean> {
    try {
      // Try to get version - this proves the binary works
      const version = await this.getVersion(binaryPath);
      console.log('getVersion output:', version); 
      return !!version && version.length > 0;
    } catch (error) {
      console.debug(`Binary validation failed for ${binaryPath}:`, error);
      return false;
    }
  }

  /**
   * Get version string from binary
   */
  private async getVersion(binaryPath: string): Promise<string> {
    try {
      const result = await getBinaryVersion(binaryPath);
      return result.output?.split('\n')[0] || '';
    } catch (error) {
      throw new Error(`Cannot get version for ${binaryPath}: ${error}`);
    }
  }

  /**
   * Manually set FFmpeg and FFprobe paths (validate before saving)
   */
  async setManualPaths(ffmpegPath: string, ffprobePath?: string): Promise<FFmpegFinderResult> {
    // Validate ffmpeg
    const ffmpeg = await this.validateAndGetInfo(ffmpegPath);
    console.log("FFmpeg validation output:", ffmpeg);
    if (!ffmpeg) {
        
      throw new Error(`Invalid FFmpeg path: ${ffmpegPath}`);
    }

    // Validate ffprobe if provided
    let ffprobe: FFmpegInfo | null = null;
    if (ffprobePath) {
      ffprobe = await this.validateAndGetInfo(ffprobePath);
      if (!ffprobe) {
        throw new Error(`Invalid FFprobe path: ${ffprobePath}`);
      }
    } else {
      // Try to find ffprobe near ffmpeg
      ffprobe = await this.searchForBinary('ffprobe', ffmpeg.path);
    }

    // Save to backend
    try {
      await saveFFmpegPaths(ffmpeg.path, ffprobe?.path || '');
    } catch (error) {
      console.error('Failed to save paths:', error);
      throw error;
    }

    const result: FFmpegFinderResult = {
      ffmpeg,
      ffprobe,
      lastUpdated: new Date()
    };

    this.cache = result;
    return result;
  }

  /**
   * Validate path and get binary info
   */
  private async validateAndGetInfo(binaryPath: string): Promise<FFmpegInfo | null> {
    const absolutePath = await this.resolveAbsolutePath(binaryPath);
    const isValid = await this.validateBinary(absolutePath);

    if (!isValid) {
      return null;
    }

    const version = await this.getVersion(absolutePath);
    return {
      path: absolutePath,
      version,
      isValid: true
    };
  }

  /**
   * Clear cache and force fresh search
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Get cached result without searching
   */
  getCached(): FFmpegFinderResult | null {
    return this.cache;
  }

  /**
   * Load saved paths from backend config; return null only if nothing was saved
   */
  private async loadSavedPaths(): Promise<FFmpegFinderResult | null> {
    try {
      const saved = await loadFFmpegPaths();
      const hasSaved = !!saved.ffmpeg_path?.trim() || !!saved.ffprobe_path?.trim();

      if (!hasSaved) {
        return null;
      }

      const ffmpeg = saved.ffmpeg_path?.trim()
        ? await this.validateAndGetInfo(saved.ffmpeg_path).catch(() => null)
        : null;

      let ffprobe = saved.ffprobe_path?.trim()
        ? await this.validateAndGetInfo(saved.ffprobe_path).catch(() => null)
        : null;

      if (!ffprobe && ffmpeg) {
        const ffmpegDir = this.getDirectory(ffmpeg.path);
        if (ffmpegDir) {
          ffprobe = await this.checkBinaryAt(ffmpegDir, 'ffprobe');
        }
      }

      return {
        ffmpeg,
        ffprobe,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.warn('Failed to load saved FFmpeg paths:', error);
      return null;
    }
  }

  /**
   * Extract directory portion from a binary path
   */
  private getDirectory(binaryPath: string): string | null {
    const lastSlash = Math.max(binaryPath.lastIndexOf('/'), binaryPath.lastIndexOf('\\'));
    if (lastSlash === -1) {
      return null;
    }

    return binaryPath.substring(0, lastSlash);
  }
}

// Export singleton instance
export const ffmpegFinder = new FFmpegFinderService();
