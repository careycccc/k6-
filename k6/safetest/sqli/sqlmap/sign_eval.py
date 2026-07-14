# -*- coding: utf-8 -*-
# safetest/sqli/sqlmap/sign_eval.py
#
# sqlmap 的 --eval 钩子：对每个被 sqlmap 变异后的请求体，重新计算项目自定义签名，
# 从而突破「签名网关」——否则 sqlmap 的变异请求会因签名不匹配在到达 SQL 前被拒（全假阴性）。
#
# 复刻 libs/utils/signature.js 的算法：
#   1) filter  去掉 signature/timestamp/track，以及值为 空串/None 的字段
#   2) sort    按 key 升序
#   3) json    紧凑 JSON（无空格），等价 JS JSON.stringify
#   4) sign    MD5(json + SECRET).hexdigest().upper()      SECRET 默认空
#
# sqlmap 在 --eval 命名空间内，把每个请求参数暴露为同名变量（如 userName / password / pwd）。
# 本钩子据此读取「当前被注入的值」，重算 signature 并回写；同时刷新 timestamp。
#
# ⚠️ 用法要点（详见同目录 README.md）：
#   - 必须与 --data 保持同一套字段与常量（RANDOM / LANGUAGE / 前台的 loginType、browserId）。
#   - 前台配 ENDPOINT="frontend"，后台配 ENDPOINT="backend"（后台口令字段名是 pwd、无 loginType）。
#   - sqlmap 命令需加 --skip-urlencode，保证「实际发送的值」= 「本钩子签名的值」。
import time
import json
import hashlib

# ============ 按目标端点配置（改这里） ============
ENDPOINT = "frontend"          # "frontend"=/api/Home/Login ；"backend"=/api/Login/Login
SECRET = ""                    # 登录接口为空密钥（与 tenantRequest 一致）
RANDOM = "888888"              # 必须与 --data 中的 random 一致
LANGUAGE = "en"                # 必须与 --data 中的 language 一致
# 前台专用：必须与 --data 中一致
LOGIN_TYPE = "Mobile"
BROWSER_ID = "abcdefghijklmnopqrstuvwxyz012345"  # 32 位；与 --data 中 browserId 一致
# =================================================


def _get(name, default=""):
    """安全读取 sqlmap 暴露的参数变量；独立运行(自检)时回退默认值。"""
    return globals().get(name, default)


# 组装参与签名的业务字段（与后端 filterObject 之后应得到的字段集一致）
if ENDPOINT == "backend":
    _body = {
        "userName": _get("userName"),
        "pwd": _get("pwd", "qwer1234"),
        "random": RANDOM,
        "language": LANGUAGE,
    }
else:  # frontend
    _body = {
        "userName": _get("userName"),
        "password": _get("password", "qwer1234"),
        "loginType": LOGIN_TYPE,
        "browserId": BROWSER_ID,
        "random": RANDOM,
        "language": LANGUAGE,
    }

# 1) filter：剔除排除字段 + 空/None
_excluded = ("signature", "timestamp", "track")
_filtered = {k: v for k, v in _body.items() if v not in ("", None) and k not in _excluded}

# 2) sort + 3) 紧凑 JSON（separators 去空格，等价 JS JSON.stringify；ensure_ascii=False 保留原字符）
_canonical = json.dumps(
    {k: _filtered[k] for k in sorted(_filtered.keys())},
    separators=(",", ":"),
    ensure_ascii=False,
)

# 4) MD5 大写
signature = hashlib.md5((_canonical + SECRET).encode("utf-8")).hexdigest().upper()

# 刷新时间戳（不参与签名，仅需存在且新鲜）
timestamp = str(int(time.time()))


# ---- 独立自检：python sign_eval.py 打印一条样例签名，便于与 k6 侧比对 ----
if __name__ == "__main__":
    print("ENDPOINT   :", ENDPOINT)
    print("canonical  :", _canonical)
    print("signature  :", signature)
    print("timestamp  :", timestamp)
    print("\n提示：把相同字段值喂给 k6 的 SignedHttpClient.signData，应得到相同 signature。")
