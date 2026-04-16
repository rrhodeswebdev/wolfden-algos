# download-python.ps1
# Downloads a standalone Python build for Windows x64 into src-tauri/python/
# Source: https://github.com/indygreg/python-build-standalone
#
# Usage: pwsh scripts/download-python.ps1

$ErrorActionPreference = "Stop"

$PYTHON_VERSION = "3.12.8"
$RELEASE_TAG = "20250106"
$ARCHIVE_NAME = "cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
$DOWNLOAD_URL = "https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_TAG}/${ARCHIVE_NAME}"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_ROOT = Split-Path -Parent $SCRIPT_DIR
$TARGET_DIR = Join-Path $PROJECT_ROOT "src-tauri" "python"

# Clean previous download
if (Test-Path $TARGET_DIR) {
    Write-Host "Removing existing python directory..."
    Remove-Item -Recurse -Force $TARGET_DIR
}

New-Item -ItemType Directory -Force -Path $TARGET_DIR | Out-Null

$ARCHIVE_PATH = Join-Path $TARGET_DIR $ARCHIVE_NAME

Write-Host "Downloading standalone Python ${PYTHON_VERSION}..."
Write-Host "URL: ${DOWNLOAD_URL}"
Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $ARCHIVE_PATH

Write-Host "Extracting..."
tar -xzf $ARCHIVE_PATH -C $TARGET_DIR

# The archive extracts to a "python/" subdirectory — move contents up
$INNER = Join-Path $TARGET_DIR "python"
if (Test-Path $INNER) {
    Get-ChildItem -Path $INNER | Move-Item -Destination $TARGET_DIR -Force
    Remove-Item -Recurse -Force $INNER
}

# Clean up archive
Remove-Item -Force $ARCHIVE_PATH

# Verify
$PYTHON_EXE = Join-Path $TARGET_DIR "python.exe"
if (Test-Path $PYTHON_EXE) {
    $version = & $PYTHON_EXE --version 2>&1
    Write-Host "Success: $version installed at $TARGET_DIR"
} else {
    Write-Error "python.exe not found after extraction!"
    exit 1
}
