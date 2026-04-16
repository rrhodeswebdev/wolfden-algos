# Python Venv Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage a single Python virtual environment in the app data directory, auto-install base + per-algo pip dependencies, and surface install status/errors in the frontend.

**Architecture:** New `venv_manager.rs` module handles venv creation, Python version validation, and pip install via `Command::new`. Process manager switches from `python3` to the venv Python binary. Frontend adds a first-launch setup modal and an "installing deps" state on algo instance cards.

**Tech Stack:** Rust (std::process::Command, sha2 for hashing), React/TypeScript (Tauri invoke/listen), existing Tailwind CSS design system.

---

### Task 1: Add sha2 dependency to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

We need sha2 for hashing dependencies strings to compare against `deps_hash`.

- [ ] **Step 1: Add sha2 to Cargo.toml**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
# Hashing for dependency change detection
sha2 = "0.10"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add sha2 dependency for deps hashing"
```

---

### Task 2: Create venv_manager.rs — Python detection and venv creation

**Files:**
- Create: `src-tauri/src/venv_manager.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod venv_manager;`)

This module handles all venv lifecycle: finding Python, validating version, creating venv, installing deps.

- [ ] **Step 1: Create venv_manager.rs with Python detection and venv creation**

Create `src-tauri/src/venv_manager.rs`:

```rust
use std::path::{Path, PathBuf};
use std::process::Command;

/// Result of a pip install operation.
pub struct PipResult {
    pub success: bool,
    pub output: String,
}

/// Manages the Python virtual environment lifecycle.
pub struct VenvManager {
    /// Path to the venv directory (e.g., ~/Library/Application Support/wolf-den/venv/)
    venv_dir: PathBuf,
    /// Path to algo_runtime/requirements.base.txt
    base_requirements: PathBuf,
}

