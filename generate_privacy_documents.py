"""根据 site/bus/8 模板生成隐私政策和用户服务协议页面。"""

from pathlib import Path
import shutil
import subprocess


# ===== 请在这里修改生成参数 =====
track = "phone_clone"
order = "1"
app_name = "手机文件克隆换机"
compony_name = "南京景珩拓科技有限公司"  # 按需求保留 compony 的拼写

# 目标目录已存在时是否允许覆盖；默认关闭以免误删已有页面。
OVERWRITE = False

# 生成完成后，是否自动提交并推送本次生成的目录到当前 Git 分支。
PUSH_TO_REMOTE = True


PROJECT_ROOT = Path(__file__).resolve().parent
TEMPLATE_DIR = PROJECT_ROOT / "site" / "bus" / "8"
SOURCE_APP_NAME = "公交地铁出行助手"
SOURCE_COMPONY_NAME = "南京星绘视界网络科技有限公司第一分公司"


def validate_path_part(value: str, name: str) -> str:
    """验证 track/order 只能表示单层目录名，避免写入项目目录外。"""
    value = str(value).strip()
    if not value or value in {".", ".."} or Path(value).name != value:
        raise ValueError(f"{name} 必须是非空的单层目录名：{value!r}")
    return value


def replace_text_in_html(file_path: Path) -> None:
    """替换单个 HTML 页面中的应用名和公司名。"""
    content = file_path.read_text(encoding="utf-8")
    content = content.replace(SOURCE_APP_NAME, app_name)
    content = content.replace(SOURCE_COMPONY_NAME, compony_name)
    file_path.write_text(content, encoding="utf-8")


def run_git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """在项目根目录执行 Git 命令。"""
    result = subprocess.run(
        ["git", *args],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
    )
    if check and result.returncode:
        details = result.stderr.strip() or result.stdout.strip() or "未返回详细错误信息。"
        raise RuntimeError(f"Git 命令执行失败：git {' '.join(args)}\n{details}")
    return result


def push_generated_files(output_dir: Path, safe_track: str, safe_order: str) -> None:
    """仅提交输出目录，并推送当前分支，不影响其他未提交的文件。"""
    repo_check = run_git("rev-parse", "--is-inside-work-tree")
    if repo_check.stdout.strip() != "true":
        raise RuntimeError(f"项目目录不是 Git 仓库：{PROJECT_ROOT}")

    # 推送前必须没有既存的本地提交，避免顺带推送本次生成无关的历史提交。
    upstream = run_git(
        "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", check=False
    )
    if upstream.returncode == 0:
        counts = run_git("rev-list", "--left-right", "--count", "@{u}...HEAD")
        _, ahead = map(int, counts.stdout.split())
        if ahead:
            raise RuntimeError("当前分支已有未推送提交；请先手动处理后再运行脚本。")

    relative_output_dir = output_dir.relative_to(PROJECT_ROOT).as_posix()
    run_git("add", "--", relative_output_dir)
    has_staged_change = run_git(
        "diff", "--cached", "--quiet", "--", relative_output_dir, check=False
    ).returncode != 0
    if not has_staged_change:
        print("生成目录没有新的 Git 变更，跳过提交和推送。")
        return

    message = f"{safe_track}_{safe_order}"
    # --only 限定本次提交的路径，保留用户已暂存的其他修改。
    run_git("commit", "--only", "-m", message, "--", relative_output_dir)
    try:
        run_git("push")
    except RuntimeError as error:
        raise RuntimeError(
            f"本地提交“{message}”已创建，但推送失败。\n"
            f"请检查网络或 GitHub 登录状态后，在项目目录执行 git push。\n\n{error}"
        ) from None
    print("已提交并推送到远程仓库。")


def main() -> None:
    safe_track = validate_path_part(track, "track")
    safe_order = validate_path_part(order, "order")

    if not app_name.strip() or not compony_name.strip():
        raise ValueError("app_name 和 compony_name 均不能为空。")
    if not TEMPLATE_DIR.is_dir():
        raise FileNotFoundError(f"找不到基准目录：{TEMPLATE_DIR}")

    output_dir = PROJECT_ROOT / "site" / safe_track / safe_order
    if output_dir.exists():
        if not OVERWRITE:
            raise FileExistsError(
                f"目标目录已存在：{output_dir}\n"
                "如确认需要重新生成，请将 OVERWRITE 改为 True。"
            )
        shutil.rmtree(output_dir)

    shutil.copytree(TEMPLATE_DIR, output_dir)
    for html_file in output_dir.rglob("*.html"):
        replace_text_in_html(html_file)

    print("生成完成：")
    print(f"隐私政策：{output_dir / 'privacy' / 'index.html'}")
    print(f"用户协议：{output_dir / 'user' / 'index.html'}")
    if PUSH_TO_REMOTE:
        try:
            push_generated_files(output_dir, safe_track, safe_order)
        except RuntimeError as error:
            print(f"\nGit 操作失败：\n{error}")
            raise SystemExit(1)


if __name__ == "__main__":
    main()
