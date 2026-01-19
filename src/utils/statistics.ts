export interface Statistics {
  totalCompressions: number;
  totalSpaceSaved: number; // in bytes
  totalTimeSpent: number; // in seconds
  averageCompressionRatio: number;
  mostUsedCodec: string;
  compressionHistory: CompressionRecord[];
}

export interface CompressionRecord {
  id: string;
  timestamp: string;
  inputFile: string;
  outputFile: string;
  originalSize: number;
  compressedSize: number;
  spaceSaved: number;
  compressionTime: number;
  videoCodec: string;
  audioCodec: string;
  success: boolean;
}

class StatisticsManager {
  private stats: Statistics = {
    totalCompressions: 0,
    totalSpaceSaved: 0,
    totalTimeSpent: 0,
    averageCompressionRatio: 0,
    mostUsedCodec: 'h264',
    compressionHistory: []
  };

  async loadStats(): Promise<Statistics> {
    // TODO: Load from stats/stat.json via Tauri fs API
    console.log('Loading statistics...');
    return this.stats;
  }

  async saveStats(): Promise<void> {
    // TODO: Save to stats/stat.json via Tauri fs API
    console.log('Saving statistics...', this.stats);
  }

  async addCompressionRecord(record: CompressionRecord): Promise<void> {
    this.stats.compressionHistory.push(record);
    this.stats.totalCompressions++;
    this.stats.totalSpaceSaved += record.spaceSaved;
    this.stats.totalTimeSpent += record.compressionTime;
    
    // Calculate average compression ratio
    const totalRatio = this.stats.compressionHistory.reduce((sum, r) => {
      return sum + (r.compressedSize / r.originalSize);
    }, 0);
    this.stats.averageCompressionRatio = totalRatio / this.stats.compressionHistory.length;

    // Find most used codec
    const codecCount: Record<string, number> = {};
    this.stats.compressionHistory.forEach(r => {
      codecCount[r.videoCodec] = (codecCount[r.videoCodec] || 0) + 1;
    });
    this.stats.mostUsedCodec = Object.entries(codecCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'h264';

    await this.saveStats();
  }

  getStats(): Statistics {
    return { ...this.stats };
  }

  async resetStats(): Promise<void> {
    this.stats = {
      totalCompressions: 0,
      totalSpaceSaved: 0,
      totalTimeSpent: 0,
      averageCompressionRatio: 0,
      mostUsedCodec: 'h264',
      compressionHistory: []
    };
    await this.saveStats();
  }
}

export const statisticsManager = new StatisticsManager();
