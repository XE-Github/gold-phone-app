# 黄金看板·手机版（PhoneApp）

面向中国黄金小白的黄金看板，作为主项目的一个**隔离分支**独立存在。

形态：**纯安卓 App**（Capacitor 套壳 + 内嵌 Node 承载数据层，数据全在 App 内闭环，
彻底脱离 Termux）。GitHub 仅用于**云端打包 + 发布 apk**，不托管任何运行时。
也保留 Web 形态（`BUILD_TARGET=web`）供浏览器/开发调试。

> ⚠️ **隔离契约**：本目录 `PhoneApp/` 与主项目（`D:\Goldpricemonitoring\src` 等）**完全解耦**——
> 自带 `package.json`、自带 `node_modules`、自带数据抓取、独立端口（3100）、独立仓库
> （`XE-Github/gold-phone-app`）。**不 import 主项目任何代码，不修改主项目任何文件**。
> 数据源「思路」参考自主项目（同样的真实上游接口），但代码为本目录独立实现。

## App 架构（目标形态）

```text
安卓 apk（Capacitor 套壳）
├─ WebView：Next.js 前端静态导出（out/，打进 apk 本地加载）
│   ├─ 行情/积存金/趋势 → 统一传输层 src/lib/apiBase.ts
│   │     三态分派：IPC（内嵌 Node 插件，优先）→ HTTP localhost:3100 兑底 → 同源 fetch(dev)
│   ├─ 通知 → 原生 @capacitor/local-notifications（绕开浏览器 denied 死结）
│   └─ 检查更新 → 拉 GitHub Releases → 下载 apk → 自定义原生 ApkInstaller 唤起系统安装器
└─ 内嵌 Node（@choreruiz/capacitor-node-js, Node 18.20.4 arm64-v8a）
    └─ 现有数据层闭包（sina/icbc/ccb/bankGold/streamManager…），IPC + 极简 HTTP 兑底
```

- 内嵌 Node 插件**正确包名**：`@choreruiz/capacitor-node-js`（曾误写的
  `@capacitor-community/nodejs-mobile` 在 npm 不存在）。官方通信是 **bridge channel（JSON IPC）**，非 HTTP。
- 本机**无安卓工具链**，apk 必须 **CI 构建**（`.github/workflows/android.yml`）。CI 的
  setup-node 须 **Node ≥22**（Capacitor 8 CLI 硬要求）。

---

## 功能（本期）

1. **实时金价 + 价格提醒**
   - 人民币理论金价（XAU/USD × USD/CNY ÷ 31.1035，**理论换算价、非成交价**）为主视觉。
   - 伦敦金、美元汇率、Au99.99 / Au(T+D) / 沪金主力快捷指标。
   - 价格提醒：本地 `localStorage` 存规则，触达阈值时顶部 toast + 可选系统通知 + Web Audio 提示音；
     同规则满足只响一次，价格离开阈值才复位。
   - **通知双实现**：App 内走**系统原生通知**（`@capacitor/local-notifications`，权限弹窗由系统弹出，
     绕开浏览器「站点通知一旦 denied 永不再弹」的死结）；Web 形态走 Service Worker。
2. **银行积存金对比**
   - 8 家银行（工/建/中/招/兴业/浙商/民生/广发）积存金买入价/卖出价/点差对比。
   - 可按「买入价低→高」或「点差小→大」排序，真实数据优先置顶。
   - 来源徽章：●官网直连 / ●京东平台 / ●第三方聚合 / ●估算（**估算项明确标注，绝不冒充真实**）。
3. **应用内 OTA 升级**
   - 「检查更新」拉 `GitHub Releases latest`，按语义版本比对当前版本（源自 `package.json`）。
   - 有新版：App 内下载 apk（`@capacitor/filesystem`）→ 自定义原生 `ApkInstaller` 唤起系统安装器。
   - 非原生环境（浏览器/dev）降级为跳转 Release 页手动下载。

## 数据源（独立抓取，内嵌 Node 提供）

> App 形态下原 `/api/*` 路由已删（静态导出与服务端路由不可共存），逻辑迁入**内嵌 Node**
> （`src/server/embeddedServer.ts` 的 `buildQuotes/buildBankGold/buildHistory`，IPC + HTTP 兑底共用）。
> 前端只经 `src/lib/apiBase.ts` 的 `requestRoute()`/`subscribeStream()` 取数，与传输方式无关。

| 路由 | 数据 | 上游 |
|---|---|---|
| `/api/quotes` | 行情快照（伦敦金/汇率/SGE 现货/沪金 + 计算的人民币理论价、金银比） | 新浪财经 `hq.sinajs.cn`（GB18030 解码 + finance.sina.com.cn Referer 必填）+ Gold-API 备用 |
| `/api/bank-gold` | 8 家银行积存金报价 | 工行/建行官网直连（`node:https` + 老旧 TLS legacy renegotiation）、汇喵 huimiao、京东金融平台；缺数据则基于基准价+已知点差**估算兜底** |
| `/api/history` | 历史趋势（国际/国内双视图） | 同上 + Frankfurter 历史汇率 |

