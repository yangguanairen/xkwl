"""隐私文档生成与云端同步桌面工具。"""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import traceback
from typing import Any, Callable

import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

import generate_privacy_documents
import keyring
import update_server_documents


APP_TITLE = "隐私文档工具"
TOKEN_SERVICE = "PrivacyDocumentTool"
TOKEN_ACCOUNT = "config-api-token"
TRACK_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
TEMPLATE_OPTIONS = {
    "普通模板": {
        "path": ("site", "pension_fund", "2"),
        "source_app_name": "社保养老云计算",
        "source_company_name": "南京星绘视界网络科技有限公司第二分公司",
    },
    "高德模板": {
        "path": ("site", "bus", "8"),
        "source_app_name": "公交地铁出行助手",
        "source_company_name": "南京星绘视界网络科技有限公司第一分公司",
    },
}


def resource_root() -> Path:
    """返回源码目录或 PyInstaller 解包后的资源目录。"""
    bundled_root = getattr(sys, "_MEIPASS", None)
    if bundled_root:
        return Path(bundled_root)
    return Path(__file__).resolve().parent


def default_workspace() -> Path:
    """源码运行时使用项目目录；打包运行时使用用户文档目录。"""
    source_root = Path(__file__).resolve().parent
    if not getattr(sys, "frozen", False) and (source_root / "site").is_dir():
        return source_root
    documents = Path.home() / "Documents"
    return documents / APP_TITLE


def load_cached_token() -> str:
    """从 Windows 凭据管理器或 macOS 钥匙串读取 Token。"""
    try:
        return keyring.get_password(TOKEN_SERVICE, TOKEN_ACCOUNT) or ""
    except Exception:
        return ""


def save_cached_token(token: str) -> None:
    """将 Token 保存到操作系统的安全凭据库。"""
    try:
        keyring.set_password(TOKEN_SERVICE, TOKEN_ACCOUNT, token)
    except Exception as exc:
        raise RuntimeError(f"无法保存 API Token：{exc}") from exc


def delete_cached_token() -> None:
    """删除操作系统安全凭据库中的 Token。"""
    try:
        if keyring.get_password(TOKEN_SERVICE, TOKEN_ACCOUNT) is not None:
            keyring.delete_password(TOKEN_SERVICE, TOKEN_ACCOUNT)
    except Exception as exc:
        raise RuntimeError(f"无法清除 API Token 缓存：{exc}") from exc


