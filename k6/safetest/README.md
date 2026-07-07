# 文件上传安全验证套件（safetest）

针对**一对一客服聊天的未登录图片上传**，验证 5 类常见文件上传安全风险。全部为**良性探针 + 上传后自动回取(fetch-back)验证**，不做任何真实破坏，vus=1、单次、不打并发流量。

> 目标环境：**3004 SIT**（`arplatsaassit4.club`）。所有域名均为 sit/uat 测试环境。
> 用 `-e TENANT_ID=3101` 可切换其他租户。

---

## 一、攻击面与真实契约（经诊断确认）

用户在一对一客服聊天里"未登录"上传，实际流程是：

1. **游客注册**：`POST {DESK}/api/Home/AutoLogin`（`guestRegister`，无需真实账号）→ 拿到 **guest token**。这就是"未登录"——聊天控件在登录前静默把访客注册成游客。
2. **前台上传**：`POST {DESK}/api/WorkOrder/UploadToOss`
   - 头：`Authorization: Bearer <guest token>`
   - **multipart 字段名为 `file`（单数！）** + `fileType` + `customPath`
   - 成功：`{ code:0, data:{ fileName, aliasFileName, imagePath, imageDomain } }`
     完整 URL = `imageDomain + imagePath`；**存储名 `aliasFileName` 由服务端生成**
   - 非图片：`{ code:1, msgCode:20, msg:"Please upload a properly formatted image" }`
   - 限流：`{ msgCode:13, "Too frequent..." }` → 需退避重试
3. **客服点开**：客服在后台看到附件链接并点开 → 浏览器访问上面的 URL。本套件用 `fetchBack()` 模拟这一步，检查服务端回吐文件时的 `Content-Type / Content-Disposition / X-Content-Type-Options / 响应体`，据此判断客服浏览器是否会"危险地"渲染/执行它。

**后端校验模型（正向对照实测）**：同时校验 **图片扩展名白名单** + **真实图片内容**（MIME 被忽略）。即：
- 真实 PNG 命名 `.png` → ✅
- 真实 PNG 命名 `.txt` → ❌（扩展名不过）
- 文本内容命名 `.png` → ❌（内容不过，msgCode=20）

**存储**：独立域 `sit.arsaassit-pub.club`（Cloudflare 前置，**非同源**于前后台），服务端生成文件名，路径固定前缀 `<tenant>/User/WorkOrder-Frontend/`。前台上传**不重编码**（原样存 PNG）；后台 `UploadFile/UploadToOss` 会转 webp。

---

## 二、目录结构

```
safetest/
├── README.md                  本文档
├── 0_positive_control.js      正向对照/校验模型诊断（证明"被拒绝"是真防护，非脚本 bug）
├── 1_rce_webshell.test.js     案例1：RCE / Webshell
├── 2_stored_xss.test.js       案例2：存储型 XSS
├── 3_dos.test.js              案例3：拒绝服务 DoS（图像解压炸弹）
├── 4_path_traversal.test.js   案例4：路径遍历
├── 5_config_hijack.test.js    案例5：服务端配置劫持 (web.config)
├── 6_pdf_upload.test.js       案例6：PDF 专项（校验模型/XSS/DoS/SSRF/遍历，5 个子判定）
├── run_all.test.js            一键跑 RCE/XSS/遍历/配置/PDF 并汇总（DoS 单独跑）
├── lib/
│   ├── env.js                 环境解析 + 存储域(origin)判定
│   ├── guest.js               游客 token（未登录）
│   ├── uploadProbe.js         上传 + 回取验证核心（含限流重试）
│   ├── payloads.js            polyglot 构造工具
│   └── report.js              统一风险判定与打印
└── payloads/
    ├── generate_payloads.py       生成解压炸弹 PNG（图片 DoS 用）
    ├── pixelflood.png / _big.png  50000×50000 / 65500×65500 解压炸弹图，各仅 68 字节
    ├── generate_pdf_payloads.py   生成 PDF payload
    ├── clean.pdf                  干净基线 PDF
    ├── js.pdf                     内嵌 OpenAction JavaScript（仅弹标记）
    ├── uri.pdf                    打开触发 URI 动作（SSRF/钓鱼探针）
    └── bomb.pdf                   PDF 解压炸弹（82KB → 解压约 80MB）
```

---

## 三、运行

