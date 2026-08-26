"""检查指定赛道、包序号下的隐私政策和用户协议配置。

运行前（PowerShell）：
    $env:CONFIG_API_TOKEN = "<当前有效的 Bearer token>"
    python .\\check_config_records.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests


# ===== 要检查的赛道与包序号 =====
track = "calculator"
order = "2"
token = "dd7eac3eb8b24115b153b21dd23431b1"


BASE_URL = "https://www.xingkongweilai.cn/prod-api/config-service"
PRODUCTS_URL = f"{BASE_URL}/switch/products"
CONFIG_LIST_URL = f"{BASE_URL}/info/list"
CONFIG_INFO_URL = f"{BASE_URL}/info"
COMMON_POLICY_URL = "https://www.xingkongweilai.cn/commonPolicy.html"
CHANNEL = "dev"
SYSTEM = "android"
REQUIRED_KEYS = {
    "privacy_policy": "隐私政策",
    "user_agreement": "用户协议",
}
HTML_PATHS = {
    "privacy_policy": ("privacy", "index.html"),
    "user_agreement": ("user", "index.html"),
}
PROJECT_ROOT = Path(__file__).resolve().parent
TRACK_MAP_PATH = Path(__file__).with_name("product_track_map.json")


def print_error(message: str) -> int:
    print(f"错误：{message}", file=sys.stderr)
    return 1


def load_product_name() -> str | None:
    """从英文赛道名对照表中取得中文产品名。"""
    print(f"第 1 步：读取赛道对照表，查找英文赛道名“{track}”……")
    try:
        mappings = json.loads(TRACK_MAP_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print_error(f"找不到赛道对照文件：{TRACK_MAP_PATH}")
        return None
    except json.JSONDecodeError as exc:
        print_error(f"赛道对照文件不是有效 JSON：{exc}")
        return None

    for item in mappings:
        if item.get("track") == track:
            product_name = item.get("productName")
            if isinstance(product_name, str) and product_name:
                print(f"  找到对应中文产品名：“{product_name}”。")
                return product_name

    print_error(f"对照表中没有英文赛道名“{track}”。")
    return None


def request_json(
    session: requests.Session,
    method: str,
    url: str,
    **kwargs: Any,
) -> dict[str, Any] | None:
    """发送请求并返回 JSON 对象，网络与响应错误均转换为中文提示。"""
    try:
        response = session.request(method, url, timeout=30, **kwargs)
        response.raise_for_status()
    except requests.RequestException as exc:
        print_error(f"接口请求失败：{exc}")
        return None

    try:
        payload = response.json()
    except ValueError:
        print_error(f"接口未返回 JSON，响应内容：{response.text[:300]}")
        return None

    if not isinstance(payload, dict):
        print_error("接口 JSON 根节点不是对象。")
        return None
    return payload


def load_html_documents() -> dict[str, str] | None:
    """一次性读取两份 HTML，避免上传一份后才发现另一份缺失。"""
    print(f"第 5 步：读取 site/{track}/{order} 下的两份 HTML 文件……")
    documents: dict[str, str] = {}
    for key_name, path_parts in HTML_PATHS.items():
        display_name = REQUIRED_KEYS[key_name]
        html_path = PROJECT_ROOT / "site" / track / order / Path(*path_parts)
        try:
            html = html_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            print_error(f"找不到{display_name}文件：{html_path}")
            return None
        except (OSError, UnicodeError) as exc:
            print_error(f"读取{display_name}文件失败：{html_path}；{exc}")
            return None

        if not html.strip():
            print_error(f"{display_name}文件为空：{html_path}")
            return None
        documents[key_name] = html
        print(f"  已读取{display_name}：{html_path}（{len(html)} 个字符）。")
    return documents


def build_policy_url(product_name: str, key_name: str) -> str:
    """按照 commonPolicy.html 的固定规则拼接协议访问地址。"""
    encoded_product_name = quote(product_name, safe="")
    encoded_order = quote(order, safe="")
    return (
        f"{COMMON_POLICY_URL}"
        f"?keyName={quote(key_name, safe='')}"
        f"&system={quote(SYSTEM, safe='')}"
        f"&channel={quote(CHANNEL, safe='')}"
        f"&productName={encoded_product_name}"
        f"&packageName={encoded_order}"
        f"&type={quote(key_name, safe='')}/{quote(SYSTEM, safe='')}/"
        f"{quote(CHANNEL, safe='')}/{encoded_product_name}/{encoded_order}"
    )


def upsert_document(
    session: requests.Session,
    product_id: int,
    product_name: str,
    key_name: str,
    html: str,
    existing_rows: list[dict[str, Any]],
) -> bool:
    """云端存在时 PUT 更新，不存在时 POST 创建。"""
    display_name = REQUIRED_KEYS[key_name]
    matched_rows = [row for row in existing_rows if row.get("keyName") == key_name]
    existing = matched_rows[0] if matched_rows else None

    if len(matched_rows) > 1:
        print(
            f"  提示：云端发现 {len(matched_rows)} 条{display_name}记录，"
            "将更新查询结果中的第一条。"
        )

    payload: dict[str, Any] = {
        "productId": product_id,
        "productName": product_name,
        "system": SYSTEM,
        "pkg": order,
        "channel": CHANNEL,
        "keyName": key_name,
        "keyValue": html,
        "versionRange": "0",
        "description": display_name,
        "isLocked": 0,
    }

    if existing is not None:
        record_id = existing.get("id")
        if not isinstance(record_id, int):
            print_error(f"云端{display_name}记录缺少有效的 id，无法执行 PUT 更新。")
            return False
        payload["id"] = record_id
        payload["versionRange"] = existing.get("versionRange") or "0"
        payload["description"] = existing.get("description") or display_name
        payload["isLocked"] = existing.get("isLocked", 0)
        method = "PUT"
        action = "更新"
        print(f"  云端已存在{display_name}（id={record_id}），调用 PUT 更新……")
    else:
        method = "POST"
        action = "创建"
        print(f"  云端不存在{display_name}，调用 POST 创建……")

    response = request_json(session, method, CONFIG_INFO_URL, json=payload)
    if response is None:
        return False
    if response.get("code") != 200 or not response.get("success"):
        print_error(f"{display_name}{action}失败：{response.get('message', '未知错误')}")
        return False

    print(f"  {display_name}{action}成功。")
    print(f"  {display_name}访问链接：{build_policy_url(product_name, key_name)}")
    return True


def main() -> int:
    if not token:
        return print_error(
            "未设置 CONFIG_API_TOKEN。请先执行："
            '$env:CONFIG_API_TOKEN = "<当前有效的 Bearer token>"'
        )

    product_name = load_product_name()
    if not product_name:
        return 1

    session = requests.Session()
    session.headers.update(
        {
            "Accept": "application/json, text/plain, */*",
            "Authorization": f"Bearer {token}",
            "Origin": "https://www.xingkongweilai.cn",
            "Referer": "https://www.xingkongweilai.cn/config-service/product/info",
            "User-Agent": "config-record-checker/1.0",
        }
    )

    print("第 2 步：请求全部产品列表，查询产品 ID……")
    products_response = request_json(session, "GET", PRODUCTS_URL)
    if not products_response:
        return 1
    if products_response.get("code") != 200 or not products_response.get("success"):
        return print_error(f"产品列表接口返回失败：{products_response.get('message', '未知错误')}")

    products = products_response.get("data")
    if not isinstance(products, list):
        return print_error("产品列表响应中的 data 不是列表。")

    product = next(
        (
            item
            for item in products
            if isinstance(item, dict) and item.get("label") == product_name
        ),
        None,
    )
    if not product or not isinstance(product.get("id"), int):
        return print_error(f"产品列表中没有中文产品名“{product_name}”。")
    product_id = product["id"]
    print(f"  找到产品：“{product_name}”，productId 为 {product_id}。")

    params = {
        "pageNum": 1,
        "pageSize": 100,
        "productId": product_id,
        "productName": product_name,
        "system": SYSTEM,
        "pkg": order,
    }
    print(
        f"第 3 步：请求配置列表（产品：{product_name}，pkg：{order}，"
        f"系统：{SYSTEM}）……"
    )
    config_response = request_json(session, "GET", CONFIG_LIST_URL, params=params)
    if not config_response:
        return 1

    rows = config_response.get("rows")
    if not isinstance(rows, list):
        return print_error("配置列表响应中的 rows 不是列表。")
    print(f"  接口返回 {len(rows)} 条配置记录。")

    print(f"第 4 步：仅检查 channel 为“{CHANNEL}”的配置……")
    dev_rows = [row for row in rows if isinstance(row, dict) and row.get("channel") == CHANNEL]
    print(f"  其中 channel={CHANNEL} 的记录共有 {len(dev_rows)} 条。")

    existing_keys = {
        row.get("keyName")
        for row in dev_rows
        if isinstance(row.get("keyName"), str)
    }
    all_present = True
    for key_name, display_name in REQUIRED_KEYS.items():
        if key_name in existing_keys:
            print(f"  已存在：{display_name}（keyName={key_name}）。")
        else:
            print(f"  不存在：{display_name}（keyName={key_name}）。")
            all_present = False

    if all_present:
        print("  检查结果：隐私政策和用户协议均已存在。")
    else:
        print("  检查结果：存在缺失的协议配置。")

    documents = load_html_documents()
    if documents is None:
        return 1

    print("第 6 步：根据云端是否存在，更新或创建两份协议配置……")
    upload_results = []
    for key_name in REQUIRED_KEYS:
        upload_results.append(
            upsert_document(
                session=session,
                product_id=product_id,
                product_name=product_name,
                key_name=key_name,
                html=documents[key_name],
                existing_rows=dev_rows,
            )
        )

    if all(upload_results):
        print("全部处理完成：两份本地 HTML 均已同步到云端。")
        return 0

    return print_error("同步未全部成功，请根据上面的输出检查失败项。")


if __name__ == "__main__":
    raise SystemExit(main())
