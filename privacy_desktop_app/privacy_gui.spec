# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_submodules


project_root = Path(SPECPATH)
data_files = [
    (str(project_root / "product_track_map.json"), "."),
    (str(project_root / "site" / "pension_fund" / "2"), "site/pension_fund/2"),
    (str(project_root / "site" / "bus" / "8"), "site/bus/8"),
]

a = Analysis(
    [str(project_root / "privacy_gui.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=data_files,
    hiddenimports=collect_submodules("keyring.backends"),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="PrivacyDocumentTool",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

if sys.platform == "darwin":
    app = BUNDLE(
        exe,
        name="PrivacyDocumentTool.app",
        icon=None,
        bundle_identifier="cn.xingkongweilai.privacy-document-tool",
    )
