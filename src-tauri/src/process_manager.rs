// Process Manager for FFmpeg rendering
// Handles lifecycle of FFmpeg processes with proper ownership and cleanup

use std::collections::{HashMap, HashSet};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use std::time::Instant;
use lazy_static::lazy_static;

// ============================================================================
// Process Manager Singleton
// ============================================================================

lazy_static! {
    pub static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = 
        Arc::new(Mutex::new(ProcessManager::new()));
}

/// Represents metadata about a rendering process
/// Note: The Child process handle is NOT stored here.
/// It's owned by run_ffmpeg_render and managed there directly.
#[derive(Debug, Clone)]
pub struct RenderProcess {
    pub id: String,
    pub started_at: Instant,
    pub input: PathBuf,
    pub output: PathBuf,
    pub pid: u32,
}

/// Manages all active FFmpeg processes
pub struct ProcessManager {
    processes: HashMap<String, RenderProcess>,
    stopped: HashSet<String>,
}

impl ProcessManager {
    /// Create new ProcessManager
    pub fn new() -> Self {
        Self {
            processes: HashMap::new(),
            stopped: HashSet::new(),
        }
    }

    /// Spawn FFmpeg process for rendering
    /// 
    /// # Arguments
    /// * `job_id` - Unique identifier for this job
    /// * `ffmpeg_path` - Path to FFmpeg binary
    /// * `input_path` - Input video file path
    /// * `output_path` - Output video file path
    /// * `ffmpeg_args` - FFmpeg command arguments
    /// 
    /// # Returns
    /// Result with (Child, PID) tuple or error message
    /// 
    /// The returned Child is owned by the caller (run_ffmpeg_render).
    /// The ProcessManager tracks only metadata for lookup/stopping.
    pub fn spawn_render(
        &mut self,
        job_id: String,
        ffmpeg_path: String,
        input_path: String,
        output_path: String,
        ffmpeg_args: Vec<String>,
    ) -> Result<(Child, u32), String> {
        // Build command with CREATE_NO_WINDOW on Windows
        #[cfg(target_os = "windows")]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut cmd = Command::new(&ffmpeg_path);
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd
        };

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new(&ffmpeg_path);

        // Build full command
        cmd.arg("-y")  // Overwrite output
            .arg("-i")
            .arg(&input_path)
            .args(&ffmpeg_args)
            .arg("-progress")
            .arg("pipe:1")
            .arg("-stats_period")
            .arg("0.5")
            .arg(&output_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Spawn process
        let child = cmd.spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;

        // Get PID
        let pid = child.id();
        
        // Store metadata ONLY (not the Child, which goes to the caller)
        let process = RenderProcess {
            id: job_id.clone(),
            started_at: Instant::now(),
            input: PathBuf::from(&input_path),
            output: PathBuf::from(&output_path),
            pid,
        };

        // Store in map for tracking/lookup
        self.processes.insert(job_id.clone(), process);

        // eprintln!("✅ [ProcessManager] Spawned FFmpeg process - Job: {}, PID: {}", job_id, pid);

        // Return both Child and PID to caller
        Ok((child, pid))
    }

    /// Get process by job ID (mutable reference for reading/waiting)
    pub fn get_process_mut(&mut self, job_id: &str) -> Option<&mut RenderProcess> {
        self.processes.get_mut(job_id)
    }

    /// Mark a render job as stopped by user
    /// 
    /// This does NOT kill the process (that's done by the caller in main.rs).
    /// This just marks it so we can distinguish user-stop from error later.
    /// 
    /// # Arguments
    /// * `job_id` - ID of the job to stop
    /// 
    /// # Returns
    /// true if job was found and marked, false if not found
    pub fn stop_render(&mut self, job_id: &str) -> bool {
        if let Some(process) = self.processes.get(job_id) {
            let pid = process.pid;
            self.stopped.insert(job_id.to_string());
            eprintln!("⚠️  [ProcessManager] Marked as stopped - Job: {}, PID: {} (actual kill done by caller)", job_id, pid);
            true
        } else {
            eprintln!("⚠️  [ProcessManager] Process not found - Job: {}", job_id);
            false
        }
    }