```bash
cd k6/safetest

# 先看正向对照（确认能正常上传、存储域、返回头）
k6 run 0_positive_control.js

# 一键跑 RCE / XSS / 路径遍历 / 配置劫持 / PDF 并汇总
k6 run run_all.test.js

# DoS 单独跑（图片解压炸弹探针）
k6 run 3_dos.test.js

# PDF 专项单独跑（5 个子判定）
k6 run 6_pdf_upload.test.js

# PDF 文件名XSS 端到端确认：真正提交成一条工单（会创建工单！带 K6ST_PDF_XSS_POC 标记便于删除）
# 提交后请到后台"一对一客服"工单列表点开该工单，看是否弹出 alert 以确认 XSS，确认后删除
k6 run -e SUBMIT=1 6_pdf_upload.test.js
# 若工单表单字段 ID 不同可覆盖：-e FORM_ID=200280 -e WO_TYPE_ID=2 -e TEXT_FIELD_ID=200426 -e FILE_FIELD_ID=200611

# 单跑某一项
k6 run 1_rce_webshell.test.js

# 换环境 / 换游客包名
k6 run -e TENANT_ID=3101 run_all.test.js
k6 run -e PACKAGE_NAME=com.arXXXX.fb.app run_all.test.js
```

> 若要重新生成 payload：`python payloads/generate_payloads.py`（图片炸弹）、`python payloads/generate_pdf_payloads.py`（PDF）
> 后端限流较敏感（msgCode=13），脚本已内置退避重试；跑套件耗时约 1–2 分钟属正常。
> k6 check "通过" = 防御有效（无中危及以上）；check 变红 = 发现潜在风险。

---

## 四、五个案例的原理与判定

