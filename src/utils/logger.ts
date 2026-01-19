import { invoke } from '@tauri-apps/api/tauri';

export const logger = {
  log: async (message: string) => {
    try {
      await invoke('write_log', { message });
      console.log(`[LOG] ${message}`);
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  },

  info: async (message: string) => {
    await logger.log(`[INFO] ${message}`);
  },

  error: async (message: string, error?: any) => {
    const errorMsg = error ? `${message}: ${error}` : message;
    await logger.log(`[ERROR] ${errorMsg}`);
  },

  warn: async (message: string) => {
    await logger.log(`[WARN] ${message}`);
  }
};
