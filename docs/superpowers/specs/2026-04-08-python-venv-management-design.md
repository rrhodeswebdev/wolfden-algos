# Python Virtual Environment Management

## Problem

Wolf Den spawns Python algos as native `python3` processes. Users can declare pip dependencies per algo (stored in the `algos.dependencies` DB column), but the app does not install them automatically. Users must manually `pip install` everything, there is no isolated environment, and there is no validation that the right Python version or packages are available.

## Design

### Managed Virtual Environment

- The app manages a **single venv** at the platform's app data directory:
  - macOS: `~/Library/Application Support/wolf-den/venv/`
  - Linux: `~/.local/share/wolf-den/venv/`
  - Windows: `%APPDATA%/wolf-den/venv/`
- All algo processes use `<venv>/bin/python3` (or `Scripts/python.exe` on Windows) instead of system `python3`.
- No shell "activation" needed -- Rust calls the venv binary directly.

### Lifecycle

#### First Launch (or missing/corrupted venv)

1. Rust finds system `python3` on PATH.
2. Runs `python3 --version`, parses output, requires >= 3.9. If below, shows an error dialog with instructions.
3. Runs `python3 -m venv <app_data>/venv/`.
4. Runs `<venv>/bin/pip install -r algo_runtime/requirements.base.txt`.
5. A **modal dialog** blocks the UI during this process, showing live pip output.
6. On failure, the modal shows the pip error output and a "Retry" button.

#### Existing Venv Detection

- On launch, if the venv directory exists:
  - Validate the Python binary exists and is >= 3.9.
  - Check installed base deps against `requirements.base.txt` (compare with pip freeze or a stored hash).
  - Install any missing/outdated base deps.
  - If the venv is corrupted (binary missing, wrong Python version), delete and recreate.

#### Per-Algo Dependency Installation (on instance start)

1. Before spawning the algo process, read the algo's `dependencies` field from the DB.
2. Compute a hash of the dependencies string.
3. Compare against `deps_hash` in the DB.
4. If changed (or first run), run `<venv>/bin/pip install <dependencies>`.
5. On success, update `deps_hash` in the DB.
6. On failure, **block the instance start** and surface the pip error to the user.
7. The **algo instance card** shows an "Installing dependencies..." status state during installation.

### Rust Implementation

All venv and pip operations happen in `process_manager.rs` via `Command::new`:

- `Command::new("python3").arg("-m").arg("venv").arg(venv_path)` -- create venv
- `Command::new(venv_pip).arg("install").arg("-r").arg(requirements_path)` -- install base deps
- `Command::new(venv_pip).arg("install").args(algo_deps)` -- install per-algo deps
- `Command::new(venv_python).arg(runner_path).args(...)` -- spawn algo (replaces current `python3`)

Stdout/stderr from pip is captured and forwarded to the frontend via Tauri events.

### Python Version Requirement

- Minimum: Python 3.9 (required by numba >= 0.60, numpy >= 1.26)
- Detection: `python3 --version` from PATH, parse major.minor
- If not found or below 3.9: error dialog with clear instructions

### Error Handling

- **Venv creation fails**: Modal error with raw output, "Retry" button
- **Base dep install fails**: Modal error with pip output, "Retry" button
- **Per-algo dep install fails**: Instance refuses to start, error shown on instance card with pip output
- **No silent failures**: A trading app must not start with missing dependencies

### Frontend Changes

1. **First-launch modal**: Blocks UI during venv setup, shows progress/output, has retry on failure
2. **Algo instance card**: New "Installing dependencies..." status state between "stopped" and "running"
3. **Error display**: Pip error output surfaced in modal (first launch) or instance card (per-algo)

### Database

No schema changes needed. Existing columns used:
- `algos.dependencies` -- pip requirement string per algo
- `algos.deps_hash` -- hash for change detection

### Files Affected

| File | Change |
|---|---|
| `src-tauri/src/process_manager.rs` | Venv creation, pip install, use venv python binary |
| `src-tauri/src/commands.rs` | New commands for venv status, setup trigger |
| `src-tauri/src/db.rs` | Query/update deps_hash |
| Frontend algo instance components | Install status state, error display |
| Frontend app shell | First-launch modal for venv setup |
