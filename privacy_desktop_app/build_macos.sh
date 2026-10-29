#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"

python3 -m pip install -r requirements-gui.txt
python3 -m PyInstaller --noconfirm --clean privacy_gui.spec

echo "构建完成：$PROJECT_DIR/dist/PrivacyDocumentTool.app"
