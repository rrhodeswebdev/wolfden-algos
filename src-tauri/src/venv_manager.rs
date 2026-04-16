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
    /// Optional path to the app's resource directory (for finding embedded Python)
    resource_dir: Option<PathBuf>,
}

impl VenvManager {
    pub fn new(app_data_dir: &Path, resource_dir: Option<PathBuf>) -> Self {
        let venv_dir = app_data_dir.join("venv");

        // Build the search list for requirements.base.txt. Order matters:
        // installed-app locations (resource_dir) come first because in production
        // the CWD-relative paths will silently miss and we need the bundled copy.
        //
        // The bundle config in tauri.conf.json declares "../algo_runtime/**/*"
        // as resources. Because that path begins with "..", Tauri v2 mangles the
        // upward traversal into an "_up_" segment under the resource directory,
        // so the file lands at <resource_dir>/_up_/algo_runtime/requirements.base.txt.
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(res_dir) = resource_dir.as_ref() {
            candidates.push(res_dir.join("_up_").join("algo_runtime").join("requirements.base.txt"));
            // Defensive fallback in case Tauri ever changes the mangling rule.
            candidates.push(res_dir.join("algo_runtime").join("requirements.base.txt"));
        }
        // Dev-mode fallbacks (running `cargo tauri dev` from the repo).
        candidates.push(PathBuf::from("algo_runtime/requirements.base.txt"));
        candidates.push(PathBuf::from("../algo_runtime/requirements.base.txt"));
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("algo_runtime/requirements.base.txt"));
            }
        }

        let base_requirements = match candidates.iter().find(|c| c.exists()) {
            Some(found) => {
                log::info!("Found requirements.base.txt at {:?}", found);
                found.clone()
            }
            None => {
                log::error!(
                    "requirements.base.txt not found. Searched: {:?}",
                    candidates
                );
                // Keep the first candidate so the later error message points at
                // the most-likely-correct path (the installed-app location when
                // resource_dir is available).
                candidates
                    .into_iter()
                    .next()
                    .unwrap_or_else(|| PathBuf::from("algo_runtime/requirements.base.txt"))
            }
        };

        VenvManager {
            venv_dir,
            base_requirements,
            resource_dir,
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

    /// Looks for an embedded standalone Python bundled in the app's resources.
    /// Returns the path to the embedded python executable if found and valid.
    fn find_embedded_python(resource_dir: &Option<PathBuf>) -> Option<PathBuf> {
        let res_dir = resource_dir.as_ref()?;

        let python_exe = if cfg!(windows) {
            res_dir.join("python").join("python.exe")
        } else {
            res_dir.join("python").join("bin").join("python3")
        };

        if !python_exe.exists() {
            log::debug!("Embedded Python not found at {:?}", python_exe);
            return None;
        }

        // Validate it works
        match Command::new(&python_exe).arg("--version").output() {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout);
                log::info!("Found embedded Python: {}", version.trim());
                Some(python_exe)
            }
            _ => {
                log::warn!("Embedded Python at {:?} exists but failed to run", python_exe);
                None
            }
        }
    }

    /// Finds the best available Python: embedded first, then system.
    /// Returns the path to python or an error message.
    pub fn find_python(resource_dir: &Option<PathBuf>) -> Result<PathBuf, String> {
        // Try embedded Python first
        if let Some(embedded) = Self::find_embedded_python(resource_dir) {
            return Ok(embedded);
        }

        // Fall back to system Python
        Self::find_system_python()
    }

    /// Finds system python3 and validates version >= 3.9.
    /// Returns the path to python3 or an error message.
    pub fn find_system_python() -> Result<PathBuf, String> {
        // On Windows, try "python" first (more common), then "python3"
        let candidates: &[&str] = if cfg!(windows) {
            &["python", "python3"]
        } else {
            &["python3", "python"]
        };

        for cmd in candidates {
            if let Ok(output) = Command::new(cmd).arg("--version").output() {
                if !output.status.success() {
                    continue;
                }

                let version_str = String::from_utf8_lossy(&output.stdout);
                let version = version_str.trim().strip_prefix("Python ").unwrap_or("");
                let parts: Vec<&str> = version.split('.').collect();
                if parts.len() < 2 {
                    continue;
                }

                let major: u32 = parts[0].parse().unwrap_or(0);
                let minor: u32 = parts[1].parse().unwrap_or(0);

                if major >= 3 && minor >= 9 {
                    return Ok(PathBuf::from(cmd));
                }
            }
        }

        Err(
            "Python 3.9+ not found. Wolf Den includes an embedded Python for Windows builds, \
             but it was not found. Please install Python 3.9 or later."
                .to_string(),
        )
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

    /// Creates the venv using the best available Python (embedded or system).
    pub fn create_venv(&self) -> Result<(), String> {
        let system_python = Self::find_python(&self.resource_dir)?;

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

        // Split deps string into individual requirements, rejecting any tokens
        // that look like pip flags to prevent flag injection attacks.
        let mut dep_list: Vec<&str> = Vec::new();
        for token in deps.lines().flat_map(|line| line.split_whitespace()).filter(|s| !s.is_empty()) {
            if token.starts_with('-') {
                log::warn!("Rejecting suspicious dependency token (looks like a flag): {:?}", token);
                continue;
            }
            // Basic validation: must start with a letter or digit (valid package specifier)
            if let Some(first) = token.chars().next() {
                if !first.is_alphanumeric() {
                    log::warn!("Rejecting invalid dependency token: {:?}", token);
                    continue;
                }
            }
            dep_list.push(token);
        }

        if dep_list.is_empty() {
            return PipResult {
                success: true,
                output: "No valid dependencies to install (all tokens were rejected).".to_string(),
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
        use sha2::{Digest, Sha256};
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
