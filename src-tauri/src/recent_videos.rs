use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, Metadata, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const FRESH_FOR_MS: u64 = 24 * 60 * 60 * 1_000;
const QUIET_FOR_MS: u64 = 2_000;
const VISIBLE_LIMIT: usize = 3;
const CHANGED_EVENT: &str = "recent-videos-changed";
lazy_static::lazy_static! {
    static ref VIDEO_EXTENSIONS: Vec<String> =
        serde_json::from_str(include_str!("../../src/utils/videoExtensions.json"))
            .expect("video extensions must be a JSON array");
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct VideoFolder {
    path: PathBuf,
    #[serde(default)]
    recursive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct RecentVideoSettings {
    enabled: bool,
    include_downloads: bool,
    folders: Vec<VideoFolder>,
}

impl Default for RecentVideoSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            include_downloads: true,
            folders: Vec::new(),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Activity {
    Appeared,
    Modified,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentVideo {
    path: PathBuf,
    version: String,
    name: String,
    activity: Activity,
    activity_at: u64,
}

#[derive(Serialize)]
pub(crate) struct RecentVideoScan {
    videos: Vec<RecentVideo>,
    settling: bool,
}

type Arrivals = Arc<Mutex<HashMap<String, u64>>>;

#[derive(Default)]
pub(crate) struct VideoWatch {
    registered: Mutex<Option<(Vec<VideoFolder>, RecommendedWatcher)>>,
    arrivals: Arrivals,
}

fn timestamp(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

fn path_key(path: &Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(windows)]
    {
        let path = path.replace('\\', "/");
        if let Some(unc) = path.strip_prefix("//?/UNC/") {
            return format!("//{}", unc.to_lowercase());
        }
        path.trim_start_matches("//?/").to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.into_owned()
    }
}

fn roots(mut folders: Vec<VideoFolder>, include_downloads: bool) -> Vec<VideoFolder> {
    if include_downloads {
        if let Some(path) = dirs::download_dir() {
            folders.push(VideoFolder {
                path,
                recursive: false,
            });
        }
    }
    let mut unique: Vec<VideoFolder> = Vec::new();
    for folder in folders
        .into_iter()
        .filter(|folder| folder.path.is_absolute())
    {
        let key = path_key(&folder.path);
        if let Some(existing) = unique.iter_mut().find(|item| path_key(&item.path) == key) {
            existing.recursive |= folder.recursive;
        } else {
            unique.push(folder);
        }
    }
    unique
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|ext| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|video| ext.eq_ignore_ascii_case(video))
        })
}

#[tauri::command]
pub(crate) async fn watch_recent_video_folders(
    window: tauri::Window,
    state: tauri::State<'_, VideoWatch>,
    folders: Vec<VideoFolder>,
    include_downloads: bool,
) -> Result<(), String> {
    let folders = roots(folders, include_downloads);
    let mut registered = state.registered.lock().map_err(|error| error.to_string())?;
    if folders.is_empty() {
        *registered = None;
        return Ok(());
    }
    if registered
        .as_ref()
        .is_some_and(|(current, _)| *current == folders)
    {
        return Ok(());
    }
    let arrivals = state.arrivals.clone();
    let mut last_notification: Option<Instant> = None;
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            let video_event = event.paths.iter().any(|path| is_video(path));
            if !video_event
                && !matches!(
                    event.kind,
                    EventKind::Create(_)
                        | EventKind::Remove(_)
                        | EventKind::Modify(ModifyKind::Name(_))
                        | EventKind::Any
                        | EventKind::Other
                )
            {
                return;
            }
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let new_path = match event.kind {
                EventKind::Create(_)
                | EventKind::Modify(ModifyKind::Name(RenameMode::To | RenameMode::Both)) => {
                    event.paths.last().filter(|path| is_video(path))
                }
                _ => None,
            };
            if let Some(path) = new_path {
                let now = timestamp(SystemTime::now());
                if let Ok(mut observed) = arrivals.lock() {
                    observed.retain(|_, time| now.saturating_sub(*time) <= FRESH_FOR_MS);
                    observed.insert(path_key(path), now);
                }
            }
        }
        if last_notification.map_or(true, |last| last.elapsed() >= Duration::from_millis(250)) {
            last_notification = Some(Instant::now());
            let _ = window.emit(CHANGED_EVENT, ());
        }
    })
    .map_err(|error| error.to_string())?;

    let mut watched = Vec::new();
    for folder in &folders {
        let mode = if folder.recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        if watcher.watch(&folder.path, mode).is_ok() {
            watched.push(folder.clone());
        }
    }
    // A later refresh can retry paths that are currently unavailable.
    *registered = Some((watched, watcher));
    Ok(())
}