    /// Stop all running renders
    pub fn stop_all_renders(&mut self) {
        let job_ids: Vec<String> = self.processes.keys().cloned().collect();
        
        for job_id in job_ids {
            let _ = self.stop_render(&job_id);
        }

        // eprintln!("✅ [ProcessManager] Stopped all renders");
    }

    /// Clean up finished process
    pub fn remove_process(&mut self, job_id: &str) {
        if self.processes.remove(job_id).is_some() {
            eprintln!("✅ [ProcessManager] Cleaned up process - Job: {}", job_id);
        }
        self.stopped.remove(job_id);
    }

    /// Verify process is actually killed (useful for post-kill verification)
    pub fn verify_killed(&self, job_id: &str) -> bool {
        !self.processes.contains_key(job_id)
    }

    /// Get count of active processes
    pub fn active_count(&self) -> usize {
        self.processes.len()
    }

    /// Get list of active job IDs
    pub fn active_jobs(&self) -> Vec<String> {
        self.processes.keys().cloned().collect()
    }

    /// Check if process exists
    pub fn has_process(&self, job_id: &str) -> bool {
        self.processes.contains_key(job_id)
    }

    /// Get PID of a process by job ID
    pub fn get_pid(&self, job_id: &str) -> Option<u32> {
        self.processes.get(job_id).map(|p| p.pid)
    }

    /// Get all active PIDs
    pub fn active_pids(&self) -> Vec<(String, u32)> {
        self.processes.iter().map(|(id, p)| (id.clone(), p.pid)).collect()
    }

    /// Diagnose current state (for debugging)
    pub fn diagnose(&self) {
        eprintln!("\n📋 [ProcessManager] Diagnostic Report:");
        eprintln!("   Active processes: {}", self.processes.len());
        
        for (job_id, process) in &self.processes {
            let elapsed = process.started_at.elapsed();
            eprintln!("   - Job: {}, PID: {}, Elapsed: {:?}", job_id, process.pid, elapsed);
        }
        eprintln!();
    }

    /// Check and clear stopped flag for a job
    pub fn take_stopped(&mut self, job_id: &str) -> bool {
        self.stopped.remove(job_id)
    }
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Helper for managing process lifecycle within a command
// ============================================================================

/// Context for managing a render process through its full lifecycle
pub struct RenderProcessContext {
    pub job_id: String,
    pub child: Child,
    pub pid: u32,
}

impl RenderProcessContext {
    /// Create new context and register with ProcessManager
    pub fn new(
        job_id: String,
        ffmpeg_path: String,
        input_path: String,
        output_path: String,
        ffmpeg_args: Vec<String>,
    ) -> Result<Self, String> {
        let mut manager = PROCESS_MANAGER.lock()
            .map_err(|e| format!("Failed to lock ProcessManager: {}", e))?;

        let (child, pid) = manager.spawn_render(
            job_id.clone(),
            ffmpeg_path,
            input_path,
            output_path,
            ffmpeg_args,
        )?;

        Ok(Self {
            job_id,
            child,
            pid,
        })
    }

    /// Clean up context (remove from manager)
    pub fn cleanup(self) -> Result<(), String> {
        let mut manager = PROCESS_MANAGER.lock()
            .map_err(|e| format!("Failed to lock ProcessManager: {}", e))?;
        
        manager.remove_process(&self.job_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_manager_creation() {
        let manager = ProcessManager::new();
        assert_eq!(manager.active_count(), 0);
    }

    #[test]
    fn test_active_jobs_empty() {
        let manager = ProcessManager::new();
        let jobs = manager.active_jobs();
        assert!(jobs.is_empty());
    }
}
