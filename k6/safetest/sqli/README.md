# 登录 SQL 注入验证套件（safetest/sqli）

针对平台**两个登录入口**做 SQL 注入检测，全部为**非破坏性探针 + 基线差分判定**，vus=1、串行、不打并发流量。提供两套互补工具：**① k6 自研签名注入脚本**（快速判定，推荐先跑）、**② sqlmap 签名 eval 钩子**（深挖/交叉验证）。

> 默认目标环境：**3004 SIT**（前台 `arplatsaassit4.club` / 后台 `arsitasdfghjklusa.com`）。
> 用 `-e TENANT_ID=3101` 等切换到其他 SIT/UAT 租户。**仅在授权测试环境运行。**

---

## 一、攻击面

| 入口 | 接口 | 域名(isDesk) | 注入点 | 基线测试账号 |
|---|---|---|---|---|
| 前台会员登录 | `POST /api/Home/Login` | `BASE_DESK_URL`(前台) | `userName` / `password` | `911229893359 / qwer1234` |
| 后台管理登录 | `POST /api/Login/Login` | `BASE_ADMIN_URL`(后台) | `userName` / `pwd` | `carey3004 / qwer1234` |

注入向量固定为 **`userName`**（登录前的用户查询点，最可能拼进 SQL）。账号来自 [config/envconfig.js](../../config/envconfig.js)；前台会员账号也可用 [presetup/exportAccounts.test.js](../../tests/api/presetup/exportAccounts.test.js) 批量导出。

---

## 二、核心难点：签名网关（为什么 sqlmap 不能裸跑）

每个请求体都必须带 `signature`（算法见 [libs/utils/signature.js](../../libs/utils/signature.js)）：

```
signature = MD5( JSON.stringify( 按key排序( 过滤后的payload ) ) + secret ).toUpperCase()
过滤 = 去掉 signature/timestamp/track 和 空/null 字段；登录接口 secret = ''（空）
```

- 签名在**客户端、对包含注入串的字段值**计算 → 注入串被如实签名 → **通过签名校验、抵达后端 SQL**。所以注入本身是可测的，签名不构成防护。
- 但 **sqlmap 裸跑会 100% 假阴性**：它变异 payload 后直接发原始请求，不会重算这个自定义 MD5，请求在「签名校验」层即被拒，根本到不了 SQL。
- 解法：① k6 脚本复用项目签名器，逐 payload 重签（本套件 [lib/signedLogin.js](lib/signedLogin.js)）；② 给 sqlmap 加 `--eval` 钩子，在每次请求前用 Python 复刻签名（本套件 [sqlmap/sign_eval.py](sqlmap/sign_eval.py)）。

---

## 三、工具一：k6 自研脚本（推荐先跑）

```bash
cd k6/safetest

k6 run sqli/login_sqli.test.js                     # 默认 3004 SIT，前台+后台
k6 run -e TARGET=frontend sqli/login_sqli.test.js  # 只测前台
k6 run -e TARGET=backend  sqli/login_sqli.test.js  # 只测后台
k6 run -e TENANT_ID=3101  sqli/login_sqli.test.js  # 切到 3101 UAT
```

**四类手法**（对每个入口先抓「格式正确但口令错误」的基线，再对比 msgCode/HTTP状态/响应长度/耗时）：

| 手法 | payload 示例 | 判定 |
|---|---|---|
| 鉴权绕过/恒真 | `' OR '1'='1'-- `、`admin'-- ` | 返回 `msgCode=0` 或拿到 token → 🔴 严重 |
| 布尔盲注（差分） | TRUE `' OR '1'='1'-- ` vs FALSE `' OR '1'='2'-- ` | 真/假条件响应可区分 → 🟠 高危 |
| 报错型 | `'` `"` `\` `extractvalue(...)` | 泄露 DB 报错串 → 🟠；触发 5xx → 🟡 |
| 时间盲注 | `' OR SLEEP(5)-- `/`WAITFOR DELAY`/`pg_sleep(5)`（多方言，带 0 延迟对照 + 复测）| 可控延迟且对照干净 → 🔴 |

> k6 check「绿」= 该项防御有效；「红」= 发现潜在注入。汇总表在 summary 末尾按 🔴/🟠/🟡/🔵/🟢 排序。

---

## 四、工具二：sqlmap + 签名 eval 钩子（深挖/交叉验证）

