# 黄金看板·手机版（PhoneApp）

面向中国黄金小白的**手机网页版**看板，作为主项目的一个**隔离分支**独立存在。

> ⚠️ **隔离契约**：本目录 `PhoneApp/` 与主项目（`D:\Goldpricemonitoring\src` 等）**完全解耦**——
> 自带 `package.json`、自带 `node_modules`、自带数据抓取、独立端口（3100）。
> **不 import 主项目任何代码，不修改主项目任何文件**（架构/内容均不受影响）。
> 数据源「思路」参考自主项目（同样的真实上游接口），但代码为本目录独立实现。

---

## 功能（本期）

1. **实时金价 + 价格提醒**
   - 人民币理论金价（XAU/USD × USD/CNY ÷ 31.1035，**理论换算价、非成交价**）为主视觉。
   - 伦敦金、美元汇率、Au99.99 / Au(T+D) / 沪金主力快捷指标。
   - 价格提醒：本地 `localStorage` 存规则，触达阈值时顶部 toast + 可选系统通知 + Web Audio 提示音；
     同规则满足只响一次，价格离开阈值才复位。
2. **银行积存金对比**
   - 8 家银行（工/建/中/招/兴业/浙商/民生/广发）积存金买入价/卖出价/点差对比。
   - 可按「买入价低→高」或「点差小→大」排序，真实数据优先置顶。
   - 来源徽章：●官网直连 / ●京东平台 / ●第三方聚合 / ●估算（**估算项明确标注，绝不冒充真实**）。

## 数据源（独立抓取，服务端 API 路由）

| 接口 | 数据 | 上游 |
|---|---|---|
| `GET /api/quotes` | 行情快照（伦敦金/汇率/SGE 现货/沪金 + 计算的人民币理论价、金银比） | 新浪财经 `hq.sinajs.cn`（GB18030 解码 + finance.sina.com.cn Referer 必填）+ Gold-API 备用 |
| `GET /api/bank-gold` | 8 家银行积存金报价 | 工行/建行官网直连（`node:https` + 老旧 TLS legacy renegotiation）、汇喵 huimiao、京东金融平台；缺数据则基于基准价+已知点差**估算兜底** |

### 字段陷阱（已在代码注释中标明）

- 新浪 `gds_`（SGE 现货）需 `fields.length>=14`；`idx2/idx3` 身份有争议**不当 bid/ask**；涨跌基准用 `idx7`。
- 新浪 `nf_`（沪金主力）涨跌按**昨结算价 idx10**算，不是昨收；时间 `idx1` 是 `HHMMSS`。
- 工行/建行官网为**老旧 TLS**，必须 `node:https` + `SSL_OP_LEGACY_SERVER_CONNECT`（全局 fetch 会失败）。
- huimiao 字段名**反直觉**：`purchase_value`=你买入价，`sale_value`=你卖出价。
- 京东只给**单边价**（卖出），买入价用全点差**估算**（卖出边真实、买入边估算，但 source 仍标京东）。
- 工行官网不暴露赎回价 → **不设 bid**（避免伪造 0 点差）。
- 真实/估算只靠 `source` 子串判定：含「官网」「汇喵」「京东积存金」= 真实。

## 运行

```bash
cd PhoneApp
npm install
npm run dev      # http://localhost:3100（手机同 Wi-Fi 用电脑局域网 IP:3100 访问）
npm run build
npm run lint
npx tsc --noEmit
```

> 手机访问：电脑与手机连同一 Wi-Fi，手机浏览器打开 `http://<电脑局域网IP>:3100`。
> 也支持「添加到主屏幕」当作类 App 全屏使用（已配 viewport + apple-web-app meta）。

## 目录结构

```text
PhoneApp/
├─ package.json            # 独立依赖，dev/start 端口 3100
├─ tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs .gitignore
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx        # 移动端 viewport / 主题色 / PWA meta
│  │  ├─ page.tsx          # 主页面：轮询 + 提醒 + 三块卡片
│  │  ├─ globals.css       # 深色金融风 + 红涨绿跌闪动 + reduced-motion
│  │  └─ api/
│  │     ├─ quotes/route.ts      # 行情快照（独立抓取）
│  │     └─ bank-gold/route.ts   # 积存金对比（独立抓取）
│  ├─ components/
│  │  ├─ HeroPrice.tsx           # 主价格 + 国际锚价/汇率 + 国内现货快捷行
│  │  ├─ PriceAlertCard.tsx      # 提醒规则增删/启停
│  │  ├─ AlertToast.tsx          # 触发提示（createPortal 到 body）
│  │  └─ BankGoldCompare.tsx     # 积存金对比卡片列表
│  └─ lib/
│     ├─ types.ts               # Quote 等类型（与主项目互不引用）
│     ├─ sina.ts goldApi.ts computed.ts quotes.ts   # 行情抓取 + 编排
│     ├─ icbcDirect.ts ccbDirect.ts bankGold.ts     # 积存金抓取 + 编排
│     ├─ display.ts             # 纯展示辅助（格式化、红涨绿跌、来源徽章）
│     └─ usePriceAlerts.ts      # 价格提醒 hook（localStorage + 通知 + 音）
```

## UI/UX 约定

- 深色金融仪表盘风、移动端单列、触控区 ≥44px、`focus-visible` 可见、支持 `prefers-reduced-motion`。
- **红涨绿跌**（中国习惯）：涨/利多 = rose(红)，跌/利空 = emerald(绿)。
- 无数据显式空状态（`--` / 「暂无」），不画假线、不伪造跳动。
- JSX 文本不用 ASCII 直引号（用全角「」），避免 `react/no-unescaped-entities`。

## 诚实边界（最高准则）

- 人民币金价 = **理论换算价**，非任何交易所成交价，已标注。
- 积存金「估算」项已明确标注来源与原因，不冒充直连真实数据。
- 行情可能延时；不预测涨跌、不喊点位。页脚明示「学习辅助工具，非投资建议，投资有风险」。
