# PhoneApp 轻量埋点方案（v1）—— 看「活跃 + 升级」两大类

> 目标：粗粒度看到**活跃**（DAU/MAU、趋势）和**升级**（版本分布、OTA 漏斗），
> 后台数据落在 **GitHub 私有仓库**，App **零 token**，可 cover 几百用户、零成本。
> 隔离纪律：所有改动限 `PhoneApp/`，不碰主项目（[[phoneapp-isolated-branch]]）。

---

## 0. 已拍板的决策（用户确认）

| 项 | 决定 |
|---|---|
| 中转架构 | **方案 A：Cloudflare Worker 中转 → 写 GitHub 私有仓库**（App 零 token） |
| 去重标识 | **安装级随机 UUID + 设备型号**（如 `Xiaomi 17 Pro`）；零权限、零隐私争议 |
| 第一版采集 | **App 启动**（日活）+ **版本信息**（升级分布）+ **OTA 升级动作** |
| 隐私告知 | **强制同意门**：首次启动弹同意页，**点「同意」才进主页并开启埋点；点「不同意」直接退出 App**（用户原话，严格执行） |
| CF 账号 | `17747005442@163.com's Account`，ID `e72be1bb69bb77532946d19fa6cac23b`——**阶段 2 部署 Worker 时才用，阶段 1 不写入任何 App 代码**（避免账号信息散落进 apk/git） |

**为什么 App 不能直接写 GitHub（硬约束，已与用户讲明）**：GitHub 任何写操作都强制认证，
没有匿名写入口；token 一旦打进 apk = 公开泄露（解包即得，可刷数据/改仓库）。
故必须有一个「藏 token 的中间服务」，CF Worker 是其中最省事免费的。

---

## 1. 整体数据流

```
┌─────────────┐   POST 事件(无token)   ┌──────────────────┐   GitHub API(带token)  ┌────────────────────┐
│  Android App │ ───────────────────▶ │ Cloudflare Worker │ ─────────────────────▶ │ GitHub 私有仓库     │
│ (埋点模块)   │   JSON over HTTPS     │ (藏 token+校验)    │  append NDJSON 按天     │ gold-phone-analytics│
└─────────────┘                       └──────────────────┘                         └────────────────────┘
                                                                                            │
                                                                              你 git pull + 跑聚合脚本
                                                                                            ▼
                                                                            活跃/版本分布/OTA漏斗 报表
```

- App 端**只知道一个 Worker URL**，不知道任何 GitHub token。
- Worker 免费额度 10 万次/天；几百用户 × 每天数条 = 每天几千次，用千分之几。
- 数据最终在你自己的 GitHub 私有仓库，`git pull` 即得原始数据。

---

## 2. 埋点数据格式（一条事件 = 一行 JSON / NDJSON）

每条上报体（App → Worker）：

```jsonc
{
  "event": "app_open",        // app_open | app_version | ota_action
  "did": "u_3f9a…",           // 安装级随机 UUID（首次启动生成，存本地，去重用）
  "model": "Xiaomi 17 Pro",   // 设备型号（@capacitor/device 取，看机型分布）
  "ver": "0.1.12",            // appVersion（NEXT_PUBLIC_APP_VERSION，看升级分布）
  "ts": 1719631200000,        // 客户端时间戳(ms)；服务端会再盖一个 sts 以防客户端时钟乱
  "ext": { "ota": "check" }   // 事件特有字段(可选)，见下
}
```

事件与 `ext`：

| event | 触发时机 | ext 字段 |
|---|---|---|
| `app_open` | 每次 App 启动/恢复到前台（去抖：同一天同 did 只算 1 次活跃由聚合脚本做，上报仍每次发） | 无 |
| `app_version` | 启动时若检测到 `ver` 与上次本地记录不同（即刚升级） | `{ from: "0.1.11", to: "0.1.12" }` |
| `ota_action` | 用户点「检查更新」/ 触发下载 / 装新版 | `{ ota: "check" \| "download" \| "install_launch" }` |

