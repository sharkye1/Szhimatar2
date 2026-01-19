#!/usr/bin/env node

/**
 * Synchronize version from package.json to tauri.conf.json and Cargo.toml
 * Run: node sync-version.js
 */

const fs = require('fs');
const path = require('path');

const packageJson = require('./package.json');
const version = packageJson.version;

console.log(`📦 Syncing version: ${version}`);

// Update tauri.conf.json
const tauriConfPath = path.join(__dirname, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
tauriConf.package.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 4));
console.log(`✅ Updated src-tauri/tauri.conf.json`);

// Update Cargo.toml
const cargoPath = path.join(__dirname, 'src-tauri', 'Cargo.toml');
let cargoContent = fs.readFileSync(cargoPath, 'utf-8');
cargoContent = cargoContent.replace(/version = "[\d.]+"/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargoContent);
console.log(`✅ Updated src-tauri/Cargo.toml`);

console.log(`\n✨ Version ${version} synced to all files!`);