impl VenvManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let venv_dir = app_data_dir.join("venv");

        // Find requirements.base.txt using same search strategy as runner.py
        let candidates = [
            PathBuf::from("algo_runtime/requirements.base.txt"),
            PathBuf::from("../algo_runtime/requirements.base.txt"),
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("algo_runtime/requirements.base.txt")))
                .unwrap_or_default(),
        ];
        let base_requirements = candidates
            .iter()
            .find(|c| c.exists())
            .cloned()
            .unwrap_or_else(|| PathBuf::from("algo_runtime/requirements.base.txt"));

        VenvManager {
            venv_dir,
            base_requirements,
        }
    }

    /// Returns the path to the venv's Python binary.
    pub fn python_path(&self) -> PathBuf {
        if cfg!(windows) {
            self.venv_dir.join("Scripts").join("python.exe")
        } else {
            self.venv_dir.join("bin").join("python3")
        }
    }

    /// Returns the path to the venv's pip binary.
    fn pip_path(&self) -> PathBuf {
        if cfg!(windows) {
            self.venv_dir.join("Scripts").join("pip.exe")
        } else {
            self.venv_dir.join("bin").join("pip")
        }
    }

    /// Finds system python3 and validates version >= 3.9.
    /// Returns the path to python3 or an error message.
    pub fn find_system_python() -> Result<PathBuf, String> {
        let output = Command::new("python3")
            .arg("--version")
            .output()
            .map_err(|e| format!(
                "Python 3 not found on your system. Please install Python 3.9 or later.\n\nDetails: {}",
                e
            ))?;

        if !output.status.success() {
            return Err("python3 --version failed. Please ensure Python 3 is installed correctly.".to_string());
        }

        let version_str = String::from_utf8_lossy(&output.stdout);
        // Parse "Python 3.X.Y"
        let version = version_str.trim().strip_prefix("Python ").unwrap_or("");
        let parts: Vec<&str> = version.split('.').collect();
        if parts.len() < 2 {
            return Err(format!("Could not parse Python version from: {}", version_str.trim()));
        }

        let major: u32 = parts[0].parse().unwrap_or(0);
        let minor: u32 = parts[1].parse().unwrap_or(0);

        if major < 3 || (major == 3 && minor < 9) {
            return Err(format!(
                "Python {}.{} found, but Wolf Den requires Python 3.9 or later.\n\nPlease upgrade your Python installation.",
                major, minor
            ));
        }

        Ok(PathBuf::from("python3"))
    }

    /// Returns true if the venv exists and has a valid Python binary.
    pub fn is_venv_healthy(&self) -> bool {
        let python = self.python_path();
        if !python.exists() {
            return false;
        }

        // Check the venv python works and is >= 3.9
        let output = match Command::new(&python).arg("--version").output() {
            Ok(o) => o,
            Err(_) => return false,
        };

        if !output.status.success() {
            return false;
        }

        let version_str = String::from_utf8_lossy(&output.stdout);
        let version = version_str.trim().strip_prefix("Python ").unwrap_or("");
        let parts: Vec<&str> = version.split('.').collect();
        if parts.len() < 2 {
            return false;
        }
        let major: u32 = parts[0].parse().unwrap_or(0);
        let minor: u32 = parts[1].parse().unwrap_or(0);
        major >= 3 && minor >= 9
    }

    /// Creates the venv using system python3.
    pub fn create_venv(&self) -> Result<(), String> {
        let system_python = Self::find_system_python()?;

        // Delete corrupted venv if it exists
        if self.venv_dir.exists() {
            std::fs::remove_dir_all(&self.venv_dir)
                .map_err(|e| format!("Failed to remove old venv: {}", e))?;
        }

        let output = Command::new(&system_python)
            .arg("-m")
            .arg("venv")
            .arg(&self.venv_dir)
            .output()
            .map_err(|e| format!("Failed to create venv: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to create virtual environment:\n{}", stderr));
        }

        Ok(())
    }

    /// Installs base dependencies from requirements.base.txt.
    pub fn install_base_deps(&self) -> PipResult {
        if !self.base_requirements.exists() {
            return PipResult {
                success: false,
                output: format!("requirements.base.txt not found at {:?}", self.base_requirements),
            };
        }

        let output = Command::new(self.pip_path())
            .arg("install")
            .arg("-r")
            .arg(&self.base_requirements)
            .output();

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                let stderr = String::from_utf8_lossy(&o.stderr);
                let combined = format!("{}\n{}", stdout, stderr);
                PipResult {
                    success: o.status.success(),
                    output: combined,
                }
            }
            Err(e) => PipResult {
                success: false,
                output: format!("Failed to run pip: {}", e),
            },
        }
    }

    /// Installs algo-specific dependencies.
    /// `deps` is a newline or space-separated string of pip requirements (e.g., "pandas>=2.0\nscikit-learn").
    pub fn install_algo_deps(&self, deps: &str) -> PipResult {
        let deps = deps.trim();
        if deps.is_empty() {
            return PipResult {
                success: true,
                output: "No dependencies to install.".to_string(),
            };
        }

        // Split deps string into individual requirements
        let dep_list: Vec<&str> = deps
            .lines()
            .flat_map(|line| line.split_whitespace())
            .filter(|s| !s.is_empty())
            .collect();

        if dep_list.is_empty() {
            return PipResult {
                success: true,
                output: "No dependencies to install.".to_string(),
            };
        }

        let output = Command::new(self.pip_path())
            .arg("install")
            .args(&dep_list)
            .output();

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                let stderr = String::from_utf8_lossy(&o.stderr);
                let combined = format!("{}\n{}", stdout, stderr);
                PipResult {
                    success: o.status.success(),
                    output: combined,
                }
            }
            Err(e) => PipResult {
                success: false,
                output: format!("Failed to run pip: {}", e),
            },
        }
    }

    /// Computes a SHA-256 hash of a dependencies string for change detection.
    pub fn hash_deps(deps: &str) -> String {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(deps.trim().as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Full setup: ensure venv exists and base deps are installed.
    /// Returns Ok(output) on success, Err(error) on failure.
    pub fn ensure_setup(&self) -> Result<String, String> {
        if self.is_venv_healthy() {
            // Venv exists and is healthy — just ensure base deps are current
            let result = self.install_base_deps();
            if result.success {
                Ok(result.output)
            } else {
                Err(result.output)
            }
        } else {
            // Need to create venv
            self.create_venv()?;
            let result = self.install_base_deps();
            if result.success {
                Ok(result.output)
            } else {
                Err(result.output)
            }
        }
    }
}
```

- [ ] **Step 2: Register the module in lib.rs**

In `src-tauri/src/lib.rs`, add after the existing `mod` declarations:

```rust
mod venv_manager;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/venv_manager.rs src-tauri/src/lib.rs
git commit -m "feat: add venv_manager module for Python venv lifecycle"
```

---

### Task 3: Add VenvState and Tauri commands for venv setup

**Files:**
- Modify: `src-tauri/src/lib.rs` (add VenvState, manage it)
- Modify: `src-tauri/src/commands.rs` (add venv commands)

- [ ] **Step 1: Add VenvState to lib.rs**

In `src-tauri/src/lib.rs`, add after the `AiTermState` struct definition:

```rust
/// Shared venv manager state for commands to setup/query the Python environment.
pub struct VenvState(pub venv_manager::VenvManager);
```

- [ ] **Step 2: Initialize VenvState in the setup closure**

In `src-tauri/src/lib.rs`, inside the `.setup(|app| { ... })` closure, after the process manager init line (`app.manage(ProcState(...));`), add:

```rust
            // Initialize venv manager
            app.manage(VenvState(venv_manager::VenvManager::new(&data_dir)));
```

- [ ] **Step 3: Add venv commands to commands.rs**

In `src-tauri/src/commands.rs`, add at the end of the file (before the closing):

```rust
// --- Python Venv ---

use crate::VenvState;
use crate::venv_manager;

#[tauri::command]
pub fn check_venv_status(
    venv_state: tauri::State<VenvState>,
) -> Result<serde_json::Value, String> {
    let healthy = venv_state.0.is_venv_healthy();
    Ok(serde_json::json!({
        "healthy": healthy,
        "python_path": venv_state.0.python_path().to_string_lossy(),
    }))
}

#[tauri::command]
pub fn setup_venv(
    venv_state: tauri::State<VenvState>,
) -> Result<String, String> {
    venv_state.0.ensure_setup()
}

#[tauri::command]
pub fn install_algo_deps(
    db_state: tauri::State<DbState>,
    venv_state: tauri::State<VenvState>,
    algo_id: i64,
) -> Result<String, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let algo = db::get_algo_by_id(&conn, algo_id)
        .map_err(|e| format!("Algo not found: {}", e))?;

    let deps = algo.dependencies.trim();
    if deps.is_empty() {
        return Ok("No dependencies to install.".to_string());
    }

    // Check if deps have changed since last install
    let current_hash = venv_manager::VenvManager::hash_deps(deps);
    if current_hash == algo.deps_hash {
        return Ok("Dependencies already up to date.".to_string());
    }

    // Install deps
    let result = venv_state.0.install_algo_deps(deps);
    if result.success {
        // Update deps_hash in DB
        conn.execute(
            "UPDATE algos SET deps_hash = ?1 WHERE id = ?2",
            rusqlite::params![current_hash, algo_id],
        )
        .map_err(|e| format!("Failed to update deps_hash: {}", e))?;
        Ok(result.output)
    } else {
        Err(result.output)
    }
}
```

- [ ] **Step 4: Register the new commands in the invoke handler**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list:

```rust
            commands::check_venv_status,
            commands::setup_venv,
            commands::install_algo_deps,
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat: add Tauri commands for venv setup and dep installation"
```

---

### Task 4: Update ProcessManager to use venv Python

**Files:**
- Modify: `src-tauri/src/process_manager.rs`
- Modify: `src-tauri/src/lib.rs` (pass venv path to ProcessManager)

The process manager currently does `Command::new("python3")`. Change it to use the venv Python binary.

- [ ] **Step 1: Add venv_python field to ProcessManager**

In `src-tauri/src/process_manager.rs`, add a `venv_python` field to the struct:

Replace the struct definition:

```rust
pub struct ProcessManager {
    processes: Mutex<HashMap<String, Child>>,
    algo_dir: PathBuf,
    runner_path: PathBuf,
    venv_python: PathBuf,
}
```

- [ ] **Step 2: Update ProcessManager::new to accept venv_python**

Replace the `new` method:

```rust
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
```

- [ ] **Step 3: Use venv_python in start_instance**

In the `start_instance` method, replace `Command::new("python3")` with `Command::new(&self.venv_python)`:

```rust
        let mut child = Command::new(&self.venv_python)