### 字段陷阱（已在代码注释中标明）

- 新浪 `gds_`（SGE 现货）需 `fields.length>=14`；`idx2/idx3` 身份有争议**不当 bid/ask**；涨跌基准用 `idx7`。
- 新浪 `nf_`（沪金主力）涨跌按**昨结算价 idx10**算，不是昨收；时间 `idx1` 是 `HHMMSS`。
- 工行/建行官网为**老旧 TLS**，必须 `node:https` + `SSL_OP_LEGACY_SERVER_CONNECT`（全局 fetch 会失败）。
- huimiao 字段名**反直觉**：`purchase_value`=你买入价，`sale_value`=你卖出价。
- 京东只给**单边价**（卖出），买入价用全点差**估算**（卖出边真实、买入边估算，但 source 仍标京东）。
- 工行官网不暴露赎回价 → **不设 bid**（避免伪造 0 点差）。
- 真实/估算只靠 `source` 子串判定：含「官网」「汇喵」「京东积存金」= 真实。

## 运行 / 构建

```bash
cd PhoneApp
npm install

# —— Web/开发调试 ——
npm run dev          # 前端 http://localhost:3100（webpack，禁用 Turbopack）
npm run dev:node     # 另起内嵌 Node 数据服务（esbuild 即跑 embeddedServer，监听 3100）
npm run lint
npx tsc --noEmit

# —— App 构建链路（本机仅到 cap sync；apk 由 CI 出）——
npm run bundle:node  # esbuild 把 nodejsEntry + src/lib 打成 public/nodejs-project/main.js
npm run build        # 静态导出到 out/（默认 output:"export"；BUILD_TARGET=web 回退普通 Next）
npx cap sync android # out/ + 内嵌 Node 同步进 android/ 工程
npm run cap:sync     # = 上面三步串起来
```

> **apk 构建**：本机无安卓工具链，推送到 `main` 触发 `.github/workflows/android.yml` 云端打
> debug apk（artifact `gold-phone-debug-apk`）；打 tag `v*` 额外发布到 GitHub Releases（供 OTA 拉取）。
> **发版**：改 `package.json` version（单一版本源，自动同步前端与 Android versionName）→ 打 tag `v<版本>` → push。

## 目录结构

```text
PhoneApp/
├─ package.json            # 独立依赖 + version（单一版本源）；dev 端口 3100
├─ capacitor.config.ts     # Capacitor 配置（appId/webDir=out/内嵌 Node 插件）
├─ next.config.ts          # 静态导出开关 + 注入 NEXT_PUBLIC_APP_VERSION
├─ tsconfig.json postcss.config.mjs eslint.config.mjs .gitignore
├─ scripts/
│  ├─ bundle-node.mjs      # esbuild 打包内嵌 Node 入口 → public/nodejs-project/main.js
│  └─ dev-node.mjs         # 开发期即跑 embeddedServer（监听 3100）
├─ .github/workflows/android.yml   # CI 云端打 apk + 打 tag 发 Release
├─ android/                # Capacitor 生成的原生工程（入库）
│  └─ app/src/main/java/com/xegithub/goldphone/
│     ├─ MainActivity.java         # 注册自定义插件
│     └─ ApkInstallerPlugin.java   # 阶段4：FileProvider + ACTION_VIEW 唤起 apk 安装器
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx        # 移动端 viewport / 主题色 / PWA meta
│  │  ├─ page.tsx          # 主页面：行情流 + 提醒 + 卡片 + 检查更新
│  │  └─ globals.css       # 深色金融风 + 涨跌闪动 + reduced-motion
│  ├─ server/
│  │  ├─ embeddedServer.ts # buildQuotes/BankGold/History + node:http 兑底服务
│  │  └─ nodejsEntry.ts    # 内嵌 Node 的 IPC 入口（require bridge）
│  ├─ components/
│  │  ├─ HeroPrice.tsx TrendChart.tsx BankGoldCompare.tsx
│  │  ├─ PriceAlertCard.tsx      # 提醒规则增删/启停（原生/Web 文案分流）
│  │  ├─ AlertToast.tsx          # 触发提示（createPortal 到 body）
│  │  └─ UpdateCard.tsx          # 阶段4：检查更新 + 下载安装
│  └─ lib/
│     ├─ types.ts               # Quote 等类型（与主项目互不引用）
│     ├─ apiBase.ts             # 统一传输层（IPC 优先→HTTP 兑底→同源 fetch）
│     ├─ sina.ts goldApi.ts computed.ts quotes.ts   # 行情抓取 + 编排
│     ├─ icbcDirect.ts ccbDirect.ts bankGold.ts     # 积存金抓取 + 编排
│     ├─ history.ts streamManager.ts quotesStream.ts # 历史 + 长驻推流
│     ├─ notify.ts              # 通知：原生 LocalNotifications / Web SW 双分支
│     ├─ ota.ts                 # 阶段4：GitHub Releases 检查 + 下载 + 唤起安装
│     ├─ display.ts             # 纯展示辅助（格式化、涨跌配色、来源徽章）
│     └─ usePriceAlerts.ts      # 价格提醒 hook（localStorage + 通知 + 音）
```