先在 [sqlmap/sign_eval.py](sqlmap/sign_eval.py) 顶部把 `ENDPOINT` / `RANDOM` / `LANGUAGE`（及前台的 `LOGIN_TYPE`/`BROWSER_ID`）**改成与 `--data` 完全一致**，然后：

### 前台 /api/Home/Login（sign_eval.py 里 `ENDPOINT="frontend"`）

```bash
cd k6/safetest/sqli/sqlmap

python sqlmap.py \
  -u "https://arplatsaassit4.club/api/Home/Login" \
  --method=POST \
  --headers="Content-Type: application/json
Domainurl: https://arplatsaassit4.club
Referrer: https://arplatsaassit4.club" \
  --data='{"userName":"10012345678","password":"qwer1234","loginType":"Mobile","browserId":"abcdefghijklmnopqrstuvwxyz012345","random":"888888","language":"en","timestamp":"0","signature":"0"}' \
  -p userName \
  --eval="$(cat sign_eval.py)" \
  --skip-urlencode \
  --technique=BET --level=3 --risk=2 --time-sec=5 \
  --threads=1 --delay=1 --batch --flush-session
```

### 后台 /api/Login/Login（sign_eval.py 里改 `ENDPOINT="backend"`）

```bash
python sqlmap.py \
  -u "https://arsitasdfghjklusa.com/api/Login/Login" \
  --method=POST \
  --headers="Content-Type: application/json
Domainurl: https://arsitasdfghjklusa.com
Referrer: https://arsitasdfghjklusa.com" \
  --data='{"userName":"carey3004","pwd":"qwer1234","random":"888888","language":"en","timestamp":"0","signature":"0"}' \
  -p userName \
  --eval="$(cat sign_eval.py)" \
  --skip-urlencode \
  --technique=BET --level=3 --risk=2 --time-sec=5 \
  --threads=1 --delay=1 --batch --flush-session
```

**关键参数说明 / 注意事项：**
- `--eval` 每次请求前重算 `signature`、刷新 `timestamp`（突破签名网关）。
- `--skip-urlencode`：确保「实际发送的值」= 「钩子签名的值」，否则 body 被编码会导致签名不匹配。
- `--technique=BET`（布尔/报错/时间盲注）+ `--risk=2`：**刻意不启用 `S`（堆叠查询）与危险写**，保持非破坏性。
- `--threads=1 --delay=1`：尊重平台限流（msgCode=13）。若仍频繁被限流，加大 `--delay`。
- 自检：`python sign_eval.py` 会打印一条样例签名，可与 k6 侧 `SignedHttpClient.signData` 的结果比对，确认算法复刻无误后再正式跑。
- Windows PowerShell 下 `--eval="$(cat sign_eval.py)"` 换成 `--eval=(Get-Content sign_eval.py -Raw)`，`--headers` 的换行请用实际多行字符串或改用多个 `-H`。

---

## 五、安全与合规

- **仅非破坏性 payload**：只做恒真/布尔/报错/延迟探测，**不含** DROP/DELETE/UPDATE/INSERT/堆叠写。即便注入成立也不改动数据。
  （对比：既有 [aitest API-006](../../tests/aitest/1-api-security/api-security.test.js) 里混入了 `DROP TABLE`/`UPDATE ... SET password='hacked'`，严禁对真实环境使用，建议一并替换。）
- 仅在**授权的 SIT/UAT** 环境运行；账号为配置内测试账号。
- vus=1、串行、带限流退避，不产生压测级流量。
- 时间盲注采用「0 延迟对照 + 复测」双重确认，降低网络抖动导致的误报。

---

## 六、实测结论（待填）

| 入口 | 鉴权绕过 | 布尔盲注 | 报错型 | 时间盲注 | 结论 |
|---|---|---|---|---|---|
| 前台 /api/Home/Login | 🟢 | 🟢 | 🟢 | 🟢 | k6 冒烟(2026-07-13, 3004 SIT)：四类手法均未发现注入迹象。注入串通过签名网关抵达鉴权逻辑后，被统一按无效凭据处理（`msgCode=5001 "Wrong account or password"`），无报错外泄、无可控延迟。31 请求 0 失败、未触发限流。 |
| 后台 /api/Login/Login | | | | | 待跑 |

> 说明：🟢 表示该黑盒手法未测出注入（防御到位的证据，非绝对无漏洞证明）。sqlmap 深挖结果另附。