fn version(metadata: &Metadata) -> String {
    let modified = metadata.modified().map(timestamp).unwrap_or_default();
    let created = metadata.created().map(timestamp).unwrap_or_default();
    format!("{created}:{modified}:{}", metadata.len())
}

fn ready(path: &Path, metadata: &Metadata, now: u64) -> bool {
    if !metadata.is_file() || metadata.len() == 0 {
        return false;
    }
    if let Ok(modified) = metadata.modified() {
        let modified = timestamp(modified);
        if modified <= now && now - modified < QUIET_FOR_MS {
            return false;
        }
    }
    let mut file = OpenOptions::new();
    file.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        // Skip offline placeholders and refuse the open while a writer holds the file.
        if metadata.file_attributes() & (0x1000 | 0x40000 | 0x400000) != 0 {
            return false;
        }
        const FILE_SHARE_READ: u32 = 1;
        const FILE_SHARE_DELETE: u32 = 4;
        file.share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE);
    }
    file.open(path)
        .and_then(|file| file.metadata())
        .is_ok_and(|current| version(&current) == version(metadata))
}

pub(crate) fn is_ready_version(path: &Path, expected: &str) -> bool {
    is_video(path)
        && fs::symlink_metadata(path).is_ok_and(|metadata| {
            version(&metadata) == expected && ready(path, &metadata, timestamp(SystemTime::now()))
        })
}

#[tauri::command]
pub(crate) async fn recent_video_still_ready(path: PathBuf, version: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || is_ready_version(&path, &version))
        .await
        .unwrap_or(false)
}

fn is_output(stem: &str, output_suffix: &str) -> bool {
    let stem = stem.to_lowercase();
    stem.ends_with("_szhatoe")
        || (!output_suffix.is_empty() && stem.ends_with(&output_suffix.to_lowercase()))
}

