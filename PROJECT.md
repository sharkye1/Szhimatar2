# Project: Szhimatar Performance Optimizations (7-Point Package)

## Architecture
Szhimatar is a desktop offline video compressor and media tool built with Tauri (Rust backend), React 18, TypeScript, and Vite.
This optimization package addresses idle resource consumption, UI thread micro-stutters, GPU/VRAM leakage, and excess DOM re-renders.

- **Rust Backend**: `src-tauri/src/main.rs` initializes WebView2 and Tauri IPC commands.
- **Queue & Main Window**: `src/pages/MainWindow.tsx`, `src/components/RenderJobItem.tsx`, `src/components/DownloadJobItem.tsx`.
- **Global Styles & Cursor Glow**: `src/components/CursorGlow.tsx`, `src/styles/global.css`, `src/styles/MainWindow.css`.
- **Media Preview**: `src/components/PreviewPanel.tsx` handles video playback and decoder lifecycle.
- **Eco Mode & Theming**: `src/styles/global.css`, `src/pages/GeneralSettings.tsx`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1: WebView2 Native Flags | Set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` with occlusion & throttling flags in `main.rs` before `tauri::Builder` | M1 | ORIGINAL_REQUEST §R1 |
| 2 | R2: Cursor Glow Root Invalidation Fix | Eliminate continuous `--mouse-x`/`--mouse-y` updates on `document.documentElement` in `CursorGlow.tsx` and adapt `global.css` | M1 | ORIGINAL_REQUEST §R2 |
| 3 | R3: Callback Memoization in MainWindow | Memoize callbacks and extract pure helper functions passed to `RenderJobItem` and `DownloadJobItem` in `MainWindow.tsx` | M1 | ORIGINAL_REQUEST §R3 |
| 4 | R4: CSS Virtualization for Job Cards | Add `content-visibility: auto;` and `contain-intrinsic-size: 0 84px;` for `.render-job-card` and `.download-job-card` | M1 | ORIGINAL_REQUEST §R4 |
| 5 | R5: Eliminate Nested Modal Backdrop-Filter | Remove duplicate `backdrop-filter` in `.stats-modal` when `.stats-overlay` is already blurred | M1 | ORIGINAL_REQUEST §R5 |
| 6 | R6: Video Decoder Teardown in PreviewPanel | Clear video `src` and call `.load()` on preview close/unmount to release VRAM video decoders | M1 | ORIGINAL_REQUEST §R6 |
| 7 | R7: Eco Mode Transition Disabling | Guarantee `transition: none !important;` in `.eco-mode` and verify toggle switch functionality | M1 | ORIGINAL_REQUEST §R7 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | 7-Point Performance Optimizations | Full implementation of R1 through R7 across Rust backend, React components, and CSS stylesheets | none | COMPLETED |

## Interface Contracts
### Rust Backend ↔ WebView2
- `main.rs` sets `std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--enable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,TurnOffStreamingMediaSuspending --disable-background-timer-throttling=0")` prior to `tauri::Builder::default()`.

### MainWindow ↔ Job Items
- `RenderJobItem` & `DownloadJobItem` receive stable memoized references for callbacks: `onShowInExplorer`, `onRemoveJob`, `onStopJob`, `onAddToQueue`, `onUpdateJobTrim`, `onRequestTrimFramePreview`, `onHideTrimFramePreview`.
- Helper functions `formatTrimTime`, `formatDurationCompact`, and `getStatusDisplay` maintain referential equality across parent re-renders.

### Queue Styling ↔ DOM
- `.render-job-card` and `.download-job-card` match class names on `RenderJobItem` and `DownloadJobItem` root containers, with `content-visibility: auto` and `contain-intrinsic-size: 0 84px`.

### Video Element Lifecycle
- `videoRef.current`: on unmount and when preview closes, element has `src` cleared via `removeAttribute('src')` / `src = ''` followed by `videoRef.current.load()` to flush DirectShow/MediaFoundation HW decoder surfaces.

## Code Layout
- `src-tauri/src/main.rs`: Rust entry point and WebView2 configuration
- `src/components/CursorGlow.tsx`: Cursor glow component (mouse tracking)
- `src/pages/MainWindow.tsx`: Main application queue manager and state container
- `src/components/RenderJobItem.tsx`: Render job queue item component
- `src/components/DownloadJobItem.tsx`: Download job queue item component
- `src/components/PreviewPanel.tsx`: Video preview player component
- `src/styles/MainWindow.css`: Main window styles, job cards, modal overlays
- `src/styles/global.css`: Global styles, button effects, eco-mode rules