```

- [ ] **Step 4: Update lib.rs to pass venv python path to ProcessManager**

In `src-tauri/src/lib.rs`, update the ProcessManager initialization. Replace:

```rust
            app.manage(ProcState(process_manager::ProcessManager::new(data_dir.clone())));
```

With:

```rust
            // Initialize venv manager
            let venv_mgr = venv_manager::VenvManager::new(&data_dir);
            let venv_python = venv_mgr.python_path();
            app.manage(VenvState(venv_mgr));

            // Initialize process manager with venv python path
            app.manage(ProcState(process_manager::ProcessManager::new(data_dir.clone(), venv_python)));
```

And remove the separate `app.manage(VenvState(...))` line added in Task 3 (it's now combined above).

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/process_manager.rs src-tauri/src/lib.rs
git commit -m "feat: use venv Python binary for algo process spawning"
```

---

### Task 5: Update start_algo_instance to install per-algo deps before spawning

**Files:**
- Modify: `src-tauri/src/commands.rs`

Before spawning the algo process, check and install per-algo dependencies using the deps_hash change detection.

- [ ] **Step 1: Update start_algo_instance command**

Replace the `start_algo_instance` function in `commands.rs`:

```rust
#[tauri::command]
pub fn start_algo_instance(
    db_state: tauri::State<DbState>,
    proc_state: tauri::State<ProcState>,
    venv_state: tauri::State<VenvState>,
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<(), String> {
    log::info!("start_algo_instance: received request for instance_id={}", instance_id);

    // Install per-algo deps if needed before spawning
    {
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        let instance = db::get_algo_instance_by_id(&conn, &instance_id)
            .map_err(|e| format!("Instance not found: {}", e))?;
        let algo = db::get_algo_by_id(&conn, instance.algo_id)
            .map_err(|e| format!("Algo not found: {}", e))?;

        let deps = algo.dependencies.trim().to_string();
        if !deps.is_empty() {
            let current_hash = venv_manager::VenvManager::hash_deps(&deps);
            if current_hash != algo.deps_hash {
                log::info!("Installing dependencies for algo {} (hash changed)", algo.name);
                let result = venv_state.0.install_algo_deps(&deps);
                if !result.success {
                    return Err(format!("Failed to install dependencies:\n{}", result.output));
                }
                // Update deps_hash
                conn.execute(
                    "UPDATE algos SET deps_hash = ?1 WHERE id = ?2",
                    rusqlite::params![current_hash, instance.algo_id],
                )
                .map_err(|e| format!("Failed to update deps_hash: {}", e))?;
                log::info!("Dependencies installed for algo {}", algo.name);
            }
        }
    }

    let (pid, handles) = proc_state.0.start_instance(&db_state, &instance_id)?;
    log::info!("start_algo_instance: spawned instance_id={} pid={}", instance_id, pid);

    // Monitor stderr in a background thread
    let app = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(handles.stderr);
        let mut last_line = String::new();
        for line in reader.lines() {
            match line {
                Ok(text) if !text.is_empty() => {
                    log::info!("Algo stderr [{}]: {}", handles.instance_id, text);
                    last_line = text;
                }
                Err(_) => break,
                _ => {}
            }
        }
        if !last_line.is_empty() {
            let _ = app.emit("algo-error", serde_json::json!({
                "instance_id": handles.instance_id,
                "algo_id": handles.algo_id,
                "severity": "critical",
                "category": "infrastructure",
                "message": format!("Process exited: {}", last_line),
                "handler": "",
                "traceback": "",
                "timestamp": std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64,
            }));
        }
    });

    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat: install per-algo deps before spawning algo process"
```

