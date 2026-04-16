#!/usr/bin/env bash
# Downloads a standalone Python build for Windows x64 into src-tauri/python/
# Source: https://github.com/indygreg/python-build-standalone
#
# Usage: bash scripts/download-python.sh

set -euo pipefail

PYTHON_VERSION="3.12.8"
RELEASE_TAG="20250106"
ARCHIVE_NAME="cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
DOWNLOAD_URL="https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_TAG}/${ARCHIVE_NAME}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="${PROJECT_ROOT}/src-tauri/python"

# Clean previous download
if [ -d "$TARGET_DIR" ]; then
    echo "Removing existing python directory..."
    rm -rf "$TARGET_DIR"
fi

mkdir -p "$TARGET_DIR"

ARCHIVE_PATH="${TARGET_DIR}/${ARCHIVE_NAME}"

echo "Downloading standalone Python ${PYTHON_VERSION}..."
echo "URL: ${DOWNLOAD_URL}"
curl -L -o "$ARCHIVE_PATH" "$DOWNLOAD_URL"

echo "Extracting..."
tar -xzf "$ARCHIVE_PATH" -C "$TARGET_DIR"

# The archive extracts to a "python/" subdirectory — move contents up
if [ -d "${TARGET_DIR}/python" ]; then
    mv "${TARGET_DIR}/python/"* "$TARGET_DIR/"
    rmdir "${TARGET_DIR}/python"
fi

# Clean up archive
rm -f "$ARCHIVE_PATH"

echo "Done. Standalone Python at: ${TARGET_DIR}/"
echo "Size: $(du -sh "$TARGET_DIR" | cut -f1)"