## UI/UX 约定

- 深色金融仪表盘风（琥珀金 #F59E0B 主色 + 深空背景）、移动端单列（`max-w-md`）、`focus-visible` 可见、支持 `prefers-reduced-motion`。
- **红涨绿跌**（中国习惯）：涨/利多 = rose(红)，跌/利空 = emerald(绿)。
- 无数据显式空状态（`--` / 「暂无」），不画假线、不伪造跳动。
- JSX 文本不用 ASCII 直引号（用全角「」），避免 `react/no-unescaped-entities`。

### 移动端统一字号系统（用 `ui-ux-pro-max` skill 系统化重做后定，须一致遵循）

- **字号档位只用 5 档（语义化、收敛——主基调是减重 + 消灭越界散档）**：
  | 档 | 用途 | Tailwind 类 |
  |---|---|---|
  | 辅助 | 徽章/时效/时间/单位/计数/来源/图例/状态 | `text-[13px]`（统一辅助档，**消灭** 散落的 `text-xs/[12px]/[11px]/[10px]`） |
  | 正文 | select/input/button/银行名/列表项/说明/阈值 | `text-sm`（14px，**密集数据看板的舒适密度，刻意不抬到 16px**） |
  | 标题 | 各卡 h2、页面 h1 | `text-base font-semibold`（**靠字重拉层级**，不用 `text-lg`） |
  | 价格数值 | HeroPrice 子卡价 / 积存金价 | `text-lg`（18px） |
  | 主价 | 仅 HeroPrice 主价 1 处 | `text-[28px]`（由 `text-3xl` 降半档减压迫） |
  - 例外保留 `text-3xl`：启动页/同意门 hero 标题、诊断反馈 6 位编号（欢迎/核心大数字处）。
  - 例外保留 `text-[11px]`：仅趋势图叠在画布上的轴单位提示 / 悬停 tooltip（极挤处硬下限，升档会遮挡曲线）；lightweight-charts 画布内 `fontSize:11` 同理不动。
- **核心数据绝不被截断**（`ui-ux-pro-max` 准则）：价格/汇率/阈值/时间(HH:MM:SS) 一律 `whitespace-nowrap`，放不下靠缩档或调列宽，**绝不 `truncate`**；仅名称类（标的名/银行名/数据源）可 `truncate`。
- **卡片外壳统一** `rounded-2xl p-4`（告别 3xl/p-5/p-3 混用）；**内部子卡** `rounded-xl p-3`（比外壳小一级形成层级）。
- **触控区**：主控件（输入框/下拉/添加/下载安装等主动作）`min-h-11`（44px）；列表内联次级按钮（启用/删除/检查更新/通知开关）`min-h-9`（36px）且彼此间距 `gap-2`（≥8px）。
- **防溢出三件套**：横向布局子项加 `min-w-0` + 名称类 `truncate`，固定/核心元素加 `shrink-0`；全局 `html,body { overflow-x: hidden }` 兜底（杜绝左右拖动）。
- **滚动条**：`body` 隐藏滚动条（`scrollbar-width:none` + `::-webkit-scrollbar{display:none}` + `-ms-overflow-style:none`）但保留滚动；`html` 加 `touch-action: manipulation`（去 300ms 点击延迟）+ `overscroll-behavior-y: contain`（防误触下拉）。
- 容器统一横向 `px-4`，header 不再额外缩进，与卡片左右对齐。

## 诚实边界（最高准则）

数据/口径：
- 人民币金价 = **理论换算价**，非任何交易所成交价，已标注。
- 积存金「估算」项已明确标注来源与原因，不冒充直连真实数据。
- 行情可能延时；不预测涨跌、不喊点位。页脚明示「学习辅助工具，非投资建议，投资有风险」。

App 形态特有边界：
1. **数据需联网**：行情/积存金来自外部接口，内嵌 Node 仍要联网抓取。「数据闭环」指不依赖
   自建云服务器，**不是离线可用**。
2. **后台离线提醒不保证**：内嵌 Node 是进程内服务，App 被系统杀死即停。前台/亮屏时通知可靠
   （已解决 denied 死结）；后台可靠提醒需「云端+推送」，本期不做。用系统「免后台限制/自启动」
   可缓解，但厂商层面无法 100% 保证。
3. **内嵌 Node 是 Node 18（已 EOL）**：功能可用但非最新；打包 Node 运行时使 apk 体积偏大（数十 MB）。
4. **工行/建行直连为实测项**：内嵌 Node 的 OpenSSL 含 legacy 选项是利好信号，但老旧 TLS 能否
   在装机环境握手成功**须实测**；失败则自动回退聚合源（huimiao/京东）并如实标注，数据仍在。
5. **升级非完全静默**：Android 安全机制要求安装时用户在系统弹窗点「安装」，并允许本应用
   「安装未知应用」，OTA 只能把人送到那一步。

> 装机待实测项（尚未在真机验证，不打包票）：工行/建行老旧 TLS 握手；IPC 通道连通性；
> 原生通知前台弹出；OTA 识别新 Release → 下载 → 唤起安装。