> Worker 落地时**额外补两个服务端字段**（不信任客户端）：`sts`（服务端收到时间）、`ip_cc`（仅国家码，
> 来自 CF 的 `request.cf.country`，**不存原始 IP**）。这样既能去时钟漂移、又零 PII 风险。

落地文件（GitHub 私有仓库 `data/YYYY-MM-DD.ndjson`，每条一行）：

```
{"event":"app_open","did":"u_3f9a","model":"Xiaomi 17 Pro","ver":"0.1.12","ts":1719631200000,"sts":1719631201050,"ip_cc":"CN"}
{"event":"ota_action","did":"u_3f9a","model":"Xiaomi 17 Pro","ver":"0.1.12","ts":...,"sts":...,"ip_cc":"CN","ext":{"ota":"check"}}
```

NDJSON 按天分文件的好处：append 友好、聚合脚本逐行读、单文件不会无限膨胀、人也能直接看。

---

## 3. Cloudflare Worker（藏 token + 校验 + 写 GitHub）

**职责**：① 只收 POST；② 轻校验（event 白名单、did 格式、限大小）；③ 补 sts/ip_cc；
④ 用 GitHub Contents API 把这一行 append 到当天 NDJSON；⑤ 永不把 token 回给客户端。

**为什么 append 用「读当天文件→拼一行→PUT」而非 commit-per-event**：GitHub Contents API 没有原子 append，
要 GET 当天文件拿到 sha + 内容，本地拼上新行，PUT 回去。**并发写同一文件会撞 sha**（race）。
几百用户低频埋点下撞车概率低；为稳妥，Worker 端对 PUT 做 **「sha 冲突自动重试 2~3 次」**。
> 若未来量更大，再升级为「Worker 先写 CF KV 缓冲、定时批量刷一个 commit 到 GitHub」——本版不做，先简单。

**密钥管理**：GitHub token（fine-grained PAT，**只给那一个私有仓库的 Contents: read/write**，别的全 deny）
存为 Worker 的 **Secret**（`wrangler secret put GH_TOKEN` 或面板里设），**不写进 Worker 源码、不进任何 git**。

Worker 代码骨架（`analytics-worker/src/index.ts`，部署到你 CF 账号，**不放进 App 仓库**）：

```ts
// 伪代码骨架——正式实现时补全错误处理/重试
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return new Response("only POST", { status: 405 });
    const body = await req.json().catch(() => null);
    if (!valid(body)) return new Response("bad event", { status: 400 }); // event 白名单 + did 格式 + 体积上限
    const rec = {
      ...pick(body, ["event", "did", "model", "ver", "ts", "ext"]),
      sts: Date.now(),
      ip_cc: req.cf?.country ?? "??",       // 仅国家码，不存原始 IP
    };
    const day = new Date(rec.sts).toISOString().slice(0, 10);   // YYYY-MM-DD
    await appendLineToGitHub(env, `data/${day}.ndjson`, JSON.stringify(rec) + "\n"); // GET sha → PUT，撞 sha 重试
    return new Response("ok", { status: 204, headers: cors() });  // 204 无体；App 不关心返回内容
  },
};
```

> ⚠️ **CORS / WebView**：App 是 Capacitor(Chromium WebView)，跨域 POST 到 Worker 需 Worker 回 `Access-Control-Allow-Origin`。
> 但更稳的是**埋点走内嵌 Node 发**（不是 WebView fetch）——见 §4 传输选择。

---

## 4. App 端埋点模块（新增 `src/lib/analytics.ts`，复用现有基建）

**复用**：`isNativeApp()`（apiBase.ts 已有）、`NEXT_PUBLIC_APP_VERSION`（已注入）、
`@capacitor/device`（取型号，需新装，与已装 Capacitor 8 系兼容）、UUID 存本地。

**传输选择（关键，避免 WebView 坑）**：
- **首选：内嵌 Node 发**（embeddedServer/nodejsEntry 加一个 `track` 通道，Node 的 `https` 直接 POST 到 Worker）。
  绕开 WebView 的 CORS / UA 丢弃（crbug 571722，OTA 那条已踩过）问题，最干净。