| 案例 | payload（良性探针） | 判定依据 |
|---|---|---|
| **RCE/Webshell** | 合法PNG 命名 `.aspx/.php`、PNG+ASPX polyglot、纯ASPX对照。ASPX 仅计算 `13337*13337=177875569` | 回取响应出现 `177875569`→已执行(🔴)；存储保留可执行扩展名→🟠；被拒/存储名服务端生成→🟢 |
| **Stored XSS** | SVG 内嵌脚本、PNG+HTML polyglot(`.html`)、合法PNG 命名 `.html`、纯HTML对照 | 回取为可执行 CT(svg/html) + 内联 + 脚本保留→🔴/🟠；仅缺 nosniff→🟡；以 image/* 返回或被拒→🟢 |
| **DoS** | 图像解压炸弹 50000×50000 / 65500×65500（仅 68 字节） | 上传 5xx/超时/长耗时→🟠；秒级接受但无尺寸校验→🟡；被拒→🟢 |
| **Path Traversal** | 合法PNG 内容 + `customPath`/`fileType`/文件名注入 `../ ..\ 绝对路径` | 返回 `imagePath` 含遍历序列/跳出固定前缀→🔴；customPath 可控子目录→🟡；归一化/忽略→🟢 |
| **Config Hijack** | 纯 web.config 文本、合法PNG 命名 `web.config`、PNG+web.config polyglot；web.config 仅注入响应头 `X-K6ST-Confighijack` | 上传后同源资源出现注入头→🔴；被接受存储→🟠；被拒→🟢 |

> ⚠ XSS/RCE 的"客服点开即触发"最终建议**人工在后台点开一次**确认；本套件从服务端侧证明其触发的**必要条件**是否成立（是自动化能覆盖的部分）。

### 案例 6：PDF 专项（`6_pdf_upload.test.js`）

前台上传除图片外**还接受 PDF**（`code=0`，保留 `.pdf` 扩展名），且提交工单时 `fieldValue = "<imagePath>?<原始文件名>"` —— **原始文件名被带进工单显示给客服**。PDF 攻击面远大于图片，故单列一案，输出 5 个子判定：

| 子案 | payload | 判定依据 |
|---|---|---|
| PDF-校验模型/RCE | PDF内容命名 `.aspx`/`.pdf.aspx`、非PDF文本命名 `.pdf` | 危险扩展名被存/执行→🔴/🟠；非PDF内容被当PDF存(只认扩展名)→🔵；均拒→🟢 |
| **PDF-存储型XSS** | **文件名含 XSS 载荷**(空格/无空格/`<script>`)、内嵌JS的PDF、PDF+HTML polyglot | 恶意文件名被原样回显→🟡(文件名XSS必要条件)；polyglot以 html 内联执行→🟠/🔴 |
| PDF-DoS | PDF 解压炸弹(82KB→80MB) | 上传崩溃/超时→🟠；被接受未解压(下游解压爆)→🟡；拒→🟢 |
| PDF-SSRF/XXE | 打开触发 URI 动作的 PDF | 外链动作未清洗即存储→🔵(客户端钓鱼；服务端 SSRF/XXE 需 OOB 确认) |
| PDF-路径遍历 | 合法PDF + customPath/fileType/文件名注入 | 同案例4 |

> 文件名 XSS 是 PDF 最突出的入口：服务端仅把**空格→下划线**，用**无空格载荷**(`<svg/onload=…>`、`<script>…</script>`)即可让完整载荷一字不改地存进工单。

---

## 五、本次在 3004 SIT 的实测结论（2026-07-06 / PDF 2026-07-07）

| 案例 | 判定 | 结论 |
|---|---|---|
| RCE/Webshell | 🟢 通过 | `.aspx/.php`、polyglot、纯 ASPX 全部被 `msgCode=20` 拒绝（扩展名白名单 + 真实图片校验双重拦截） |
| Stored XSS | 🟢 通过 | SVG/HTML/polyglot 全被拒；合法图片以 `image/png` 从**独立 OSS 域**返回，脚本无法在客服浏览器执行 |
| Path Traversal | 🟢 通过 | `../`、`..\`、绝对路径、`fileType`/`customPath` 注入全部被归一化/忽略；固定前缀 + 服务端生成随机名 |
| Config Hijack | 🟢 通过 | web.config 各变体被拒，未落地未生效 |
| 图片 DoS | 🟡 **中危** | **上传层对图片声明尺寸零校验**：50000×50000 的炸弹（68 字节）被照单全收并存储。客服点开时其浏览器需为解码分配 ~10GB 内存 → 客服端标签页卡死/崩溃（客户端 DoS） |

**PDF 专项（2026-07-07）：**

| 子案 | 判定 | 结论 |
|---|---|---|
| **PDF-存储型XSS** | 🟡 中危 / 🟠 **高危(SUBMIT=1)** | **文件名型 XSS**：恶意文件名被服务端**原样回显**并随工单 `fieldValue` 的 `?<name>` 展示给客服。服务端仅把空格→下划线，用无空格载荷（`<svg/onload=…>`、`<script>…</script>`）即**一字不改保留**。<br>**已用 `-e SUBMIT=1` 端到端验证**：签名算法(剔除 formFields，经真实样本比对)复刻成功，恶意文件名已提交进一条真实工单(`code=0`)。**充分条件仅剩客服在后台点开该工单肉眼确认弹窗**——建议人工复核一次并删除该测试工单 |
| **PDF-DoS** | 🟡 **中危** | PDF 解压炸弹（82KB→80MB）被接受存储，上传端未解压；客服点开/预览解压时膨胀，客户端卡顿或服务端 OOM |
| PDF-校验模型 | 🔵 低危 | `.pdf` 通道**只校验扩展名、不校验内容**（非PDF文本可存为 `.pdf`）；但 `.aspx/.pdf.aspx` 被扩展名白名单拦下，`.pdf` 本身不可执行，直接 RCE 风险低 |
| PDF-SSRF/XXE | 🔵 低危 | PDF 打开动作/外链未被清洗即存储，客服查看器可能自动外连（钓鱼）；服务端 SSRF/XXE 需带外(OOB)确认 |
| PDF-路径遍历 | 🟢 通过 | 同图片，服务端生成名 + 固定前缀 |

**总体**：图片通道防御扎实（真实图片校验 + 扩展名白名单 + 服务端生成文件名 + 独立 OSS 域），RCE/XSS/遍历/配置劫持四项无法得手；**需关注**：① **PDF 文件名型 XSS（最高优先级，已端到端提交进真实工单验证，🟠 高危）** ② 图片 DoS（无尺寸上限）③ PDF DoS。PDF 通道明显比图片弱（不校验内容、内联返回、文件名回显未过滤）。

### 加固建议
**DoS（图片 + PDF）**
1. 上传入口只读文件头即校验图片声明尺寸并设上限（如 ≤ 4096×4096 / ≤ 2500 万像素）；对 PDF 限制流解压后大小/对象数/页数。
2. 客服端渲染改用受限的**缩略图/预览服务**（带内存/超时/像素上限），不直接加载用户原文件。

**PDF 文件名型 XSS（重点）**
3. 工单/客服端展示文件名处**必须 HTML 转义**；上传即对原始文件名做严格白名单（去除 `<>"'&/` 等）。
4. 提交 `fieldValue` **不回传用户原始文件名**，改用服务端生成的 `aliasFileName`。

**PDF 其他**
5. 对 `.pdf` 也校验文件头（`%PDF`），与图片一致做内容校验。
6. 用户文件统一以 `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` 返回，PDF 不内联；服务端解析 PDF 时禁用外部实体/网络访问（XXE/SSRF 防护）。

---

## 六、安全与合规说明

- 全部 payload 为**良性探针**：webshell 只回显算式、XSS 信标指向不可解析域 `example.invalid`（无真实外泄）、DoS 只投递单个"声明尺寸大但体积小"的头部文件（不打流量、不投递完整炸弹）、web.config 只注入一个无害响应头。
- 仅在授权的 **SIT/UAT 测试环境**运行；账号为游客注册（临时）与配置内的测试管理员。
- 上传会在对象存储留下少量测试文件（文件名带 `k6st_` / `k6ok_` 前缀），可按需清理。
