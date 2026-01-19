/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly TAURI_PLATFORM: 'linux' | 'darwin' | 'win32' | 'windows';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
