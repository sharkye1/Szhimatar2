// Process Manager for FFmpeg rendering and yt-dlp downloads
// Handles lifecycle of child processes with proper cancellation tokens and cleanup

use lazy_static::lazy_static;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio_util::sync::CancellationToken;

// ============================================================================
// Process Manager Singleton
// ============================================================================

lazy_static! {
    pub static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> =
        Arc::new(Mutex::new(ProcessManager::new()));
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum TaskType {
    Render,
    Download,
}

/// Represents an active process tracked by the manager
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ActiveTask {
    pub id: String,
    pub task_type: TaskType,
    pub started_at: Instant,
    pub pid: Option<u32>,
    pub token: CancellationToken,
}

/// Manages all active FFmpeg and yt-dlp processes
pub struct ProcessManager {
    tasks: HashMap<String, ActiveTask>,
    stopped: HashSet<String>,
}

#[allow(dead_code)]
impl ProcessManager {
    /// Create new ProcessManager
    pub fn new() -> Self {
        Self {
            tasks: HashMap::new(),
            stopped: HashSet::new(),
        }
    }

    /// Register a running task with its cancellation token and PID
    pub fn register(
        &mut self,
        job_id: String,
        task_type: TaskType,
        pid: Option<u32>,
        token: CancellationToken,
    ) {
        let task = ActiveTask {
            id: job_id.clone(),
            task_type,
            started_at: Instant::now(),
            pid,
            token,
        };
        self.tasks.insert(job_id, task);
    }

    /// Unregister a finished task
    pub fn unregister(&mut self, job_id: &str) {
        self.tasks.remove(job_id);
        self.stopped.remove(job_id);
    }

    /// Cancel a specific task by job ID
    ///
    /// # Arguments
    /// * `job_id` - ID of the task to cancel
    ///
    /// # Returns
    /// true if task was found and cancellation requested, false if not found
    pub fn cancel_task(&mut self, job_id: &str) -> bool {
        self.stopped.insert(job_id.to_string());
        if let Some(task) = self.tasks.get(job_id) {
            eprintln!(
                "⚠️  [ProcessManager] Cancelling task: {} (PID: {:?})",
                job_id, task.pid
            );
            task.token.cancel();
            true
        } else {
            eprintln!("⚠️  [ProcessManager] Task not found to cancel: {}", job_id);
            false
        }
    }

    /// Cancel all active tasks (renders and downloads)
    pub fn cancel_all(&mut self) -> usize {
        let count = self.tasks.len();
        let job_ids: Vec<String> = self.tasks.keys().cloned().collect();

        for job_id in job_ids {
            self.cancel_task(&job_id);
        }

        eprintln!("✅ [ProcessManager] Cancelled all {} active tasks", count);
        count
    }

    /// Check if task exists and is active
    pub fn has_process(&self, job_id: &str) -> bool {
        self.tasks.contains_key(job_id)
    }

    /// Check if task was stopped by user
    pub fn is_stopped(&self, job_id: &str) -> bool {
        self.stopped.contains(job_id)
    }

    /// Check and clear stopped flag for a job
    pub fn take_stopped(&mut self, job_id: &str) -> bool {
        self.stopped.remove(job_id)
    }

    /// Get PID of a process by job ID
    pub fn get_pid(&self, job_id: &str) -> Option<u32> {
        self.tasks.get(job_id).and_then(|p| p.pid)
    }

    /// Get all active PIDs
    pub fn active_pids(&self) -> Vec<(String, u32)> {
        self.tasks
            .iter()
            .filter_map(|(id, p)| p.pid.map(|pid| (id.clone(), pid)))
            .collect()
    }

    /// Get count of active processes
    pub fn active_count(&self) -> usize {
        self.tasks.len()
    }

    /// Get list of active job IDs
    pub fn active_jobs(&self) -> Vec<String> {
        self.tasks.keys().cloned().collect()
    }

    /// Diagnose current state (for debugging)
    pub fn diagnose(&self) {
        eprintln!("\n📋 [ProcessManager] Diagnostic Report:");
        eprintln!("   Active tasks: {}", self.tasks.len());

        for (job_id, task) in &self.tasks {
            let elapsed = task.started_at.elapsed();
            eprintln!(
                "   - Task: {}, Type: {:?}, PID: {:?}, Elapsed: {:?}",
                job_id, task.task_type, task.pid, elapsed
            );
        }
        eprintln!();
    }
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
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

    #[test]
    fn test_register_and_cancel() {
        let mut manager = ProcessManager::new();
        let token = CancellationToken::new();
        manager.register(
            "test_job".to_string(),
            TaskType::Render,
            Some(1234),
            token.clone(),
        );
        assert_eq!(manager.active_count(), 1);
        assert!(!token.is_cancelled());

        assert!(manager.cancel_task("test_job"));
        assert!(token.is_cancelled());
        assert!(manager.is_stopped("test_job"));

        manager.unregister("test_job");
        assert_eq!(manager.active_count(), 0);
    }
}
