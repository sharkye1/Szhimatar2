use ed25519_dalek::{Signature, VerifyingKey};
use futures_util::StreamExt;
use semver::Version;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};
use tauri::Manager;
use tokio::io::AsyncWriteExt;

const PUBLIC_KEY: &str = include_str!("../update-public-key.hex");
const PLATFORM: &str = "windows-x86_64";
const RELEASES: &str = "https://github.com/sharkye1/Szhimatar2/releases/download";

fn signed_message(version: &Version, hash: &str) -> String {
    format!("Szhimatar update v1\n{PLATFORM}\n{version}\n{hash}\n")
}

fn verify_update(
    version: &str,
    hash: &str,
    signature: &str,
    public_key: &str,
) -> Result<Version, String> {
    let version = Version::parse(version).map_err(|_| "Invalid update version")?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("Expected a stable update version".into());
    }
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("Invalid update SHA-256".into());
    }

    let mut key_bytes = [0u8; 32];
    hex::decode_to_slice(public_key.trim(), &mut key_bytes)
        .map_err(|_| "Invalid update public key")?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| "Invalid update public key")?;
    let mut signature_bytes = [0u8; 64];
    hex::decode_to_slice(signature, &mut signature_bytes)
        .map_err(|_| "Invalid update signature")?;
    let signature = Signature::from_bytes(&signature_bytes);
    key.verify_strict(signed_message(&version, hash).as_bytes(), &signature)
        .map_err(|_| "Update signature verification failed")?;
    Ok(version)
}

fn update_path(version: &str, hash: &str, signature: &str) -> Result<(Version, PathBuf), String> {
    let version = verify_update(version, hash, signature, PUBLIC_KEY)?;
    let installed =
        Version::parse(env!("CARGO_PKG_VERSION")).map_err(|_| "Invalid installed version")?;
    if version <= installed {
        return Err("Update must be newer than the installed version".into());
    }
    let path = super::get_app_data_dir()
        .join("updates")
        .join(format!("{version}-{hash}.exe"));
    Ok((version, path))
}

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    version: String,
    hash: String,
    signature: String,
) -> Result<(), String> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err("This platform does not have packaged updates".into());
    }
    let (version, path) = update_path(&version, &hash, &signature)?;
    let directory = path.parent().ok_or("Invalid update directory")?;
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|error| error.to_string())?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{RELEASES}/v{version}/Szhimatar.exe"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?;
    let total = response.content_length().unwrap_or_default();
    let (file, temporary_path) = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| error.to_string())?
        .into_parts();
    let mut file = tokio::fs::File::from_std(file);
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut downloaded = 0;
    let mut last_progress = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        if last_progress.elapsed() >= Duration::from_millis(100) || downloaded == total {
            let _ = app.emit_all(
                "update-download-progress",
                DownloadProgress { downloaded, total },
            );
            last_progress = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    if hex::encode(hasher.finalize()) != hash {
        return Err("Update SHA-256 mismatch".into());
    }
    temporary_path
        .persist(path)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn apply_update(
    app: tauri::AppHandle,
    version: String,
    hash: String,
    signature: String,
) -> Result<(), String> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err("This platform does not have packaged updates".into());
    }
    let (_, path) = update_path(&version, &hash, &signature)?;
    start_installer(path, &hash)?;
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
fn start_installer(download: PathBuf, hash: &str) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::os::windows::process::CommandExt;
    use std::{fs, io};

    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let destination = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = destination
        .parent()
        .ok_or("Invalid application directory")?;
    let mut staged = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| format!("Cannot write to the application directory: {error}"))?;
    let mut source = fs::File::open(download).map_err(|error| error.to_string())?;
    io::copy(&mut source, staged.as_file_mut()).map_err(|error| error.to_string())?;
    staged
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    let mut staged_file = staged.reopen().map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    io::copy(&mut staged_file, &mut hasher).map_err(|error| error.to_string())?;
    if hex::encode(hasher.finalize()) != hash {
        return Err("Staged update SHA-256 mismatch".into());
    }
    drop(staged_file);
    let (_, staged_path) = staged.keep().map_err(|error| error.to_string())?;
    let script: Vec<_> = include_str!("apply-update.ps1")
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let result = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &STANDARD.encode(script),
        ])
        .env("SZHIMATAR_UPDATE_PID", std::process::id().to_string())
        .env("SZHIMATAR_UPDATE_SOURCE", &staged_path)
        .env("SZHIMATAR_UPDATE_DESTINATION", destination)
        .env("SZHIMATAR_UPDATE_HASH", hash)
        .creation_flags(CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW)
        .spawn();
    if let Err(error) = result {
        let _ = fs::remove_file(staged_path);
        return Err(format!("Cannot start the update installer: {error}"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn start_installer(_download: PathBuf, _hash: &str) -> Result<(), String> {
    Err("This platform does not have packaged updates".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn signed_updates_bind_the_hash_and_version() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let public = hex::encode(key.verifying_key().to_bytes());
        let version = Version::new(1, 5, 2);
        let hash = "ab".repeat(32);
        let signature = hex::encode(
            key.sign(signed_message(&version, &hash).as_bytes())
                .to_bytes(),
        );
        assert_eq!(
            verify_update("1.5.2", &hash, &signature, &public).unwrap(),
            version
        );
        assert!(verify_update("1.5.3", &hash, &signature, &public).is_err());
        assert!(verify_update("1.5.2", &"ba".repeat(32), &signature, &public).is_err());
        assert!(verify_update("1.5.2", &hash, "", &public).is_err());
        assert!(verify_update("1.5.2", &hash, &signature, &"00".repeat(32)).is_err());
    }
}