- **兑底：WebView `fetch`**（dev / 无 Node 时）；需 Worker 开 CORS。
> 这与现有「IPC 优先 → HTTP 兑底」三态分派同思路（[[phoneapp-android-app]]）。

`analytics.ts` 对外 API（极简）：
```ts
export async function trackAppOpen(): Promise<void>;          // 启动时调一次
export async function trackOta(action: "check"|"download"|"install_launch"): Promise<void>;
// 内部：getOrCreateDeviceId()（localStorage/Filesystem 存 UUID）、getModel()、send(event, ext)
```

**埋点接入点（最小侵入）**：
- `app_open` + `app_version`：主页根组件 `useEffect` 启动时调 `trackAppOpen()`（内部比对本地存的上次 ver，
  变了就顺带发 `app_version{from,to}`）。
- `ota_action`：`ota.ts` 的 `checkForUpdate` / 下载 / 唤起安装三处各调 `trackOta(...)`。

**失败静默 + 不阻塞**：埋点纯 fire-and-forget，`try/catch` 吞掉，**绝不影响主功能**（[[two-dashboards-decoupling]]
的「新增只增不改、不拖累既有」纪律）。无网/Worker 挂了就丢这条，不重试堆积（本版不做离线队列）。

**去重标识生成**：
```
did = "u_" + crypto.randomUUID()   // 首次启动生成；存 Capacitor Preferences/Filesystem；卸载重装会换新（已知取舍）
model = (await Device.getInfo()).model  + 厂商  // 如 "Xiaomi 17 Pro"
```

---

## 5. GitHub 私有仓库 + 聚合脚本

- 新建私有仓库 **`XE-Github/gold-phone-analytics`**（与 app 仓库分开，数据/代码解耦）。
- 目录：`data/YYYY-MM-DD.ndjson`（Worker 写）、`scripts/aggregate.mjs`（你本地跑，我给）。
- 聚合脚本产出（纯本地 Node，读 NDJSON）：
  - **活跃**：按天 distinct `did` = DAU；近 30 天滚动 distinct = MAU；活跃趋势表。
  - **升级分布**：最近一天每个 `ver` 的 distinct `did` 占比（多少人已在 v0.1.12、多少卡旧版）。
  - **OTA 漏斗**：`check` → `download` → `install_launch` 三级人数。
  - **机型分布**：`model` Top N。
- 看数据 = `git pull` 后 `node scripts/aggregate.mjs`，打印表格 / 出个简单 md。
  （**不做实时看板**，符合「简单粗略」诉求；将来想要可视化再加。）

---

## 6. 隐私与诚实边界（必须写明）

- **不采集**：真实 SN/IMEI（拿不到也不碰）、原始 IP（Worker 只留国家码）、任何账号/位置/通讯录。
- **did 是随机 UUID**，非真实身份，卸载重装即重置——**活跃数会比真实设备数偏高**（已知、如实标注）。
- **强制同意门（已定，严格执行用户原话）**：首次启动弹同意页，告知「本应用会上报匿名启动/版本/升级统计用于改进，
  不含任何个人信息（无 SN/IMEI/IP/账号/位置）」。**点「同意」→ 存本地 consent=granted、进主页、开启埋点；
  点「不同意」→ 调 `@capacitor/app` 的 `exitApp()` 退出 App（不同意不能用）**。同意状态存 localStorage，以后不再问。
  - ⚠️ 合规含义：consent gate 让埋点是「用户明示同意后」才采集——比一行被动告知更稳。
  - did/model 等任何上报数据**只在 consent=granted 时才生成/发送**；未同意时连 did 都不建。
- 数据仓库**私有**，只有你能看。

---

## 7. 分阶段落地（建议顺序，每阶段可独立验证）

**阶段 1（先把 App 端埋点逻辑跑通，不依赖 Worker）**
- 新增 `src/lib/analytics.ts`：did 生成/缓存、getModel、事件构造；传输先打到一个**可配置 URL**（默认空=只本地存）。
- 装 `@capacitor/device`；接入 3 个埋点点；/diag 加一小块「本机埋点预览」（看 did/model/ver/已记录事件数）。
- 验证：tsc/lint/build 三连绿 + bundle:node；本地能看到事件被构造（先不真上传）。

