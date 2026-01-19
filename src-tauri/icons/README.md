# App Icons

This folder should contain your application icons for bundling:

- `icon.ico` (Windows)
- `icon.icns` (macOS)
- `32x32.png`, `128x128.png`, `128x128@2x.png` (optional PNGs)

Currently the project is configured to build without icons (see `tauri.conf.json` → `bundle.icon: []`).

To enable custom icons:
1. Place the files above in this folder.
2. Update `src-tauri/tauri.conf.json` to list them in `tauri.bundle.icon`.

Example:
```
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

Tips:
- You can create icons using online generators or design tools.
- For Windows ICO, include 16x16, 32x32, 48x48, 64x64, 128x128 sizes.
- Ensure files exist to avoid tauri-build errors during bundling.
