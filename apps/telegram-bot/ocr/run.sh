#!/usr/bin/env bash
# Starts the OCR service.
#
# DYLD_LIBRARY_PATH is not optional on macOS 26: Homebrew's Python links pyexpat
# against a libexpat symbol the system no longer provides, which breaks XML
# parsing and therefore plistlib, platform.mac_ver() and pip. Pointing at
# Homebrew's own expat fixes it. Harmless on other systems.
set -euo pipefail
cd "$(dirname "$0")"

if [ -d /opt/homebrew/opt/expat/lib ]; then
  export DYLD_LIBRARY_PATH="/opt/homebrew/opt/expat/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi

# Models are already on disk after the first run; skip the connectivity check.
export PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

exec .venv/bin/python server.py