**阶段 2（部署 Worker + 私有仓库，打通上传）—— ✅ 已完成（2026-06-29）**
- 私有数据仓库：`XE-Github/gold-phone-analytics`（private，main 分支）。
- Worker：`gold-phone-analytics`，URL `https://gold-phone-analytics.zhenengold.workers.dev`。
  CF 账号 `17747005442@163.com's Account`（ID e72be1bb…，仅 Worker 配置用，不进 App）。
- GitHub fine-grained PAT（只给该仓库 Contents:read+write）已设为 CF Secret `GH_TOKEN`，不进 git。
- Worker 源码在 `D:/Goldpricemonitoring/analytics-worker/`（**App 仓库之外**，不提交进 PhoneApp）。
- App 侧 `ANALYTICS_ENDPOINT` 已填该 URL；tsc/lint/build + bundle:node 四连绿。
- **本地端到端实测（直连真实 CF IP 绕 DNS 污染）**：`POST app_open → HTTP 204`，
  仓库 `data/2026-06-29.ndjson` 真落一行（带服务端补的 `sts`/`ip_cc`），测试数据已清理。
  CORS 预检 `OPTIONS → 204` + 坏 event `→ 400` 均符合设计。

> ⚠️ **`*.workers.dev` 国内 DNS 污染（重要、影响数据解读）**：本机/国内网络对 `workers.dev`
> 普遍 DNS 污染（解析到 Dropbox 段假 IP→超时），CF DoH 查真实 IP 是 CF 段、直连即通——
> 即 **Worker 没问题，是默认域名在国内连不上**。后果：设备只有在能连通 workers.dev 时
> （开 VPN/代理，或所在网络未污染）才上报得出去；连不上则静默超时丢弃（fire-and-forget）。
> **故统计是「能连通设备」的粗粒度活跃/升级，绝对值偏低**，看趋势够用、勿当精确口径。
> 用户已知此取舍，选择「先用 workers.dev + 自己开 VPN」；将来想治本就绑 CF Custom Domain
> （需自有域名 + DNS 托管 CF），只改 `analytics.ts` 一处 endpoint 即可，无需动其它代码。

**阶段 3（聚合脚本 + 发版）—— 待做**
- `scripts/aggregate.mjs` 出活跃/版本/OTA 报表；bump 版本发 v0.1.13；真机确认埋点上报。

---

## 8. 关键文件清单

**App 仓库（`PhoneApp/`）新增/改动**：
- 新增：`src/lib/analytics.ts`（埋点核心）、`docs/analytics-plan.md`（本文件）
- 改动：主页根组件（启动调 trackAppOpen）、`src/lib/ota.ts`（3 处 trackOta）、
  `src/server/embeddedServer.ts` + `nodejsEntry.ts`（加 track 转发通道，内嵌 Node 发请求）、
  `package.json`（加 `@capacitor/device`）、可能 `src/components/DiagPanel.tsx`（本机埋点预览）
- 不动：数据层 quotes/bankGold/history、银行直连、签名/CI（埋点是旁路，绝不拖累主链路）

**App 仓库之外（你的 CF + 另一个 GitHub 私有仓库，不进 App 仓库）**：
- `analytics-worker/`（Worker 源码，部署到 CF；token 在 CF Secret 不进 git）
- `gold-phone-analytics`（私有数据仓库 + 聚合脚本）

---

## 9. 待你确认/提供（进入实施前）

1. CF 账号（免费注册即可）——阶段 2 才需要，阶段 1 不卡。
2. 私有数据仓库名是否就用 `gold-phone-analytics`（默认用这个）。
3. 是否要「首次启动匿名统计告知」那句话，放哪（默认：先不做，或放 /diag 一行）。
4. 是否接受「本版无离线重试队列」（无网就丢该条埋点，最简单）。

> 设计完成。等你点头后，建议**先做阶段 1**（纯 App 端、不依赖任何外部账号，可立刻三连绿验证），
> 再做阶段 2 的 Worker 部署。
