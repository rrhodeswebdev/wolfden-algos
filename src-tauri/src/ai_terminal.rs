use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

use crate::db::{self, DbState};

/// Handle to a running PTY session — holds the child process, writer, master, and file watcher.
struct PtySession {
    child: Box<dyn portable_pty::Child + Send>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    /// Thread reading PTY output
    _reader_handle: std::thread::JoinHandle<()>,
    /// File watcher for the algo file — dropped on close to stop watching
    _watcher: RecommendedWatcher,
}

/// Manages Claude Code PTY sessions, one per algo.
pub struct AiTerminalManager {
    sessions: Mutex<HashMap<i64, PtySession>>,
    project_root: PathBuf,
    db_path: PathBuf,
}

impl AiTerminalManager {
    pub fn new(db_path: PathBuf) -> Self {
        let project_root = Self::find_project_root();
        AiTerminalManager {
            sessions: Mutex::new(HashMap::new()),
            project_root,
            db_path,
        }
    }

    fn find_project_root() -> PathBuf {
        // Try exe-relative path first (most reliable in production), then CWD-based fallbacks for dev
        let candidates = [
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_default(),
            PathBuf::from("."),
            PathBuf::from(".."),
        ];
        for c in &candidates {
            if c.join("algo_runtime").exists() {
                return c.canonicalize().unwrap_or_else(|_| c.clone());
            }
        }
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }

    /// Derives a filesystem slug from an algo name.
    fn slugify(name: &str) -> String {
        name.to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '_' })
            .collect::<String>()
            .trim_matches('_')
            .to_string()
    }

    /// Writes the algo's current code from the DB to disk and returns the file path.
    fn write_algo_file(&self, algo: &crate::types::Algo) -> Result<PathBuf, String> {
        let algos_dir = self.project_root.join("algo_runtime/algos");
        fs::create_dir_all(&algos_dir)
            .map_err(|e| format!("Failed to create algos dir: {}", e))?;

        let slug = Self::slugify(&algo.name);
        let file_path = algos_dir.join(format!("{}.py", slug));
        fs::write(&file_path, &algo.code)
            .map_err(|e| format!("Failed to write algo file: {}", e))?;

        Ok(file_path)
    }

    /// Starts a file watcher for the algo file that syncs changes back to the DB.
    fn start_watcher(
        &self,
        algo_id: i64,
        algo_file: PathBuf,
        app_handle: AppHandle,
    ) -> Result<RecommendedWatcher, String> {
        let db_path = self.db_path.clone();
        let watched_path = algo_file.clone();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("File watcher error: {}", e);
                    return;
                }
            };

            // React to any event that could indicate the file content changed.
            // Claude Code does atomic writes (write tmp + rename), which fires
            // Create/Rename events on macOS rather than Modify.
            let dominated_by_file = event.paths.iter().any(|p| p == &watched_path);
            if !dominated_by_file {
                return;
            }

            // Read the updated file
            let code = match fs::read_to_string(&watched_path) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("Failed to read updated algo file: {}", e);
                    return;
                }
            };

            // Open a dedicated DB connection for this update
            let conn = match rusqlite::Connection::open(&db_path) {
                Ok(c) => c,
                Err(e) => {
                    log::error!("Failed to open DB for algo code sync: {}", e);
                    return;
                }
            };

            if let Err(e) = db::update_algo_code(&conn, algo_id, &code) {
                log::error!("Failed to update algo code in DB: {}", e);
                return;
            }

            log::info!("Synced file change to DB for algo {}", algo_id);

            // Emit event to frontend
            #[derive(Clone, serde::Serialize)]
            struct AlgoCodeUpdated {
                algo_id: i64,
                code: String,
            }

            if let Err(e) = app_handle.emit("algo-code-updated", AlgoCodeUpdated { algo_id, code }) {
                log::warn!("Failed to emit algo-code-updated: {}", e);
            }
        })
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

        // Watch the parent directory so atomic writes (tmp + rename) are caught
        let watch_dir = algo_file.parent().unwrap_or(&algo_file);
        watcher
            .watch(watch_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch algo directory: {}", e))?;

        log::info!("Started file watcher for algo {} at {:?}", algo_id, algo_file);
        Ok(watcher)
    }

    /// Spawns a Claude Code PTY session for the given algo.
    pub fn spawn(
        &self,
        db_state: &DbState,
        algo_id: i64,
        rows: u16,
        cols: u16,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;

        // Enforce one terminal per algo
        if sessions.contains_key(&algo_id) {
            return Err(format!(
                "A terminal session is already active for algo {}",
                algo_id
            ));
        }

        // Fetch algo from DB and write code to disk
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        let algo = db::get_algo_by_id(&conn, algo_id)
            .map_err(|e| format!("Algo not found: {}", e))?;
        drop(conn);

        let algo_file = self.write_algo_file(&algo)?;

        // Check that `claude` is available
        let claude_path = which_claude().ok_or_else(|| {
            "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
                .to_string()
        })?;

        // Start file watcher before spawning PTY
        let watcher = self.start_watcher(algo_id, algo_file.clone(), app_handle.clone())?;

        // Spawn PTY
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: if rows > 0 { rows } else { 24 },
                cols: if cols > 0 { cols } else { 80 },
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // CreateProcessW (used by portable-pty on Windows) can't execute .cmd
        // or .bat files directly — route those through cmd.exe /C. Everything
        // else runs unwrapped.
        let mut cmd = if needs_cmd_wrapper(&claude_path) {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/C");
            c.arg(claude_path.as_os_str());
            c
        } else {
            CommandBuilder::new(claude_path.as_os_str())
        };
        cmd.arg("--allowedTools");
        cmd.arg("Edit");
        cmd.arg("Write");
        cmd.arg("Read");
        cmd.arg("Skill");
        cmd.arg("--system-prompt");
        cmd.arg(format!(
            "You are editing the trading algo \"{name}\". The algo file is at {path}.\n\n\
             FIRST: Load the wolfden-algo skill before doing anything.\n\n\
             Rules:\n\
             - Only read and modify this file. Do not read, search, or explore any other files.\n\
             - Everything you need is in the wolfden-algo skill. Do not look at wolf_types.py, runner.py, examples/, or other algo files.\n\
             - Use the skill's embedded examples as reference, not files on disk.\n\
             - Only respond to questions about this algo, trading strategies, and the Wolf Den algo API. Decline all unrelated requests.",
            name = algo.name,
            path = algo_file.display()
        ));
        cmd.cwd(&self.project_root);

        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        // Spawn a thread to read PTY output and emit events
        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let event_name = format!("ai-terminal-output-{}", algo_id);
        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        if app_handle.emit(&event_name, &data).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        sessions.insert(
            algo_id,
            PtySession {
                child,
                writer,
                master: pty_pair.master,
                _reader_handle: reader_handle,
                _watcher: watcher,
            },
        );

        log::info!("Spawned AI terminal for algo {}", algo_id);
        Ok(())
    }

    /// Sends input bytes to the PTY for the given algo.
    pub fn write(&self, algo_id: i64, input: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get_mut(&algo_id)
            .ok_or_else(|| format!("No active terminal for algo {}", algo_id))?;

        session
            .writer
            .write_all(input)
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;

        Ok(())
    }

    /// Resizes the PTY for the given algo.
    pub fn resize(&self, algo_id: i64, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(&algo_id)
            .ok_or_else(|| format!("No active terminal for algo {}", algo_id))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    /// Kills the PTY session for the given algo and cleans up.
    /// Dropping the session also drops the watcher, stopping file monitoring.
    pub fn close(&self, algo_id: i64) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(mut session) = sessions.remove(&algo_id) {
            session.child.kill().ok();
            session.child.wait().ok();
            // _watcher is dropped here, stopping file monitoring
            log::info!("Closed AI terminal for algo {}", algo_id);
        }
        Ok(())
    }

    /// Closes all active PTY sessions. Called on app shutdown.
    pub fn close_all(&self) {
        let mut sessions = match self.sessions.lock() {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to lock AI terminal sessions for cleanup: {}", e);
                return;
            }
        };
        for (algo_id, mut session) in sessions.drain() {
            log::info!("Killing AI terminal for algo {} (shutdown)", algo_id);
            session.child.kill().ok();
            session.child.wait().ok();
        }
    }

    /// Returns the set of algo IDs that have active terminal sessions.
    pub fn active_algo_ids(&self) -> Vec<i64> {
        self.sessions
            .lock()
            .map(|s| s.keys().copied().collect())
            .unwrap_or_default()
    }
}

