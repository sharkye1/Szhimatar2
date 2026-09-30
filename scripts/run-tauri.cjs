const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function hasLinker() {
  try {
    execSync('where link.exe', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function loadMsvcEnv() {
  if (hasLinker()) {
    return;
  }

  const candidates = [
    'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
  ];

  const vcvars = candidates.find(p => fs.existsSync(p));
  if (!vcvars) {
    return;
  }

  try {
    const raw = execSync(`chcp 65001 >nul && cmd.exe /s /c ""${vcvars}" >nul 2>&1 && set"`, { encoding: 'utf-8' });
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const k = line.substring(0, idx);
        const v = line.substring(idx + 1);
        process.env[k] = v;
      }
    }
  } catch (err) {
    console.warn('[run-tauri] Warning: Could not initialize MSVC environment:', err.message);
  }
}

loadMsvcEnv();

// Forward to Tauri CLI directly within the same Node process
const tauriEntry = path.join(__dirname, '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
require(tauriEntry);
