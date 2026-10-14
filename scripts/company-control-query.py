"""执行面查询辅助：复用 mcp_server.upstream_client 直查中台上游只读接口。

这是「执行面查询智能体」的最小查询实现，供 scripts/execution-plane-simulator.mjs 调用；
真实执行面可参考同一份 upstream_client 契约自行实现（见 docs/execution-plane-agent-contract.md）。

用法（必须在 mcp-company-control 目录下运行，load_dotenv 才能读到 .env 凭据）:
    python scripts/company-control-query.py <path> <params_json>

输出（stdout，单行 JSON）:
    成功 {"ok": true, "data": <统一信封的 data 字段>}
    失败 {"ok": false, "code": "<错误码>", "message": "..."}
"""
import asyncio
import json
import os
import sys

# Windows 控制台 stdout 默认 GBK；本脚本被 Node execFile 以 UTF-8 读取，必须强制 UTF-8 输出，
# 否则中文会被 GBK 字节 + UTF-8 解码双重错位变成乱码。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# mcp_server 包位于 mcp-company-control 目录；以 cwd 为准加入 sys.path。
sys.path.insert(0, os.getcwd())

from mcp_server.upstream_client import UpstreamError, call as upstream  # noqa: E402


async def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "code": "INVALID_ARGUMENT", "message": "用法: query.py <path> <params_json>"}, ensure_ascii=False))
        return 2
    path = sys.argv[1]
    try:
        params = json.loads(sys.argv[2])
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "code": "INVALID_ARGUMENT", "message": f"params_json 无效: {exc}"}, ensure_ascii=False))
        return 2
    try:
        data = await upstream(path, params)
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
        return 0
    except UpstreamError as exc:
        print(json.dumps({"ok": False, "code": exc.code, "message": exc.message}, ensure_ascii=False))
        return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "code": "INTERNAL_ERROR", "message": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
