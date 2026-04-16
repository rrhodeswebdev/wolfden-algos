use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use crate::db::{self, DbState};
use crate::zmq_hub;

/// Gracefully terminate a child process: send SIGTERM first, wait up to 2 seconds,
/// then SIGKILL if still alive. On non-Unix platforms, falls back to immediate kill.
fn graceful_kill(child: &mut Child) {
    #[cfg(unix)]
    let pid = child.id();

    #[cfg(unix)]
    {
        // Send SIGTERM for graceful shutdown
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
        // Poll for up to 2 seconds
        for _ in 0..20 {
            match child.try_wait() {
                Ok(Some(_)) => return, // Process exited
                Ok(None) => {}         // Still running
                Err(_) => {
                    child.kill().ok();
                    child.wait().ok();
                    return;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        // Still alive after 2 seconds — force kill
        log::warn!("Process pid={} did not exit after SIGTERM, sending SIGKILL", pid);
        child.kill().ok();
        child.wait().ok();
    }

    #[cfg(not(unix))]
    {
        child.kill().ok();
        child.wait().ok();
    }
}

/// Handles from a spawned algo process for output monitoring.
pub struct ProcessHandles {
    pub stderr: std::process::ChildStderr,
    pub stdout: std::process::ChildStdout,
    pub instance_id: String,
    pub algo_id: String,
}

/// Manages Python algo processes — spawn, track, kill.
///
/// Each algo instance runs in its own process with ZMQ connections
/// to the Rust backend. Keyed by instance_id (UUID).
pub struct ProcessManager {
    processes: Mutex<HashMap<String, Child>>,
    algo_dir: PathBuf,
    runner_path: PathBuf,
    venv_python: PathBuf,
}

impl ProcessManager {
    pub fn new(app_data_dir: PathBuf, venv_python: PathBuf) -> Self {
        let algo_dir = app_data_dir.join("algos");
        fs::create_dir_all(&algo_dir).ok();

        let runner_path = Self::find_runner();

        ProcessManager {
            processes: Mutex::new(HashMap::new()),
            algo_dir,
            runner_path,
            venv_python,
        }
    }

    fn find_runner() -> PathBuf {
        // Try exe-relative path first (most reliable in production), then CWD-based fallbacks for dev
        let candidates = [
            // Relative to executable for release builds — tried first for reliability
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("algo_runtime/runner.py")))
                .unwrap_or_default(),
            // In dev: relative to the CWD
            PathBuf::from("algo_runtime/runner.py"),
            PathBuf::from("../algo_runtime/runner.py"),
        ];
        for c in &candidates {
            if c.exists() {
                return c.clone();
            }
        }
        // Default fallback
        PathBuf::from("algo_runtime/runner.py")
    }

    /// Spawns a Python algo process for the given instance.
    /// Writes the algo code to a temp file, then runs runner.py with the correct args.
    pub fn start_instance(
        &self,
        db_state: &DbState,
        instance_id: &str,
    ) -> Result<(u32, ProcessHandles), String> {
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;

        // Fetch instance and algo details from DB
        let instance = db::get_algo_instance_by_id(&conn, instance_id)
            .map_err(|e| format!("Instance not found: {}", e))?;
        let algo = db::get_algo_by_id(&conn, instance.algo_id)
            .map_err(|e| format!("Algo not found: {}", e))?;

        // Write algo code to a file
        let algo_file = self.algo_dir.join(format!("{}_{}.py", algo.id, instance_id));
        {
            let mut f = fs::File::create(&algo_file)
                .map_err(|e| format!("Failed to write algo file: {}", e))?;
            f.write_all(algo.code.as_bytes())
                .map_err(|e| format!("Failed to write algo code: {}", e))?;
        }

        // Spawn runner.py
        let mut child = Command::new(&self.venv_python)
            .arg(self.runner_path.to_str().unwrap_or("algo_runtime/runner.py"))
            .arg("--algo-path")
            .arg(algo_file.to_str().unwrap_or(""))
            .arg("--market-data-addr")
            .arg(zmq_hub::market_data_addr())
            .arg("--trade-signal-addr")
            .arg(zmq_hub::trade_signal_addr())
            .arg("--instance-id")
            .arg(instance_id)
            .arg("--algo-id")
            .arg(instance.algo_id.to_string())
            .arg("--source-id")
            .arg(&instance.data_source_id)
            .arg("--account")
            .arg(&instance.account)
            .arg("--mode")
            .arg(&instance.mode)
            .arg("--max-position-size")
            .arg(instance.max_position_size.to_string())
            .arg("--max-daily-loss")
            .arg(instance.max_daily_loss.to_string())
            .arg("--max-daily-trades")
            .arg(instance.max_daily_trades.to_string())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn runner.py: {}", e))?;

        let pid = child.id();
        let stderr = child.stderr.take()
            .ok_or("Failed to capture stderr from algo process")?;
        let stdout = child.stdout.take()
            .ok_or("Failed to capture stdout from algo process")?;
        let algo_id_str = instance.algo_id.to_string();
        log::info!(
            "Spawned algo process: instance={} algo={} pid={} source={}",
            instance_id, algo.name, pid, instance.data_source_id
        );

        // Update DB with PID
        db::update_algo_instance_status(&conn, instance_id, "running", Some(pid as i64))
            .map_err(|e| format!("Failed to update instance status: {}", e))?;

        drop(conn);

        self.processes
            .lock()
            .map_err(|e| e.to_string())?
            .insert(instance_id.to_string(), child);

        Ok((pid, ProcessHandles {
            stderr,
            stdout,
            instance_id: instance_id.to_string(),
            algo_id: algo_id_str,
        }))
    }

    /// Stops all running algo processes and marks them as stopped in the DB.
    /// Lock order: processes first, then DB.
    pub fn stop_all(&self, db_state: &DbState) {
        let mut procs = match self.processes.lock() {
            Ok(p) => p,
            Err(e) => {
                log::error!("Failed to lock processes for stop_all: {}", e);
                return;
            }
        };

        let conn = match db_state.0.lock() {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to lock DB for stop_all: {}", e);
                // Still kill processes even if DB update fails
                for (id, mut child) in procs.drain() {
                    log::info!("Stopping algo process: instance={} pid={}", id, child.id());
                    graceful_kill(&mut child);
                }
                return;
            }
        };

        for (id, mut child) in procs.drain() {
            log::info!("Stopping algo process: instance={} pid={}", id, child.id());
            graceful_kill(&mut child);
            db::update_algo_instance_status(&conn, &id, "stopped", None).ok();
        }
    }

    /// Stops all running algo processes for a given data source.
    /// Called when a NinjaTrader chart disconnects.
    /// Lock order: processes first, then DB.
    pub fn stop_instances_for_source(
        &self,
        db_state: &DbState,
        data_source_id: &str,
    ) -> Vec<String> {
        // Acquire process lock first to maintain consistent lock ordering
        let mut procs = match self.processes.lock() {
            Ok(p) => p,
            Err(_) => return vec![],
        };

        let conn = match db_state.0.lock() {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to lock DB for stop_instances_for_source: {}", e);
                return vec![];
            }
        };

        // Find running instances for this data source
        let instances = match db::get_algo_instances(&conn, Some(data_source_id)) {
            Ok(list) => list,
            Err(e) => {
                log::error!("Failed to query instances for source {}: {}", data_source_id, e);
                return vec![];
            }
        };

        let mut stopped = vec![];
        for inst in instances.iter().filter(|i| i.status == "running") {
            if let Some(mut child) = procs.remove(&inst.id) {
                log::info!("Stopping algo (chart disconnected): instance={} pid={}", inst.id, child.id());
                graceful_kill(&mut child);
            }
            db::update_algo_instance_status(&conn, &inst.id, "stopped", None).ok();
            stopped.push(inst.id.clone());
        }

        stopped
    }

    /// Stops a running algo process by instance_id.
    /// Lock order: processes first, then DB.
    pub fn stop_instance(
        &self,
        db_state: &DbState,
        instance_id: &str,
    ) -> Result<(), String> {
        let mut procs = self.processes.lock().map_err(|e| e.to_string())?;

        if let Some(mut child) = procs.remove(instance_id) {
            log::info!("Stopping algo process: instance={} pid={}", instance_id, child.id());
            graceful_kill(&mut child);
        } else {
            log::warn!("No running process found for instance {}", instance_id);
        }

        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        db::update_algo_instance_status(&conn, instance_id, "stopped", None)
            .map_err(|e| format!("Failed to update instance status: {}", e))?;

        // Clean up the algo file
        let pattern = format!("_{}.py", instance_id);
        if let Ok(entries) = fs::read_dir(&self.algo_dir) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().ends_with(&pattern) {
                    fs::remove_file(entry.path()).ok();
                }
            }
        }

        Ok(())
    }
}
