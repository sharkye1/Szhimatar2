/**
 * useStatistics - React hook for render statistics
 * 
 * Usage:
 * ```tsx
 * const {
 *   renders,
 *   activeRenders,
 *   aggregateStats,
 *   clearHistory,
 *   exportStats,
 *   deleteRender,
 *   formatDuration,
 * } = useStatistics();
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import StatisticsService, {
  Statistics,
  RenderStatRecord,
} from '../services/StatisticsService';

export interface UseStatisticsReturn {
  // Data
  stats: Statistics;
  renders: RenderStatRecord[];
  activeRenders: RenderStatRecord[];
  isLoaded: boolean;
  
  // Aggregate stats
  aggregateStats: {
    total: number;
    successful: number;
    failed: number;
    stopped: number;
    successRate: number;
    avgRenderTime: number;
    avgSpeed: number;
    totalTime: number;
  };
  
  // Actions
  clearHistory: () => Promise<void>;
  exportStats: (outputPath: string) => Promise<void>;
  deleteRender: (id: string) => void;
  refresh: () => Promise<void>;
  
  // Utilities
  formatDuration: (seconds: number) => string;
}

export function useStatistics(): UseStatisticsReturn {
  const [stats, setStats] = useState<Statistics>(StatisticsService.getStats());
  const [isLoaded, setIsLoaded] = useState<boolean>(StatisticsService.isLoaded());

  console.log('[useStatistics] Initial state:', {
    isLoaded: StatisticsService.isLoaded(),
    rendersCount: StatisticsService.getStats().renders.length,
  });

  // Subscribe to StatisticsService updates
  useEffect(() => {
    console.log('[useStatistics] Setting up subscription');
    
    const unsubscribe = StatisticsService.subscribe((newStats) => {
      console.log('[useStatistics] Got update from StatisticsService:', {
        rendersCount: newStats.renders.length,
      });
      setStats({ ...newStats });
    });

    // Load if not already loaded
    if (!StatisticsService.isLoaded()) {
      console.log('[useStatistics] Service not loaded, loading...');
      StatisticsService.load().then(() => {
        console.log('[useStatistics] Load completed');
        setStats(StatisticsService.getStats());
        setIsLoaded(true);
      });
    } else {
      console.log('[useStatistics] Service already loaded, using existing data');
      setStats(StatisticsService.getStats());
      setIsLoaded(true);
    }

    return () => {
      unsubscribe();
    };
  }, []);

  // Get active renders
  const activeRenders = stats.renders.filter(r => r.status === 'rendering');

  // Get aggregate stats
  const aggregateStats = StatisticsService.getAggregateStats();

  // Actions
  const clearHistory = useCallback(async (): Promise<void> => {
    await StatisticsService.clearHistory();
  }, []);

  const exportStats = useCallback(async (outputPath: string): Promise<void> => {
    await StatisticsService.exportToFile(outputPath);
  }, []);

  const deleteRender = useCallback((id: string): void => {
    StatisticsService.deleteRender(id);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await StatisticsService.load();
    setStats(StatisticsService.getStats());
  }, []);

  const formatDuration = useCallback((seconds: number): string => {
    return StatisticsService.formatDuration(seconds);
  }, []);

  return {
    stats,
    renders: stats.renders,
    activeRenders,
    isLoaded,
    aggregateStats,
    clearHistory,
    exportStats,
    deleteRender,
    refresh,
    formatDuration,
  };
}

export default useStatistics;