/// Locates the Claude Code CLI on disk.
///
/// On Windows, `npm install -g` drops three shims into `%APPDATA%\npm\`:
/// `claude.cmd` (primary), `claude.ps1`, and sometimes a bare `claude`
/// bash script. We probe PATH plus common npm global dirs because an
/// installed GUI app doesn't always inherit every PATH entry the user
/// sees in an interactive shell.
fn which_claude() -> Option<PathBuf> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();

    if cfg!(windows) {
        // Fallback probes — npm global bin is frequently here even when PATH
        // doesn't carry it into the Tauri process environment.
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local_appdata).join("npm"));
        }
    }

    // Extension order mirrors a reasonable PATHEXT precedence; `.cmd` first
    // because that's what npm's cmd-shim generates and what Windows users
    // actually invoke.
    let exts: &[&str] = if cfg!(windows) {
        &[".cmd", ".exe", ".bat", ".ps1", ""]
    } else {
        &[""]
    };

    for dir in dirs {
        for ext in exts {
            let candidate = dir.join(format!("claude{}", ext));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Returns true if `path` is a Windows batch file that must be launched via
/// `cmd.exe /C` — `CreateProcessW` (which portable-pty wraps) won't execute
/// `.cmd` / `.bat` scripts directly.
fn needs_cmd_wrapper(path: &PathBuf) -> bool {
    if !cfg!(windows) {
        return false;
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_ascii_lowercase();
            ext == "cmd" || ext == "bat"
        }
        None => false,
    }
}
