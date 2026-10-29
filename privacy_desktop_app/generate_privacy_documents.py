"""根据 site/bus/8 模板生成隐私政策和用户服务协议页面。"""

from pathlib import Path
import shutil


# ===== 请在这里修改生成参数 =====
track = "calculator"
order = "1"
app_name = "万能计算器pro"
compony_name = "南京景珩拓科技有限公司"  # 按需求保留 compony 的拼写

# 目标目录已存在时是否允许覆盖；默认关闭以免误删已有页面。
OVERWRITE = False

# PROJECT_ROOT = Path(__file__).resolve().parent
# TEMPLATE_DIR = PROJECT_ROOT / "site" / "truck_driver" / "1"
# SOURCE_APP_NAME = "货运司机运货"
# SOURCE_COMPONY_NAME = "南京攸星矩科技有限公司"

PROJECT_ROOT = Path(__file__).resolve().parent
TEMPLATE_DIR = PROJECT_ROOT / "site" / "pension_fund" / "2"
SOURCE_APP_NAME = "社保养老云计算"
SOURCE_COMPONY_NAME = "南京星绘视界网络科技有限公司第二分公司"

# 使用到高德sdk的使用下述配置
# TEMPLATE_DIR = PROJECT_ROOT / "site" / "bus" / "8"
# SOURCE_APP_NAME = "公交地铁出行助手"
# SOURCE_COMPONY_NAME = "南京星绘视界网络科技有限公司第一分公司"


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


if __name__ == "__main__":
    main()