---

### Task 6: Create VenvSetupModal frontend component

**Files:**
- Create: `src/components/VenvSetupModal.tsx`

A modal that blocks the UI during first-launch venv setup, shows progress, and has retry on failure.

- [ ] **Step 1: Create VenvSetupModal.tsx**

Create `src/components/VenvSetupModal.tsx`:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type VenvSetupModalProps = {
  onComplete: () => void;
};

export const VenvSetupModal = ({ onComplete }: VenvSetupModalProps) => {
  const [status, setStatus] = useState<"checking" | "installing" | "error" | "done">("checking");
  const [output, setOutput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const runSetup = async () => {
    setStatus("installing");
    setOutput("");
    setErrorMessage("");

    try {
      const result = await invoke<string>("setup_venv");
      setOutput(result);
      setStatus("done");
      onComplete();
    } catch (e) {
      setErrorMessage(String(e));
      setStatus("error");
    }
  };

  // Start setup on first render
  useState(() => {
    runSetup();
  });

  if (status === "done") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-6 max-w-lg w-full mx-4 shadow-xl">
        <h2 className="text-base font-semibold mb-1">Setting Up Python Environment</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Installing required Python packages for algo execution...
        </p>

        {status === "installing" && (
          <div className="flex items-center gap-3 py-4">
            <div className="w-4 h-4 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--text-primary)]">Installing dependencies...</span>
          </div>
        )}

        {status === "error" && (
          <>
            <div className="mb-4">
              <div className="text-xs font-medium text-[var(--accent-red)] mb-2">Setup failed</div>
              <pre className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded-md p-3 overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                {errorMessage}
              </pre>
            </div>
            <div className="flex justify-end">
              <button
                onClick={runSetup}
                className="px-4 py-2 text-xs bg-[var(--accent-blue)] text-white rounded-md hover:opacity-90 transition-opacity font-medium"
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VenvSetupModal.tsx
git commit -m "feat: add VenvSetupModal component for first-launch setup"
```

---

### Task 7: Integrate VenvSetupModal into App.tsx

**Files:**
- Modify: `src/App.tsx`

Show the modal on startup if the venv is not healthy. Block the app until setup completes.

- [ ] **Step 1: Add venv state and import**

In `src/App.tsx`, add the import:

```tsx
import { VenvSetupModal } from "./components/VenvSetupModal";
```

- [ ] **Step 2: Add venvReady state**

Inside the `App` component, after the existing useState declarations, add:

```tsx
  const [venvReady, setVenvReady] = useState<boolean | null>(null);
```

- [ ] **Step 3: Add venv check on startup**

Add a new `useEffect` after the existing startup `useEffect` (the one that calls `loadAlgos()` and `loadRunningInstances()`):

```tsx
  useEffect(() => {
    const checkVenv = async () => {
      try {
        const status = await invoke<{ healthy: boolean }>("check_venv_status");
        if (status.healthy) {
          setVenvReady(true);
        } else {
          setVenvReady(false);
        }
      } catch {
        setVenvReady(false);
      }
    };
    checkVenv();
  }, []);
```

- [ ] **Step 4: Render VenvSetupModal**

In the return JSX, add the modal right before `{confirmDialog !== null && (`. Add:

```tsx
      {venvReady === false && (
        <VenvSetupModal onComplete={() => setVenvReady(true)} />
      )}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build` (or `npm run dev` and check in browser)
Expected: App starts, checks venv, shows modal if needed

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate venv setup modal into app startup"
```

---

### Task 8: Add "installing deps" status to algo instance start flow

**Files:**
- Modify: `src/App.tsx`

When starting an algo, show an "installing" state before it transitions to "running".

- [ ] **Step 1: Update handleStartAlgo in App.tsx**

Replace the `handleStartAlgo` function:

```tsx
  const handleStartAlgo = async (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => {
    console.log("[handleStartAlgo] called:", { id, mode, account, dataSourceId });
    try {
      // Create the instance in the DB first
      const instance = await invoke<{ id: string }>("create_algo_instance", {
        algoId: id,
        dataSourceId: dataSourceId,
        account,
        mode,
      });
      console.log("[handleStartAlgo] instance created:", instance.id);

      // Show "installing" status while deps install + process starts
      setActiveRuns((prev) => [...prev, {
        algo_id: id, status: "installing", mode, account,
        data_source_id: dataSourceId, instance_id: instance.id,
      }]);

      // start_algo_instance now handles dep installation before spawning
      await invoke("start_algo_instance", { instanceId: instance.id });
      console.log("[handleStartAlgo] process started, updating to running");

      // Update status to running
      setActiveRuns((prev) => prev.map((r) =>
        r.instance_id === instance.id ? { ...r, status: "running" } : r
      ));
    } catch (e) {
      console.error("Failed to start algo:", e);
      // Remove the "installing" entry on failure
      setActiveRuns((prev) => prev.filter((r) => !(r.algo_id === id && r.status === "installing")));
      toast.error("Failed to start algo: " + e);
    }
  };
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: show installing status during algo dep installation"
```

---

### Task 9: Display "installing" status in RunningInstanceRow

**Files:**
- Modify: `src/views/AlgosView.tsx`

Show a visual indicator when an instance is in the "installing" state.

- [ ] **Step 1: Update RunningInstanceRow to handle "installing" status**

In `src/views/AlgosView.tsx`, in the `RunningInstanceRow` component, update the mode badge section. Replace the mode badge `<span>`:

```tsx
              {run.status === "installing" ? (
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-md font-medium bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
                  installing deps
                </span>
              ) : (
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded-md font-medium ${
                  run.mode === "live"
                    ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                    : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
                }`}>
                  {run.mode}
                </span>
              )}
```

- [ ] **Step 2: Disable the Stop button during installation**

In the same component, update the Stop button to be disabled during installation:

```tsx
          <button
            onClick={() => onStopAlgo(run.instance_id)}
            disabled={run.status === "installing"}
            className={`px-4 py-2 text-xs rounded-md font-medium transition-opacity ${
              run.status === "installing"
                ? "bg-[var(--bg-secondary)] text-[var(--text-secondary)] cursor-not-allowed"
                : "bg-[var(--accent-red)] text-white hover:opacity-90"
            }`}
          >
            {run.status === "installing" ? "Installing..." : "Stop"}
          </button>
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src/views/AlgosView.tsx
git commit -m "feat: display installing deps status on algo instance cards"
```

---

### Task 10: End-to-end manual test

**Files:** None (testing only)

- [ ] **Step 1: Start the app in dev mode**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify first-launch venv setup**

Expected behavior on first launch:
- Modal appears: "Setting Up Python Environment"
- Spinner shows while pip installs
- Modal disappears when done
- Subsequent launches skip the modal (venv already healthy)

- [ ] **Step 3: Verify algo start with deps**

1. Create an algo in the editor
2. Add `pandas` to its dependencies field (if visible in UI) or verify base deps work
3. Start the algo on a chart
4. Expected: instance card shows "installing deps" briefly, then switches to running
5. Stop the algo

- [ ] **Step 4: Verify error handling**

1. Temporarily break `requirements.base.txt` (add a fake package like `nonexistent-pkg-xyz`)
2. Delete the venv directory from app data
3. Restart app
4. Expected: modal shows error with pip output, Retry button works
5. Restore `requirements.base.txt`

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during venv management testing"
```