def load_track_map(path: Path) -> list[dict[str, str]]:
    """读取赛道映射，并忽略格式不完整的记录。"""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    result: list[dict[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        track = item.get("track")
        product_name = item.get("productName")
        if isinstance(track, str) and isinstance(product_name, str):
            result.append({"track": track, "productName": product_name})
    return result


def validate_track_identifier(value: str) -> str:
    """校验作为唯一键使用的英文赛道名。"""
    value = str(value).strip()
    if not TRACK_PATTERN.fullmatch(value):
        raise ValueError(
            "英文赛道标识只能包含小写英文字母、数字和下划线，且必须以字母开头。"
        )
    return value


def validate_unique_tracks(mappings: list[dict[str, str]]) -> None:
    """确保映射表中的英文赛道名不重复（忽略大小写）。"""
    seen: set[str] = set()
    for item in mappings:
        normalized = item["track"].casefold()
        if normalized in seen:
            raise ValueError(f"赛道映射中存在重复英文名：{item['track']}")
        seen.add(normalized)


def add_track_mapping(
    mapping_path: Path,
    fallback_path: Path,
    track: str,
    product_name: str,
) -> None:
    """在工作目录的映射文件中添加一个新赛道。"""
    track = validate_track_identifier(track)
    product_name = str(product_name).strip()
    if not product_name:
        raise ValueError("中文产品名不能为空。")
    source_path = mapping_path if mapping_path.is_file() else fallback_path
    mappings = load_track_map(source_path)
    if not mappings:
        raise ValueError(f"无法从以下文件读取赛道映射：{source_path}")
    validate_unique_tracks(mappings)
    if any(item["track"].casefold() == track.casefold() for item in mappings):
        raise ValueError(f"赛道“{track}”已经存在。")

    mappings.append({"track": track, "productName": product_name})
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = mapping_path.with_suffix(mapping_path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(mappings, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(mapping_path)


def exit_code_from_system_exit(exc: SystemExit) -> int:
    if exc.code is None:
        return 0
    return exc.code if isinstance(exc.code, int) else 1


class QueueWriter:
    """把后台线程的 print 输出转交给 Tk 主线程。"""

    def __init__(self, events: queue.Queue[tuple[Any, ...]]) -> None:
        self.events = events

    def write(self, text: str) -> int:
        if text:
            self.events.put(("log", text))
        return len(text)

    def flush(self) -> None:
        return None


class PrivacyApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.events: queue.Queue[tuple[Any, ...]] = queue.Queue()
        self.running = False
        self.last_output_dir: Path | None = None

        root.title(APP_TITLE)
        root.geometry("900x720")
        root.minsize(760, 640)
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        self._configure_style()
        self._create_variables()
        self._build_ui()
        self._load_track_choices()
        self.root.after(100, self._poll_events)

    def _configure_style(self) -> None:
        style = ttk.Style(self.root)
        available = style.theme_names()
        if "vista" in available:
            style.theme_use("vista")
        elif "aqua" not in available and "clam" in available:
            style.theme_use("clam")
        style.configure("Title.TLabel", font=("TkDefaultFont", 18, "bold"))
        style.configure("Hint.TLabel", foreground="#5f6368")
        style.configure("Primary.TButton", padding=(18, 9))
        style.configure("Secondary.TButton", padding=(12, 7))

    def _create_variables(self) -> None:
        self.workspace_var = tk.StringVar(value=str(default_workspace()))
        self.template_var = tk.StringVar(value="普通模板")
        self.track_var = tk.StringVar(value="test")
        self.order_var = tk.StringVar(value="1")
        self.app_name_var = tk.StringVar(value="倒计时免费Days")
        self.company_name_var = tk.StringVar(value="合肥玄极科技有限公司")
        self.overwrite_var = tk.BooleanVar(value=False)
        cached_token = load_cached_token()
        self.token_var = tk.StringVar(
            value=cached_token or os.environ.get("CONFIG_API_TOKEN", "")
        )
        self.remember_token_var = tk.BooleanVar(value=True)
        self.show_token_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value="就绪")

    def _build_ui(self) -> None:
        container = ttk.Frame(self.root, padding=22)
        container.pack(fill="both", expand=True)
        container.columnconfigure(0, weight=1)
        container.rowconfigure(3, weight=1)

        ttk.Label(container, text=APP_TITLE, style="Title.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(
            container,
            text="生成隐私政策和用户协议，并按需同步到云端（不执行任何 Git 操作）",
            style="Hint.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(4, 16))

        form = ttk.LabelFrame(container, text="运行配置", padding=16)
        form.grid(row=2, column=0, sticky="ew")
        form.columnconfigure(1, weight=1)

        row = 0
        ttk.Label(form, text="工作目录").grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        workspace_entry = ttk.Entry(form, textvariable=self.workspace_var)
        workspace_entry.grid(row=row, column=1, sticky="ew", pady=6)
        ttk.Button(form, text="选择…", command=self._browse_workspace).grid(
            row=row, column=2, padx=(8, 0), pady=6
        )

        row += 1
        ttk.Label(form, text="模板类型").grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        ttk.Combobox(
            form,
            textvariable=self.template_var,
            values=list(TEMPLATE_OPTIONS),
            state="readonly",
        ).grid(row=row, column=1, columnspan=2, sticky="ew", pady=6)

        row += 1
        ttk.Label(form, text="赛道 track").grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        self.track_combo = ttk.Combobox(form, textvariable=self.track_var)
        self.track_combo.grid(row=row, column=1, sticky="ew", pady=6)
        ttk.Button(form, text="新增赛道…", command=self._add_track).grid(
            row=row, column=2, padx=(8, 0), pady=6
        )

        row += 1
        ttk.Label(form, text="包序号 order").grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        ttk.Entry(form, textvariable=self.order_var).grid(
            row=row, column=1, columnspan=2, sticky="ew", pady=6
        )

        row += 1
        ttk.Label(form, text="应用名称").grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        ttk.Entry(form, textvariable=self.app_name_var).grid(
            row=row, column=1, columnspan=2, sticky="ew", pady=6
        )

        row += 1
        ttk.Label(form, text="公司名称").grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        ttk.Entry(form, textvariable=self.company_name_var).grid(
            row=row, column=1, columnspan=2, sticky="ew", pady=6
        )

        row += 1
        ttk.Label(form, text="API Token").grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        self.token_entry = ttk.Entry(form, textvariable=self.token_var, show="●")
        self.token_entry.grid(row=row, column=1, sticky="ew", pady=6)
        ttk.Checkbutton(
            form,
            text="显示",
            variable=self.show_token_var,
            command=self._toggle_token,
        ).grid(row=row, column=2, padx=(8, 0), pady=6)

        row += 1
        ttk.Checkbutton(
            form,
            text="记住 API Token（安全保存在系统凭据库）",
            variable=self.remember_token_var,
        ).grid(row=row, column=1, sticky="w", pady=(3, 2))
        ttk.Button(form, text="清除缓存", command=self._clear_token_cache).grid(
            row=row, column=2, padx=(8, 0), pady=(3, 2)
        )

        row += 1
        ttk.Checkbutton(
            form,
            text="覆盖已存在的目标目录",
            variable=self.overwrite_var,
        ).grid(row=row, column=1, columnspan=2, sticky="w", pady=(7, 2))

        log_frame = ttk.LabelFrame(container, text="运行日志", padding=10)
        log_frame.grid(row=3, column=0, sticky="nsew", pady=(16, 12))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log_text = tk.Text(
            log_frame,
            height=12,
            wrap="word",
            state="disabled",
            font=("TkFixedFont", 10),
            relief="flat",
        )
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.grid(row=0, column=0, sticky="nsew")
        scrollbar.grid(row=0, column=1, sticky="ns")

        footer = ttk.Frame(container)
        footer.grid(row=4, column=0, sticky="ew")
        footer.columnconfigure(0, weight=1)
        ttk.Label(footer, textvariable=self.status_var, style="Hint.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        self.open_button = ttk.Button(
            footer,
            text="打开输出目录",
            command=self._open_output_dir,
            state="disabled",
            style="Secondary.TButton",
        )
        self.open_button.grid(row=0, column=1, padx=(8, 0))
        self.sync_button = ttk.Button(
            footer,
            text="仅同步",
            command=lambda: self._start("sync"),
            style="Secondary.TButton",
        )
        self.sync_button.grid(row=0, column=2, padx=(8, 0))
        self.generate_button = ttk.Button(
            footer,
            text="仅生成",
            command=lambda: self._start("generate"),
            style="Secondary.TButton",
        )
        self.generate_button.grid(row=0, column=3, padx=(8, 0))
        self.run_button = ttk.Button(
            footer,
            text="生成并同步",
            command=lambda: self._start("all"),
            style="Primary.TButton",
        )
        self.run_button.grid(row=0, column=4, padx=(8, 0))
        self.action_buttons = [self.sync_button, self.generate_button, self.run_button]

    def _load_track_choices(self, selected_track: str | None = None) -> None:
        workspace_text = self.workspace_var.get().strip()
        local_mapping = (
            Path(workspace_text).expanduser() / "product_track_map.json"
            if workspace_text
            else None
        )
        mapping_path = (
            local_mapping
            if local_mapping is not None and local_mapping.is_file()
            else resource_root() / "product_track_map.json"
        )
        mappings = load_track_map(mapping_path)
        self.track_combo["values"] = [item["track"] for item in mappings]
        if selected_track:
            self.track_var.set(selected_track)

    def _browse_workspace(self) -> None:
        selected = filedialog.askdirectory(
            title="选择工作目录",
            initialdir=self.workspace_var.get() or str(Path.home()),
        )
        if selected:
            self.workspace_var.set(selected)
            self._load_track_choices()

    def _add_track(self) -> None:
        track = simpledialog.askstring(
            "新增赛道",
            "请输入英文赛道标识（例如 memo）：",
            parent=self.root,
        )
        if track is None:
            return
        track = track.strip()
        try:
            validate_track_identifier(track)
        except ValueError as exc:
            messagebox.showerror(APP_TITLE, str(exc), parent=self.root)
            return

        product_name = simpledialog.askstring(
            "新增赛道",
            "请输入对应的中文产品名：",
            parent=self.root,
        )
        if product_name is None:
            return
        product_name = product_name.strip()
        if not product_name:
            messagebox.showerror(APP_TITLE, "中文产品名不能为空。", parent=self.root)
            return

        workspace_text = self.workspace_var.get().strip()
        if not workspace_text:
            messagebox.showerror(APP_TITLE, "请先选择工作目录。", parent=self.root)
            return
        try:
            workspace = Path(workspace_text).expanduser().resolve()
            if workspace.exists() and not workspace.is_dir():
                raise ValueError("工作目录指向了一个文件。")
            mapping_path = workspace / "product_track_map.json"
            add_track_mapping(
                mapping_path=mapping_path,
                fallback_path=resource_root() / "product_track_map.json",
                track=track,
                product_name=product_name,
            )
        except (OSError, ValueError) as exc:
            messagebox.showerror(APP_TITLE, str(exc), parent=self.root)
            return

        self._load_track_choices(selected_track=track)
        messagebox.showinfo(
            APP_TITLE,
            f"已添加赛道：{track}（{product_name}）\n\n映射文件：{mapping_path}",
            parent=self.root,
        )

    def _toggle_token(self) -> None:
        self.token_entry.configure(show="" if self.show_token_var.get() else "●")

    def _clear_token_cache(self) -> None:
        try:
            delete_cached_token()
        except RuntimeError as exc:
            messagebox.showerror(APP_TITLE, str(exc), parent=self.root)
            return
        self.token_var.set("")
        self.remember_token_var.set(False)
        messagebox.showinfo(APP_TITLE, "API Token 缓存已清除。", parent=self.root)

    def _append_log(self, text: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _clear_log(self) -> None:
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def _validate(self, mode: str) -> dict[str, Any] | None:
        workspace_text = self.workspace_var.get().strip()
        template_name = self.template_var.get().strip()
        track = self.track_var.get().strip()
        order = self.order_var.get().strip()
        app_name = self.app_name_var.get().strip()
        company_name = self.company_name_var.get().strip()
        token = self.token_var.get().strip()

        try:
            if not workspace_text:
                raise ValueError("请选择工作目录。")
            workspace = Path(workspace_text).expanduser().resolve()
            if workspace.exists() and not workspace.is_dir():
                raise ValueError("工作目录指向了一个文件。")
            if template_name not in TEMPLATE_OPTIONS:
                raise ValueError("请选择有效的模板类型。")
            track = validate_track_identifier(track)
            generate_privacy_documents.validate_path_part(order, "order")
            local_mapping = workspace / "product_track_map.json"
            mapping_path = (
                local_mapping
                if local_mapping.is_file()
                else resource_root() / "product_track_map.json"
            )
            mappings = load_track_map(mapping_path)
            validate_unique_tracks(mappings)
            if mode in {"sync", "all"} and not any(
                item["track"].casefold() == track.casefold() for item in mappings
            ):
                raise ValueError(
                    f"赛道“{track}”尚未添加到映射表，请先点击“新增赛道…”。"
                )
            if mode in {"generate", "all"} and (not app_name or not company_name):
                raise ValueError("应用名称和公司名称不能为空。")
            if mode in {"sync", "all"} and not token:
                raise ValueError("同步云端时必须填写 API Token。")
        except (OSError, ValueError) as exc:
            messagebox.showerror(APP_TITLE, str(exc), parent=self.root)
            return None

        overwrite = self.overwrite_var.get()
        output_dir = workspace / "site" / track / order
        if mode in {"generate", "all"} and output_dir.exists() and overwrite:
            confirmed = messagebox.askyesno(
                APP_TITLE,
                f"将删除并重新生成已有目录：\n{output_dir}\n\n确定继续吗？",
                parent=self.root,
            )
            if not confirmed:
                return None

        return {
            "workspace": workspace,
            "template_name": template_name,
            "track": track,
            "order": order,
            "app_name": app_name,
            "company_name": company_name,
            "overwrite": overwrite,
            "token": token,
            "output_dir": output_dir,
        }

    def _start(self, mode: str) -> None:
        if self.running:
            return
        config = self._validate(mode)
        if config is None:
            return
        try:
            if self.remember_token_var.get() and config["token"]:
                save_cached_token(config["token"])
            elif not self.remember_token_var.get():
                delete_cached_token()
        except RuntimeError as exc:
            messagebox.showwarning(
                APP_TITLE,
                f"任务仍会继续，但 Token 缓存操作失败：\n{exc}",
                parent=self.root,
            )
        self.running = True
        self._clear_log()
        self.status_var.set("正在执行…")
        for button in self.action_buttons:
            button.configure(state="disabled")
        self.open_button.configure(state="disabled")
        thread = threading.Thread(
            target=self._worker,
            args=(mode, config),
            daemon=True,
            name="privacy-workflow",
        )
        thread.start()

    def _configure_modules(self, config: dict[str, Any]) -> None:
        workspace: Path = config["workspace"]
        assets = resource_root()
        template = TEMPLATE_OPTIONS[config["template_name"]]
        template_parts = template["path"]
        local_template = workspace.joinpath(*template_parts)
        bundled_template = assets.joinpath(*template_parts)
        template_dir = local_template if local_template.is_dir() else bundled_template

        if not template_dir.is_dir():
            raise FileNotFoundError(f"找不到文档模板目录：{template_dir}")
        if config["output_dir"].resolve() == template_dir.resolve():
            raise ValueError(f"目标目录不能与所选的{config['template_name']}目录相同。")

        generate_privacy_documents.PROJECT_ROOT = workspace
        generate_privacy_documents.TEMPLATE_DIR = template_dir
        generate_privacy_documents.SOURCE_APP_NAME = template["source_app_name"]
        generate_privacy_documents.SOURCE_COMPONY_NAME = template["source_company_name"]
        generate_privacy_documents.track = config["track"]
        generate_privacy_documents.order = config["order"]
        generate_privacy_documents.app_name = config["app_name"]
        generate_privacy_documents.compony_name = config["company_name"]
        generate_privacy_documents.OVERWRITE = config["overwrite"]

        local_mapping = workspace / "product_track_map.json"
        bundled_mapping = assets / "product_track_map.json"
        update_server_documents.PROJECT_ROOT = workspace
        update_server_documents.TRACK_MAP_PATH = (
            local_mapping if local_mapping.is_file() else bundled_mapping
        )
        update_server_documents.track = config["track"]
        update_server_documents.order = config["order"]
        update_server_documents.token = config["token"]

    @staticmethod
    def _run_step(label: str, function: Callable[[], Any]) -> None:
        try:
            result = function()
        except SystemExit as exc:
            code = exit_code_from_system_exit(exc)
            if code:
                raise RuntimeError(f"{label}失败，退出码：{code}") from None
            return
        if isinstance(result, int) and result != 0:
            raise RuntimeError(f"{label}失败，退出码：{result}")

    def _worker(self, mode: str, config: dict[str, Any]) -> None:
        writer = QueueWriter(self.events)
        success = False
        error_message = ""
        try:
            with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
                config["workspace"].mkdir(parents=True, exist_ok=True)
                self._configure_modules(config)
                print(f"工作目录：{config['workspace']}")
                print(
                    f"运行配置：模板={config['template_name']}，track={config['track']}，"
                    f"order={config['order']}，"
                    f"应用名={config['app_name']}，公司名={config['company_name']}"
                )
                if mode in {"generate", "all"}:
                    print("\n========== 阶段 1：生成隐私政策和用户协议 ==========")
                    self._run_step("文档生成", generate_privacy_documents.main)
                if mode in {"sync", "all"}:
                    print("\n========== 阶段 2：同步云端配置 ==========")
                    self._run_step("云端同步", update_server_documents.main)
                print("\n操作执行成功。")
                success = True
        except Exception as exc:
            error_message = str(exc) or exc.__class__.__name__
            writer.write(f"\n执行失败：{error_message}\n")
            if not isinstance(exc, (FileExistsError, FileNotFoundError, ValueError, RuntimeError)):
                writer.write(traceback.format_exc())
        finally:
            self.events.put(("done", success, error_message, config["output_dir"]))

    def _poll_events(self) -> None:
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log":
                    self._append_log(event[1])
                elif event[0] == "done":
                    _, success, error_message, output_dir = event
                    self.running = False
                    for button in self.action_buttons:
                        button.configure(state="normal")
                    self.last_output_dir = output_dir if output_dir.exists() else None
                    if self.last_output_dir:
                        self.open_button.configure(state="normal")
                    self.status_var.set("执行成功" if success else "执行失败")
                    if success:
                        messagebox.showinfo(APP_TITLE, "操作执行成功。", parent=self.root)
                    else:
                        messagebox.showerror(
                            APP_TITLE,
                            f"操作执行失败：\n{error_message}\n\n请查看运行日志。",
                            parent=self.root,
                        )
        except queue.Empty:
            pass
        self.root.after(100, self._poll_events)

    def _open_output_dir(self) -> None:
        if not self.last_output_dir or not self.last_output_dir.exists():
            messagebox.showwarning(APP_TITLE, "输出目录尚不存在。", parent=self.root)
            return
        try:
            if sys.platform == "win32":
                os.startfile(self.last_output_dir)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(self.last_output_dir)])
            else:
                subprocess.Popen(["xdg-open", str(self.last_output_dir)])
        except OSError as exc:
            messagebox.showerror(APP_TITLE, f"无法打开目录：{exc}", parent=self.root)

    def _on_close(self) -> None:
        if self.running and not messagebox.askyesno(
            APP_TITLE,
            "任务仍在运行。关闭窗口会中断本次操作，确定退出吗？",
            parent=self.root,
        ):
            return
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    PrivacyApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