fn scan(
    folders: Vec<VideoFolder>,
    excluded: Vec<PathBuf>,
    output_suffix: &str,
    arrivals: HashMap<String, u64>,
    now: u64,
) -> RecentVideoScan {
    let mut seen: HashSet<_> = excluded.iter().map(|path| path_key(path)).collect();
    let mut candidates = Vec::new();
    for folder in folders {
        let depth = if folder.recursive { usize::MAX } else { 1 };
        for entry in WalkDir::new(folder.path)
            .min_depth(1)
            .max_depth(depth)
            .into_iter()
            .flatten()
        {
            let path = entry.path();
            if !entry.file_type().is_file() || !is_video(path) {
                continue;
            }
            let key = path_key(path);
            let Some(name) = path.file_stem().and_then(|name| name.to_str()) else {
                continue;
            };
            if is_output(name, output_suffix) || !seen.insert(key.clone()) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let created = metadata
                .created()
                .map(timestamp)
                .ok()
                .filter(|time| *time <= now)
                .unwrap_or_default();
            let modified = metadata
                .modified()
                .map(timestamp)
                .ok()
                .filter(|time| *time <= now)
                .unwrap_or_default();
            let arrived = arrivals.get(&key).copied().unwrap_or_default();
            let activity_at = created.max(modified).max(arrived).min(now);
            if now.saturating_sub(activity_at) > FRESH_FOR_MS {
                continue;
            }
            let was_modified = modified > created.max(arrived).saturating_add(5_000);
            let activity = if was_modified || (created == 0 && arrived == 0) {
                Activity::Modified
            } else {
                Activity::Appeared
            };
            candidates.push((
                RecentVideo {
                    path: path.to_owned(),
                    version: version(&metadata),
                    name: name.to_owned(),
                    activity,
                    activity_at,
                },
                metadata,
            ));
        }
    }
    candidates.sort_unstable_by(|(left, _), (right, _)| {
        right
            .activity_at
            .cmp(&left.activity_at)
            .then_with(|| left.path.cmp(&right.path))
    });
    let mut videos = Vec::new();
    let mut settling = false;
    for (video, metadata) in candidates {
        if ready(&video.path, &metadata, now) {
            videos.push(video);
            if videos.len() == VISIBLE_LIMIT {
                break;
            }
        } else if now.saturating_sub(video.activity_at) <= 60_000 {
            settling = true;
        }
    }
    RecentVideoScan { videos, settling }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn scans_nested_sources_and_skips_outputs_queued_files_and_old_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let desktop = root.join("NVIDIA").join("Desktop");
        fs::create_dir_all(&desktop).unwrap();
        let clip = desktop.join("Clip.MP4");
        let copied = root.join("Copied.mkv");
        let queued = root.join("Queued.mp4");
        for file in [
            &clip,
            &copied,
            &queued,
            &desktop.join("Clip_szhatoe.MP4"),
            &root.join("Part.mp4.part"),
        ] {
            fs::write(file, b"video data").unwrap();
        }
        let now = timestamp(SystemTime::now()) + 3_000;
        let old_now = now + 2 * FRESH_FOR_MS;
        let folders = vec![VideoFolder {
            path: root.into(),
            recursive: true,
        }];
        let result = scan(
            folders.clone(),
            vec![queued],
            "_custom",
            HashMap::new(),
            now,
        );
        assert_eq!(result.videos.len(), 2);
        assert!(result
            .videos
            .iter()
            .any(|video| video.path == clip && video.name == "Clip"));
        assert!(result.videos.iter().any(|video| video.path == copied));
        assert!(scan(folders.clone(), vec![], "", HashMap::new(), old_now)
            .videos
            .is_empty());
        let moved_in = HashMap::from([(path_key(&copied), old_now - 3_000)]);
        let result = scan(folders, vec![], "", moved_in, old_now);
        assert_eq!(result.videos.len(), 1);
        assert_eq!(result.videos[0].activity, Activity::Appeared);
    }

    #[test]
    fn shows_three_ready_videos_and_rejects_a_replaced_version() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        for number in 0..4 {
            fs::write(root.join(format!("Clip {number}.mp4")), b"video data").unwrap();
        }
        let writing = root.join("Writing.mp4");
        fs::write(&writing, b"").unwrap();
        let now = timestamp(SystemTime::now()) + 3_000;
        let arrived = HashMap::from([(path_key(&writing), now - 100)]);
        let result = scan(
            vec![VideoFolder {
                path: root.into(),
                recursive: false,
            }],
            vec![],
            "",
            arrived,
            now,
        );
        assert_eq!(result.videos.len(), 3);
        assert!(result.settling);
        let video = &result.videos[0];
        fs::OpenOptions::new()
            .append(true)
            .open(&video.path)
            .unwrap()
            .write_all(b"new")
            .unwrap();
        assert!(!is_ready_version(&video.path, &video.version));
    }

    #[cfg(windows)]
    #[test]
    fn refuses_to_offer_a_file_held_open_for_writing() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Writing.mp4");
        let mut writer = fs::File::create(&path).unwrap();
        writer.write_all(b"video data").unwrap();
        let now = timestamp(SystemTime::now()) + 3_000;
        assert!(!ready(&path, &fs::metadata(&path).unwrap(), now));
        drop(writer);
        assert!(ready(&path, &fs::metadata(&path).unwrap(), now));
    }
}

#[tauri::command]
pub(crate) async fn list_recent_videos(
    state: tauri::State<'_, VideoWatch>,
    folders: Vec<VideoFolder>,
    include_downloads: bool,
    excluded: Vec<PathBuf>,
    output_suffix: String,
) -> Result<RecentVideoScan, String> {
    let arrivals = state
        .arrivals
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan(
            roots(folders, include_downloads),
            excluded,
            &output_suffix,
            arrivals,
            timestamp(SystemTime::now()),
        )
    })
    .await
    .map_err(|error| error.to_string())
}
