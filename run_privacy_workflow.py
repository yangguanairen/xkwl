"""依次生成隐私文档，并将隐私政策和用户协议同步到云端。"""

from __future__ import annotations

import os
import sys

import update_server_documents
import generate_privacy_documents


# ===== 统一配置：日常运行只需要修改这里 =====
track = "calculator"
order = "2"
app_name = "万能计算器免费版"
company_name = "南京沐星智科技有限公司"

# 已存在目标目录时是否覆盖，以及生成后是否提交并推送 Git。
overwrite = False
push_to_remote = True

# 推荐通过环境变量提供，避免令牌被提交到 Git。
api_token = "dd7eac3eb8b24115b153b21dd23431b1"


def exit_code_from_system_exit(exc: SystemExit) -> int:
    """将子脚本的 SystemExit 转换为统一的整数退出码。"""
    if exc.code is None:
        return 0
    if isinstance(exc.code, int):
        return exc.code
    print(f"错误：{exc.code}", file=sys.stderr)
    return 1


def configure_scripts() -> None:
    """把统一配置注入两个原有脚本。"""
    generate_privacy_documents.track = track
    generate_privacy_documents.order = order
    generate_privacy_documents.app_name = app_name
    generate_privacy_documents.compony_name = company_name
    generate_privacy_documents.OVERWRITE = overwrite
    generate_privacy_documents.PUSH_TO_REMOTE = push_to_remote

    update_server_documents.track = track
    update_server_documents.order = order
    update_server_documents.token = api_token


def run_generate_step() -> int:
    print("\n========== 阶段 1：生成隐私政策和用户协议 ==========")
    try:
        generate_privacy_documents.main()
    except SystemExit as exc:
        return exit_code_from_system_exit(exc)
    except Exception as exc:
        print(f"文档生成失败：{exc}", file=sys.stderr)
        return 1
    return 0


def run_sync_step() -> int:
    print("\n========== 阶段 2：检查并同步云端配置 ==========")
    try:
        result = update_server_documents.main()
    except SystemExit as exc:
        return exit_code_from_system_exit(exc)
    except Exception as exc:
        print(f"云端同步失败：{exc}", file=sys.stderr)
        return 1
    return result if isinstance(result, int) else 0


def main() -> int:
    print("开始执行隐私文档完整流程。")
    print(f"统一配置：track={track}，order={order}，应用名={app_name}，公司名={company_name}")
    configure_scripts()

    generate_result = run_generate_step()
    if generate_result != 0:
        print("流程已停止：文档生成阶段未成功，不继续同步云端。", file=sys.stderr)
        return generate_result

    sync_result = run_sync_step()
    if sync_result != 0:
        print("流程结束：云端同步阶段未成功。", file=sys.stderr)
        return sync_result

    print("\n完整流程执行成功。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
