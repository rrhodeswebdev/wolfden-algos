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
